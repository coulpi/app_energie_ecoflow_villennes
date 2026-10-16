#!/usr/bin/env bash
# Compile et installe (OTA Wi-Fi) le firmware de l'écran ESPHome tabscreen1
# depuis le serveur, sans Home Assistant ni ESPHome Builder.
#
# Usage (sur le serveur, après ./scripts/deploy.sh qui met le dépôt à jour) :
#   ./scripts/esphome-deploy.sh            # compile + installe + 30 s de logs
#   ./scripts/esphome-deploy.sh compile    # compile seulement (test)
#   ./scripts/esphome-deploy.sh logs       # logs de l'écran (Ctrl+C pour quitter)
#
# Secrets : esphome/secrets.yaml (non versionné, chmod 600) avec wifi_ssid,
# wifi_password, tabscreen1_api_key, tabscreen1_ota_password,
# tabscreen1_ap_password.

set -euo pipefail

ESPHOME_VERSION="${ESPHOME_VERSION:-2026.9.1}"
DEVICE_IP="${DEVICE_IP:-192.168.0.148}"
NODE="tabscreen1"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CFG_DIR="$REPO_DIR/esphome"
FONT="$CFG_DIR/fonts/materialdesignicons-webfont.ttf"
FONT_URL="https://cdn.jsdelivr.net/npm/@mdi/font@7.4.47/fonts/materialdesignicons-webfont.ttf"
MODE="${1:-run}"

info() { printf "\033[1;36m▶ %s\033[0m\n" "$*"; }
err()  { printf "\033[1;31m✗ %s\033[0m\n" "$*"; }

[[ -f "$CFG_DIR/secrets.yaml" ]] || { err "$CFG_DIR/secrets.yaml manquant"; exit 1; }
for k in wifi_ssid wifi_password tabscreen1_api_key tabscreen1_ota_password tabscreen1_ap_password; do
  grep -q "^$k:" "$CFG_DIR/secrets.yaml" || { err "secret $k absent de secrets.yaml"; exit 1; }
done

if [[ ! -f "$FONT" ]]; then
  info "Téléchargement de la police Material Design Icons"
  mkdir -p "$(dirname "$FONT")"
  curl -fsSL -o "$FONT" "$FONT_URL"
fi

run_esphome() {
  docker run --rm --network host \
    -v "$CFG_DIR":/config \
    -v esphome-cache:/cache \
    "ghcr.io/esphome/esphome:$ESPHOME_VERSION" "$@"
}

case "$MODE" in
  compile)
    info "Compilation de $NODE (ESPHome $ESPHOME_VERSION)"
    run_esphome compile "$NODE.yaml"
    ;;
  logs)
    run_esphome logs "$NODE.yaml" --device "$DEVICE_IP"
    ;;
  run)
    info "Compilation + installation OTA de $NODE sur $DEVICE_IP (ESPHome $ESPHOME_VERSION)"
    run_esphome run "$NODE.yaml" --device "$DEVICE_IP" --no-logs
    info "Logs pendant 30 s"
    # NB : `timeout docker run` n'arrête que le client, le conteneur continue :
    # conteneur nommé, détaché, puis supprimé.
    docker rm -f esphome-deploy-logs >/dev/null 2>&1 || true
    docker run -d --name esphome-deploy-logs --network host -v "$CFG_DIR":/config \
      "ghcr.io/esphome/esphome:$ESPHOME_VERSION" logs "$NODE.yaml" --device "$DEVICE_IP" >/dev/null
    sleep 30
    docker logs esphome-deploy-logs 2>&1 | grep -E "ESPHome version|SSID|\[W\]|\[E\]|Received response" | tail -15 || true
    docker rm -f esphome-deploy-logs >/dev/null
    ;;
  *)
    err "mode inconnu : $MODE (run | compile | logs)"
    exit 1
    ;;
esac
