// Données compactes pour l'écran ESPHome tabscreen1 (ESP32-S3, LVGL),
// qui interroge cette route toutes les 5 s via http_request.
// JSON plat, nombres entiers, -1 / "" quand la valeur est inconnue : le
// parseur ArduinoJson côté ESP reste trivial.

import { NextResponse } from "next/server";
import { getDashboardSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

const LAT = Number(process.env.HOME_LAT ?? 48.9436);
const LON = Number(process.env.HOME_LON ?? 1.993);
const TZ = process.env.HOME_TZ ?? "Europe/Paris";
const WEATHER_TTL_MS = 10 * 60_000;

// Codes WMO Open-Meteo → états météo déjà gérés par l'écran.
function weatherState(code: number, isDay: boolean): string {
  if (code === 0) return isDay ? "sunny" : "clear-night";
  if (code <= 2) return "partlycloudy";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code === 65 || code === 82) return "pouring";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 81)) return "rainy";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snowy";
  if (code === 96 || code === 99) return "hail";
  if (code === 95) return "lightning-rainy";
  return "";
}

let weatherCache: { at: number; temp: number | null; state: string } | null = null;

async function currentWeather(): Promise<{ temp: number | null; state: string }> {
  if (weatherCache && Date.now() - weatherCache.at < WEATHER_TTL_MS) return weatherCache;
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(LAT));
    url.searchParams.set("longitude", String(LON));
    url.searchParams.set("timezone", TZ);
    url.searchParams.set("current", "temperature_2m,weather_code,is_day");
    const r = await fetch(url, { signal: AbortSignal.timeout(5_000), cache: "no-store" });
    if (!r.ok) throw new Error(`Open-Meteo HTTP ${r.status}`);
    const c = ((await r.json()) as {
      current?: { temperature_2m?: number; weather_code?: number; is_day?: number };
    }).current;
    weatherCache = {
      at: Date.now(),
      temp: c?.temperature_2m ?? null,
      state: c?.weather_code !== undefined ? weatherState(c.weather_code, c.is_day !== 0) : "",
    };
  } catch {
    // On garde l'ancienne valeur, et on réessaie dans 1 min.
    weatherCache = {
      at: Date.now() - WEATHER_TTL_MS + 60_000,
      temp: weatherCache?.temp ?? null,
      state: weatherCache?.state ?? "",
    };
  }
  return weatherCache;
}

const int = (v: number | null | undefined) =>
  v === null || v === undefined || Number.isNaN(v) ? null : Math.round(v);

export async function GET() {
  const [s, w] = await Promise.all([getDashboardSnapshot(), currentWeather()]);
  const soc = int(s.batterySoc);
  return NextResponse.json(
    {
      prod: Math.max(0, int(s.productionW) ?? 0),
      conso: Math.max(0, int(s.consumptionW) ?? 0),
      grid: int(s.gridW) ?? 0, // + achat, − injection
      aux: Math.max(0, int(s.auxNetworkW) ?? 0),
      soc: soc ?? -1,
      bat: int(s.batteryPowerW) ?? 0, // + décharge, − charge
      tempo: s.tempoColor ?? "",
      tempo_dem: s.tempoColorTomorrow ?? "",
      temp: w.temp === null ? -99 : Math.round(w.temp * 10) / 10,
      meteo: w.state,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
