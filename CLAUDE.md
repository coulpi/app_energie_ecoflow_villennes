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

## Schéma BD `Device`

Rôles enum Prisma : `PRODUCTION_METER`, `CONSUMPTION_METER`, `GRID_METER`,
`BATTERY`, `BATTERY_AC_SWITCH`, `POWERSTREAM`.

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
