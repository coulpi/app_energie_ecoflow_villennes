import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

async function saveControl(formData: FormData) {
  "use server";
  const data = {
    mode: String(formData.get("mode")) as never,
    followLoadOffsetW: Number(formData.get("offsetW") ?? 50),
    followLoadMinW: Number(formData.get("minW") ?? 0),
    followLoadMaxW: Number(formData.get("maxW") ?? 800),
    chargeMaxW: Number(formData.get("chargeMaxW") ?? 800),
    chargeMinW: Number(formData.get("chargeMinW") ?? 400),
    chargeOffsetW: Number(formData.get("chargeOffsetW") ?? 100),
    minDischargeSoc: Number(formData.get("minSoc") ?? 20),
    maxChargeSoc: Number(formData.get("maxSoc") ?? 95),
  };
  await prisma.controlState.upsert({
    where: { key: "default" },
    create: { key: "default", ...data },
    update: data,
  });
  revalidatePath("/control");
  revalidatePath("/");
}

export default async function ControlPage() {
  const c = (await prisma.controlState.findUnique({
    where: { key: "default" },
  })) ?? {
    mode: "RULES" as const,
    followLoadOffsetW: 50,
    followLoadMinW: 0,
    followLoadMaxW: 800,
    chargeMaxW: 800,
    chargeMinW: 400,
    chargeOffsetW: 100,
    minDischargeSoc: 20,
    maxChargeSoc: 95,
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-semibold">Pilotage</h1>
      <p className="text-sm text-zinc-400">
        Mode <code>FOLLOW_LOAD</code> : la batterie ajuste sa puissance
        d'injection AC pour suivre la consommation maison (auto-conso, zéro
        export).
      </p>

      <form
        action={saveControl}
        className="bg-zinc-900 ring-1 ring-zinc-800 rounded-2xl p-4 space-y-4"
      >
        <label className="flex items-center justify-between gap-4">
          <span>Mode</span>
          <select
            name="mode"
            defaultValue={c.mode}
            className="bg-zinc-800 rounded px-3 py-2"
          >
            <option value="MANUAL">Manuel</option>
            <option value="RULES">Règles</option>
            <option value="FOLLOW_LOAD">Suivi de charge (auto-conso)</option>
            <option value="OFF">Désactivé</option>
          </select>
        </label>

        <fieldset className="border border-zinc-800 rounded p-3 space-y-3">
          <legend className="text-xs uppercase text-zinc-500 px-2">
            Suivi de charge
          </legend>
          <label className="flex items-center justify-between gap-4">
            <span>Offset sous la conso (W)</span>
            <input
              name="offsetW"
              type="number"
              defaultValue={c.followLoadOffsetW}
              className="bg-zinc-800 rounded px-3 py-2 w-32"
            />
          </label>
          <label className="flex items-center justify-between gap-4">
            <span>Puissance min (W)</span>
            <input
              name="minW"
              type="number"
              defaultValue={c.followLoadMinW}
              className="bg-zinc-800 rounded px-3 py-2 w-32"
            />
          </label>
          <label className="flex items-center justify-between gap-4">
            <span>Puissance max (W)</span>
            <input
              name="maxW"
              type="number"
              defaultValue={c.followLoadMaxW}
              className="bg-zinc-800 rounded px-3 py-2 w-32"
            />
          </label>
          <label className="flex items-center justify-between gap-4">
            <span>Charge max (W)</span>
            <input
              name="chargeMaxW"
              type="number"
              defaultValue={(c as { chargeMaxW?: number }).chargeMaxW ?? 800}
              className="bg-zinc-800 rounded px-3 py-2 w-32"
            />
          </label>
          <label className="flex items-center justify-between gap-4">
            <span>Charge min — seuil prise (W)</span>
            <input
              name="chargeMinW"
              type="number"
              defaultValue={(c as { chargeMinW?: number }).chargeMinW ?? 400}
              className="bg-zinc-800 rounded px-3 py-2 w-32"
            />
          </label>
          <label className="flex items-center justify-between gap-4">
            <span>Marge sur surplus (W)</span>
            <input
              name="chargeOffsetW"
              type="number"
              defaultValue={(c as { chargeOffsetW?: number }).chargeOffsetW ?? 100}
              className="bg-zinc-800 rounded px-3 py-2 w-32"
            />
          </label>
        </fieldset>

        <fieldset className="border border-zinc-800 rounded p-3 space-y-3">
          <legend className="text-xs uppercase text-zinc-500 px-2">
            Bornes SoC
          </legend>
          <label className="flex items-center justify-between gap-4">
            <span>SoC min décharge (%)</span>
            <input
              name="minSoc"
              type="number"
              defaultValue={c.minDischargeSoc}
              className="bg-zinc-800 rounded px-3 py-2 w-32"
            />
          </label>
          <label className="flex items-center justify-between gap-4">
            <span>SoC max charge (%)</span>
            <input
              name="maxSoc"
              type="number"
              defaultValue={c.maxChargeSoc}
              className="bg-zinc-800 rounded px-3 py-2 w-32"
            />
          </label>
        </fieldset>

        <button className="bg-emerald-600 hover:bg-emerald-500 rounded px-4 py-2">
          Enregistrer
        </button>
      </form>
    </div>
  );
}
