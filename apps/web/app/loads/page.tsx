import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import DetectButton from "./DetectButton";
import { LiveSummary } from "./LiveStatus";

export const dynamic = "force-dynamic";

const DOW_LABELS = ["", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

async function createProfile(formData: FormData) {
  "use server";
  await prisma.loadProfile.create({
    data: {
      name: String(formData.get("name") ?? "").trim(),
      expectedPowerW: Math.max(50, Number(formData.get("expectedPowerW") ?? 1000)),
      toleranceW: Math.max(20, Number(formData.get("toleranceW") ?? 150)),
      minDurationMin: Math.max(5, Number(formData.get("minDurationMin") ?? 15)),
      activeStartHour: parseHourField(formData.get("activeStartHour")),
      activeEndHour: parseHourField(formData.get("activeEndHour")),
      notes: String(formData.get("notes") ?? "").trim() || null,
    },
  });
  revalidatePath("/loads");
}

function parseHourField(v: FormDataEntryValue | null): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(23, Math.round(n)));
}

async function toggleProfile(id: string) {
  "use server";
  const p = await prisma.loadProfile.findUnique({ where: { id } });
  if (!p) return;
  await prisma.loadProfile.update({
    where: { id },
    data: { enabled: !p.enabled },
  });
  revalidatePath("/loads");
}

async function deleteProfile(id: string) {
  "use server";
  await prisma.loadProfile.delete({ where: { id } });
  revalidatePath("/loads");
}

async function updateProfile(id: string, formData: FormData) {
  "use server";
  const measuredDeviceId = String(formData.get("measuredDeviceId") ?? "").trim();
  await prisma.loadProfile.update({
    where: { id },
    data: {
      name: String(formData.get("name") ?? "").trim() || undefined,
      expectedPowerW: Math.max(50, Number(formData.get("expectedPowerW") ?? 1000)),
      toleranceW: Math.max(20, Number(formData.get("toleranceW") ?? 150)),
      minDurationMin: Math.max(5, Number(formData.get("minDurationMin") ?? 15)),
      activeStartHour: parseHourField(formData.get("activeStartHour")),
      activeEndHour: parseHourField(formData.get("activeEndHour")),
      measuredDeviceId: measuredDeviceId || null,
      measuredOnThresholdW:
        formData.get("measuredOnThresholdW") === null ||
        formData.get("measuredOnThresholdW") === ""
          ? null
          : Math.max(0, Number(formData.get("measuredOnThresholdW") ?? 30)),
      notes: String(formData.get("notes") ?? "").trim() || null,
    },
  });
  revalidatePath("/loads");
}

export default async function LoadsPage() {
  const [profiles, recentEvents, plugDevices] = await Promise.all([
    prisma.loadProfile.findMany({
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { events: true } } },
    }),
    prisma.loadEvent.findMany({
      orderBy: { startTs: "desc" },
      take: 20,
      include: { profile: true },
    }),
    // Prises Tuya/Shelly disponibles pour lier à un LoadProfile.
    prisma.device.findMany({
      where: {
        enabled: true,
        type: { in: ["TUYA_SWITCH", "TUYA_METER", "SHELLY_METER"] as never },
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, type: true, role: true },
    }),
  ]);

  return (
    <div className="space-y-5 sm:space-y-6 max-w-5xl mx-auto">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="page-h1">Charges récurrentes</h1>
          <p className="page-sub mt-1">
            Configurez les appareils qui consomment par périodes (piscine, PAC,
            voiture, jacuzzi…). Le système détecte automatiquement leurs
            cycles depuis le compteur conso et infère le planning.
          </p>
        </div>
        <DetectButton />
      </header>

      <LiveSummary />

      <form
        action={createProfile}
        className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-zinc-950/60 border border-zinc-900 rounded-2xl p-4"
      >
        <input
          name="name"
          required
          placeholder="Nom (Piscine, PAC, Voiture…)"
          className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 sm:col-span-2"
        />
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Puissance moyenne (W)
          <input
            name="expectedPowerW"
            type="number"
            min={50}
            defaultValue={1500}
            required
            className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Tolérance (±W)
          <input
            name="toleranceW"
            type="number"
            min={20}
            defaultValue={150}
            className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Durée min. (min)
          <input
            name="minDurationMin"
            type="number"
            min={5}
            defaultValue={15}
            className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm"
          />
        </label>
        <input
          name="notes"
          placeholder="Notes (optionnel)"
          className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 sm:col-span-3"
        />
        <button className="bg-emerald-600 hover:bg-emerald-500 rounded px-4 py-2 text-sm">
          Ajouter
        </button>
      </form>

      <section className="space-y-3">
        <h2 className="text-sm uppercase text-zinc-400 tracking-wider">
          Profils ({profiles.length})
        </h2>
        {profiles.length === 0 && (
          <p className="text-sm text-zinc-500">
            Aucun profil. Créez-en un avec sa puissance moyenne pour démarrer
            la détection.
          </p>
        )}
        {profiles.map((p) => {
          const sched = p.detectedSchedule as
            | {
                slots?: Array<{
                  dow: number;
                  startHour: number;
                  avgDurationMin: number;
                  avgPowerW: number;
                  occurrences: number;
                }>;
                totalEvents?: number;
              }
            | null;
          return (
            <div
              key={p.id}
              className="bg-zinc-950/60 border border-zinc-900 rounded-xl p-4 space-y-2"
            >
              <div className="flex items-center gap-3">
                <span
                  className={
                    "w-1.5 h-1.5 rounded-full " +
                    (p.enabled ? "bg-emerald-500" : "bg-zinc-600")
                  }
                />
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-zinc-500">
                  {p.expectedPowerW} W ± {p.toleranceW} W · ≥ {p.minDurationMin}{" "}
                  min · {p._count.events} cycles
                </span>
                <form
                  action={toggleProfile.bind(null, p.id)}
                  className="ml-auto"
                >
                  <button className="text-xs bg-zinc-800 hover:bg-zinc-700 px-3 py-1 rounded">
                    {p.enabled ? "Désactiver" : "Activer"}
                  </button>
                </form>
                <form action={deleteProfile.bind(null, p.id)}>
                  <button className="text-xs bg-rose-900 hover:bg-rose-800 px-3 py-1 rounded">
                    Suppr
                  </button>
                </form>
              </div>
              {p.notes && <p className="text-xs text-zinc-500">{p.notes}</p>}
              <details className="text-xs">
                <summary className="text-zinc-400 hover:text-zinc-200 cursor-pointer select-none">
                  Éditer
                </summary>
                <form
                  action={updateProfile.bind(null, p.id)}
                  className="grid grid-cols-1 sm:grid-cols-5 gap-2 mt-2 p-2 bg-zinc-900/40 border border-zinc-800 rounded"
                >
                  <input
                    name="name"
                    defaultValue={p.name}
                    placeholder="Nom"
                    className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 sm:col-span-2"
                  />
                  <label className="flex flex-col gap-0.5 text-[10px] uppercase text-zinc-500">
                    Puiss. moy. (W)
                    <input
                      name="expectedPowerW"
                      type="number"
                      min={50}
                      defaultValue={p.expectedPowerW}
                      className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-zinc-200 normal-case"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5 text-[10px] uppercase text-zinc-500">
                    Tolérance ±W
                    <input
                      name="toleranceW"
                      type="number"
                      min={20}
                      defaultValue={p.toleranceW}
                      className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-zinc-200 normal-case"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5 text-[10px] uppercase text-zinc-500">
                    Durée min (min)
                    <input
                      name="minDurationMin"
                      type="number"
                      min={5}
                      defaultValue={p.minDurationMin}
                      className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-zinc-200 normal-case"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5 text-[10px] uppercase text-zinc-500 sm:col-span-2">
                    Prise mesurée (optionnel)
                    <select
                      name="measuredDeviceId"
                      defaultValue={
                        (p as { measuredDeviceId?: string | null })
                          .measuredDeviceId ?? ""
                      }
                      className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-zinc-200 normal-case"
                    >
                      <option value="">— Aucune (heuristique) —</option>
                      {plugDevices.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.type})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-0.5 text-[10px] uppercase text-zinc-500">
                    Seuil ON (W)
                    <input
                      name="measuredOnThresholdW"
                      type="number"
                      min={0}
                      placeholder="30"
                      defaultValue={
                        (p as { measuredOnThresholdW?: number | null })
                          .measuredOnThresholdW ?? ""
                      }
                      className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-zinc-200 normal-case"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5 text-[10px] uppercase text-zinc-500">
                    Heure début
                    <input
                      name="activeStartHour"
                      type="number"
                      min={0}
                      max={23}
                      placeholder="—"
                      defaultValue={
                        (p as { activeStartHour?: number | null })
                          .activeStartHour ?? ""
                      }
                      className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-zinc-200 normal-case"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5 text-[10px] uppercase text-zinc-500">
                    Heure fin
                    <input
                      name="activeEndHour"
                      type="number"
                      min={0}
                      max={23}
                      placeholder="—"
                      defaultValue={
                        (p as { activeEndHour?: number | null })
                          .activeEndHour ?? ""
                      }
                      className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-zinc-200 normal-case"
                    />
                  </label>
                  <input
                    name="notes"
                    defaultValue={p.notes ?? ""}
                    placeholder="Notes"
                    className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 sm:col-span-4"
                  />
                  <button className="bg-emerald-600 hover:bg-emerald-500 rounded px-3 py-1.5 text-xs">
                    Enregistrer
                  </button>
                </form>
              </details>
              {sched?.slots && sched.slots.length > 0 ? (
                <div className="text-xs text-zinc-400">
                  <span className="text-zinc-500 mr-2">Planning détecté :</span>
                  <span className="inline-flex flex-wrap gap-1">
                    {sched.slots
                      .sort(
                        (a, b) =>
                          a.dow - b.dow || a.startHour - b.startHour,
                      )
                      .map((s, i) => (
                        <span
                          key={i}
                          className="bg-emerald-900/30 text-emerald-300 rounded px-2 py-0.5"
                        >
                          {DOW_LABELS[s.dow]}{" "}
                          {String(s.startHour).padStart(2, "0")}h ·{" "}
                          {s.avgDurationMin} min · {s.avgPowerW} W
                          <span className="opacity-50 ml-1">
                            ({s.occurrences}×)
                          </span>
                        </span>
                      ))}
                  </span>
                </div>
              ) : (
                <p className="text-xs text-zinc-500">
                  Aucun cycle détecté pour l'instant. Le système analyse les
                  données toutes les 30 min.
                </p>
              )}
            </div>
          );
        })}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm uppercase text-zinc-400 tracking-wider">
          Cycles récents ({recentEvents.length})
        </h2>
        {recentEvents.length === 0 ? (
          <p className="text-sm text-zinc-500">Aucun cycle détecté.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead className="text-zinc-500">
                <tr>
                  <th className="text-left p-1.5">Profil</th>
                  <th className="text-left p-1.5">Début</th>
                  <th className="text-left p-1.5">Fin</th>
                  <th className="text-right p-1.5">Durée</th>
                  <th className="text-right p-1.5">Puissance moy.</th>
                  <th className="text-right p-1.5">Énergie</th>
                </tr>
              </thead>
              <tbody>
                {recentEvents.map((e) => (
                  <tr key={e.id.toString()} className="border-t border-zinc-900">
                    <td className="p-1.5">{e.profile?.name ?? "—"}</td>
                    <td className="p-1.5 font-mono">
                      {e.startTs.toLocaleString("fr-FR", {
                        timeZone: "Europe/Paris",
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="p-1.5 font-mono">
                      {e.endTs.toLocaleString("fr-FR", {
                        timeZone: "Europe/Paris",
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="p-1.5 text-right tabular-nums">
                      {e.durationMin} min
                    </td>
                    <td className="p-1.5 text-right tabular-nums">
                      {Math.round(e.avgPowerW)} W
                    </td>
                    <td className="p-1.5 text-right tabular-nums">
                      {e.energyWh ? Math.round(e.energyWh) : "—"} Wh
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
