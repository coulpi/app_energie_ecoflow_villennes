// Disposition physique des panneaux (de gauche à droite, vue de face),
// partagée par la page /solar et l'écran ESPHome (/api/screen/solar).
// 1 micro-onduleur DS3 = 2 panneaux (panelIndex 0 à gauche, 1 à droite).
export const ARRAYS: Array<{ title: string; kind: "ground" | "roof"; sns: string[] }> = [
  { title: "Jardin · au sol", kind: "ground", sns: ["703000201323", "703000724293", "703000728874"] },
  { title: "Abri · toiture", kind: "roof", sns: ["703000988780", "703000198170", "703000197256"] },
];

export const SOLAR_STALE_MS = 20 * 60_000; // ECU : relevé toutes les 5 min
export const AC_MIN_V = 100;
