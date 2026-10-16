// Dernière requête de l'écran ESPHome tabscreen1 sur /api/screen
// (User-Agent « ESPHome/… »), pour afficher son état sur la page /screen.
// En mémoire du process web (globalThis : partagé entre les routes).

interface ScreenSeen {
  at: number;
  userAgent: string;
}

const g = globalThis as { __screenSeen?: ScreenSeen | null };

export function markScreenSeen(userAgent: string | null): void {
  if (userAgent && /esphome/i.test(userAgent)) {
    g.__screenSeen = { at: Date.now(), userAgent };
  }
}

export function getScreenSeen(): ScreenSeen | null {
  return g.__screenSeen ?? null;
}
