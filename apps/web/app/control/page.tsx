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

function Field({
  label,
  name,
  defaultValue,
  type = "number",
  unit,
}: {
  label: string;
  name: string;
  defaultValue: string | number;
  type?: string;
  unit?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-xs text-zinc-400">{label}</span>
      <div className="flex items-center gap-2">
        <input
          name={name}
          type={type}
          defaultValue={defaultValue}
          className="input-base flex-1 min-w-0"
        />
        {unit && (
          <span className="text-xs text-zinc-500 w-6 text-right">{unit}</span>
        )}
      </div>
    </label>
  );
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
    <div className="space-y-5 sm:space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="page-h1">Pilotage</h1>
        <p className="page-sub mt-1">
          Mode <code className="text-emerald-400">FOLLOW_LOAD</code> : la batterie
          ajuste sa puissance d&rsquo;injection AC pour suivre la consommation
          maison (auto-conso, zéro export).
        </p>
      </div>

      <form action={saveControl} className="card space-y-5">
        <label className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4">
          <span className="text-sm text-zinc-300">Mode</span>
          <select
            name="mode"
            defaultValue={c.mode}
            className="input-base sm:w-72"
          >
            <option value="MANUAL">Manuel</option>
            <option value="RULES">Règles</option>
            <option value="FOLLOW_LOAD">Suivi de charge (auto-conso)</option>
            <option value="OFF">Désactivé</option>
          </select>
        </label>

        <fieldset className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-4">
          <legend className="text-[10px] uppercase tracking-[0.14em] text-zinc-500 px-2">
            Suivi de charge
          </legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Offset sous la conso" name="offsetW" defaultValue={c.followLoadOffsetW} unit="W" />
            <Field label="Puissance min" name="minW" defaultValue={c.followLoadMinW} unit="W" />
            <Field label="Puissance max" name="maxW" defaultValue={c.followLoadMaxW} unit="W" />
            <Field label="Charge max" name="chargeMaxW" defaultValue={(c as { chargeMaxW?: number }).chargeMaxW ?? 800} unit="W" />
            <Field label="Charge min — seuil prise" name="chargeMinW" defaultValue={(c as { chargeMinW?: number }).chargeMinW ?? 400} unit="W" />
            <Field label="Marge sur surplus" name="chargeOffsetW" defaultValue={(c as { chargeOffsetW?: number }).chargeOffsetW ?? 100} unit="W" />
          </div>
        </fieldset>

        <fieldset className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-4">
          <legend className="text-[10px] uppercase tracking-[0.14em] text-zinc-500 px-2">
            Bornes SoC
          </legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="SoC min décharge" name="minSoc" defaultValue={c.minDischargeSoc} unit="%" />
            <Field label="SoC max charge" name="maxSoc" defaultValue={c.maxChargeSoc} unit="%" />
          </div>
        </fieldset>

        <div className="flex justify-end">
          <button className="btn-primary">Enregistrer</button>
        </div>
      </form>
    </div>
  );
}
