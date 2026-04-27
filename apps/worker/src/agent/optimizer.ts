import { ollama as ollamaNs, weather as weatherNs } from "@app/shared";
import { AutomationRuleSchema, type AutomationRuleDefinition } from "@app/shared";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { log } from "../log.js";
import { lastSnapshot, weeklyConsumptionPattern } from "./stats.js";

const { ollamaChat } = ollamaNs;
const { fetchSolarForecast } = weatherNs;

const AGENT_RULE_TAG = "[agent]"; // marque les règles gérées par l'agent

interface AgentSettings {
  enabled: boolean;
  model: string;
  intervalMinutes: number;
}

async function loadSettings(): Promise<AgentSettings> {
  const rows = await prisma.systemConfig.findMany({
    where: {
      key: { in: ["agent.enabled", "agent.model", "agent.intervalMinutes"] },
    },
  });
  const map = new Map(rows.map((r) => [r.key, r.value as unknown]));
  return {
    enabled:
      typeof map.get("agent.enabled") === "boolean"
        ? (map.get("agent.enabled") as boolean)
        : env.AGENT_ENABLED,
    model:
      typeof map.get("agent.model") === "string"
        ? (map.get("agent.model") as string)
        : env.OLLAMA_MODEL,
    intervalMinutes:
      typeof map.get("agent.intervalMinutes") === "number"
        ? (map.get("agent.intervalMinutes") as number)
        : env.AGENT_INTERVAL_MINUTES,
  };
}

const SYSTEM_PROMPT = `Tu es un agent d'optimisation énergétique pour une maison à Villennes-sur-Seine.
Équipements :
- Panneaux solaires (production)
- Compteur Shelly (consommation maison)
- Compteur PJ2101A (réseau, signé : + import / - export)
- Batterie EcoFlow Delta Max 2000 (~2016 Wh, SoC en %)
- Prise Tuya en amont de l'entrée AC de la batterie : ON = la batterie peut charger sur secteur, OFF = pas de courant.
- PowerStream EcoFlow (micro-onduleur grid-tied) connecté à la batterie : il injecte sur le réseau maison pour alimenter la maison via la batterie. Deux modes :
  - priority 0 = "alimentation" : la batterie alimente la maison via le PS (décharge).
  - priority 1 = "stockage" : la batterie ne décharge pas, on privilégie de la recharger.
  Quand priority=0, la consigne `permanentWatts` (0..800 W) fixe la puissance d'injection.

Ton rôle : optimiser quotidiennement la stratégie de charge/décharge en tenant compte :
- de la consommation moyenne hebdomadaire par jour/heure,
- de la prévision météo (rayonnement solaire) sur les 24-48h à venir,
- des fenêtres tarifaires (heures creuses / pleines),
- de l'état actuel de la batterie,
- des appareils récurrents (loads) et de leur état ON/OFF live.

Repères conso :
- Conso de base nuit (sans gros appareil) ≈ 650-700 W (réfrigérateur, box, veille).
- consumption_live.deltaW = current - baseline 1h. Si ce delta correspond
  à expectedW d'un load ± toleranceW, le champ loads[i].currentlyOn=true
  signale qu'on PENSE que cet appareil est en marche en ce moment
  (heuristique, confidence ∈ [0, 1]).

Contraintes dures :
- Si SoC ≤ 5 %, la prise AC DOIT rester ON (sinon la batterie ne peut plus se réveiller).
- 20 ≤ minDischargeSoc ≤ 50, 80 ≤ maxChargeSoc ≤ 100.
- Mode possible : RULES, FOLLOW_LOAD, MANUAL, OFF.

Tu réponds UNIQUEMENT en JSON valide avec cette structure :
{
  "control": {
    "mode": "RULES" | "FOLLOW_LOAD" | "MANUAL" | "OFF",
    "followLoadOffsetW": number,
    "followLoadMinW": number,
    "followLoadMaxW": number,
    "minDischargeSoc": number,
    "maxChargeSoc": number
  },
  "rules": [
    {
      "name": "[agent] ...",
      "priority": number,
      "if": { "all" | "any": [ {"metric": "...", "op": "...", "value": ...}, ... ] },
      "then": [ {"action": "...", "params": {...}} ],
      "minHoldSeconds": number
    }
  ],
  "rationale": "explication courte en français"
}

Métriques disponibles : production_W, consumption_W, grid_W, surplus_W, battery.soc, tuya.switch.state, tariff.period, time.minute, time.dow.
Actions disponibles :
- tuya.switch.on / tuya.switch.off : prise AC IN de la batterie (charge sur secteur).
- ecoflow.setChargeWatts {watts} : limite de charge AC en W (100..2000).
- ecoflow.setMaxChargeSoc {soc} / ecoflow.setMinDischargeSoc {soc} : bornes SoC.
- powerstream.setPermanentWatts {watts} : puissance d'injection PowerStream (0..800).
- powerstream.setSupplyPriority {priority: 0|1} : 0 = alimentation maison, 1 = stockage batterie.

Stratégie typique :
- Surplus solaire abondant + SoC bas → priority 1 (stockage) + prise ON pour charger.
- Conso élevée + SoC haut + tarif PEAK → priority 0 + permanentWatts ajusté à la conso.
- Nuit hors PEAK et SoC haut : priority 0 pour alimenter via batterie au lieu d'importer.
Le préfixe [agent] dans le nom des règles est OBLIGATOIRE — il permet au système de remplacer uniquement tes propres règles sans toucher aux règles utilisateur.`;

interface AgentProposal {
  control?: {
    mode?: string;
    followLoadOffsetW?: number;
    followLoadMinW?: number;
    followLoadMaxW?: number;
    minDischargeSoc?: number;
    maxChargeSoc?: number;
  };
  rules?: AutomationRuleDefinition[];
  rationale?: string;
}

async function buildContext() {
  const [snapshot, pattern, tariffs, controlState, loads] = await Promise.all([
    lastSnapshot(),
    weeklyConsumptionPattern(4),
    prisma.tariffWindow.findMany({ where: { enabled: true } }),
    prisma.controlState.findUnique({ where: { key: "default" } }),
    prisma.loadProfile.findMany({ where: { enabled: true } }),
  ]);

  // Compaction du pattern hebdo : moyennes par tranche de 6h (jour/nuit)
  // pour limiter la taille du prompt — 7×4 = 28 entrées au lieu de 168.
  const compactPattern: Array<{ dow: number; slot: string; avgW: number }> = [];
  const slots = [
    [0, 6],
    [6, 12],
    [12, 18],
    [18, 24],
  ];
  for (let dow = 1; dow <= 7; dow++) {
    for (const [startH, endH] of slots) {
      const buckets = pattern.filter(
        (p) =>
          p.dow === dow &&
          p.hour >= startH! &&
          p.hour < endH! &&
          p.samples > 0,
      );
      if (buckets.length === 0) continue;
      const avg =
        buckets.reduce((a, b) => a + b.avgWh, 0) / buckets.length;
      compactPattern.push({
        dow,
        slot: `${String(startH).padStart(2, "0")}-${String(endH).padStart(2, "0")}h`,
        avgW: Math.round(avg),
      });
    }
  }

  let forecast: Awaited<
    ReturnType<typeof fetchSolarForecast>
  > = [];
  try {
    forecast = await fetchSolarForecast({
      lat: env.HOME_LAT,
      lon: env.HOME_LON,
      tz: env.HOME_TZ,
      hours: 24,
    });
    // Échantillonne 1 point sur 3 pour réduire la taille du prompt.
    forecast = forecast.filter((_, i) => i % 3 === 0);
  } catch (e) {
    log.warn("agent: weather fetch failed", { error: (e as Error).message });
  }

  // Compaction agressive : on omet les champs vides pour réduire le prompt.
  const ctx: Record<string, unknown> = {
    now: new Date().toISOString(),
    snapshot,
    constraints: {
      batteryCriticalSoc: env.BATTERY_CRITICAL_SOC,
      batteryCapacityWh: 2016,
    },
  };
  if (compactPattern.length > 0) ctx.consumption_pattern = compactPattern;
  if (forecast.length > 0) {
    ctx.weather_forecast = forecast.map((p) => ({
      t: p.ts,
      irr: p.shortwaveRadWm2,
      cloud: p.cloudCoverPct,
    }));
  }
  if (tariffs.length > 0) {
    ctx.tariffs = tariffs.map((t) => ({
      name: t.name,
      period: t.period,
      start: minToHHMM(t.startMinute),
      end: minToHHMM(t.endMinute),
      pricePerKwh: t.pricePerKwh,
    }));
  }
  if (controlState) {
    ctx.control_state = controlState;
    // Expose explicitement l'état PowerStream pour que l'agent le lise
    // d'un coup d'œil sans creuser dans control_state.
    const cs = controlState as unknown as {
      powerstreamSn?: string | null;
      powerstreamPermanentW?: number;
      powerstreamPriority?: number;
    };
    if (cs.powerstreamSn) {
      ctx.powerstream = {
        sn: cs.powerstreamSn,
        permanentW: cs.powerstreamPermanentW ?? 0,
        priority: cs.powerstreamPriority ?? 0,
        priorityLabel:
          (cs.powerstreamPriority ?? 0) === 0 ? "alimentation" : "stockage",
      };
    }
  }

  // Détection live des appareils ON/OFF (heuristique sur conso vs base).
  const liveLoads = await computeLiveLoads(loads);
  if (liveLoads.summary) ctx.consumption_live = liveLoads.summary;
  if (loads.length > 0) {
    ctx.loads = loads.map((l) => {
      const live = liveLoads.profileMap.get(l.id);
      return {
        name: l.name,
        expectedW: l.expectedPowerW,
        toleranceW: l.toleranceW,
        schedule: l.detectedSchedule,
        currentlyOn: live?.currentlyOn ?? false,
        confidence: live?.confidence ?? 0,
      };
    });
  }
  return ctx;
}

/** Résumé live + état ON/OFF par profil, basé sur la conso CONSUMPTION_METER. */
async function computeLiveLoads(
  loads: Array<{ id: string; expectedPowerW: number; toleranceW: number }>,
): Promise<{
  summary: { currentW: number | null; baseW: number | null; deltaW: number | null } | null;
  profileMap: Map<string, { currentlyOn: boolean; confidence: number }>;
}> {
  const [prodDev, gridDev] = await Promise.all([
    prisma.device.findFirst({
      where: { enabled: true, role: "PRODUCTION_METER" },
    }),
    prisma.device.findFirst({
      where: { enabled: true, role: "GRID_METER" },
    }),
  ]);
  if (!prodDev || !gridDev) return { summary: null, profileMap: new Map() };

  const since = new Date(Date.now() - 60 * 60_000);
  const [prodRows, gridRows] = await Promise.all([
    prisma.reading.findMany({
      where: { deviceId: prodDev.id, ts: { gte: since }, powerW: { not: null } },
      orderBy: { ts: "asc" },
      select: { ts: true, powerW: true },
    }),
    prisma.reading.findMany({
      where: { deviceId: gridDev.id, ts: { gte: since }, powerW: { not: null } },
      orderBy: { ts: "asc" },
      select: { ts: true, powerW: true },
    }),
  ]);

  // Bilan : conso = prod + grid (signé), bucketé par minute.
  const buckets = new Map<number, { p: number[]; g: number[] }>();
  for (const r of prodRows) {
    if (r.powerW === null) continue;
    const k = Math.floor(r.ts.getTime() / 60_000);
    const b = buckets.get(k) ?? { p: [], g: [] };
    b.p.push(r.powerW);
    buckets.set(k, b);
  }
  for (const r of gridRows) {
    if (r.powerW === null) continue;
    const k = Math.floor(r.ts.getTime() / 60_000);
    const b = buckets.get(k) ?? { p: [], g: [] };
    b.g.push(r.powerW);
    buckets.set(k, b);
  }
  const consoSeries: { tsMin: number; w: number }[] = [];
  for (const [k, b] of buckets) {
    if (b.p.length === 0 || b.g.length === 0) continue;
    const p = b.p.reduce((a, x) => a + x, 0) / b.p.length;
    const g = b.g.reduce((a, x) => a + x, 0) / b.g.length;
    consoSeries.push({ tsMin: k, w: Math.max(0, p + g) });
  }
  const powers = consoSeries.map((x) => x.w).filter((w) => w > 0);

  const recentMinKey = Math.floor((Date.now() - 2 * 60_000) / 60_000);
  const recents = consoSeries
    .filter((x) => x.tsMin >= recentMinKey)
    .map((x) => x.w);
  const currentW =
    recents.length > 0 ? recents.reduce((a, b) => a + b, 0) / recents.length : null;

  // Override manuel via ControlState.loadsBaselineW si défini.
  // Sinon, double baseline auto : médiane nocturne 2-5h vs p25 diurne
  // 8-22h, sur 7 jours, on prend selon l'heure courante.
  const ctrl = (await prisma.controlState.findUnique({
    where: { key: "default" },
  })) as { loadsBaselineW?: number | null } | null;
  let baseW: number | null = null;
  if (typeof ctrl?.loadsBaselineW === "number" && ctrl.loadsBaselineW > 0) {
    baseW = ctrl.loadsBaselineW;
  } else {
    const sinceWeek = new Date(Date.now() - 7 * 24 * 3_600_000);
    const [pWeek, gWeek] = await Promise.all([
      prisma.reading.findMany({
        where: { deviceId: prodDev.id, ts: { gte: sinceWeek }, powerW: { not: null } },
        select: { ts: true, powerW: true },
      }),
      prisma.reading.findMany({
        where: { deviceId: gridDev.id, ts: { gte: sinceWeek }, powerW: { not: null } },
        select: { ts: true, powerW: true },
      }),
    ]);
    const ranges = [
      { name: "night", filter: (h: number) => h >= 2 && h < 5 },
      { name: "day", filter: (h: number) => h >= 8 && h < 22 },
    ];
    const series: Record<string, number[]> = { night: [], day: [] };
    for (const range of ranges) {
      const bk = new Map<number, { p: number[]; g: number[] }>();
      const acc = (rows: typeof pWeek, field: "p" | "g") => {
        for (const r of rows) {
          if (r.powerW === null) continue;
          if (!range.filter(r.ts.getHours())) continue;
          const k = Math.floor(r.ts.getTime() / 60_000);
          const b = bk.get(k) ?? { p: [], g: [] };
          b[field].push(r.powerW);
          bk.set(k, b);
        }
      };
      acc(pWeek, "p");
      acc(gWeek, "g");
      for (const [, b] of bk) {
        if (b.p.length === 0 || b.g.length === 0) continue;
        const p = b.p.reduce((a, x) => a + x, 0) / b.p.length;
        const g = b.g.reduce((a, x) => a + x, 0) / b.g.length;
        series[range.name]!.push(Math.max(0, p + g));
      }
    }
    const sortedNight = [...series.night!].sort((a, b) => a - b);
    const sortedDay = [...series.day!].sort((a, b) => a - b);
    const nightBase =
      sortedNight.length >= 30 ? sortedNight[Math.floor(sortedNight.length * 0.5)]! : null;
    const dayBase =
      sortedDay.length >= 30 ? sortedDay[Math.floor(sortedDay.length * 0.35)]! : null;
    const h = new Date().getHours();
    const useNight = h < 6 || h >= 22;
    const auto = useNight ? nightBase ?? dayBase : dayBase ?? nightBase;
    if (auto !== null) {
      baseW = Math.max(400, Math.min(2000, auto));
    } else if (powers.length >= 10) {
      const sorted = [...powers].sort((a, b) => a - b);
      baseW = Math.max(400, Math.min(1500, sorted[Math.floor(sorted.length * 0.5)]!));
    }
  }

  const deltaW = currentW !== null && baseW !== null ? currentW - baseW : null;
  const profileMap = new Map<string, { currentlyOn: boolean; confidence: number }>();
  for (const l of loads) {
    if (deltaW === null) {
      profileMap.set(l.id, { currentlyOn: false, confidence: 0 });
      continue;
    }
    const distance = Math.abs(deltaW - l.expectedPowerW);
    const within = distance <= l.toleranceW;
    const confidence = Math.max(0, 1 - distance / Math.max(l.toleranceW, 1));
    profileMap.set(l.id, { currentlyOn: within, confidence });
  }

  return {
    summary: {
      currentW: currentW !== null ? Math.round(currentW) : null,
      baseW: baseW !== null ? Math.round(baseW) : null,
      deltaW: deltaW !== null ? Math.round(deltaW) : null,
    },
    profileMap,
  };
}

function minToHHMM(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function tryParseJson(content: string): AgentProposal | null {
  // Tolère un fenced ```json ... ``` ou du JSON pur.
  const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : content;
  try {
    return JSON.parse(raw!.trim()) as AgentProposal;
  } catch {
    return null;
  }
}

async function applyProposal(
  proposal: AgentProposal,
): Promise<{ controlUpdated: boolean; rulesReplaced: number }> {
  let controlUpdated = false;
  let rulesReplaced = 0;

  // ControlState
  if (proposal.control) {
    const c = proposal.control;
    const data: Record<string, unknown> = {};
    if (c.mode && ["MANUAL", "RULES", "FOLLOW_LOAD", "OFF"].includes(c.mode)) {
      data.mode = c.mode;
    }
    if (typeof c.followLoadOffsetW === "number")
      data.followLoadOffsetW = Math.max(0, Math.round(c.followLoadOffsetW));
    if (typeof c.followLoadMinW === "number")
      data.followLoadMinW = Math.max(0, Math.round(c.followLoadMinW));
    if (typeof c.followLoadMaxW === "number")
      data.followLoadMaxW = Math.max(0, Math.round(c.followLoadMaxW));
    if (typeof c.minDischargeSoc === "number")
      data.minDischargeSoc = clamp(Math.round(c.minDischargeSoc), 5, 90);
    if (typeof c.maxChargeSoc === "number")
      data.maxChargeSoc = clamp(Math.round(c.maxChargeSoc), 50, 100);

    if (Object.keys(data).length > 0) {
      await prisma.controlState.upsert({
        where: { key: "default" },
        create: { key: "default", ...data },
        update: data,
      });
      controlUpdated = true;
    }
  }

  // Règles : remplace toutes les règles dont le nom commence par [agent].
  if (Array.isArray(proposal.rules)) {
    await prisma.automationRule.deleteMany({
      where: { name: { startsWith: AGENT_RULE_TAG } },
    });
    for (const r of proposal.rules) {
      try {
        const parsed = AutomationRuleSchema.parse(r);
        const name = parsed.name.startsWith(AGENT_RULE_TAG)
          ? parsed.name
          : `${AGENT_RULE_TAG} ${parsed.name}`;
        await prisma.automationRule.create({
          data: {
            name,
            enabled: parsed.enabled,
            priority: parsed.priority,
            conditionExpr: parsed.if as unknown as object,
            actions: parsed.then as unknown as object,
            minHoldSeconds: parsed.minHoldSeconds,
          },
        });
        rulesReplaced++;
      } catch (e) {
        log.warn("agent: rule rejected by schema", {
          error: (e as Error).message,
          rule: r,
        });
      }
    }
  }

  return { controlUpdated, rulesReplaced };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export async function runAgent(
  trigger: "schedule" | "manual" | "demo" = "schedule",
  opts: { dryRun?: boolean } = {},
): Promise<{ id: bigint; applied: boolean; error?: string }> {
  const start = Date.now();
  const settings = await loadSettings();
  const dryRun = opts.dryRun === true || trigger === "demo";

  if (trigger === "schedule" && !settings.enabled) {
    return { id: 0n, applied: false, error: "agent disabled" };
  }

  const ctx = await buildContext();
  const userPrompt = JSON.stringify(ctx, null, 2);

  const run = await prisma.agentRun.create({
    data: {
      trigger,
      model: settings.model,
      context: ctx as unknown as object,
      prompt: userPrompt,
    },
  });

  try {
    log.info("agent: calling ollama", {
      model: settings.model,
      promptLen: userPrompt.length,
    });
    const response = await ollamaChat({
      baseUrl: env.OLLAMA_BASE_URL,
      model: settings.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      format: "json",
      temperature: 0.1,
      signal: AbortSignal.timeout(1800_000),
      onProgress: (info) => {
        log.info("agent: ollama stream done", info);
      },
    });

    const proposal = tryParseJson(response);
    let applied = false;
    let appliedJson: unknown = null;

    if (proposal && !dryRun) {
      const result = await applyProposal(proposal);
      applied = result.controlUpdated || result.rulesReplaced > 0;
      appliedJson = result;
    } else if (proposal && dryRun) {
      appliedJson = { dryRun: true };
    }

    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        response,
        proposal: (proposal as unknown as object) ?? undefined,
        applied,
        appliedJson: (appliedJson as unknown as object) ?? undefined,
        durationMs: Date.now() - start,
      },
    });

    log.info("agent run completed", {
      id: run.id.toString(),
      applied,
      durationMs: Date.now() - start,
    });
    return { id: run.id, applied };
  } catch (e) {
    const error = (e as Error).message;
    await prisma.agentRun.update({
      where: { id: run.id },
      data: {
        error,
        durationMs: Date.now() - start,
      },
    });
    log.error("agent run failed", { error });
    return { id: run.id, applied: false, error };
  }
}

export function startAgentScheduler(): NodeJS.Timeout {
  log.info("starting agent scheduler", {
    intervalMinutes: env.AGENT_INTERVAL_MINUTES,
  });
  // Premier tick légèrement décalé pour laisser au worker le temps de
  // collecter quelques données avant la première proposition.
  setTimeout(() => void runAgent("schedule"), 60_000);
  return setInterval(
    () => void runAgent("schedule"),
    env.AGENT_INTERVAL_MINUTES * 60_000,
  );
}
