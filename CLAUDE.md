# CLAUDE.md

Application web auto-hébergée pilotant une batterie EcoFlow Delta Max 2000
+ micro-onduleur PowerStream en fonction de la production / consommation
électrique mesurées via Tuya et Shelly. Réseau LAN interne, pas
d'authentification.

## Architecture

Monorepo `pnpm` (workspaces) :

- `apps/web` — Next.js 15 (App Router, TypeScript, Tailwind, shadcn/ui).
  Pages : `/` dashboard, `/flow` schéma de flux animé, `/agent`, `/devices`,
  `/rules`, `/control`, `/loads`, `/tariffs`, `/history`, `/kiosk`.
- `apps/worker` — process Node.js : poller Tuya 30 s, MQTT EcoFlow privé
  (lecture + écriture), poller Tempo 1 h, moteur de règles, boucle
  FOLLOW_LOAD, agent LLM (Ollama) sur intervalle.
- `packages/shared` — clients Tuya / EcoFlow (cloud + privé) /
  PowerStream (protobuf) / Shelly / Ollama / météo / Tempo, DSL de
  règles, types Zod.
- `prisma/` — schéma PostgreSQL (devices, readings, controlState…).

Déploiement : `docker compose up -d` (services `postgres`, `web`, `worker`).
Postgres en binding interne uniquement (pas de port hôte par défaut, évite
un conflit local sur 5432).

## Pilotage EcoFlow — IMPORTANT

L'API REST publique EcoFlow (`/iot-open/sign/device/quota`) **renvoie
systématiquement `1006: current Device is not allowed to be controlled`
sur Delta Max** (modèle gen 1, pas listé sur le Developer Portal). Toutes
les écritures passent donc par le **MQTT privé** (le canal utilisé par
l'app mobile).

### Delta Max — JSON via MQTT privé

Format validé en live (`packages/shared/src/ecoflow-private.ts`) :

- Topic : `/app/{userId}/{sn}/thing/property/set`
- Payload (string JSON) :
  ```json
  {
    "from": "HomeAssistant",
    "id": "<string sequence 999900000+random>",
    "version": "1.0",
    "moduleType": <int>,
    "operateType": "TCP",
    "params": { "id": <int>, ... }
  }
  ```

Mapping Delta Max (`apps/worker/src/rules/ecoflow-cmds.ts`) :

| Action                        | moduleType | params                              |
|-------------------------------|------------|--------------------------------------|
| Charge AC slow (100..2000 W)  | 0          | `{ id: 69, slowChgPower: <W> }`     |
| Sortie AC ON/OFF              | 0          | `{ id: 66, enabled: 0\|1 }`         |
| SoC max charge                | 2          | `{ id: 49, maxChgSoc: <%> }`        |
| SoC min décharge              | 2          | `{ id: 51, minDsgSoc: <%> }`        |

`setDischargeWatts` retourne `null` sur Delta Max : ce modèle ne sait pas
moduler sa décharge AC (juste ON/OFF).

### PowerStream — Protocol Buffers

Le PowerStream EcoFlow (HW51… SN différent de la batterie) utilise
**protobuf** (`packages/shared/src/ecoflow-powerstream.ts`, schéma porté
depuis `tolwi/hassio-ecoflow-cloud`).

- Même topic publish : `/app/{userId}/{sn}/thing/property/set`
- Payload : bytes binaires `PowerStreamSendHeaderMsg { msg: [PowerStreamHeader { cmd_func, cmd_id, pdata }] }`
- Encoding via `protobufjs/light` avec descripteur JSON inline.

Mapping `cmd_func` / `cmd_id` :

| Action                         | func | id  | sous-message                     |
|--------------------------------|------|-----|----------------------------------|
| Puissance fixe (×10 dW)        | 20   | 129 | `PermanentWattsPack`             |
| Priorité alim/stockage         | 20   | 130 | `SupplyPriorityPack` (0/1)       |
| SoC haut                       | 20   | 133 | `BatUpperPack`                   |
| SoC bas                        | 20   | 132 | `BatLowerPack`                   |
| Sécurité injection             | 20   | 143 | `SetValue`                       |

**Attention** : `permanent_watts` est en **dixièmes de W** (ex. 400 W → 4000).
`supply_priority` : `0 = Prioritize power supply` (alimentation maison),
`1 = Prioritize power storage` (priorité charge batterie).

### Différence sortie AC Delta Max vs PowerStream

- La **sortie AC de la Delta Max** est **off-grid** : alimente uniquement
  les appareils branchés directement sur ses prises. Pas synchronisée
  avec ENEDIS, pas certifiée pour injection.
- Le **PowerStream** est un **micro-onduleur grid-tied** : injecte sur le
  réseau maison en synchronisation phase/fréquence avec ENEDIS. C'est
  lui qui permet à la batterie d'alimenter la maison entière.

## Pipeline `getDashboardSnapshot` (`apps/web/lib/snapshot.ts`)

Logique critique, plusieurs fix successifs. Lire avant de toucher :

### `batteryPowerW`

Cherché dans cet ordre :

1. **Prise AC Tuya** : si `switchOn === true && powerW > 30`, on prend
   `-acSwitchPowerW` directement (la mesure AC réelle d'entrée batterie,
   plus fiable que le BMS qui peut envoyer des pics transitoires).
2. **PowerStream stable** : si `priority === 0` (alimentation) et
   `permanentWatts > 30`, on plancher `batteryPowerW` à cette consigne.
   Évite l'oscillation 0 W ↔ valeur BMS quand le BMS ne pousse pas régulièrement.
3. **BMS direct** depuis le reading.
4. **Bilan énergétique** : `conso − prod − grid` avec seuil 30 W.
5. **Prise AC charging** ON + powerW > 5 → `-acSwitchPowerW`.
6. **Dérive du SoC sur 60 min**.

Guards finaux (avant retour) :
- Seuil 30 W absolus → batterie idle.
- Cohérence prise AC : si `switchOn === false`, toute valeur `< 0`
  (charging) est rejetée → 0.

### `consumptionW`

Bilan énergétique forcé : `consumption = production + grid_signed + ps`

- `ps` = `powerstreamPermanentW` UNIQUEMENT si `powerstreamPriority === 0`
  (mode alimentation). En mode stockage le PS n'injecte pas, on ne le
  compte pas dans le bilan.
- La batterie étant branchée sur un circuit maison via la prise AC IN,
  sa charge fait partie de la conso (elle apparaît au compteur).
- On ne déduit pas la batterie du bilan : la conso reflète ce qui passe
  physiquement au point de livraison.

Capacité batterie : `BATTERY_CAPACITY_WH = 2016` (Delta Max 2000).

## Mode FOLLOW_LOAD (`apps/worker/src/rules/follow-load.ts`)

Auto-conso bidirectionnelle : à chaque tick (toutes les `POLL_INTERVAL_SECONDS`) :

1. **Resync prise Tuya** : si l'état réel diffère du dernier appliqué
   (quelqu'un l'a coupée manuellement), on synchronise pour éviter
   l'idempotence trompeuse.
2. **Tempo discharge programmée** : si on est dans `[startHour, endHour)`
   selon couleur Tempo (RED → `tempoRedDischargeHour`, autre →
   `tempoOtherDischargeHour`) :
   - Sur **transition** d'entrée/sortie de fenêtre, push automatique de
     `powerstreamPriority` (0 entrée, 1 sortie). Hors transition, le
     choix manuel utilisateur est respecté.
   - **Fenêtre de réveil** : `tempoWakeupBeforeMin` (défaut 15 min)
     avant `endHour`, on rallume la prise Tuya AC IN pour sortir la
     batterie de veille profonde, prête à charger dès l'aube.
   - Hors fenêtre de réveil : prise OFF + charge à 0.
3. **Charge sur surplus solaire** :
   - Démarrage : surplus ≥ `chargeMinW + 50 W` (hystérésis), SoC < `maxChargeSoc`.
   - Cible : `clamp(surplus − chargeOffsetW, [chargeMinW, chargeMaxW])`.
   - **Rampe** : variation max ±100 W par tick (~+200 W/min).
   - **Tolérance déficit** (`chargeDeficitTimeoutMin`, défaut 10 min) :
     si surplus < `chargeMinW` continu pendant cette durée, on coupe la
     prise.
   - **Verrou redémarrage** (`chargeOffToOnLockMin`, défaut 5 min) :
     après une coupure, on bloque tout ré-allumage pendant cette durée.
4. **Décharge** (Delta Max ne module pas, sortie libre) : sur déficit
   (`gridW > 30 W`) et `SoC > minDischargeSoc`, on coupe la prise pour
   laisser la batterie alimenter la maison via son inverter ou via le
   PowerStream selon le câblage.

État live exposé via `GET /follow-load/state` (worker) → proxy
`/api/follow-load/state` : compteurs déficit + verrou en temps réel pour
l'UI.

## EDF Tempo

Récupéré 1×/h via `api-couleur-tempo.fr` (sans auth). Stocké dans
`ControlState.tempoColor` / `tempoColorTomorrow`. Utilisé pour la
décharge programmée (heures différentes selon couleur).

## Détection live d'appareils (`/api/loads/live`)

Comparaison conso bilanée actuelle (`prod + grid`, **sans PS** car la
baseline est apprise sans injection) à une **double baseline** apprise
sur 7 jours :

- **Nuit** (utilisée si heure ∈ [22h-6h]) : médiane des minutes 2h-5h
  (presque rien ne tourne).
- **Jour** (utilisée sinon) : 35e percentile sur 8h-22h. Compromis entre
  p25 (trop bas, capte les creux du matin) et p50 (qui inclut les
  appareils qui tournent souvent).

Override manuel possible via `loadsBaselineW` (champ "Forcer plancher"
sur `/loads`).

Pour chaque `LoadProfile`, `currentlyOn = |delta - expectedW| <= toleranceW`,
avec `confidence ∈ [0, 1]`.

## Agent LLM (`apps/worker/src/agent`)

- Ollama, `think=false`, streaming `keep_alive`.
- Dispatcher `undici` sans `bodyTimeout` côté worker ET côté web.
- Timeout 30 min côté agent, prompt trimmé.
- Mode démo : `runAgent("demo", { dryRun: true })` — calcule la proposition
  sans rien appliquer (badge violet `démo` sur `/agent`).
- Contexte enrichi : `consumption_live` (currentW, baseW, deltaW),
  `loads[i].currentlyOn` + `confidence`, `consumption_pattern` (28
  buckets dow×slot), `weather_forecast`, `tariffs`, `control_state`.

## Conventions de signe

- Batterie : **+ = décharge, − = charge**.
- Grid : **+ = import, − = export**. `surplusW = -gridW`.
- PowerStream `permanent_watts` : valeur en **dixièmes de W**.
- PowerStream `supply_priority` : `0 = alimentation`, `1 = stockage`.

## APSystems DS3 — micro-onduleurs PV (passerelle Zigbee custom)

Lecture des micro-onduleurs **APSystems DS3** (et compatibles YC600 / QS1)
**sans la ECU officielle** (200-400 €). On reproduit son rôle avec une
passerelle DIY ESP8266 + module Zigbee CC2530+CC2591 (~30 €) qui parle
le protocole Zigbee propriétaire APSystems et republie les trames en
**MQTT**. Firmware de référence :
[`patience4711/read-APSystems-YC600-QS1-DS3`](https://github.com/patience4711/read-APSystems-YC600-QS1-DS3).

Cas d'usage : **2ᵉ maison** (mutualisée via le même repo, déploiement
Docker séparé sur mini-PC d'occasion type EliteDesk Mini ou ThinkCentre).
On veut surveiller la santé de **chaque panneau** ET de **chaque
onduleur** (détection panneau sale / diode bypass HS / onduleur muet).

### Topics MQTT attendus

L'ESP doit publier sur :

- `apsystems/<inverterSn>/data` — payload JSON complet (périodique)
- `apsystems/<inverterSn>/status` — `online` | `offline` (LWT)

Format du payload `data` (validé Zod dans `packages/shared/src/apsystems.ts`) :

```json
{
  "sn": "406000123456",
  "ts": 1714291200,
  "online": true,
  "tempC": 42.3,
  "acV": 233.1,
  "acHz": 50.02,
  "signalDb": -65,
  "panels": [
    { "i": 0, "dcV": 35.2, "dcA": 8.1, "pW": 285, "energyWh": 12345 },
    { "i": 1, "dcV": 35.0, "dcA": 7.9, "pW": 276, "energyWh": 12100 }
  ]
}
```

`panels[].i` = index MPPT (0/1 pour DS3 DUO). 1 onduleur DS3 = 2 panneaux.

### Variables d'env worker

- `APSYSTEMS_MQTT_URL` : ex `mqtt://192.168.1.10:1883` (vide = poller off)
- `APSYSTEMS_MQTT_USER` / `_PASSWORD` : auth broker (optionnel)
- `APSYSTEMS_TOPIC_PREFIX` : défaut `apsystems`
- `APSYSTEMS_MOCK=1` : active un générateur de courbe solaire simulée
  (`generateMockInverter` dans le shared) pour dev sans matos
- `APSYSTEMS_MOCK_INTERVAL_S` : période du mock (défaut 15 s)

### Pipeline d'ingestion (`apps/worker/src/pollers/apsystems.ts`)

1. `startApsystemsMqtt` : subscribe `<prefix>/+/data` et `<prefix>/+/status`
2. À chaque trame, lookup `Device` par `externalId === sn` et
   `type === APSYSTEMS_INVERTER`. Si absent ou désactivé, ignore.
3. `ingestInverterMessage` :
   - Insère N lignes `SolarPanelReading` (1 par panneau) avec valeurs
     onduleur dupliquées (`acV/acHz/tempC/signalDb`) pour faciliter les
     requêtes.
   - Insère **aussi** un `Reading` agrégé (somme des `pW`) pour que
     l'onduleur tombe dans les agrégats horaires standards
     (`ReadingHourly`). Le rôle `SOLAR_INVERTER` est distinct de
     `PRODUCTION_METER` donc l'onduleur n'impacte **pas** le
     `productionW` du dashboard EcoFlow (séparation propre).
4. `runHealthChecks` (synchrone à chaque trame) : voir section suivante.
5. `startApsystemsHealthLoop` (tick 60 s) : `checkSilentInverters` —
   raise une alerte `INVERTER_SILENT` si dernière `SolarPanelReading`
   > 10 min.

### Health checks (`HealthAlert` + enums `HealthAlertKind/Severity`)

| Kind | Seuil | Severity | Resolve auto |
|---|---|---|---|
| `INVERTER_SILENT` | dernière trame > 10 min | CRITICAL | oui (à la prochaine trame) |
| `PEER_IMBALANCE` | écart panneaux jumeaux > 25 % et `max ≥ 50 W` | WARN | oui |
| `OVER_TEMPERATURE` | `tempC > 75` | WARN | oui |
| `GRID_FREQ_OUT` | `acHz` ∉ [49.5, 50.5] | CRITICAL | oui |
| `WEAK_SIGNAL` | `signalDb < -85` dBm | INFO | oui |
| `PANEL_LOW_DC` | (placeholder, à implémenter) | — | — |

Les alertes sont **persistées** ; les alertes en cours sont celles
avec `resolvedAt = null`. La page `/solar` affiche un bandeau pour
chacune. À chaque trame, les checks décident raise/resolve.

Logique "jumeaux" : panneaux pairs adjacents (`i=0` ↔ `i=1`,
`i=2` ↔ `i=3`), correspond aux 2 entrées MPPT d'un DS3 DUO.

### Page `/solar` (`apps/web/app/solar/`)

- Header : production instantanée totale, énergie du jour, nb
  panneaux/onduleurs.
- Bandeau d'alertes en cours (couleur selon severity).
- Pour chaque onduleur (`InverterPanel`) :
  - Statut OK/silencieux, T°, AC V/Hz, RSSI Zigbee, total W + énergie jour
  - Grille panneaux (`PanelTile`) : P/V/I, énergie cumulée, ratio vs
    jumeau (alerte visuelle si ratio < 0.75 ou > 1.33), barre de
    puissance normalisée à 400 W
  - Graphe 24h superposé par panneau (recharts `AreaChart`,
    bucketisation 5 min côté server, max 288 points × N panneaux)
- État vide : instructions pour créer un device + activer le mode mock.

### Mode mock (dev sans matos)

`generateMockInverter(cfg, now)` dans `packages/shared/src/apsystems.ts` :
- Profil solaire en cloche centré sur 13h (Europe/Paris), atténué de 7h à 19h
- Variation nuageuse via `sin(now / 600s)`
- Léger déséquilibre déterministe par panneau (~5 %, seed = SN+i)
- Température corrélée à la puissance instantanée

Activation : créer 2 devices `APSYSTEMS_INVERTER` avec SN factices
(`406000000001`, `...02`) puis `APSYSTEMS_MOCK=1` dans `.env` worker
+ restart. Les valeurs simulées tombent toutes les 15 s dans
`SolarPanelReading` et le dashboard `/solar`.

### Matériel à acheter (2ᵉ maison)

- **Mini-PC d'occasion** (HP EliteDesk 800 G3 Mini ou Lenovo M720q) :
  ~120-180 € sur Backmarket / LeBonCoin. x86_64 = compatibilité Docker
  parfaite, plus solide qu'un Raspberry Pi pour Postgres long terme.
- **ESP8266 NodeMCU v3** : ~5-8 €
- **Module Zigbee CC2530+CC2591** (avec PA + antenne externe SMA) : ~10-15 €
  → **PAS** un CC2530 nu, **PAS** un Sonoff Zigbee 3.0 (incompatible,
  protocole APSystems custom)
- **CP2102 USB-TTL** : ~3-5 € (flash CC2530 une fois)
- **Câbles Dupont** F/F + M/F : ~3-5 €
- **Tailscale** (gratuit) pour accès distant entre les 2 maisons.

Pré-requis pairing : récupérer les **SN à 12 chiffres** sur l'étiquette
de chaque DS3 (sous le panneau ou sur la facture).

### Conventions APSystems

- `panelIndex` : 0-based, `panelIndex + 1` à l'affichage utilisateur.
- DS3 DUO = 2 entrées MPPT par onduleur.
- Watts : valeurs DC et AC en **W entiers** (pas de dW comme PowerStream).
- Energie cumulée `energyWh` : depuis le démarrage de l'onduleur, peut
  reset si le DS3 a été coupé. Ne jamais s'en servir comme « énergie du
  jour » — calculer plutôt l'intégrale `pW × dt` côté server (méthode
  utilisée dans `apps/web/app/solar/page.tsx`).

## Schéma BD `Device`

Rôles enum Prisma : `PRODUCTION_METER`, `CONSUMPTION_METER`, `GRID_METER`,
`BATTERY`, `BATTERY_AC_SWITCH`, `POWERSTREAM`, `SOLAR_INVERTER`.

Types enum Prisma : `TUYA_METER`, `TUYA_SWITCH`, `ECOFLOW_BATTERY`,
`SHELLY_METER`, `APSYSTEMS_INVERTER`.

`ControlState` (key=`default`) — champs clés ajoutés :

- Charge : `chargeMinW` (400), `chargeMaxW` (800), `chargeOffsetW` (100),
  `chargeDeficitTimeoutMin` (10), `chargeOffToOnLockMin` (5).
- Tempo : `tempoEnabled`, `tempoColor`, `tempoColorTomorrow`,
  `tempoRedDischargeHour` (17), `tempoOtherDischargeHour` (22),
  `tempoDischargeEndHour` (6), `tempoDischargeTargetW` (400),
  `tempoWakeupBeforeMin` (15).
- PowerStream : `powerstreamSn`, `powerstreamPermanentW`,
  `powerstreamPriority`.
- Loads : `loadsBaselineW` (override manuel ou null = auto).

## Accès & déploiement

- **Serveur** : 192.168.0.26 (LAN interne)
- **SSH** : `ssh coulpi@192.168.0.26` (clé publique)
- **Répertoire** : `/home/app_energie_ecoflow_villennes`
- **Web UI** : http://192.168.0.26:3010 (port hôte 3010 → conteneur 3000)
- **Repo** : https://github.com/coulpi/app_energie_ecoflow_villennes
- **Déploiement** : push sur `main`, puis
  ```bash
  ssh coulpi@192.168.0.26 "cd /home/app_energie_ecoflow_villennes && bash ./scripts/deploy.sh"
  ```
  Le script fait `git fetch/reset --hard origin/main`, rebuild les images
  Docker, redémarre `web` + `worker`, applique `prisma db push`.
- **Logs** : `ssh coulpi@192.168.0.26 "cd /home/app_energie_ecoflow_villennes && docker compose logs -f web"` (ou `worker`).
- **Espace disque** : surveiller le cache Docker, lancer périodiquement
  `docker system prune -af --volumes` (libère typiquement ~40 GB de cache build).

## Endpoints HTTP utiles (debug / test)

Worker (port 3100, exposé via proxy Next) :

- `GET /follow-load/state` → état live (deficit, offLock).
- `GET /ecoflow/status` → connexion MQTT privée OK.
- `GET /ecoflow/recent?n=20` → ring buffer 50 derniers messages MQTT.
- `POST /ecoflow/cmd` → commande JSON Delta Max (`{sn, moduleType, operateType, params}`).
- `POST /ecoflow/raw` → publish raw arbitraire `{topic, payload}` (debug).
- `POST /ecoflow/powerstream/cmd` → commande PowerStream
  (`{sn, kind: permanentWatts|supplyPriority|batUpper|batLower|feedProtect, ...}`).

## Commandes

```bash
pnpm dev:web              # Next dev server
pnpm dev:worker           # worker en watch
pnpm build                # build récursif
pnpm prisma:migrate       # migration dev
pnpm prisma:studio        # UI Prisma
docker compose up -d      # stack complète
```

## Variables d'environnement clés

EcoFlow : `ECOFLOW_ACCESS_KEY`, `ECOFLOW_SECRET_KEY`, `ECOFLOW_API_BASE`
(REST publique, lecture surtout), `ECOFLOW_EMAIL`/`ECOFLOW_PASSWORD`
(API privée — c'est elle qu'on utilise pour les commandes),
`ECOFLOW_MQTT_BROKER/PORT`.
Tuya : `TUYA_CLIENT_ID/SECRET/REGION/API_BASE`.
Agent : `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `AGENT_INTERVAL_MINUTES`,
`AGENT_ENABLED`. Maison : `HOME_LAT/LON/TZ`.
Rétention : `RAW_RETENTION_DAYS` (30), `HOURLY_RETENTION_DAYS` (365).
Sécurité batterie : `BATTERY_CRITICAL_SOC` (5).
