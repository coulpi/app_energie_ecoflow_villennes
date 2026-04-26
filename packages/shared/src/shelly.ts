// Client Shelly local — accès direct via HTTP sur le LAN, sans cloud.
//
// Compatible :
//   - Gen1 (Shelly 1PM, Plug, EM, EM3) → GET /status
//   - Gen2/Gen3 (Plus 1PM, Pro EM, etc.) → GET /rpc/Shelly.GetStatus
//
// L'`externalId` du Device est l'URL ou l'IP : `http://192.168.1.42`.

export interface ShellyReading {
  powerW: number | null;
  energyWh: number | null;
  raw: unknown;
}

export async function fetchShellyStatus(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ShellyReading> {
  const url = baseUrl.replace(/\/+$/, "");
  // Tentative Gen2/3 d'abord (plus précis), fallback Gen1.
  try {
    const r2 = await fetchImpl(`${url}/rpc/Shelly.GetStatus`, {
      signal: AbortSignal.timeout(4000),
    });
    if (r2.ok) {
      const json = (await r2.json()) as Record<string, unknown>;
      return parseGen2(json);
    }
  } catch {
    // ignore, on tente Gen1
  }

  const r1 = await fetchImpl(`${url}/status`, {
    signal: AbortSignal.timeout(4000),
  });
  if (!r1.ok) {
    throw new Error(`Shelly HTTP ${r1.status}`);
  }
  const json = (await r1.json()) as Record<string, unknown>;
  return parseGen1(json);
}

function parseGen2(s: Record<string, unknown>): ShellyReading {
  // Gen2 expose des composants nommés `switch:0`, `pm1:0`, `em:0`, `emeter:0`,
  // selon le modèle. On somme les puissances trouvées.
  let powerW = 0;
  let energyWh = 0;
  let found = false;
  for (const [k, v] of Object.entries(s)) {
    if (!v || typeof v !== "object") continue;
    if (
      k.startsWith("switch:") ||
      k.startsWith("pm1:") ||
      k.startsWith("em1:") ||
      k.startsWith("em:") ||
      k.startsWith("emeter:")
    ) {
      const o = v as Record<string, unknown>;
      const p =
        (typeof o.apower === "number" && o.apower) ||
        (typeof o.act_power === "number" && o.act_power) ||
        (typeof o.power === "number" && o.power);
      if (typeof p === "number") {
        powerW += p;
        found = true;
      }
      const e =
        (o.aenergy as Record<string, unknown> | undefined)?.total ??
        (typeof o.total === "number" ? o.total : undefined);
      if (typeof e === "number") energyWh += e;
    }
  }
  return {
    powerW: found ? powerW : null,
    energyWh: energyWh || null,
    raw: s,
  };
}

function parseGen1(s: Record<string, unknown>): ShellyReading {
  // Gen1 expose `meters` (tableau), ou `emeters`, ou `relays[i].power`.
  let powerW: number | null = null;
  let energyWh: number | null = null;

  for (const key of ["meters", "emeters"]) {
    const arr = s[key];
    if (Array.isArray(arr) && arr.length > 0) {
      powerW = arr.reduce(
        (acc, m: Record<string, unknown>) =>
          acc + (typeof m.power === "number" ? m.power : 0),
        0,
      );
      energyWh = arr.reduce(
        (acc, m: Record<string, unknown>) =>
          acc + (typeof m.total === "number" ? m.total : 0),
        0,
      );
      break;
    }
  }
  if (powerW === null && Array.isArray(s.relays)) {
    powerW = (s.relays as Record<string, unknown>[]).reduce(
      (acc, r) => acc + (typeof r.power === "number" ? r.power : 0),
      0,
    );
  }

  return { powerW, energyWh, raw: s };
}
