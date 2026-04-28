# Mode d'emploi — Surveillance APSystems DS3 (2ᵉ maison)

Procédure complète pour mettre en service la surveillance par panneau
de tes 2 micro-onduleurs APSystems DS3, **sans la ECU officielle**, en
mutualisant le code de cette stack.

Estimation : **1 demi-journée** une fois le matos reçu (commande +
livraison : compter ~1 semaine).

---

## 1. Acheter le matériel

### Hôte (mini-PC pour faire tourner Docker)

- **Mini-PC d'occasion** : HP EliteDesk 800 G3 Mini ou Lenovo M720q
  (i5 + 8 Go RAM + SSD 256 Go) — ~120-180 € sur
  [Backmarket](https://www.backmarket.fr/) ou
  [LeBonCoin](https://www.leboncoin.fr/)
- **Câble RJ45 Cat 6** (1-2 m) — ~5 € — **brancher en filaire** au
  routeur, pas en Wi-Fi

### Passerelle Zigbee (lit les DS3)

Recherches AliExpress / Amazon :

| Article | Mots-clés à chercher | Prix |
|---|---|---|
| ESP8266 NodeMCU v3 | « NodeMCU ESP8266 CH340 » | 5-8 € |
| Module Zigbee CC2530 + CC2591 | « **CC2530 CC2591** PA antenna external » | 10-15 € |
| Adaptateur USB-TTL CP2102 | « CP2102 USB to TTL UART » | 3-5 € |
| Câbles Dupont F/F + M/F (40 brins) | « Dupont jumper 40 pin » | 3-5 € |
| Boîtier ABS ~80×60×30 mm (optionnel) | n/a | 4-6 € |

> **Très important** : le module doit être un **CC2530 + CC2591**
> (avec amplificateur de puissance et antenne externe). **PAS** un
> CC2530 nu (portée insuffisante). **PAS** un Sonoff Zigbee 3.0 ou
> dongle Zigbee USB (incompatible avec le protocole APSystems custom).

### Total ~150-210 €

---

## 2. Pendant la livraison : préparer le terrain

### 2.1 Récupérer les SN des 2 DS3

Sur l'étiquette de chaque onduleur DS3 (sous le panneau ou sur la
facture d'installation), un code à **12 chiffres** type
`406000123456`. Les noter quelque part — indispensable pour le
pairing.

### 2.2 Comprendre Tailscale (et créer un compte)

**Qu'est-ce que c'est ?** Un service qui crée un **VPN privé maillé**
(« mesh ») entre tous tes appareils. Concrètement :

- Le mini-PC chez la 2ᵉ maison reçoit une IP privée fixe type
  `100.64.10.5`
- Ton PC perso à Villennes : `100.64.10.6`
- Ton mobile : `100.64.10.7`
- Le serveur Villennes : `100.64.10.8`

Tous ces appareils peuvent se parler **comme s'ils étaient sur le
même réseau local**, où qu'ils soient dans le monde, **sans ouvrir
le moindre port** sur la box ni configurer de DynDNS.

**Pourquoi c'est utile ici ?**

1. **Accès distant au dashboard** : depuis ton mobile à Villennes
   tu fais `http://100.64.10.5:3010/solar` et tu vois la production
   des panneaux de la 2ᵉ maison. Pas besoin d'être sur le LAN
   physique.
2. **Sécurité** : aucune exposition Internet. Pas de port forwarding,
   pas de risque qu'un bot scanne ton dashboard.
3. **Comparaison entre maisons** : tu peux interroger les 2 dashboards
   depuis le même endroit (Villennes ↔ maison 2 via Tailscale).
4. **SSH facile** : `ssh coulpi@100.64.10.5` depuis n'importe où.

**Comparaison avec les alternatives :**

| Solution | Difficulté | Sécurité | Coût |
|---|---|---|---|
| Tailscale | très facile (5 min) | excellente | gratuit perso |
| OpenVPN auto-hébergé | difficile | bonne | gratuit |
| Port forwarding + DynDNS | moyen | risquée (exposition Internet) | gratuit |
| Cloudflare Tunnel | facile | excellente | gratuit |

Tailscale gagne sur tous les tableaux pour cet usage perso.

**Création du compte** : va sur https://tailscale.com → « Get
started » → connecte-toi avec ton Google ou Microsoft (le plus
simple). Plan gratuit : jusqu'à **100 appareils** et **3 utilisateurs**,
amplement suffisant.

Tu installeras le client à 4 endroits :
- Mini-PC maison 2 (étape 3.2)
- Serveur Villennes (`192.168.0.26`) — `curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`
- Ton PC perso (Windows/Mac) — installeur depuis le site
- Ton mobile (app iOS / Android)

Une fois connectés, tu vois tous tes appareils dans l'admin
[login.tailscale.com](https://login.tailscale.com), avec leur IP
`100.x.y.z` à utiliser.

---

## 3. Setup du mini-PC

Une fois reçu :

### 3.1 OS

Installer **Ubuntu Server 24.04 LTS** (gratuit, [ubuntu.com/download/server](https://ubuntu.com/download/server)) :
- Démarrer sur la clé USB d'install
- Configurer un user `coulpi` (ou autre), activer SSH
- Brancher en filaire, IP fixe via DHCP du routeur (réservation MAC
  dans la box) — exemple `192.168.X.10`

### 3.2 Outils de base (en SSH)

```bash
# Mise à jour
sudo apt update && sudo apt upgrade -y

# Docker + docker compose
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker  # ou se reconnecter

# Tailscale (VPN mesh)
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
# Suivre le lien affiché pour authentifier le mini-PC
```

### 3.3 Cloner le repo

```bash
sudo mkdir -p /home/app_energie
sudo chown $USER:$USER /home/app_energie
cd /home/app_energie
git clone https://github.com/coulpi/app_energie_ecoflow_villennes.git .
```

### 3.4 Configurer le `.env` pour la 2ᵉ maison

Créer `/home/app_energie/.env` (copier depuis `.env.example` si présent) :

```env
# DB locale
DATABASE_URL=postgresql://app:app@postgres:5432/ecoflow

# Maison 2 — pas d'EcoFlow ici, on désactive
# (laisser vide les credentials EcoFlow / Tuya / Shelly)

# APSystems
APSYSTEMS_MQTT_URL=mqtt://mosquitto:1883
APSYSTEMS_TOPIC_PREFIX=apsystems
APSYSTEMS_MOCK=0

# Géo & TZ
HOME_LAT=48.94
HOME_LON=1.99
HOME_TZ=Europe/Paris
TZ=Europe/Paris

# Polling
POLL_INTERVAL_SECONDS=30
```

> Si tu veux tester l'UI **avant** d'avoir branché l'ESP, mets
> `APSYSTEMS_MOCK=1` — le worker générera des données simulées.

### 3.5 Ajouter Mosquitto au `docker-compose.yml`

Le repo n'a pas de Mosquitto par défaut (il s'appuie sur le broker
EcoFlow). Pour la 2ᵉ maison, on en lance un local. Créer
`docker-compose.override.yml` à la racine :

```yaml
services:
  mosquitto:
    image: eclipse-mosquitto:2
    container_name: mosquitto
    ports:
      - "127.0.0.1:1883:1883"
    volumes:
      - ./mosquitto/config:/mosquitto/config
      - ./mosquitto/data:/mosquitto/data
      - ./mosquitto/log:/mosquitto/log
    restart: unless-stopped
    networks:
      - default

  worker:
    depends_on:
      - mosquitto
```

Puis le fichier de conf Mosquitto :

```bash
mkdir -p mosquitto/config mosquitto/data mosquitto/log
cat > mosquitto/config/mosquitto.conf <<EOF
listener 1883
allow_anonymous true
persistence true
persistence_location /mosquitto/data/
log_dest file /mosquitto/log/mosquitto.log
EOF
```

> `allow_anonymous true` est OK car le broker n'écoute que sur le LAN
> (`127.0.0.1:1883` côté hôte + réseau Docker). Si tu veux durcir,
> ajouter un `password_file` plus tard.

### 3.6 Premier démarrage

```bash
docker compose up -d
docker compose logs -f web worker
```

Attendre le « worker ready » et « ✓ ready » côté web. Tester :

- http://192.168.X.10:3010 (depuis le LAN)
- http://192.168.X.10:3010/solar — page vide car aucun device

---

## 4. Flasher le module CC2530

C'est l'étape la plus technique mais une seule fois.

### 4.1 Câblage USB-TTL ↔ CC2530+CC2591

| CP2102 (USB-TTL) | CC2530+CC2591 |
|---|---|
| 3.3V | VCC |
| GND | GND |
| TX | RX |
| RX | TX |
| DTR ou RTS | RESET (selon firmware) |

> Branche le CP2102 sur ton PC (Windows ou Linux), pas sur le mini-PC.

### 4.2 Récupérer le firmware

Le projet de référence est
[`patience4711/read-APSystems-YC600-QS1-DS3`](https://github.com/patience4711/read-APSystems-YC600-QS1-DS3).
Cloner le repo et suivre `README.md` pour :

1. Flasher le **CC2530** avec le binaire `coordinator.hex` fourni
   (utiliser **CCLoader** ou **Flash Programmer 2** de Texas Instruments).
2. Flasher l'**ESP8266** avec le sketch `.ino` du repo (utiliser
   l'IDE Arduino, board « NodeMCU 1.0 (ESP-12E Module) »).

> Le firmware ESP du repo sort par défaut sur un endpoint HTTP. **Il
> faut adapter le code pour publier en MQTT** vers `mosquitto` sur
> le bon topic. Voir section 5 ci-dessous.

### 4.3 Câblage final ESP8266 ↔ CC2530+CC2591

Une fois flashés, débrancher le CP2102, et relier l'ESP au CC2530 :

| ESP8266 NodeMCU | CC2530+CC2591 | Couleur Dupont conseillée |
|---|---|---|
| 3V3 | VCC | rouge |
| GND | GND | noir |
| D5 (GPIO14) | TX (P0_3 sur CC2530) | jaune |
| D6 (GPIO12) | RX (P0_2 sur CC2530) | vert |
| D2 (GPIO4)  | RESET | bleu |

(Vérifier le pinout exact dans le `.ino` du repo, ça peut varier
selon la version du firmware.)

Schéma simplifié :

```
        ┌──────────────┐                ┌──────────────────┐
        │              │                │                  │
        │   ESP8266    │                │  CC2530+CC2591   │  ━┓
        │   NodeMCU    │                │   (PA + ant.)    │   ┃ antenne
        │              │                │                  │  ━┛  externe
        │  3V3 ───────────── rouge ───────── VCC           │
        │  GND ───────────── noir  ───────── GND           │
        │  D5  ───────────── jaune ───────── TX (P0_3)     │
        │  D6  ───────────── vert  ───────── RX (P0_2)     │
        │  D2  ───────────── bleu  ───────── RESET         │
        │              │                │                  │
        │  USB ───┐    │                │                  │
        └─────────┼────┘                └──────────────────┘
                  │
                  ▼
            5V USB (chargeur 1A
            ou alim secteur)
```

### 4.4 Montage final dans le boîtier

Liste des étapes :

1. **Souder** des connecteurs Dupont mâles aux pins du CC2530+CC2591
   (s'il n'a pas déjà les pin headers — le module en vente sur
   AliExpress est généralement livré avec). Sinon utiliser des
   barrettes de 2.54 mm soudées.
2. **Câblage** : 5 fils Dupont F/F entre l'ESP et le CC2530 selon le
   tableau ci-dessus. Vérifier 2× avant d'alimenter (un mauvais
   branchement VCC/GND peut tuer le CC2530).
3. **Fixation** : double-face mousse 3M dans le boîtier ABS, ESP
   d'un côté, CC2530 de l'autre. **Garder l'antenne externe à
   l'extérieur du boîtier** (ne jamais l'enfermer dans du métal,
   sinon perte de portée massive).
4. **Sortie antenne** : percer un trou dans le boîtier, laisser
   passer le câble SMA, fixer l'antenne dehors.
5. **USB d'alim** : percer un 2ᵉ trou pour le câble micro-USB.
   L'ESP s'alimente en 5 V via son port micro-USB ; il fournit
   ensuite le 3.3 V au CC2530.
6. **Fermer le boîtier**, étiqueter (date, version firmware).

### 4.5 Emplacement physique de la passerelle

C'est **critique** pour la portée Zigbee 2.4 GHz :

- **Idéal** : dans les combles ou près du tableau électrique, à
  distance directe (< 15 m) et sans dalle béton entre l'ESP et les
  DS3.
- **Bon** : dans une pièce du dernier étage, contre un mur exposé
  vers le toit.
- **À éviter** : sous-sol, derrière 2+ murs porteurs, dans une boîte
  métallique fermée (cage de Faraday).
- **Wi-Fi** : la box doit être atteignable par l'ESP (même réseau
  que le mini-PC). Si le mini-PC est dans le tableau électrique
  mais le Wi-Fi est faible là-bas, soit déplacer la passerelle, soit
  ajouter un répéteur Wi-Fi.
- **Alimentation** : prise USB murale type chargeur de téléphone
  (5 V 1 A suffisant). Brancher de préférence sur un onduleur si
  tu en as un, sinon une simple prise filtrée fait l'affaire.

> Astuce diagnostic : la **valeur RSSI Zigbee** (`signalDb` dans le
> dashboard) te dit si la passerelle est bien placée :
> - ≥ -65 dBm : excellent
> - -65 à -75 dBm : OK
> - -75 à -85 dBm : limite, prévoir un déplacement
> - < -85 dBm : trop faible, déclenche l'alerte `WEAK_SIGNAL`

---

## 5. Adapter le firmware ESP pour publier en MQTT

Le firmware patience4711 fournit déjà la sortie MQTT. À configurer
dans le `.ino` :

```cpp
// Wi-Fi
const char* WIFI_SSID = "ton-ssid-maison-2";
const char* WIFI_PASS = "...";

// MQTT — IP du mini-PC sur le LAN local
const char* MQTT_HOST = "192.168.X.10";
const int   MQTT_PORT = 1883;
const char* MQTT_USER = "";   // anonymous
const char* MQTT_PASS = "";

// Topic structure attendue par notre stack :
//   apsystems/<sn>/data
//   apsystems/<sn>/status
const char* TOPIC_PREFIX = "apsystems";

// SN des 2 DS3 (récupérés étape 2.1)
const char* INVERTERS[] = {
  "406000000001",  // DS3 #1
  "406000000002",  // DS3 #2
};
```

**Format du payload `data` que l'ESP doit publier** (validé par Zod
côté worker, cf. `packages/shared/src/apsystems.ts`) :

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

Si le firmware d'origine sort autre chose, adapter le `printf`/`sprintf`
qui construit le JSON.

LWT (Last Will & Testament) recommandé sur `apsystems/<sn>/status`
avec payload `offline`. Au connect, publier `online`.

---

## 6. Pairing des DS3

Une fois l'ESP en place et alimenté, dans son interface web (port 80,
adresse IP affichée par le `.ino` au boot via Serial monitor) :

1. Ouvrir l'interface (typiquement http://192.168.X.YY)
2. Saisir les 2 SN dans la page « Pairing »
3. Cliquer « Start pairing »
4. **Côté DS3** : il faut couper puis rallumer chaque onduleur (mettre
   le disjoncteur AC OFF puis ON). À la mise sous tension, le DS3
   diffuse un beacon Zigbee pendant ~30 s qui permet l'appairage.
5. L'interface affiche « DS3 #1 paired » puis « DS3 #2 paired ».

À partir de là, l'ESP poll les onduleurs toutes les ~15-30 s et
publie sur MQTT.

### Vérifier en CLI sur le mini-PC

```bash
# Subscribe à tous les topics APSystems
docker compose exec mosquitto mosquitto_sub -t 'apsystems/#' -v
```

Tu dois voir des messages JSON arriver toutes les 15 s.

---

## 7. Déclarer les onduleurs dans l'app

Sur http://192.168.X.10:3010/devices, créer **un device par DS3** :

| Champ | Valeur |
|---|---|
| Nom | `DS3 #1 — façade sud` (ou ce que tu veux) |
| Type | `APSystems — micro-onduleur (Zigbee)` |
| Rôle | `Onduleur solaire (par panneau)` |
| externalId | **le SN à 12 chiffres exact** (ex: `406000123456`) |
| Modèle | `DS3` (champ libre, optionnel) |

Répéter pour le 2ᵉ DS3.

---

## 8. Vérifier sur `/solar`

Aller sur http://192.168.X.10:3010/solar (ou via Tailscale si tu es
hors LAN). En quelques secondes, les 4 panneaux doivent apparaître
avec :

- Production instantanée par panneau
- Tension/courant DC
- Énergie cumulée
- Ratio vs panneau jumeau (proche de 100 % si tout va bien)
- Graphe 24h superposé (rempli au fur et à mesure)
- Stats onduleur : T°, AC V/Hz, RSSI Zigbee

Si **aucun panneau** ne remonte après 1-2 min :
- Vérifier que les SN dans `/devices` correspondent **exactement** à
  ceux configurés dans le `.ino`
- Vérifier que `mosquitto_sub` reçoit bien des messages
- Logs worker : `docker compose logs -f worker | grep apsystems`

---

## 9. Surveillance et alertes

La page `/solar` affiche un **bandeau d'alertes** au-dessus de la
liste des onduleurs. Les alertes se déclenchent automatiquement :

| Type | Déclenchement | Niveau |
|---|---|---|
| Onduleur silencieux | aucune trame depuis > 10 min | CRITICAL |
| Déséquilibre panneaux | écart > 25 % entre jumeaux d'un même DS3 | WARN |
| Surchauffe | T° onduleur > 75 °C | WARN |
| Fréquence réseau | AC Hz hors [49.5, 50.5] | CRITICAL |
| Signal Zigbee faible | RSSI < -85 dBm | INFO |

Les alertes se résolvent automatiquement quand la condition disparaît.

> **À venir** (TODO) : intégration Telegram / email pour push d'alerte.
> Pour l'instant les alertes sont visibles uniquement dans le dashboard.

---

## 10. Diagnostiquer un panneau ou onduleur défaillant

Quelques scénarios à reconnaître sur `/solar` :

### « Mon panneau A produit 30 % de moins que B »
- **Sale** : nettoyer le panneau, refaire la mesure dans 1 jour ensoleillé.
- **Ombre permanente** : nouvelle plante, branche, pylône → tailler ou
  accepter.
- **Diode bypass HS** : si la chute est brutale (cellule entière qui
  passe sous le seuil), DC_V chute aussi → garantie panneau / installateur.

### « Onduleur silencieux depuis X min mais le DS3 fonctionne »
- Coupure Wi-Fi de l'ESP → vérifier l'alim 5 V et la portée.
- Antenne CC2530 mal placée → repositionner plus haut, dégager la
  ligne de vue.
- Coupure complète de l'install → vérifier le disjoncteur AC du DS3.

### « Fréquence réseau hors plage »
- C'est rarement la faute du panneau, c'est le **réseau ENEDIS** qui
  flotte. Si répété, regarder le micro-onduleur de plus près (norme
  VDE-AR-N 4105).

### « T° > 75 °C »
- Panneau / onduleur exposé plein sud sans aération → en été ça arrive.
- Si > 85 °C de manière chronique : risque de désamorçage protection.
  Améliorer la ventilation (espacement panneau / toiture).

---

## 11. Maintenance courante

- **Backup DB** : `docker compose exec postgres pg_dump -U app ecoflow > backup_$(date +%F).sql` (à scripter en cron hebdo).
- **Mises à jour code** : `git pull && bash ./scripts/deploy.sh` (le
  même script que sur Villennes).
- **Espace disque** : `docker system prune -af --volumes` 1×/mois.
- **Tailscale** : si l'IP du LAN change, l'IP Tailscale du mini-PC
  reste la même (toujours `100.x.y.z`). Pratique.

---

## Annexe — Endpoints utiles

- `GET http://192.168.X.10:3010/solar` — dashboard solaire
- `GET http://192.168.X.10:3010/devices` — gestion équipements
- `GET http://192.168.X.10:3100/follow-load/state` — état worker (debug)
- `mosquitto_sub -t 'apsystems/#' -v` — voir les trames live

## Annexe — Liens

- Firmware ESP : https://github.com/patience4711/read-APSystems-YC600-QS1-DS3
- Doc Mosquitto : https://mosquitto.org/documentation/
- Tailscale : https://tailscale.com/kb/1017/install
