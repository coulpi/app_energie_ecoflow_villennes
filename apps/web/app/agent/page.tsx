import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { ModelSelect, RunNowButton } from "./AgentControls";

export const dynamic = "force-dynamic";

async function loadSettings() {
  const rows = await prisma.systemConfig.findMany({
    where: {
      key: {
        in: ["agent.enabled", "agent.model", "agent.intervalMinutes"],
      },
    },
  });
  const map = new Map(rows.map((r) => [r.key, r.value as unknown]));
  return {
    enabled:
      typeof map.get("agent.enabled") === "boolean"
        ? (map.get("agent.enabled") as boolean)
        : true,
    model:
      typeof map.get("agent.model") === "string"
        ? (map.get("agent.model") as string)
        : "",
    intervalMinutes:
      typeof map.get("agent.intervalMinutes") === "number"
        ? (map.get("agent.intervalMinutes") as number)
        : 60,
  };
}

async function saveSettings(formData: FormData) {
  "use server";
  const enabled = formData.get("enabled") === "on";
  const model = String(formData.get("model") ?? "");
  const intervalMinutes = Math.max(5, Number(formData.get("intervalMinutes") ?? 60));

  await prisma.$transaction([
    prisma.systemConfig.upsert({
      where: { key: "agent.enabled" },
      create: { key: "agent.enabled", value: enabled },
      update: { value: enabled },
    }),
    prisma.systemConfig.upsert({
      where: { key: "agent.model" },
      create: { key: "agent.model", value: model },
      update: { value: model },
    }),
    prisma.systemConfig.upsert({
      where: { key: "agent.intervalMinutes" },
      create: { key: "agent.intervalMinutes", value: intervalMinutes },
      update: { value: intervalMinutes },
    }),
  ]);
  revalidatePath("/agent");
}

export default async function AgentPage() {
  const [settings, runs] = await Promise.all([
    loadSettings(),
    prisma.agentRun.findMany({
      orderBy: { ts: "desc" },
      take: 15,
      select: {
        id: true,
        ts: true,
        trigger: true,
        model: true,
        applied: true,
        error: true,
        durationMs: true,
        proposal: true,
      },
    }),
  ]);

  return (
    <div className="space-y-6 max-w-5xl">
      <header>
        <h1 className="text-2xl font-semibold">Agent IA</h1>
        <p className="text-xs text-zinc-400 mt-1">
          Optimise les paramètres en analysant : conso hebdo par jour/heure, météo
          (Open-Meteo), tarifs, état batterie. Les règles produites sont
          préfixées <code className="text-zinc-300">[agent]</code> et remplacées
          à chaque exécution.
        </p>
      </header>

      <form
        action={saveSettings}
        className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-zinc-950/60 border border-zinc-900 rounded-2xl p-4"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-400">Modèle Ollama</span>
          <ModelSelect defaultModel={settings.model} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-400">Intervalle (min)</span>
          <input
            name="intervalMinutes"
            type="number"
            min={5}
            defaultValue={settings.intervalMinutes}
            className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2"
          />
        </label>
        <label className="flex items-center gap-2 text-sm pt-6">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={settings.enabled}
            className="w-4 h-4"
          />
          Auto-run activé
        </label>
        <div className="sm:col-span-3 flex gap-2 justify-between items-center pt-2">
          <button className="bg-emerald-600 hover:bg-emerald-500 rounded px-4 py-2 text-sm">
            Enregistrer
          </button>
          <RunNowButton />
        </div>
      </form>

      <section className="space-y-2">
        <h2 className="text-sm uppercase text-zinc-400 tracking-wider">
          Dernières exécutions
        </h2>
        {runs.length === 0 && (
          <p className="text-sm text-zinc-500">
            Aucune exécution pour l'instant.
          </p>
        )}
        <div className="space-y-2">
          {runs.map((r) => (
            <details
              key={r.id.toString()}
              className="bg-zinc-950/60 border border-zinc-900 rounded-xl p-3 text-sm"
            >
              <summary className="flex items-center gap-3 cursor-pointer">
                <span
                  className={
                    "w-1.5 h-1.5 rounded-full " +
                    (r.error
                      ? "bg-rose-500"
                      : r.applied
                        ? "bg-emerald-500"
                        : "bg-zinc-500")
                  }
                />
                <span className="font-mono text-xs text-zinc-400">
                  {r.ts.toISOString().slice(0, 19).replace("T", " ")}
                </span>
                <span className="text-zinc-300">{r.trigger}</span>
                <span className="text-zinc-500 text-xs">{r.model ?? "—"}</span>
                <span className="text-zinc-500 text-xs ml-auto">
                  {r.durationMs ? `${(r.durationMs / 1000).toFixed(1)} s` : ""}
                </span>
                <span
                  className={
                    "text-xs px-2 py-0.5 rounded " +
                    (r.error
                      ? "bg-rose-900/40 text-rose-300"
                      : r.trigger === "demo"
                        ? "bg-violet-900/40 text-violet-300"
                        : r.applied
                          ? "bg-emerald-900/40 text-emerald-300"
                          : "bg-zinc-800 text-zinc-400")
                  }
                >
                  {r.error
                    ? "erreur"
                    : r.trigger === "demo"
                      ? "démo"
                      : r.applied
                        ? "appliqué"
                        : "n/a"}
                </span>
              </summary>
              <pre className="mt-3 text-xs text-zinc-400 overflow-x-auto">
                {r.error ?? JSON.stringify(r.proposal, null, 2) ?? "—"}
              </pre>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
