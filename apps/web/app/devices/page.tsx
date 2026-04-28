import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

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

export default async function DevicesPage() {
  const devices = await prisma.device.findMany({ orderBy: { createdAt: "asc" } });
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
            <option value="TUYA_METER">Tuya — compteur</option>
            <option value="TUYA_SWITCH">Tuya — prise on/off</option>
            <option value="SHELLY_METER">Shelly — compteur (LAN)</option>
            <option value="ECOFLOW_BATTERY">EcoFlow — batterie</option>
            <option value="APSYSTEMS_INVERTER">APSystems — micro-onduleur (Zigbee)</option>
          </select>
          <select name="role" className="input-base">
            <option value="PRODUCTION_METER">Production (solaire)</option>
            <option value="CONSUMPTION_METER">Consommation maison</option>
            <option value="GRID_METER">Réseau (bidirectionnel ±)</option>
            <option value="BATTERY_AC_SWITCH">Prise AC batterie</option>
            <option value="BATTERY">Batterie</option>
            <option value="SOLAR_INVERTER">Onduleur solaire (par panneau)</option>
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
        {devices.map((d) => (
          <div
            key={d.id}
            className="card flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4"
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <span
                className={
                  "w-2 h-2 rounded-full shrink-0 " +
                  (d.enabled ? "bg-emerald-500 shadow-[0_0_8px] shadow-emerald-500/50" : "bg-zinc-600")
                }
              />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{d.name}</div>
                <div className="text-xs text-zinc-500 font-mono truncate">
                  {d.type} · {d.role} · {d.externalId}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
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
        ))}
      </div>
    </div>
  );
}
