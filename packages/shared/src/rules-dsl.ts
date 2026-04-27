import { z } from "zod";

// --- DSL de règles ---

export const ConditionAtomSchema = z.object({
  metric: z.enum([
    "production_W",
    "consumption_W",
    "grid_W",
    "surplus_W",
    "battery.soc",
    "tuya.switch.state",
    "tariff.period",
    "time.minute",
    "time.dow",
  ]),
  op: z.enum(["<", "<=", "==", "!=", ">=", ">", "in"]),
  value: z.union([z.number(), z.string(), z.array(z.union([z.number(), z.string()]))]),
});

export type ConditionAtom = z.infer<typeof ConditionAtomSchema>;

export type Condition =
  | ConditionAtom
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    ConditionAtomSchema,
    z.object({ all: z.array(ConditionSchema) }),
    z.object({ any: z.array(ConditionSchema) }),
    z.object({ not: ConditionSchema }),
  ]),
);

export const ActionSchema = z.object({
  action: z.enum([
    "tuya.switch.on",
    "tuya.switch.off",
    "ecoflow.setChargeWatts",
    "ecoflow.setDischargeWatts",
    "ecoflow.setMaxChargeSoc",
    "ecoflow.setMinDischargeSoc",
    "ecoflow.setOutputMode",
    "powerstream.setPermanentWatts",
    "powerstream.setSupplyPriority",
    "control.setMode",
    "control.setFollowLoad",
  ]),
  // Paramètres bruts. Les valeurs peuvent être un nombre / string fixe
  // ou une expression JSON simple (object {expr: "..."}) évaluée dans
  // le moteur de règles avec accès aux métriques courantes.
  params: z.record(z.unknown()).optional(),
});

export type RuleAction = z.infer<typeof ActionSchema>;

export const HysteresisSchema = z
  .object({
    metric: z.string(),
    onAbove: z.number().optional(),
    offBelow: z.number().optional(),
  })
  .optional();

export const AutomationRuleSchema = z.object({
  name: z.string(),
  enabled: z.boolean().default(true),
  priority: z.number().int().default(100),
  if: ConditionSchema,
  then: z.array(ActionSchema).min(1),
  minHoldSeconds: z.number().int().nonnegative().default(60),
  hysteresis: HysteresisSchema,
});

export type AutomationRuleDefinition = z.infer<typeof AutomationRuleSchema>;
