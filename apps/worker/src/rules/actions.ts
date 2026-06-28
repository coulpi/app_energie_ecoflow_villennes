import type { RuleAction } from "@app/shared";
import { tuya as tuyaNs } from "@app/shared";
import { prisma } from "../db.js";
import { env } from "../env.js";
import { publishEcoFlowSet } from "../pollers/ecoflow.js";
import { ECOFLOW_CMDS } from "./ecoflow-cmds.js";
import { log } from "../log.js";
import type { MetricSnapshot } from "./engine.js";

const { TuyaClient } = tuyaNs;

export interface ActionContext {
  snapshot: MetricSnapshot;
}

let tuyaClient: InstanceType<typeof TuyaClient> | null = null;
function tuya() {
  if (!tuyaClient) {
    tuyaClient = new TuyaClient({
      clientId: env.TUYA_CLIENT_ID!,
      clientSecret: env.TUYA_CLIENT_SECRET!,
      apiBase: env.TUYA_API_BASE,
    });
  }
  return tuyaClient;
}

/**
 * Évalue une expression simple :
 *   - nombre direct → renvoyé tel quel
 *   - { expr: "min(surplus_W, 800)" } → mini-évaluateur sécurisé
 */
function evalParam(value: unknown, ctx: ActionContext): unknown {
  if (
    value !== null &&
    typeof value === "object" &&
    "expr" in (value as Record<string, unknown>)
  ) {
    return safeEvalExpr(
      String((value as Record<string, unknown>).expr),
      ctx.snapshot,
    );
  }
  return value;
}

function safeEvalExpr(expr: string, m: MetricSnapshot): number | null {
  // Parser minimal : remplacer les noms de métrique par des nombres,
  // autoriser min/max/abs/clamp et opérateurs +-*/, sinon refuser.
  const env: Record<string, number> = {
    production_W: m.production_W ?? 0,
    consumption_W: m.consumption_W ?? 0,
    grid_W: m.grid_W ?? 0,
    surplus_W: m.surplus_W ?? 0,
    battery_soc: m.battery_soc ?? 0,
  };
  const allowed = /^[\s0-9+\-*/().,a-zA-Z_]+$/;
  if (!allowed.test(expr)) {
    throw new Error("expression non autorisée");
  }
  const fn = new Function(
    ...Object.keys(env),
    "min",
    "max",
    "abs",
    "clamp",
    `return (${expr});`,
  );
  const clamp = (x: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, x));
  const result = fn(
    ...Object.values(env),
    Math.min,
    Math.max,
    Math.abs,
    clamp,
  );
  return typeof result === "number" && Number.isFinite(result)
    ? result
    : null;
}

async function findDevice(role:
  | "BATTERY_AC_SWITCH"
  | "BATTERY") {
  const d = await prisma.device.findFirst({
    where: { enabled: true, role: role as never },
  });
  if (!d) throw new Error(`device avec role ${role} introuvable`);
  return d;
}

export async function applyAction(
  a: RuleAction,
  ctx: ActionContext,
): Promise<unknown> {
  const params = Object.fromEntries(
    Object.entries(a.params ?? {}).map(([k, v]) => [k, evalParam(v, ctx)]),
  );

  switch (a.action) {
    case "tuya.switch.on":
    case "tuya.switch.off": {
      const sw = await findDevice("BATTERY_AC_SWITCH");
      const code =
        (sw.capabilities as { switchCode?: string } | null)?.switchCode ??
        "switch_1";
      const want = a.action === "tuya.switch.on";
      // Tuya renvoie `result:false` quand la commande n'a pas pu être
      // délivrée (prise déconnectée du cloud). On le rend visible au lieu
      // de l'ignorer silencieusement.
      const delivered = await tuya().switchOnOff(sw.externalId, want, code);
      if (!delivered) {
        log.warn("tuya: commande non délivrée (prise hors-ligne ?)", {
          device: sw.externalId,
          name: sw.name,
          want,
        });
      }
      return { device: sw.externalId, switch: want, delivered };
    }

    case "ecoflow.setChargeWatts": {
      const bat = await findDevice("BATTERY");
      const watts = Number(params.watts ?? 0);
      const cmd = ECOFLOW_CMDS.setChargeWatts(bat, watts);
      await publishEcoFlowSet(bat.externalId, cmd);
      return { sn: bat.externalId, watts };
    }

    case "ecoflow.setDischargeWatts": {
      const bat = await findDevice("BATTERY");
      const watts = Number(params.watts ?? 0);
      const cmd = ECOFLOW_CMDS.setDischargeWatts(bat, watts);
      if (!cmd) {
        log.info("setDischargeWatts non supporté par ce modèle", {
          sn: bat.externalId,
        });
        return { sn: bat.externalId, watts, supported: false };
      }
      await publishEcoFlowSet(bat.externalId, cmd);
      return { sn: bat.externalId, watts };
    }

    case "ecoflow.setMaxChargeSoc": {
      const bat = await findDevice("BATTERY");
      const soc = Number(params.soc ?? 95);
      const cmd = ECOFLOW_CMDS.setMaxChargeSoc(bat, soc);
      await publishEcoFlowSet(bat.externalId, cmd);
      return { sn: bat.externalId, maxChargeSoc: soc };
    }

    case "ecoflow.setMinDischargeSoc": {
      const bat = await findDevice("BATTERY");
      const soc = Number(params.soc ?? 20);
      const cmd = ECOFLOW_CMDS.setMinDischargeSoc(bat, soc);
      await publishEcoFlowSet(bat.externalId, cmd);
      return { sn: bat.externalId, minDischargeSoc: soc };
    }

    case "ecoflow.setOutputMode": {
      const bat = await findDevice("BATTERY");
      const acOn = Boolean(params.acOn);
      const cmd = ECOFLOW_CMDS.setOutputAc(bat, acOn);
      await publishEcoFlowSet(bat.externalId, cmd);
      return { sn: bat.externalId, acOn };
    }

    case "powerstream.setPermanentWatts": {
      const ctrl = (await prisma.controlState.findUnique({
        where: { key: "default" },
      })) as { powerstreamSn?: string | null } | null;
      const sn = ctrl?.powerstreamSn;
      if (!sn) throw new Error("powerstreamSn non configuré");
      const watts = Math.max(0, Math.min(800, Number(params.watts ?? 0)));
      const { publishPowerStreamCommand } = await import(
        "../pollers/ecoflow.js"
      );
      await publishPowerStreamCommand(sn, { kind: "permanentWatts", watts });
      await prisma.controlState.update({
        where: { key: "default" },
        data: { powerstreamPermanentW: watts } as never,
      });
      return { sn, watts };
    }

    case "powerstream.setSupplyPriority": {
      const ctrl = (await prisma.controlState.findUnique({
        where: { key: "default" },
      })) as { powerstreamSn?: string | null } | null;
      const sn = ctrl?.powerstreamSn;
      if (!sn) throw new Error("powerstreamSn non configuré");
      const priority = (Number(params.priority ?? 0) === 1 ? 1 : 0) as 0 | 1;
      const { publishPowerStreamCommand } = await import(
        "../pollers/ecoflow.js"
      );
      await publishPowerStreamCommand(sn, { kind: "supplyPriority", priority });
      await prisma.controlState.update({
        where: { key: "default" },
        data: { powerstreamPriority: priority } as never,
      });
      return { sn, priority };
    }

    case "control.setMode": {
      const mode = String(params.mode ?? "RULES");
      await prisma.controlState.upsert({
        where: { key: "default" },
        create: { key: "default", mode: mode as never },
        update: { mode: mode as never },
      });
      return { mode };
    }

    case "control.setFollowLoad": {
      const offsetW = Number(params.offsetW ?? 50);
      const minW = Number(params.minW ?? 0);
      const maxW = Number(params.maxW ?? 800);
      await prisma.controlState.upsert({
        where: { key: "default" },
        create: {
          key: "default",
          mode: "FOLLOW_LOAD",
          followLoadOffsetW: offsetW,
          followLoadMinW: minW,
          followLoadMaxW: maxW,
        },
        update: {
          mode: "FOLLOW_LOAD",
          followLoadOffsetW: offsetW,
          followLoadMinW: minW,
          followLoadMaxW: maxW,
        },
      });
      return { mode: "FOLLOW_LOAD", offsetW, minW, maxW };
    }
  }
  log.warn("action inconnue", { action: a.action });
  return null;
}
