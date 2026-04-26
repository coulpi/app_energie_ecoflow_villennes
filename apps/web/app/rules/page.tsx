import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { AutomationRuleSchema } from "@app/shared";

export const dynamic = "force-dynamic";

async function createRule(formData: FormData) {
  "use server";
  const definition = JSON.parse(String(formData.get("definition")));
  const parsed = AutomationRuleSchema.parse(definition);
  await prisma.automationRule.create({
    data: {
      name: parsed.name,
      enabled: parsed.enabled,
      priority: parsed.priority,
      conditionExpr: parsed.if as unknown as object,
      actions: parsed.then as unknown as object,
      minHoldSeconds: parsed.minHoldSeconds,
      hysteresis: (parsed.hysteresis as unknown as object) ?? undefined,
    },
  });
  revalidatePath("/rules");
}

async function toggleRule(id: string) {
  "use server";
  const r = await prisma.automationRule.findUnique({ where: { id } });
  if (!r) return;
  await prisma.automationRule.update({
    where: { id },
    data: { enabled: !r.enabled },
  });
  revalidatePath("/rules");
}

async function deleteRule(id: string) {
  "use server";
  await prisma.automationRule.delete({ where: { id } });
  revalidatePath("/rules");
}

const sample = JSON.stringify(
  {
    name: "Charger sur surplus solaire",
    priority: 10,
    if: {
      all: [
        { metric: "surplus_W", op: ">", value: 300 },
        { metric: "battery.soc", op: "<", value: 95 },
      ],
    },
    then: [
      { action: "tuya.switch.on" },
      {
        action: "ecoflow.setChargeWatts",
        params: { watts: { expr: "min(surplus_W, 800)" } },
      },
    ],
    minHoldSeconds: 60,
  },
  null,
  2,
);

export default async function RulesPage() {
  const rules = await prisma.automationRule.findMany({
    orderBy: { priority: "asc" },
  });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Règles d'automatisation</h1>

      <form
        action={createRule}
        className="bg-zinc-900 ring-1 ring-zinc-800 rounded-2xl p-4 space-y-3"
      >
        <textarea
          name="definition"
          rows={14}
          defaultValue={sample}
          className="bg-zinc-950 ring-1 ring-zinc-800 rounded p-3 w-full font-mono text-xs"
        />
        <button className="bg-emerald-600 hover:bg-emerald-500 rounded px-4 py-2">
          Créer la règle
        </button>
      </form>

      <div className="space-y-2">
        {rules.map((r) => (
          <div
            key={r.id}
            className="bg-zinc-900 ring-1 ring-zinc-800 rounded-xl p-3"
          >
            <div className="flex items-center gap-3">
              <span
                className={
                  "w-2 h-2 rounded-full " +
                  (r.enabled ? "bg-emerald-500" : "bg-zinc-600")
                }
              />
              <span className="font-medium flex-1">
                {r.name}{" "}
                <span className="text-xs text-zinc-500">
                  (prio {r.priority}, hold {r.minHoldSeconds}s)
                </span>
              </span>
              <form action={toggleRule.bind(null, r.id)}>
                <button className="text-sm bg-zinc-800 hover:bg-zinc-700 px-3 py-1 rounded">
                  {r.enabled ? "Désactiver" : "Activer"}
                </button>
              </form>
              <form action={deleteRule.bind(null, r.id)}>
                <button className="text-sm bg-rose-900 hover:bg-rose-800 px-3 py-1 rounded">
                  Suppr
                </button>
              </form>
            </div>
            <pre className="mt-2 text-xs text-zinc-400 overflow-x-auto">
              {JSON.stringify(
                { if: r.conditionExpr, then: r.actions },
                null,
                2,
              )}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
