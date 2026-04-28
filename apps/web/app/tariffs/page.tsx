import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

function hhmmToMin(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
function minToHHMM(m: number): string {
  const h = Math.floor(m / 60).toString().padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${h}:${mm}`;
}

async function createWindow(formData: FormData) {
  "use server";
  const days = formData.getAll("days").map((v) => Number(v));
  await prisma.tariffWindow.create({
    data: {
      name: String(formData.get("name")),
      period: String(formData.get("period")) as never,
      startMinute: hhmmToMin(String(formData.get("start"))),
      endMinute: hhmmToMin(String(formData.get("end"))),
      daysOfWeek: days,
      pricePerKwh: formData.get("price")
        ? Number(formData.get("price"))
        : null,
    },
  });
  revalidatePath("/tariffs");
}

async function deleteWindow(id: string) {
  "use server";
  await prisma.tariffWindow.delete({ where: { id } });
  revalidatePath("/tariffs");
}

const DAYS = [
  [1, "Lun"],
  [2, "Mar"],
  [3, "Mer"],
  [4, "Jeu"],
  [5, "Ven"],
  [6, "Sam"],
  [7, "Dim"],
] as const;

export default async function TariffsPage() {
  const windows = await prisma.tariffWindow.findMany({
    orderBy: [{ period: "asc" }, { startMinute: "asc" }],
  });
  return (
    <div className="space-y-5 sm:space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="page-h1">Fenêtres tarifaires</h1>
        <p className="page-sub mt-1">
          Heures creuses / pleines pour planifier la recharge batterie au
          meilleur tarif.
        </p>
      </div>

      <form action={createWindow} className="card space-y-3">
        <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">
          Nouvelle fenêtre
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input
            name="name"
            required
            placeholder="Nom (ex: HC nuit)"
            className="input-base"
          />
          <select name="period" className="input-base">
            <option value="OFF_PEAK">Heures creuses</option>
            <option value="PEAK">Heures pleines</option>
            <option value="SHOULDER">Intermédiaire</option>
          </select>
          <input
            name="price"
            type="number"
            step="0.0001"
            placeholder="€/kWh (optionnel)"
            className="input-base"
          />
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <span className="text-xs text-zinc-500 w-12">Début</span>
            <input
              name="start"
              type="time"
              required
              defaultValue="22:30"
              className="input-base flex-1"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <span className="text-xs text-zinc-500 w-12">Fin</span>
            <input
              name="end"
              type="time"
              required
              defaultValue="06:30"
              className="input-base flex-1"
            />
          </label>
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap text-xs sm:col-span-3">
            <span className="text-zinc-500 mr-1">Jours :</span>
            {DAYS.map(([n, label]) => (
              <label
                key={n}
                className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-900 border border-zinc-800 cursor-pointer hover:bg-zinc-800"
              >
                <input
                  type="checkbox"
                  name="days"
                  value={n}
                  defaultChecked
                  className="accent-emerald-500"
                />
                {label}
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end">
          <button className="btn-primary">Ajouter la fenêtre</button>
        </div>
      </form>

      <div className="space-y-2">
        {windows.length === 0 && (
          <p className="text-sm text-zinc-500">Aucune fenêtre tarifaire.</p>
        )}
        {windows.map((w) => (
          <div
            key={w.id}
            className="card flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3"
          >
            <span
              className={
                "chip self-start " +
                (w.period === "OFF_PEAK"
                  ? "bg-emerald-900/40 text-emerald-200 border-emerald-800"
                  : w.period === "PEAK"
                    ? "bg-rose-900/40 text-rose-200 border-rose-800"
                    : "bg-amber-900/40 text-amber-200 border-amber-800")
              }
            >
              {w.period}
            </span>
            <span className="font-medium truncate">{w.name}</span>
            <span className="text-zinc-400 font-mono text-sm">
              {minToHHMM(w.startMinute)} → {minToHHMM(w.endMinute)}
            </span>
            <span className="text-xs text-zinc-500 truncate">
              {w.daysOfWeek.length === 0 || w.daysOfWeek.length === 7
                ? "tous les jours"
                : w.daysOfWeek
                    .map((d) => DAYS.find(([n]) => n === d)?.[1])
                    .join(" ")}
            </span>
            {w.pricePerKwh !== null && (
              <span className="text-xs text-zinc-500">
                {w.pricePerKwh.toFixed(4)} €/kWh
              </span>
            )}
            <form action={deleteWindow.bind(null, w.id)} className="sm:ml-auto">
              <button className="btn text-xs bg-rose-900/60 hover:bg-rose-800 text-rose-100 border border-rose-900">
                Supprimer
              </button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
