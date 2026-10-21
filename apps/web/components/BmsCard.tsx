"use client";

// Carte « État de la batterie » : santé, cycles, capacité, cellules,
// températures et défauts, lus dans le BMS de la Delta Max (rafraîchi
// toutes les 30 s, rythme des messages du BMS).

import { useEffect, useState } from "react";
import type { BmsSummary, Level } from "@/lib/bms";
import { Icon, Section } from "./ui";

const LEVEL: Record<Level, { text: string; chip: string; label: string }> = {
  ok: { text: "text-emerald-400", chip: "border-emerald-500/40 bg-emerald-500/[0.07] text-emerald-400", label: "Normal" },
  warn: { text: "text-amber-400", chip: "border-amber-500/40 bg-amber-500/[0.07] text-amber-400", label: "À surveiller" },
  bad: { text: "text-rose-400", chip: "border-rose-500/40 bg-rose-500/[0.07] text-rose-400", label: "Élevé" },
};

const num = (v: number | null, digits = 0) =>
  v === null ? "—" : v.toLocaleString("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: digits });

function Metric({
  label,
  value,
  unit,
  sub,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 p-3 min-w-0">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`mt-0.5 text-xl font-semibold tabular-nums ${tone ?? "text-zinc-100"}`}>
        {value}
        {unit && <span className="text-sm font-normal text-zinc-400"> {unit}</span>}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-zinc-500">{sub}</div>}
    </div>
  );
}

export default function BmsCard() {
  const [b, setB] = useState<BmsSummary | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch("/api/battery/bms", { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        setB(await r.json());
        setErr(false);
      } catch {
        setErr(true);
      }
    };
    void load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  const ageMin = b?.updatedAt ? Math.round((Date.now() - new Date(b.updatedAt).getTime()) / 60_000) : null;
  const stale = ageMin !== null && ageMin > 15;

  const status =
    !b || !b.updatedAt
      ? null
      : b.faults.length > 0
        ? { cls: LEVEL.bad.chip, text: `${b.faults.length} défaut(s)` }
        : { cls: LEVEL.ok.chip, text: "Aucun défaut" };

  return (
    <Section
      title="État de la batterie (BMS)"
      sub={
        err
          ? "Worker injoignable"
          : !b?.updatedAt
            ? "En attente d'un message du BMS…"
            : `Mesures du BMS · ${ageMin === 0 ? "à l'instant" : `il y a ${ageMin} min`}${stale ? " (périmées)" : ""}`
      }
      action={
        status && (
          <span className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-xs font-medium ${status.cls}`}>
            <span className="w-3.5 h-3.5">{b && b.faults.length ? Icon.alert : Icon.check}</span>
            {status.text}
          </span>
        )
      }
    >
      {b?.updatedAt && (
        <div className={stale ? "opacity-60" : ""}>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Metric
              label="Santé (SoH)"
              value={num(b.sohPct)}
              unit="%"
              tone={b.sohPct === null ? undefined : b.sohPct >= 80 ? "text-emerald-400" : b.sohPct >= 70 ? "text-amber-400" : "text-rose-400"}
              sub={
                b.fullCapAh !== null && b.designCapAh !== null
                  ? `${num(b.fullCapAh, 1)} Ah réels / ${num(b.designCapAh, 0)} Ah d'origine`
                  : undefined
              }
            />
            <Metric label="Cycles" value={num(b.cycles)} sub="cycles de charge complets" />
            <Metric
              label="Énergie restante"
              value={b.remainWh === null ? "—" : num(b.remainWh / 1000, 2)}
              unit="kWh"
              sub={b.fullWh !== null ? `sur ${num(b.fullWh / 1000, 2)} kWh utilisables · SoC ${num(b.socPct, 1)} %` : undefined}
            />
            <Metric
              label="Tension · courant"
              value={num(b.packV, 1)}
              unit="V"
              sub={
                b.packA === null
                  ? undefined
                  : `${b.packA >= 0 ? "+" : "−"}${num(Math.abs(b.packA), 1)} A · ${num(Math.abs((b.packV ?? 0) * b.packA))} W ${
                      b.direction === "charge" ? "en charge" : b.direction === "discharge" ? "en décharge" : "au repos"
                    }`
              }
            />
            <Metric
              label="Écart entre cellules"
              value={num(b.cellDiffMv)}
              unit="mV"
              tone={b.cellDiffLevel ? LEVEL[b.cellDiffLevel].text : undefined}
              sub={
                b.cellMinV !== null && b.cellMaxV !== null
                  ? `${b.cellCount ?? "?"} cellules · ${num(b.cellMinV, 3)} à ${num(b.cellMaxV, 3)} V`
                  : undefined
              }
            />
            <Metric
              label="Température cellules"
              value={
                b.cellTempMin !== null && b.cellTempMax !== null && b.cellTempMin !== b.cellTempMax
                  ? `${num(b.cellTempMin)}–${num(b.cellTempMax)}`
                  : num(b.cellTempMax)
              }
              unit="°C"
              tone={b.cellTempLevel ? LEVEL[b.cellTempLevel].text : undefined}
              sub={`MOSFET ${num(b.mosTempMax)} °C · onduleur ${num(b.inverterTemp)} °C`}
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-400">
            {b.remainMin !== null && b.remainMin > 0 && (
              <span>
                {b.direction === "charge" ? "Pleine dans" : "Vide dans"}{" "}
                <strong className="text-zinc-200">
                  {b.remainMin >= 60 ? `${Math.floor(b.remainMin / 60)} h ${String(b.remainMin % 60).padStart(2, "0")}` : `${b.remainMin} min`}
                </strong>{" "}
                (estimation BMS)
              </span>
            )}
            {b.cellDiffLevel && b.cellDiffLevel !== "ok" && (
              <span className="text-amber-400">
                Écart entre cellules {LEVEL[b.cellDiffLevel].label.toLowerCase()} : normal en charge ou décharge forte,
                à vérifier s&rsquo;il persiste au repos.
              </span>
            )}
            {b.faults.map((f, i) => (
              <span key={i} className="text-rose-400">
                Défaut {f.source} : code {f.code}
              </span>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}
