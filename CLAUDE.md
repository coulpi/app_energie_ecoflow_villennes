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

### Delta Max — broadcasts BMS sporadiques + ping `/get`

**Le BMS Delta Max gen 1 ne diffuse qu'en bursts** (pendant les transitions
de charge/décharge) puis reste muet 30-70 min en idle. Conséquence : le
SoC affiché peut rester périmé pendant des heures (ex. 74% sticky alors
que la batterie est en réalité à 100%). Et REST `/iot-open/sign/device/quota/all`
renvoie aussi 1006 → pas de poll actif possible par cette voie.

**Solution validée en live** : le BMS répond à un ping MQTT sur le topic
`/app/{userId}/{sn}/thing/property/get` (payload minimal `{from, id, version}`).
Implémenté via `requestEcoFlowPrivateQuota` dans `packages/shared/src/ecoflow-private.ts`,
appelé toutes les 60 s par `startEcoFlowQuotaPing` (`apps/worker/src/pollers/ecoflow.ts`).
Quelques secondes après chaque ping, le BMS pousse un broadcast complet
(SoC, inputW, outputW). Sticky SoC réduit à **15 min** dans `snapshot.ts`
(au-delà → null/`—` plutôt qu'une valeur fausse).

### Détection "batterie pleine" dans follow-load

Si la **prise AC est ON depuis >2 min** et tire **<30 W** alors qu'on
commande `slowChgPower > 0`, c'est que le BMS refuse — la batterie est
pleine en réalité (le SoC affiché peut être obsolète si le ping n'a pas
encore tourné). On coupe la prise, on verrouille `offToOnLockMin`, et on
bascule le **PowerStream en `alimentation`** (priority=0) pour valoriser
le surplus au lieu de l'exporter au réseau. Implémenté dans
`apps/worker/src/rules/follow-load.ts` (constantes `FULL_BATTERY_GRACE_MS`
et `FULL_BATTERY_PLUG_THRESHOLD_W`).

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

1. **Prise AC Tuya — autoritaire pour exclure une charge** :
   - Si `sw.powerW > 30` (peu importe `switchOn` qui n'est rempli que
     pour `TUYA_SWITCH`, pas `TUYA_METER`) → `-sw.powerW` (mesure AC
     réelle, plus fiable que les pics transitoires du BMS).
   - Sinon, on calcule `plugSaysNotCharging = sw.switchOn === false || sw.powerW <= 30`.
     Cette condition est utilisée plus bas pour **plafonner à 0** toute
     charge fantôme (BMS stale, bilan désynchronisé, etc.).
2. **BMS direct** depuis le reading.
3. **Bilan énergétique** : `conso − prod − grid` avec seuil 30 W,
   clampé `[-2200, +2200]`. Si `plugSaysNotCharging`, on plafonne le
   résultat à 0 (pas de charge) — évite la fausse "Charge 2200 W"
   quand le BMS est stale et que prod/grid/conso sont déphasés.
4. **Dérive du SoC sur 60 min**.

Guards finaux (avant retour) :
- Seuil 30 W absolus → batterie idle.
- Cohérence prise AC : si `switchOn === false`, toute valeur `< 0`
  (charging) est rejetée → 0.

**Important** : `switchOn` n'est rempli que par le poller Tuya pour les
devices `TUYA_SWITCH`, pas `TUYA_METER` (cf. `apps/worker/src/pollers/tuya.ts`).
Donc une garde du type `sw?.switchOn === true && sw.powerW > 30` saute
silencieusement pour les meters → utiliser `sw.powerW > 30` seul comme
preuve de charge.

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

## Jacuzzi Intex — pilotage chauffage par surplus

Setup physique :

- **Jacuzzi gonflable Intex PureSpa** (avec module Wi-Fi natif sur le
  bloc de commande). Le module Wi-Fi est **toujours alimenté** : il
  tient l'état chauffage / pompe / bulles, c'est lui qu'on commande.
- **Prise Tuya en amont** : déjà configurée dans `Device` (rôle
  `APPLIANCE`), mesure la conso totale du jacuzzi (chauffe ~1900 W +
  pompe filtration ~50 W). **Ne JAMAIS la couper** : couper la prise
  efface l'état du contrôleur Intex et casse le pilotage Wi-Fi.

Stratégie de pilotage :

- L'**actionneur** est le module Wi-Fi Intex (commande `heater on/off`),
  pas la prise Tuya.
- **Allumage chauffe** : surplus solaire (`-gridW`) ≥ ~1500 W pendant 2
  min ET SoC batterie suffisant (sinon on pomperait sur la batterie),
  hors heures Tempo rouge HP.
- **Coupure chauffe** : `gridW > 300 W` pendant 5 min (= la maison
  importe du réseau, le jacuzzi n'est plus "gratuit").
- Hystérésis large pour éviter le cyclage du relais Intex (durée de vie
  limitée vs un Shelly).

Intégration Wi-Fi Intex :

- Référence : `mathieu-mp/homeassistant-intex-spa` (HACS), basée sur la
  lib Python `mathieu-mp/intex-spa`. Compatibilité = panneau de
  commande dont le code gravé **NE contient PAS "TY"** (modèles
  SB-HWF20, SB-HSWF20, SC-WF20, SC-WF20-1).
- Client TS porté dans `packages/shared/src/intex-spa.ts` (export
  namespace `intexSpa`). Connexion TCP sur **port 8990**, requête JSON
  `{data: <hex+checksum>, sid: <timestamp>, type: 1|2|3}`, réponse JSON
  avec status encodé en bigint (bits 104-109 = power/filter/heater/jets/
  bubbles/sanitizer, octet 88-95 = temp courante, octet 24-31 = preset).
- Commandes hex (toggle, le module inverse l'état → on lit `status`
  d'abord et on n'envoie le toggle que si l'état courant ≠ consigne) :
  | Action       | Request hex (avant checksum) |
  |--------------|------------------------------|
  | status       | `8888060FEE0F01`            |
  | power        | `8888060F014000`            |
  | filter       | `8888060F010004`            |
  | heater       | `8888060F010010`            |
  | jets         | `8888060F011000`            |
  | bubbles      | `8888060F010400`            |
  | sanitizer    | `8888060F010001`            |
  | preset_temp  | `8888050F0C` + `<temp hex>` |
- Checksum : 0xFF − Σ(bytes), modulo 0xFF, 0 → 0xFF, sortie hex maj.
- Variables d'env worker à prévoir (dans `.env`) :
  - `INTEX_SPA_HOST` : IP locale du module (DHCP fixé au routeur)
  - `INTEX_SPA_PORT` : défaut 8990
  - `INTEX_SPA_ENABLED` : 0/1
- Boucle dédiée `apps/worker/src/rules/jacuzzi-control.ts` (à créer,
  similaire à `follow-load.ts`), avec champs `ControlState` :
  - `jacuzziEnabled`, `jacuzziStartSurplusW` (1500), `jacuzziStopGridW`
    (300), `jacuzziStartHoldS` (120), `jacuzziStopHoldS` (300),
    `jacuzziMinSocPct` (40), `jacuzziTempoBlockRedHp` (true).

**Reste à faire** : (1) renseigner `INTEX_SPA_HOST` (IP locale du module
Wi-Fi du jacuzzi, à figer en DHCP réservé sur le routeur), (2) écrire
la boucle `jacuzzi-control.ts`, (3) ajouter les champs `ControlState`
au schema Prisma, (4) UI minimale + endpoint `/api/jacuzzi/state`.

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

**Recherche combinatoire** : pour les profils sans `measuredDeviceId`,
on énumère tous les sous-ensembles (2^N, N ≤ 16) et on garde celui dont
la somme `expectedPowerW` est la plus proche du `deltaResidualW` (delta
restant après soustraction des prises mesurées). À distance égale, on
préfère le sous-ensemble avec le plus d'appareils (jacuzzi+pompe = 2400 W
plutôt que voiture seule = 2400 W).

**Important** : si `deltaResidualW > 100 W`, on **exclut le sous-ensemble
vide** de l'énumération. Sans ça, un résiduel de ~250 W (pompe piscine
500 W ±300 attendue) faisait gagner `{}` (dist=250) face à `{pool}`
(dist=253), et la pompe n'était jamais détectée. La règle : un résiduel
clairement non négligeable est une preuve qu'un appareil est actif → le
set vide ne peut pas être la bonne réponse.

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

### Passerelle DIY ESP-ECU — mise en service (2ᵉ maison)

Code firmware patience4711 cloné dans `read-APSystems-YC600-QS1-DS3/`
(non-trackée, juste pour référence locale du `.hex` CC2530 et du source
ESP). Le firmware ESP `ESP-ECU-v10_9a.bin` flashé en mai 2026.

**Câblage validé en live** (via `readMe.txt` du repo, autorité finale) :

```
cc2530+cc2591  →  ESP8266 NodeMCU
   P0_2 (RX)   →  D8 (GPIO15, TX swappé)   [ESP TX → CC RX]
   P0_3 (TX)   →  D7 (GPIO13, RX swappé)   [CC TX → ESP RX]
   RST         →  D5 (GPIO14)
   VCC (3.3V)  →  sortie régulateur 5V→3.3V (PAS le 3V3 du NodeMCU)
   GND         →  GND commun (ESP, régulateur, module)
```

⚠️ **Régulateur 3.3V externe obligatoire** : le LDO interne du NodeMCU
ne tient pas le pic TX du CC2591 (~150 mA). Le 5V du NodeMCU (Vin USB)
alimente un module step-down 5V→3.3V dédié, dont la sortie pilote VCC
du CC2591. Le GND IN/OUT du régulateur étant relié en interne, un seul
fil GND par segment suffit.

⚠️ **Piège câblage TX/RX** : la sérigraphie de certains modules
CC2530+CC2591 est ambiguë. **NE PAS** se fier aux labels "TX"/"RX",
toujours raisonner en pin CC2530 (`P0_2` = RX du CC, `P0_3` = TX du
CC). Symptôme d'inversion : `errorCode 10`, journal `zigbee no
inverter`, console `readZB nothing received` à chaque `sendSB sent`.
Inverser les 2 fils data, le test `10;ZBT=2710AABBCC` doit retourner
`inMessage: FE036710AABBCCA9`.

**Firmware CC2530** : flasher `CC2530ZNP_2591-with-SBL.hex` du dossier
`CC25xxfirmware ds3/` du zip `cc25xx_firmware.zip` (variante avec
support PA CC2591). Les `.hex` Zigbee2MQTT (Koenkk) sont incompatibles,
protocole MT vs APSystems.

**Console websocket** (`/CONSOLE`, mdp `0000`) : commandes utiles
- `10;DIAG` toggle verbose (montre `sendSB`/`readZB` bruts)
- `10;HEALTH` test boot du coordinator
- `10;INIT_N` force re-init coordinator (8 cmd, doit finir sur
  `zigbee running oke` + `ZB coordinator started`)
- `10;ZBT=2710AABBCC` test boucle UART CC2530
- `10;FILES` liste SPIFFS (`Inv_PropN.str` = onduleurs sauvegardés)

**Codes erreur** (cf. `readMe.txt`) :
- `10` : `AF_DATA_REQUEST failed` (en pratique : pas de réponse UART CC)
- `11` : pas de `AF_DATA_CONFIRM` (radio émise, pas de réponse onduleur
  → typique nuit / DC trop faible)
- `12/13` : pas de `ZDO_SRC_RTG_IND` / `AF_INCOMING_MSG`
- `50` : rien reçu
- `100` : pas de réaction matériel (CC2530 absent ?)
- `200` : coordinator pas up

**Pairing** :
- Endpoint `GET /PAIR?inv=N` → page polling `/get.Paired` toutes les 9 s.
  Réponse `{"invID":"1111"}` = en cours, `0000` = échec, autre = OK.
- Échec **`failed, inverter got id 0000`** = onduleur silencieux, 4
  causes possibles : (1) DS3 endormi DC trop bas (< ~25 W/MPPT, typique
  matin tôt / soir / nuit), (2) onduleur déjà appairé à une autre ECU
  active concurrente sur la même fréquence, (3) SN saisi incorrect, (4)
  cases panneaux non cochées (cf. ci-dessous).
- **Fenêtre de pairing utile** : 11h-16h ciel dégagé.
- **ECU APSystems officielle** : doit être **éteinte** pendant le
  pairing (un onduleur n'écoute qu'une ECU à la fois ; le firmware
  patience4711 sait "voler" la paire mais ça échoue si l'ECU officielle
  poll en parallèle sur la même radio).

**Cases panneaux** (`/INV_CONFIG`, checkboxes `pan1..pan4`) : pas
cosmétiques. Déclarent au firmware quelles entrées MPPT lire pour ce
slot. Convention :
- inv 0 → `pan1` + `pan2` (2 entrées du 1er DS3 DUO)
- inv 1 → `pan3` + `pan4` (2 entrées du 2ᵉ DS3 DUO)
- etc.

Si non cochées, polling silencieux même appairage réussi.

**Heure / fenêtre polling** : la page `/GEOCONFIG` accepte `tz` en
minutes vs GMT et une checkbox DST. **Ne PAS combiner** `tz=+120` ET
`dst checked` (=> GMT+3, fenêtre polling décalée +1h). Pour la France :
soit `tz=+120` sans DST (fenêtre simple, à mettre à jour hiver), soit
`tz=+60` avec DST cochée (auto-saison). Hors fenêtre `polling from / to`
(fonction de lat/lon + crépuscule), le firmware passe en
`system nightmode` et désactive polling + parfois init Zigbee.

**Wi-Fi save-corruption** : le save d'`/INV_CONFIG` peut occasionnellement
réécrire `wificonfig.json` corrompu en SPIFFS → ESP au reboot reste en
LED bleue continue (mode AP captif). Récupération :
1. Smartphone Android → SSID `ESP-ECU` ou `ESP-XXXXXX` → portail
   `192.168.4.1` → ressaisir SSID/mdp Wi-Fi + admin password (`0000`).
2. Si la connexion échoue (LED reste bleue) : ESP8266 = **2.4 GHz +
   WPA2 only**. Vérifier que le SSID 2.4 GHz est visible (pas de band
   steering 5 GHz forcé), et que la box n'est pas en WPA3 only.
3. Caractères spéciaux dans le mdp Wi-Fi : le portail captif les mange
   parfois — saisir au clavier, pas au copier-coller.

**Adresse passerelle Villennes** : `192.168.0.3` (DHCP fixe).

**Boucle de pairing typique** (en plein soleil, ECU officielle off) :
1. `/INV_CONFIG` → onglet inv 0 → SN 12 chiffres + DS3 + cases pan1+pan2 → save
2. Idem inv 1 (autre SN, pan3+pan4)
3. `/INV_CONFIG` → inv 0 → bouton **pair** → attendre 30-60 s
4. `/CONSOLE` (en // dans un autre onglet) avec `10;diag` actif pour
   suivre les `paircmd 0..3` et le code retour
5. Idem inv 1
6. Vérifier sur `/` que les 4 panneaux remontent une production cohérente

## Schéma BD `Device`

Rôles enum Prisma : `PRODUCTION_METER`, `CONSUMPTION_METER`, `GRID_METER`,
`BATTERY`, `BATTERY_AC_SWITCH`, `POWERSTREAM`, `SOLAR_INVERTER`.

Types enum Prisma : `TUYA_METER`, `TUYA_SWITCH`, `ECOFLOW_BATTERY`,
`SHELLY_METER`, `APSYSTEMS_INVERTER`.

Champs `Device.online` / `onlineAt` : connexion **cloud Tuya** des devices
`TUYA_*`. Le poller (`apps/worker/src/pollers/tuya.ts`) appelle
`isOnline()` (endpoint `/v1.0/iot-03/devices/{id}`) pour les `TUYA_SWITCH`
à chaque tick. **Important** : `getDeviceStatus` (`/status`) renvoie le
dernier état **en cache** même quand le boîtier est hors-ligne — une prise
déconnectée passe donc inaperçue (lectures figées, `switchOn`/`powerW`
gelés) alors que **toutes les commandes ON/OFF échouent** (Tuya renvoie
`result:false`, désormais loggé en warn dans `actions.ts` et non plus
ignoré). `acSwitchOnline` est exposé par le snapshot ; le dashboard affiche
un bandeau + une tuile « Injoignable » quand `online === false`.

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
- Forçage charge : `forceChargeSoc` (null = inactif, sinon SoC cible %),
  `forceChargeWatts` (1000), `forceChargeStartAt` / `forceChargeEndAt`
  (timer optionnel). Voir section ci-dessous.

## Forçage manuel de charge

Recharge la batterie jusqu'à un SoC cible **quel que soit le mode**
(prioritaire sur FOLLOW_LOAD / RULES / fenêtre Tempo), en **tirant sur le
réseau** si le surplus solaire ne suffit pas. Piloté depuis le dashboard
`/` (carte « Forcer la recharge »).

- UI : `apps/web/app/ForceChargeCard.tsx` → `POST /api/control/force-charge`.
  Corps : `{forceChargeSoc, forceChargeWatts, startAt?, durationMin?}`
  (`forceChargeSoc: null` = arrêt/annulation). `GET` renvoie l'état + SoC
  live + `serverNow` pour les barres de progression / comptes à rebours.
- **Timer** (les deux optionnels) :
  - `startAt` (ISO) → `forceChargeStartAt`. null = démarrage immédiat. Si
    dans le futur, le forçage est **armé** mais le mode normal continue
    jusqu'à l'heure ; le worker ne prend la main qu'à `startAt`.
  - `durationMin` → `forceChargeEndAt = (startAt ?? now) + durée`. null =
    pas de limite de durée.
  - L'API calcule les timestamps absolus (web et worker partagent l'horloge
    du même hôte) ; le worker compare en `Date.now()`.
- **Sémantique cible vs durée** (`durationMode = forceChargeEndAt != null`) :
  - **Sans durée** : la cible SoC est l'**objectif** → on termine le forçage
    en l'atteignant (ou si batterie pleine détectée).
  - **Avec durée** : la **durée est prioritaire** → on charge jusqu'à
    l'échéance, et la cible SoC n'est qu'un **plafond de sécurité**. Une fois
    le plafond atteint (ou batterie pleine), on **maintient** (prise OFF,
    reste armé) jusqu'à l'échéance sans réessayer de charger — flag module
    `forceChargeCeilingHit` pour éviter le cyclage du relais Tuya.
- Worker : dispatch en tête de `tickFollowLoad`
  (`apps/worker/src/rules/follow-load.ts`) gère échéance / démarrage
  programmé, puis `tickForceCharge(ctrl, durationMode)` : prise AC ON +
  `setChargeWatts(forceChargeWatts)`. Relève le plafond BMS (`maxChgSoc`)
  à `max(cible, maxChargeSoc)`, puis le **restaure** à la fin (objectif
  atteint sans durée, durée écoulée, ou annulation). `endForceCharge` remet
  `forceChargeSoc/StartAt/EndAt = null` et `forceChargeCeilingHit = false`.

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

## Conformité AI Act

Si cette application met en œuvre de l'IA (LLM, ML, agent, appel à un modèle tiers), réaliser un audit de conformité au **Règlement (UE) 2024/1689** (AI Act) via le skill `ai-act-conformite` : classification de risque (interdit / high-risk / transparence Art. 50 / minimal), audit des obligations applicables, plan d'action priorisé. Consigner le rapport sous `docs/conformite/ai-act-audit-<date>.md`. Refaire l'audit à chaque évolution touchant la fonction IA. Échéance transparence Art. 50 : **2 août 2026**. Ceci est une aide à la conformité, pas un avis juridique.
