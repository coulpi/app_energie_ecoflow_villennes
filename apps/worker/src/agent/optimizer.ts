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

Ton rôle : optimiser quotidiennement la stratégie de charge/décharge en tenant compte :
- de la consommation moyenne hebdomadaire par jour/heure,
- de la prévision météo (rayonnement solaire) sur les 24-48h à venir,
- des fenêtres tarifaires (heures creuses / pleines),
- de l'état actuel de la batterie.

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
Actions disponibles : tuya.switch.on, tuya.switch.off, ecoflow.setChargeWatts {watts}, ecoflow.setDischargeWatts {watts}, ecoflow.setMaxChargeSoc {soc}, ecoflow.setMinDischargeSoc {soc}.
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
  if (controlState) ctx.control_state = controlState;
  const loadsWithSchedule = loads.filter((l) => l.detectedSchedule);
  if (loads.length > 0) {
    ctx.loads = loads.map((l) => ({
      name: l.name,
      expectedW: l.expectedPowerW,
      schedule: l.detectedSchedule,
    }));
    void loadsWithSchedule; // référence pour grep futur
  }
  return ctx;
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
