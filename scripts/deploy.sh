#!/usr/bin/env bash
# Script de déploiement / mise à jour de l'application sur le serveur interne.
#
# Usage (sur le serveur 192.168.0.26) :
#   sudo mkdir -p /home/app_energie_ecoflow_villennes
#   sudo chown -R "$USER" /home/app_energie_ecoflow_villennes
#   cd /home/app_energie_ecoflow_villennes
#   curl -fsSL https://raw.githubusercontent.com/coulpi/app_energie_ecoflow_villennes/main/scripts/deploy.sh | bash
#
# Ou, après le 1er clone :
#   cd /home/app_energie_ecoflow_villennes
#   ./scripts/deploy.sh

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/coulpi/app_energie_ecoflow_villennes.git}"
TARGET_DIR="${TARGET_DIR:-/home/app_energie_ecoflow_villennes}"
BRANCH="${BRANCH:-main}"

color() { printf "\033[%sm%s\033[0m\n" "$1" "$2"; }
info()  { color "1;36" "▶ $*"; }
ok()    { color "1;32" "✓ $*"; }
warn()  { color "1;33" "⚠ $*"; }
err()   { color "1;31" "✗ $*"; }

# 1. Pré-requis
info "Vérification des pré-requis"
command -v git >/dev/null    || { err "git absent"; exit 1; }
command -v docker >/dev/null || { err "docker absent — installer Docker d'abord"; exit 1; }
docker compose version >/dev/null 2>&1 || { err "plugin docker compose absent"; exit 1; }
ok "git, docker, docker compose présents"

# 2. Clone ou mise à jour
if [[ -d "$TARGET_DIR/.git" ]]; then
  info "Mise à jour du dépôt dans $TARGET_DIR"
  cd "$TARGET_DIR"
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git reset --hard "origin/$BRANCH"
  ok "branche $BRANCH à jour"
else
  info "Clone initial dans $TARGET_DIR"
  mkdir -p "$TARGET_DIR"
  if [[ -n "$(ls -A "$TARGET_DIR" 2>/dev/null || true)" ]]; then
    err "$TARGET_DIR n'est pas vide et n'est pas un repo git — abandon"
    exit 1
  fi
  git clone --branch "$BRANCH" "$REPO_URL" "$TARGET_DIR"
  cd "$TARGET_DIR"
  ok "dépôt cloné"
fi

# 3. .env
if [[ ! -f .env ]]; then
  warn ".env manquant — copie depuis .env.example. Vous DEVEZ y mettre vos credentials"
  cp .env.example .env
  err "Modifiez maintenant .env (EcoFlow, Tuya, Ollama URL, etc.) puis relancez ce script"
  exit 1
fi
ok ".env présent"

# 4. Build + up
info "Build des images Docker (peut prendre 3-5 min la 1re fois)"
docker compose --profile apsystems build

info "Démarrage des services"
docker compose --profile apsystems up -d

# 5. Migration Prisma — la 1re fois ou si le schéma a changé
info "Application du schéma Prisma sur la base"
sleep 5
# On utilise le conteneur web qui contient déjà prisma + le schéma + les deps
docker compose exec -T web npx prisma db push --schema=/repo/prisma/schema.prisma --skip-generate || \
  warn "db push a échoué — la base sera peut-être déjà en sync, à vérifier"

# 5b. Redémarrage du worker APRÈS la migration.
# IMPORTANT : `up -d` (étape 4) démarre le worker AVANT que le db push
# ci-dessus ait appliqué le schéma. Or le worker fait des requêtes Prisma
# au boot (ex. startEcoFlowMqtt → device.findMany), qui sélectionnent
# toutes les colonnes du client généré. Si une migration ajoute une
# colonne, ces requêtes plantent au démarrage et certaines initialisations
# one-shot (connexion MQTT privé EcoFlow) restent mortes jusqu'au prochain
# redémarrage. On relance donc le worker contre le schéma à jour.
info "Redémarrage du worker (init contre le schéma migré)"
docker compose restart worker || warn "restart worker a échoué — à vérifier"

# 6. Nettoyage Docker (libère le cache de build, images intermédiaires, etc.)
# Évite que /var/lib/docker grossisse sans limite à chaque build (~40 GB
# régulièrement). Ne touche pas aux conteneurs en cours d'exécution ni aux
# volumes nommés (postgres_data est conservé).
info "Nettoyage cache Docker (images dangling, build cache)"
docker_disk_before=$(docker system df --format '{{.Type}}={{.Size}}' | tr '\n' ' ' || echo "?")
docker system prune -af >/dev/null 2>&1 || warn "docker system prune partiel"
docker builder prune -af >/dev/null 2>&1 || true
docker_disk_after=$(docker system df --format '{{.Type}}={{.Size}}' | tr '\n' ' ' || echo "?")
ok "cache Docker nettoye (avant: $docker_disk_before / apres: $docker_disk_after)"

# 7. Status final
info "État des services"
docker compose ps

echo
ok "Déploiement terminé"
echo
echo "Accès web :    http://$(hostname -I | awk '{print $1}'):3000"
echo "Logs worker :  docker compose logs -f worker"
echo "Logs web :     docker compose logs -f web"
