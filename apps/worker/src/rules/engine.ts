// Moteur de règles : évalue les AutomationRule en BDD à intervalle régulier
// (calé sur le polling Tuya) et applique les actions résultantes.
//
// Le DSL est défini dans @app/shared/rules-dsl.

import type { Condition, ConditionAtom, RuleAction } from "@app/shared";
import { isInWindow, minutesSinceMidnight, dayOfWeek } from "@app/shared";
import { prisma } from "../db.js";
import { log } from "../log.js";
import { applyAction, type ActionContext } from "./actions.js";

interface MetricSnapshot {
  production_W: number | null;
  consumption_W: number | null;
  grid_W: number | null; // signé : + import, - export
  surplus_W: number | null;
  battery_soc: number | null;
  switch_state: boolean | null;
  tariffPeriod: "OFF_PEAK" | "PEAK" | "SHOULDER" | "NONE";
  now: Date;
}

const lastFiredAt = new Map<string, number>(); // ruleId -> epoch ms

export async function buildSnapshot(now = new Date()): Promise<MetricSnapshot> {
  const recent = new Date(now.getTime() - 5 * 60_000);

  const lastReading = async (role: string) => {
    const dev = await prisma.device.findFirst({
      where: { enabled: true, role: role as never },
      include: {
        readings: {
          where: { ts: { gte: recent } },
          orderBy: { ts: "desc" },
          take: 1,
        },
      },
    });
    return dev?.readings[0] ?? null;
  };

  const prod = await lastReading("PRODUCTION_METER");
  const cons = await lastReading("CONSUMPTION_METER");
  const grid = await lastReading("GRID_METER");
  const battery = await lastReading("BATTERY");
  const sw = await lastReading("BATTERY_AC_SWITCH");

  let production_W = prod?.powerW ?? null;
  const grid_W = grid?.powerW ?? null;
  let consumption_W = cons?.powerW ?? null;
  if (consumption_W === null && production_W !== null && grid_W !== null) {
    consumption_W = production_W + grid_W;
  }
  if (production_W === null && consumption_W !== null && grid_W !== null) {
    production_W = Math.max(0, consumption_W - grid_W);
  }
  const surplus_W =
    grid_W !== null
      ? -grid_W
      : production_W !== null && consumption_W !== null
        ? production_W - consumption_W
        : null;

  const tariffPeriod = await currentTariffPeriod(now);

  return {
    production_W,
    consumption_W,
    grid_W,
    surplus_W,
    battery_soc: battery?.soc ?? null,
    switch_state: sw?.switchOn ?? null,
    tariffPeriod,
    now,
  };
}

async function currentTariffPeriod(
  now: Date,
): Promise<"OFF_PEAK" | "PEAK" | "SHOULDER" | "NONE"> {
  const windows = await prisma.tariffWindow.findMany({
    where: { enabled: true },
  });
  for (const w of windows) {
    if (
      isInWindow(
        {
          startMinute: w.startMinute,
          endMinute: w.endMinute,
          daysOfWeek: w.daysOfWeek,
          enabled: w.enabled,
        },
        now,
      )
    ) {
      return w.period;
    }
  }
  return "NONE";
}

function metricValue(m: MetricSnapshot, key: ConditionAtom["metric"]): unknown {
  switch (key) {
    case "production_W":
      return m.production_W;
    case "consumption_W":
      return m.consumption_W;
    case "grid_W":
      return m.grid_W;
    case "surplus_W":
      return m.surplus_W;
    case "battery.soc":
      return m.battery_soc;
    case "tuya.switch.state":
      return m.switch_state;
    case "tariff.period":
      return m.tariffPeriod;
    case "time.minute":
      return minutesSinceMidnight(m.now);
    case "time.dow":
      return dayOfWeek(m.now);
  }
}

function evalAtom(atom: ConditionAtom, m: MetricSnapshot): boolean {
  const v = metricValue(m, atom.metric);
  if (v === null || v === undefined) return false;
  switch (atom.op) {
    case "<":
      return Number(v) < Number(atom.value);
    case "<=":
      return Number(v) <= Number(atom.value);
    case "==":
      return v === atom.value;
    case "!=":
      return v !== atom.value;
    case ">=":
      return Number(v) >= Number(atom.value);
    case ">":
      return Number(v) > Number(atom.value);
    case "in":
      return Array.isArray(atom.value) && (atom.value as unknown[]).includes(v);
  }
}

export function evalCondition(
  cond: Condition,
  m: MetricSnapshot,
): boolean {
  if ("metric" in cond) return evalAtom(cond, m);
  if ("all" in cond) return cond.all.every((c) => evalCondition(c, m));
  if ("any" in cond) return cond.any.some((c) => evalCondition(c, m));
  if ("not" in cond) return !evalCondition(cond.not, m);
  return false;
}

export async function evaluateRules(now = new Date()): Promise<void> {
  const snapshot = await buildSnapshot(now);
  const rules = await prisma.automationRule.findMany({
    where: { enabled: true },
    orderBy: { priority: "asc" },
  });

  const ctx: ActionContext = { snapshot };

  for (const r of rules) {
    const cond = r.conditionExpr as unknown as Condition;
    const matches = evalCondition(cond, snapshot);

    if (!matches) continue;

    // Hold : on ne re-déclenche pas une règle plus vite que minHoldSeconds.
    const last = lastFiredAt.get(r.id) ?? 0;
    if (now.getTime() - last < r.minHoldSeconds * 1000) {
      await prisma.ruleExecution.create({
        data: {
          ruleId: r.id,
          ts: now,
          triggered: false,
          status: "SKIPPED",
          context: snapshot as unknown as object,
          result: { reason: "minHoldSeconds" },
        },
      });
      continue;
    }
    lastFiredAt.set(r.id, now.getTime());

    const actions = r.actions as unknown as RuleAction[];
    for (const a of actions) {
      try {
        const result = await applyAction(a, ctx);
        await prisma.ruleExecution.create({
          data: {
            ruleId: r.id,
            ts: new Date(),
            triggered: true,
            status: "SUCCESS",
            context: snapshot as unknown as object,
            result: result as unknown as object,
          },
        });
      } catch (e) {
        log.warn("rule action failed", {
          ruleId: r.id,
          action: a.action,
          error: (e as Error).message,
        });
        await prisma.ruleExecution.create({
          data: {
            ruleId: r.id,
            ts: new Date(),
            triggered: true,
            status: "FAILED",
            context: snapshot as unknown as object,
            error: (e as Error).message,
          },
        });
      }
    }
    // Premier match : on s'arrête (priorité = ordre).
    break;
  }
}

export function startRulesEngine(intervalSeconds: number): NodeJS.Timeout {
  log.info("starting rules engine", { intervalSeconds });
  const tick = async () => {
    try {
      await evaluateRules();
    } catch (e) {
      log.error("rules engine error", { error: (e as Error).message });
    }
  };
  void tick();
  return setInterval(tick, intervalSeconds * 1000);
}

export type { MetricSnapshot };
