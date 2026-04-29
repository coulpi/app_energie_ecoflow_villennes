import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import TestDeviceButton from "./TestDeviceButton";

export const dynamic = "force-dynamic";

const ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "PRODUCTION_METER", label: "Production (solaire)" },
  { value: "CONSUMPTION_METER", label: "Consommation maison" },
  { value: "GRID_METER", label: "Réseau (bidirectionnel ±)" },
  { value: "BATTERY_AC_SWITCH", label: "Prise AC batterie" },
  { value: "BATTERY", label: "Batterie" },
  { value: "SOLAR_INVERTER", label: "Onduleur solaire (par panneau)" },
  { value: "APPLIANCE", label: "Appareil mesuré (jacuzzi, voiture…)" },
];

const TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "TUYA_METER", label: "Tuya — compteur" },
  { value: "TUYA_SWITCH", label: "Tuya — prise on/off" },
  { value: "SHELLY_METER", label: "Shelly — compteur (LAN)" },
  { value: "ECOFLOW_BATTERY", label: "EcoFlow — batterie" },
  { value: "APSYSTEMS_INVERTER", label: "APSystems — micro-onduleur (Zigbee)" },
];

async function createDevice(formData: FormData) {
  "use server";
  await prisma.device.create({
    data: {
      type: String(formData.get("type")) as never,
      role: String(formData.get("role")) as never,
      externalId: String(formData.get("externalId")),
      name: String(formData.get("name")),
      vendorMeta: formData.get("model")
        ? { model: String(formData.get("model")) }
        : undefined,
      capabilities: formData.get("switchCode")
        ? { switchCode: String(formData.get("switchCode")) }
        : undefined,
    },
  });
  revalidatePath("/devices");
}

async function toggleDevice(id: string) {
  "use server";
  const d = await prisma.device.findUnique({ where: { id } });
  if (!d) return;
  await prisma.device.update({
    where: { id },
    data: { enabled: !d.enabled },
  });
  revalidatePath("/devices");
}

async function deleteDevice(id: string) {
  "use server";
  await prisma.device.delete({ where: { id } });
  revalidatePath("/devices");
}

async function updateDevice(id: string, formData: FormData) {
  "use server";
  const switchCode = String(formData.get("switchCode") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  await prisma.device.update({
    where: { id },
    data: {
      name: String(formData.get("name") ?? "").trim() || undefined,
      type: (String(formData.get("type") ?? "") || undefined) as never,
      role: (String(formData.get("role") ?? "") || undefined) as never,
      externalId: String(formData.get("externalId") ?? "").trim() || undefined,
      vendorMeta: model ? { model } : null,
      capabilities: switchCode ? { switchCode } : null,
    },
  });
  revalidatePath("/devices");
}

export default async function DevicesPage() {
  const devices = await prisma.device.findMany({ orderBy: { createdAt: "asc" } });
  // Dernier reading de chaque device pour aperçu rapide.
  const lastReadings = new Map<
    string,
    { ts: Date; powerW: number | null; switchOn: boolean | null }
  >();
  if (devices.length > 0) {
    const since = new Date(Date.now() - 5 * 60_000);
    const readings = await prisma.reading.findMany({
      where: {
        deviceId: { in: devices.map((d) => d.id) },
        ts: { gte: since },
      },
      orderBy: { ts: "desc" },
      select: { deviceId: true, ts: true, powerW: true, switchOn: true },
    });
    for (const r of readings) {
      if (!lastReadings.has(r.deviceId)) {
        lastReadings.set(r.deviceId, {
          ts: r.ts,
          powerW: r.powerW,
          switchOn: r.switchOn,
        });
      }
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="page-h1">Équipements</h1>
        <p className="page-sub mt-1">
          Compteurs, prises et batteries reliés au système de pilotage.
        </p>
      </div>

      <form action={createDevice} className="card">
        <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500 mb-3">
          Ajouter un équipement
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input
            name="name"
            required
            placeholder="Nom (ex: Compteur prod)"
            className="input-base"
          />
          <select name="type" className="input-base">
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select name="role" className="input-base">
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <input
            name="externalId"
            required
            placeholder="Tuya devId / EcoFlow SN / Shelly URL"
            className="input-base sm:col-span-2"
          />
          <input
            name="model"
            placeholder="Modèle EcoFlow (DELTA_2, DELTA_PRO…)"
            className="input-base"
          />
          <input
            name="switchCode"
            placeholder="Code switch Tuya (default: switch_1)"
            className="input-base sm:col-span-2"
          />
          <button className="btn-primary">Ajouter</button>
        </div>
      </form>

      <div className="space-y-2">
        {devices.length === 0 && (
          <p className="text-sm text-zinc-500">Aucun équipement enregistré.</p>
        )}
        {devices.map((d) => {
          const last = lastReadings.get(d.id);
          const meta = (d.vendorMeta as { model?: string } | null) ?? null;
          const caps = (d.capabilities as { switchCode?: string } | null) ?? null;
          return (
            <div key={d.id} className="card space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span
                    className={
                      "w-2 h-2 rounded-full shrink-0 " +
                      (d.enabled
                        ? "bg-emerald-500 shadow-[0_0_8px] shadow-emerald-500/50"
                        : "bg-zinc-600")
                    }
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{d.name}</div>
                    <div className="text-xs text-zinc-500 font-mono truncate">
                      {d.type} · {d.role} · {d.externalId}
                    </div>
                    {last && (
                      <div className="text-[11px] text-zinc-500 mt-0.5">
                        Dernière mesure : {new Date(last.ts).toLocaleString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        {last.powerW !== null && ` · ${Math.round(last.powerW)} W`}
                        {last.switchOn !== null && ` · ${last.switchOn ? "ON" : "OFF"}`}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <TestDeviceButton deviceId={d.id} />
                  <form action={toggleDevice.bind(null, d.id)}>
                    <button className="btn-ghost text-xs">
                      {d.enabled ? "Désactiver" : "Activer"}
                    </button>
                  </form>
                  <form action={deleteDevice.bind(null, d.id)}>
                    <button className="btn text-xs bg-rose-900/60 hover:bg-rose-800 text-rose-100 border border-rose-900">
                      Supprimer
                    </button>
                  </form>
                </div>
              </div>

              <details className="text-xs">
                <summary className="text-zinc-400 hover:text-zinc-200 cursor-pointer select-none">
                  Éditer
                </summary>
                <form
                  action={updateDevice.bind(null, d.id)}
                  className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2 p-3 bg-zinc-900/40 border border-zinc-800 rounded"
                >
                  <input
                    name="name"
                    defaultValue={d.name}
                    placeholder="Nom"
                    className="input-base"
                  />
                  <select name="type" defaultValue={d.type} className="input-base">
                    {TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <select name="role" defaultValue={d.role} className="input-base">
                    {ROLE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <input
                    name="externalId"
                    defaultValue={d.externalId}
                    placeholder="ID externe"
                    className="input-base sm:col-span-2"
                  />
                  <input
                    name="model"
                    defaultValue={meta?.model ?? ""}
                    placeholder="Modèle"
                    className="input-base"
                  />
                  <input
                    name="switchCode"
                    defaultValue={caps?.switchCode ?? ""}
                    placeholder="Code switch Tuya"
                    className="input-base sm:col-span-2"
                  />
                  <button className="btn-primary text-xs">Enregistrer</button>
                </form>
              </details>
            </div>
          );
        })}
      </div>
    </div>
  );
}
