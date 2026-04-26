// Open-Meteo : prévisions météo gratuites sans clé.
// Doc : https://open-meteo.com/en/docs

export interface WeatherForecastPoint {
  ts: string; // ISO local time
  temperatureC: number | null;
  cloudCoverPct: number | null;
  shortwaveRadWm2: number | null; // proxy direct du potentiel solaire
  precipMm: number | null;
}

export interface WeatherFetchOptions {
  lat: number;
  lon: number;
  tz?: string;
  hours?: number; // 1..168
  fetchImpl?: typeof fetch;
}

export async function fetchSolarForecast(
  opts: WeatherFetchOptions,
): Promise<WeatherForecastPoint[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const tz = opts.tz ?? "Europe/Paris";
  const hours = Math.min(opts.hours ?? 48, 168);
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(opts.lat));
  url.searchParams.set("longitude", String(opts.lon));
  url.searchParams.set("timezone", tz);
  url.searchParams.set(
    "hourly",
    "temperature_2m,cloud_cover,shortwave_radiation,precipitation",
  );
  url.searchParams.set("forecast_days", String(Math.ceil(hours / 24)));

  const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw new Error(`Open-Meteo HTTP ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    hourly?: {
      time?: string[];
      temperature_2m?: number[];
      cloud_cover?: number[];
      shortwave_radiation?: number[];
      precipitation?: number[];
    };
  };
  const h = json.hourly;
  if (!h?.time) return [];
  const out: WeatherForecastPoint[] = [];
  for (let i = 0; i < Math.min(h.time.length, hours); i++) {
    out.push({
      ts: h.time[i]!,
      temperatureC: h.temperature_2m?.[i] ?? null,
      cloudCoverPct: h.cloud_cover?.[i] ?? null,
      shortwaveRadWm2: h.shortwave_radiation?.[i] ?? null,
      precipMm: h.precipitation?.[i] ?? null,
    });
  }
  return out;
}
