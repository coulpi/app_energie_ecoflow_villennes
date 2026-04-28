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
    <div className="space-y-5 sm:space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="page-h1">Règles d&rsquo;automatisation</h1>
        <p className="page-sub mt-1">
          DSL JSON : conditions (<code className="text-zinc-300">if</code>) → actions (<code className="text-zinc-300">then</code>).
        </p>
      </div>

      <form action={createRule} className="card space-y-3">
        <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">
          Nouvelle règle
        </div>
        <textarea
          name="definition"
          rows={14}
          defaultValue={sample}
          className="input-base w-full font-mono text-xs leading-relaxed bg-zinc-950"
        />
        <div className="flex justify-end">
          <button className="btn-primary">Créer la règle</button>
        </div>
      </form>

      <div className="space-y-2">
        {rules.length === 0 && (
          <p className="text-sm text-zinc-500">Aucune règle pour le moment.</p>
        )}
        {rules.map((r) => (
          <div key={r.id} className="card">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <span
                  className={
                    "w-2 h-2 rounded-full shrink-0 " +
                    (r.enabled ? "bg-emerald-500 shadow-[0_0_8px] shadow-emerald-500/50" : "bg-zinc-600")
                  }
                />
                <div className="min-w-0">
                  <div className="font-medium truncate">{r.name}</div>
                  <div className="text-xs text-zinc-500">
                    prio {r.priority} · hold {r.minHoldSeconds}s
                  </div>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <form action={toggleRule.bind(null, r.id)}>
                  <button className="btn-ghost text-xs">
                    {r.enabled ? "Désactiver" : "Activer"}
                  </button>
                </form>
                <form action={deleteRule.bind(null, r.id)}>
                  <button className="btn text-xs bg-rose-900/60 hover:bg-rose-800 text-rose-100 border border-rose-900">
                    Supprimer
                  </button>
                </form>
              </div>
            </div>
            <pre className="mt-3 text-xs text-zinc-400 overflow-x-auto bg-zinc-950/60 rounded-lg p-3 border border-white/[0.04]">
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
