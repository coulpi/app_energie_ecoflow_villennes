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
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Équipements</h1>

      <form
        action={createDevice}
        className="bg-zinc-900 ring-1 ring-zinc-800 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3"
      >
        <input
          name="name"
          required
          placeholder="Nom (ex: Compteur prod)"
          className="bg-zinc-800 rounded px-3 py-2"
        />
        <select name="type" className="bg-zinc-800 rounded px-3 py-2">
          <option value="TUYA_METER">Tuya — compteur</option>
          <option value="TUYA_SWITCH">Tuya — prise on/off</option>
          <option value="ECOFLOW_BATTERY">EcoFlow — batterie</option>
        </select>
        <select name="role" className="bg-zinc-800 rounded px-3 py-2">
          <option value="PRODUCTION_METER">Production</option>
          <option value="CONSUMPTION_METER">Consommation</option>
          <option value="BATTERY_AC_SWITCH">Prise AC batterie</option>
          <option value="BATTERY">Batterie</option>
        </select>
        <input
          name="externalId"
          required
          placeholder="ID cloud (Tuya devId / EcoFlow SN)"
          className="bg-zinc-800 rounded px-3 py-2 sm:col-span-2"
        />
        <input
          name="model"
          placeholder="Modèle EcoFlow (DELTA_2, DELTA_PRO…)"
          className="bg-zinc-800 rounded px-3 py-2"
        />
        <input
          name="switchCode"
          placeholder="Code switch Tuya (default: switch_1)"
          className="bg-zinc-800 rounded px-3 py-2 sm:col-span-2"
        />
        <button className="bg-emerald-600 hover:bg-emerald-500 rounded px-3 py-2">
          Ajouter
        </button>
      </form>

      <div className="space-y-2">
        {devices.length === 0 && (
          <p className="text-sm text-zinc-500">Aucun équipement enregistré.</p>
        )}
        {devices.map((d) => (
          <div
            key={d.id}
            className="bg-zinc-900 ring-1 ring-zinc-800 rounded-xl p-3 flex items-center gap-4"
          >
            <span
              className={
                "w-2 h-2 rounded-full " +
                (d.enabled ? "bg-emerald-500" : "bg-zinc-600")
              }
            />
            <div className="flex-1">
              <div className="font-medium">{d.name}</div>
              <div className="text-xs text-zinc-500 font-mono">
                {d.type} · {d.role} · {d.externalId}
              </div>
            </div>
            <form action={toggleDevice.bind(null, d.id)}>
              <button className="text-sm bg-zinc-800 hover:bg-zinc-700 px-3 py-1 rounded">
                {d.enabled ? "Désactiver" : "Activer"}
              </button>
            </form>
            <form action={deleteDevice.bind(null, d.id)}>
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
