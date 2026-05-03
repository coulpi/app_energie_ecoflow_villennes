# Backlog

Suivi des actions en cours / à faire. Priorité haut → bas dans chaque
section. Date de création de l'item entre parenthèses.

## En cours

### Passerelle APSystems DIY (2ᵉ maison)

- [ ] **Pairing des 2 DS3** sur la passerelle ESP-ECU `192.168.0.3` —
  fenêtre 11h-16h, ciel dégagé, ECU officielle APSystems éteinte (2026-05-03)
  - SN inv 0 : `703000728874` (à confirmer)
  - SN inv 1 : à confirmer (le scrape HTTP n'a pas pu lire le slot 1
    car le tab switcher est JS-side ; vérifier manuellement sur
    `/INV_CONFIG`)
- [ ] **Cocher pan1+pan2 sur inv 0, pan3+pan4 sur inv 1** dans
  `/INV_CONFIG` → save (2026-05-03)
- [ ] **Corriger l'heure** : `/GEOCONFIG` → décocher `dst` (`tz=+120`
  inclut déjà l'heure d'été), ou passer à `tz=+60` + DST coché
  (2026-05-03)
- [ ] **Configurer MQTT** sur `/MQTT` :
  - host `192.168.0.26`, port `1883`
  - prefix topic `apsystems` (ou `apsystems/villennes` si on partage le
    broker entre les 2 maisons plus tard)
- [ ] **Côté worker** : ajouter `APSYSTEMS_MQTT_URL=mqtt://192.168.0.26:1883`
  au `.env` Villennes + créer 2 `Device` (`APSYSTEMS_INVERTER`) avec
  les SN réels → vérifier que `SolarPanelReading` se remplit
- [ ] **Page `/solar`** : valider l'affichage des 4 panneaux + graphe 24 h
  une fois les premières trames arrivées

### Jacuzzi Intex (cf. CLAUDE.md)

- [ ] Renseigner `INTEX_SPA_HOST` (IP locale du module Wi-Fi Intex à
  figer en DHCP réservé sur le routeur)
- [ ] Écrire la boucle `apps/worker/src/rules/jacuzzi-control.ts`
  (similaire à `follow-load.ts`)
- [ ] Ajouter les champs `ControlState` jacuzzi au schema Prisma
  (`jacuzziEnabled`, `jacuzziStartSurplusW` 1500, `jacuzziStopGridW` 300,
  `jacuzziStartHoldS` 120, `jacuzziStopHoldS` 300, `jacuzziMinSocPct` 40,
  `jacuzziTempoBlockRedHp` true)
- [ ] UI minimale + endpoint `/api/jacuzzi/state`

## Idées / pas urgent

- [ ] Health check `PANEL_LOW_DC` (placeholder dans CLAUDE.md, à
  implémenter une fois les vraies trames DS3 captées)
- [ ] Mini-PC dédié 2ᵉ maison (HP EliteDesk 800 G3 Mini ou Lenovo
  M720q) : achat + Tailscale + déploiement Docker du repo
- [ ] Backup régulier de la base Postgres (rétention `RAW_RETENTION_DAYS`
  = 30, on perd l'historique brut au-delà)

## Fait récemment

- ✅ 2026-05-03 — Câblage CC2530+CC2591 ↔ NodeMCU corrigé (TX/RX étaient
  inversés ; les labels du module n'étaient pas fiables, raisonner en
  P0_2/P0_3 confirmé par `readMe.txt` patience4711)
- ✅ 2026-05-03 — Régulateur 5V→3.3V externe câblé (3V3 NodeMCU
  insuffisant pour pic TX CC2591)
- ✅ 2026-05-03 — Firmware ESP `ESP-ECU-v10_9a.bin` + CC2530
  `CC2530ZNP_2591-with-SBL.hex` flashés ; coordinator UP
  (`zigbee running oke`)
- ✅ 2026-05-03 — Diagnostic console WS validé (`10;DIAG`, `10;HEALTH`,
  `10;ZBT`, `10;INIT_N`, `10;FILES`)
