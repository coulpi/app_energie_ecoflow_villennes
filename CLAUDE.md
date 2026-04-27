# CLAUDE.md

Application web auto-hébergée pilotant une batterie EcoFlow Delta Max 2000
en fonction de la production / consommation électrique mesurées via Tuya
et Shelly. Réseau LAN interne, pas d'authentification.

## Architecture

Monorepo `pnpm` (workspaces) :

- `apps/web` — Next.js 15 (App Router, TypeScript, Tailwind, shadcn/ui).
  Pages : `/` dashboard, `/flow` schéma de flux animé, `/agent`, `/devices`,
  `/rules`, `/control`, `/loads`, `/tariffs`, `/history`, `/kiosk`.
- `apps/worker` — process Node.js : poller Tuya 30 s, MQTT EcoFlow, moteur
  de règles, agent LLM (Ollama) sur intervalle.
- `packages/shared` — clients Tuya / EcoFlow (cloud + privé) / Shelly /
  Ollama / météo, DSL de règles, types Zod.
- `prisma/` — schéma PostgreSQL (devices, readings, controlState…).

Déploiement : `docker compose up -d` (services `postgres`, `web`, `worker`).
Postgres en binding interne uniquement (pas de port hôte par défaut, évite
un conflit local sur 5432).

## Sources de données EcoFlow

Trois chemins, dans l'ordre de précision :

1. **API privée EcoFlow** (`packages/shared/src/ecoflow-private.ts`) —
   donne la puissance batterie temps réel précise via le BMS.
2. **MQTT EcoFlow** + décodage PJ2101A : sens de courant via le LSB.
3. **Prise AC Tuya** (rôle `BATTERY_AC_SWITCH`) : powerW de la prise
   = puissance de charge (signe inversé).

## Pipeline `getDashboardSnapshot` (`apps/web/lib/snapshot.ts`)

Logique critique, plusieurs fix successifs. Lire avant de toucher :

1. `batteryPowerW` est cherché dans cet ordre : valeur BMS directe →
   bilan énergétique (`conso − prod − grid`, seuil 30 W) → prise AC ON
   avec powerW > 5 → dérive du SoC sur 60 min.
2. **Guards appliqués APRÈS toutes les dérivations** (commit 1985fa8 :
   c'était le vrai fix — les guards en amont laissaient passer des
   fausses valeurs via la branche bilan/SoC) :
   - **Seuil 30 W** : sous 30 W absolus → batterie idle (filtre
     standby inverter).
   - **Cohérence prise AC** : si `switchOn === false`, toute valeur
     `< 0` (charging) est rejetée → 0.
3. **Conso forcée par bilan** : `consumptionW = prod + grid + bat`
   (cohérence visuelle indépendante du Shelly direct éventuel sur
   sous-circuit).

Capacité batterie : `BATTERY_CAPACITY_WH = 2016` (Delta Max 2000).
La résolution SoC du BMS est de 1 % → l'estimation par dérive est
volontairement sur 60 min, premier ↔ dernier tick.

## Agent LLM (`apps/worker/src/agent`)

- Ollama, `think=false`, streaming `keep_alive`.
- Dispatcher `undici` sans `bodyTimeout` (sinon coupures sur réponses
  longues) côté worker ET côté web (proxy agent).
- Timeout 30 min côté agent, prompt trimmé.
- Détection charges récurrentes côté worker.

## Conventions

- Signe batterie : **+ = décharge, − = charge**.
- Signe grid : **+ = import, − = export**. `surplusW = -gridW`.
- Tous les rôles `Device` sont des enums Prisma : `PRODUCTION_METER`,
  `CONSUMPTION_METER`, `GRID_METER`, `BATTERY`, `BATTERY_AC_SWITCH`.

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

EcoFlow : `ECOFLOW_ACCESS_KEY`, `ECOFLOW_SECRET_KEY`, `ECOFLOW_API_BASE`,
`ECOFLOW_EMAIL`/`PASSWORD` (API privée), `ECOFLOW_MQTT_BROKER/PORT`.
Tuya : `TUYA_CLIENT_ID/SECRET/REGION/API_BASE`.
Agent : `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `AGENT_INTERVAL_MINUTES`,
`AGENT_ENABLED`. Maison : `HOME_LAT/LON/TZ`.
Rétention : `RAW_RETENTION_DAYS` (30), `HOURLY_RETENTION_DAYS` (365).
Sécurité batterie : `BATTERY_CRITICAL_SOC` (5).
