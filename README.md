# app_energie_ecoflow_villennes

Application web auto-hébergée pour piloter automatiquement une batterie
EcoFlow en fonction de la production et de la consommation électriques
mesurées via des appareils Tuya.

## Architecture

Monorepo `pnpm` :

- `apps/web` — interface Next.js 15 (App Router, TypeScript, Tailwind, shadcn/ui).
- `apps/worker` — process Node.js : polling Tuya 30 s, MQTT EcoFlow, moteur de règles.
- `packages/shared` — clients API Tuya / EcoFlow et types Zod partagés.
- `prisma/` — schéma PostgreSQL.

Tout tourne en `docker compose` sur un serveur interne. Aucune authentification
(accès LAN uniquement).

## Démarrage rapide

```bash
cp .env.example .env       # remplir EcoFlow + Tuya credentials
docker compose up -d
# puis http://<serveur-interne>:3000
```

Voir `docs/` pour les détails (à venir).
