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
  profiles: LiveProfile[];
}

export function LiveSummary() {
  const [data, setData] = useState<LivePayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const r = await fetch("/api/loads/live", { cache: "no-store" });
        if (r.ok && !cancelled) setData(await r.json());
      } catch {
        // ignore
      }
    };
    void fetchOnce();
    const id = setInterval(fetchOnce, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!data) return null;
  const onCount = data.profiles.filter((p) => p.currentlyOn).length;

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
