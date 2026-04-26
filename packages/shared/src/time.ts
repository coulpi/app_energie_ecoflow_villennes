// Helpers temps & fenêtres tarifaires.

export function minutesSinceMidnight(d: Date, tz = "Europe/Paris"): number {
  const fmt = new Intl.DateTimeFormat("fr-FR", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

export function dayOfWeek(d: Date, tz = "Europe/Paris"): number {
  // 1 = lundi ... 7 = dimanche
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
  });
  const map: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return map[fmt.format(d)] ?? 1;
}

export interface TariffWindowLike {
  startMinute: number;
  endMinute: number;
  daysOfWeek: number[];
  enabled: boolean;
}

export function isInWindow(
  win: TariffWindowLike,
  now: Date,
  tz = "Europe/Paris",
): boolean {
  if (!win.enabled) return false;
  if (win.daysOfWeek.length > 0 && !win.daysOfWeek.includes(dayOfWeek(now, tz))) {
    return false;
  }
  const m = minutesSinceMidnight(now, tz);
  if (win.startMinute <= win.endMinute) {
    return m >= win.startMinute && m < win.endMinute;
  }
  // Fenêtre traversant minuit (ex. 22:30 -> 06:30)
  return m >= win.startMinute || m < win.endMinute;
}
