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
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Fenêtres tarifaires</h1>
      <p className="text-sm text-zinc-400">
        Définissez vos heures creuses / pleines pour permettre aux règles de
        recharger la batterie au tarif le plus avantageux.
      </p>

      <form
        action={createWindow}
        className="bg-zinc-900 ring-1 ring-zinc-800 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3"
      >
        <input
          name="name"
          required
          placeholder="Nom (ex: HC nuit)"
          className="bg-zinc-800 rounded px-3 py-2"
        />
        <select name="period" className="bg-zinc-800 rounded px-3 py-2">
          <option value="OFF_PEAK">Heures creuses</option>
          <option value="PEAK">Heures pleines</option>
          <option value="SHOULDER">Intermédiaire</option>
        </select>
        <input
          name="price"
          type="number"
          step="0.0001"
          placeholder="€/kWh (optionnel)"
          className="bg-zinc-800 rounded px-3 py-2"
        />
        <label className="flex items-center gap-2">
          Début
          <input
            name="start"
            type="time"
            required
            defaultValue="22:30"
            className="bg-zinc-800 rounded px-3 py-2"
          />
        </label>
        <label className="flex items-center gap-2">
          Fin
          <input
            name="end"
            type="time"
            required
            defaultValue="06:30"
            className="bg-zinc-800 rounded px-3 py-2"
          />
        </label>
        <div className="flex items-center gap-2 flex-wrap text-sm">
          {DAYS.map(([n, label]) => (
            <label key={n} className="flex items-center gap-1">
              <input
                type="checkbox"
                name="days"
                value={n}
                defaultChecked
              />
              {label}
            </label>
          ))}
        </div>
        <button className="bg-emerald-600 hover:bg-emerald-500 rounded px-3 py-2 sm:col-span-3">
          Ajouter la fenêtre
        </button>
      </form>

      <div className="space-y-2">
        {windows.map((w) => (
          <div
            key={w.id}
            className="bg-zinc-900 ring-1 ring-zinc-800 rounded-xl p-3 flex items-center gap-3"
          >
            <span
              className={
                "px-2 py-0.5 rounded text-xs " +
                (w.period === "OFF_PEAK"
                  ? "bg-emerald-900 text-emerald-200"
                  : w.period === "PEAK"
                    ? "bg-rose-900 text-rose-200"
                    : "bg-amber-900 text-amber-200")
              }
            >
              {w.period}
            </span>
            <span className="font-medium">{w.name}</span>
            <span className="text-zinc-400 font-mono text-sm">
              {minToHHMM(w.startMinute)} → {minToHHMM(w.endMinute)}
            </span>
            <span className="text-xs text-zinc-500">
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
            <form action={deleteWindow.bind(null, w.id)} className="ml-auto">
              <button className="text-sm bg-rose-900 hover:bg-rose-800 px-3 py-1 rounded">
                Suppr
              </button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
