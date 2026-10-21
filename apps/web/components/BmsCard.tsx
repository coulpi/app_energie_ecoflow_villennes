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

const CELL_BAR: Record<Level, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-rose-500",
};

/** Détail par cellule : jauge de tension relative + écart à la médiane. */
function CellGrid({
  cells,
  temps,
}: {
  cells: NonNullable<BmsSummary["cells"]>;
  temps: number[] | null;
}) {
  const vs = cells.map((c) => c.v);
  // Échelle resserrée autour des tensions réelles pour rendre les écarts
  // visibles (quelques dizaines de mV sur ~4 V).
  const lo = Math.min(...vs) - 0.03;
  const hi = Math.max(...vs) + 0.01;
  const median = cells.find((c) => c.devMv === 0)?.v ?? vs.slice().sort((a, b) => a - b)[Math.floor(vs.length / 2)]!;
  const outliers = cells.filter((c) => c.level !== "ok");
  return (
    <div className="mt-4 rounded-xl border border-zinc-800 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <span className="text-xs font-medium text-zinc-300">Détail par cellule</span>
        <span className="text-[11px] text-zinc-500">
          médiane {num(median, 3)} V
          {temps && temps.length > 0 && ` · sondes ${temps.map((t) => `${t} °C`).join(" / ")}`}
        </span>
      </div>
      <div className="grid grid-cols-7 md:grid-cols-[repeat(14,minmax(0,1fr))] gap-1.5">
        {cells.map((c) => {
          const pct = Math.max(8, Math.min(100, ((c.v - lo) / (hi - lo)) * 100));
          return (
            <div
              key={c.index}
              className="flex flex-col items-center gap-1 min-w-0"
              title={`Cellule ${c.index} : ${num(c.v, 3)} V (${c.devMv > 0 ? "+" : ""}${c.devMv} mV / médiane)`}
            >
              <span className="text-[10px] tabular-nums text-zinc-400">{num(c.v, 3)}</span>
              <div className="relative w-full max-w-[34px] h-16 rounded-md border border-zinc-800 overflow-hidden" style={{ background: "var(--track)" }}>
                <div className={`absolute inset-x-0 bottom-0 ${CELL_BAR[c.level]}`} style={{ height: `${pct}%`, opacity: 0.85 }} />
              </div>
              <span className={`text-[10px] tabular-nums ${c.level === "ok" ? "text-zinc-500" : c.level === "warn" ? "text-amber-400" : "text-rose-400"}`}>
                {c.devMv > 0 ? "+" : ""}
                {c.devMv}
              </span>
              <span className="text-[10px] text-zinc-500">n°{c.index}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-zinc-500">
        {outliers.length === 0
          ? "Cellules homogènes : toutes à moins de 40 mV de la médiane."
          : outliers
              .map((c) => `Cellule ${c.index} : ${Math.abs(c.devMv)} mV ${c.devMv < 0 ? "sous" : "au-dessus de"} la médiane`)
              .join(" · ") + ". Si l'écart persiste batterie au repos, la cellule est plus faible que les autres."}
      </p>
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

          {b.cells && <CellGrid cells={b.cells} temps={b.cellTemps} />}

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
