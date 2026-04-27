"use client";

import { useEffect, useState } from "react";

interface LiveProfile {
  id: string;
  name: string;
  expectedW: number;
  currentlyOn: boolean;
  confidence: number;
}
interface LivePayload {
  currentW: number | null;
  baseW: number | null;
  deltaW: number | null;
  baselineOverride: number | null;
  baselineNightW: number | null;
  baselineDayW: number | null;
  baselineUsed: "night" | "day";
  profiles: LiveProfile[];
}

export function LiveSummary() {
  const [data, setData] = useState<LivePayload | null>(null);
  const [editBase, setEditBase] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const fetchOnce = async () => {
    try {
      const r = await fetch("/api/loads/live", { cache: "no-store" });
      if (r.ok) setData(await r.json());
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (!cancelled) await fetchOnce();
    };
    void tick();
    const id = setInterval(tick, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const applyBaseline = async (value: number | null) => {
    setSaving(true);
    try {
      await fetch("/api/control/battery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loadsBaselineW: value }),
      });
      setEditBase("");
      await fetchOnce();
    } finally {
      setSaving(false);
    }
  };

  if (!data) return null;
  const onCount = data.profiles.filter((p) => p.currentlyOn).length;
  const overrideActive = data.baselineOverride !== null;

  return (
    <div className="bg-zinc-950/60 border border-zinc-900 rounded-2xl p-4 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-sm uppercase text-zinc-400 tracking-wider">
          État live
        </h2>
        <div className="flex items-center gap-3 text-xs">
          <Stat label="Conso actuelle" v={data.currentW} unit="W" />
          <Stat label="Plancher 1h" v={data.baseW} unit="W" />
          <Stat label="Δ" v={data.deltaW} unit="W" highlight />
          <span className="text-zinc-500">
            {onCount} appareil{onCount > 1 ? "s" : ""} probable
            {onCount > 1 ? "s" : ""} ON
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {data.profiles.map((p) => (
          <ProfileBadge key={p.id} p={p} />
        ))}
      </div>
      <div className="flex items-center gap-3 pt-2 border-t border-zinc-900 text-xs flex-wrap text-zinc-500">
        <span>Plancher auto utilisé :</span>
        <span className="text-zinc-300">
          {data.baselineUsed === "night" ? "nuit" : "jour"}
        </span>
        {data.baselineNightW !== null && (
          <span>
            nuit (2-5h, 7j) :{" "}
            <span className="text-zinc-300 font-mono">
              {data.baselineNightW} W
            </span>
          </span>
        )}
        {data.baselineDayW !== null && (
          <span>
            jour (8-22h p25, 7j) :{" "}
            <span className="text-zinc-300 font-mono">
              {data.baselineDayW} W
            </span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 pt-2 text-xs flex-wrap">
        <span className="text-zinc-500">Forcer plancher :</span>
        <input
          type="number"
          min={0}
          max={5000}
          step={50}
          placeholder={data.baseW?.toString() ?? "auto"}
          value={editBase}
          onChange={(e) => setEditBase(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 w-24 font-mono text-zinc-200"
        />
        <button
          type="button"
          disabled={saving || editBase === ""}
          onClick={() => applyBaseline(Number(editBase) || 0)}
          className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 rounded px-3 py-1"
        >
          Fixer
        </button>
        {overrideActive && (
          <>
            <span className="text-amber-400">
              ⚠ override actif : {data.baselineOverride} W
            </span>
            <button
              type="button"
              disabled={saving}
              onClick={() => applyBaseline(null)}
              className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 rounded px-3 py-1"
            >
              Remettre auto
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  v,
  unit,
  highlight,
}: {
  label: string;
  v: number | null;
  unit: string;
  highlight?: boolean;
}) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-zinc-500">{label}</span>
      <span
        className={
          "font-mono " + (highlight ? "text-emerald-300" : "text-zinc-300")
        }
      >
        {v ?? "—"}
        {v !== null && <span className="text-zinc-500 ml-0.5">{unit}</span>}
      </span>
    </span>
  );
}

function ProfileBadge({ p }: { p: LiveProfile }) {
  const on = p.currentlyOn;
  const conf = Math.round(p.confidence * 100);
  return (
    <span
      className={
        "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs " +
        (on
          ? "bg-emerald-900/30 border-emerald-700/40 text-emerald-200"
          : "bg-zinc-900/60 border-zinc-800 text-zinc-400")
      }
    >
      <span
        className={
          "w-2 h-2 rounded-full " +
          (on ? "bg-emerald-400 animate-pulse" : "bg-zinc-700")
        }
      />
      <span className="font-medium">{p.name}</span>
      <span className="opacity-60 font-mono">{p.expectedW} W</span>
      {on ? (
        <span className="bg-emerald-700/30 px-1.5 rounded text-[10px] uppercase">
          ON · {conf}%
        </span>
      ) : (
        <span className="text-[10px] uppercase opacity-50">off</span>
      )}
    </span>
  );
}
