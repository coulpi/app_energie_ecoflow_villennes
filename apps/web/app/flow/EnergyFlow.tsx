"use client";

import { useEffect, useState } from "react";

interface FlowSnapshot {
  productionW: number | null;
  consumptionW: number | null;
  gridW: number | null;
  batteryPowerW: number | null;
  batterySoc: number | null;
  switchOn: boolean | null;
  ts: string;
}

const POLL_MS = 5000;

const C = {
  solar: "#f59e0b",
  house: "#10b981",
  grid: "#06b6d4",
  battery: "#a855f7",
  inactive: "#3a3f4d",
} as const;

export default function EnergyFlow({ initial }: { initial: FlowSnapshot }) {
  const [snap, setSnap] = useState<FlowSnapshot>(initial);

  useEffect(() => {
    const tick = async () => {
      try {
        const res = await fetch("/api/snapshot", { cache: "no-store" });
        if (res.ok) setSnap(await res.json());
      } catch {
        // ignore
      }
    };
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, []);

  const prod = snap.productionW ?? 0;
  const cons = snap.consumptionW ?? 0;
  const grid = snap.gridW ?? 0;
  const bat = snap.batteryPowerW ?? 0;
  const soc = snap.batterySoc;

  const fmtW = (v: number) =>
    Math.abs(v) < 1 ? "0 W" : `${Math.round(Math.abs(v))} W`;

  // Flux directionnels.
  const pvToHouse = Math.min(prod, cons);
  const exportToGrid = Math.max(0, -grid);
  const importFromGrid = Math.max(0, grid);
  const batteryDischarge = Math.max(0, bat);
  const batteryCharge = Math.max(0, -bat);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Flux d'énergie</h1>
          <p className="text-xs text-zinc-400 flex items-center gap-2 mt-1">
            <span>Vue temps réel</span>
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              En direct
            </span>
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-2">
          <button className="bg-zinc-900/80 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs flex items-center gap-2">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-3.5 h-3.5">
              <rect x="4" y="5" width="16" height="16" rx="2" />
              <path d="M4 9h16M9 3v4M15 3v4" strokeLinecap="round" />
            </svg>
            Aujourd'hui
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-3 h-3">
              <path d="m6 9 6 6 6-6" strokeLinecap="round" />
            </svg>
          </button>
          <button className="bg-zinc-900/80 border border-zinc-800 rounded-lg w-9 h-9 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
              <circle cx="5" cy="12" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="19" cy="12" r="1.5" />
            </svg>
          </button>
        </div>
      </header>

      <BalanceBanner gridW={grid} surplusW={exportToGrid - importFromGrid} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi
          label="Production solaire"
          value={fmtW(prod)}
          status={prod > 1 ? "En cours" : "idle"}
          tone={C.solar}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" strokeLinecap="round" />
            </svg>
          }
        />
        <Kpi
          label="Consommation maison"
          value={fmtW(cons)}
          status={cons > 1 ? "En cours" : "idle"}
          tone={C.house}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M3 12 12 4l9 8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M5 10v10h14V10" strokeLinejoin="round" />
            </svg>
          }
        />
        <Kpi
          label={importFromGrid > exportToGrid ? "Import réseau" : "Export réseau"}
          value={fmtW(grid)}
          status={Math.abs(grid) > 1 ? "En cours" : "idle"}
          tone={C.grid}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M12 3v18" strokeLinecap="round" />
              <path d="m6 21 6-6 6 6M8 11h8M9 7h6" strokeLinecap="round" />
            </svg>
          }
        />
        <Kpi
          label={
            batteryCharge > 1
              ? "Batterie charge"
              : batteryDischarge > 1
                ? "Batterie décharge"
                : "Niveau batterie"
          }
          value={
            batteryCharge > 1
              ? fmtW(batteryCharge)
              : batteryDischarge > 1
                ? fmtW(batteryDischarge)
                : soc === null
                  ? "— %"
                  : `${Math.round(soc)} %`
          }
          status={
            soc === null
              ? "—"
              : `SoC ${Math.round(soc)} %${batteryCharge > 1 ? " · charge" : batteryDischarge > 1 ? " · décharge" : ""}`
          }
          tone={C.battery}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <rect x="4" y="7" width="14" height="10" rx="2" />
              <path d="M19 10v4M8 10v4M11 10v4" strokeLinecap="round" />
            </svg>
          }
        />
      </div>

      <div className="bg-zinc-950/60 border border-zinc-900 rounded-2xl p-4 sm:p-6">
        <svg
          viewBox="0 0 1000 540"
          className="w-full h-auto"
          style={{ maxHeight: 580 }}
        >
          <defs>
            <filter id="glow-solar" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="glow-strong" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="10" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Marqueur chevron pour flux actifs */}
            <marker
              id="chev-active"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="4"
              markerHeight="4"
              orient="auto"
            >
              <path d="M0,0 L10,5 L0,10 L3,5 z" fill="#22c55e" />
            </marker>

            <style>{`
              @keyframes flow-dash { to { stroke-dashoffset: -40; } }
              .flow-line {
                stroke-dasharray: 12 18;
                animation: flow-dash 1.4s linear infinite;
                filter: drop-shadow(0 0 4px rgba(34,197,94,0.6));
              }
              .flow-rail {
                stroke: rgba(34,197,94,0.18);
                stroke-width: 6;
                fill: none;
                stroke-linecap: round;
              }
              .flow-idle {
                stroke: ${C.inactive};
                stroke-width: 2;
                stroke-dasharray: 6 6;
                fill: none;
                stroke-linecap: round;
              }
              @keyframes pulse-ring {
                0%, 100% { opacity: 0.6; }
                50% { opacity: 1; }
              }
              .ring-pulse {
                animation: pulse-ring 2s ease-in-out infinite;
              }
            `}</style>
          </defs>

          {/* Connexions */}

          {/* PV → Maison (vertical) */}
          <FlowPath
            d="M 500 195 V 360"
            active={pvToHouse > 1}
            width={powerWidth(pvToHouse)}
          />
          {/* PV → Réseau (horizontal puis courbe descendante) */}
          <FlowPath
            d="M 565 145 H 760 Q 820 145 820 200 V 320"
            active={exportToGrid > 1}
            width={powerWidth(exportToGrid)}
          />
          {/* Réseau → Maison (import) */}
          <FlowPath
            d="M 820 380 Q 820 430 760 430 H 580"
            active={importFromGrid > 1}
            width={powerWidth(importFromGrid)}
          />
          {/* Batterie → Maison (décharge) */}
          <FlowPath
            d="M 245 420 Q 320 440 425 425"
            active={batteryDischarge > 1}
            width={powerWidth(batteryDischarge)}
          />
          {/* PV → Batterie (charge depuis surplus) */}
          <FlowPath
            d="M 440 170 Q 320 180 230 350"
            active={batteryCharge > 1}
            width={powerWidth(batteryCharge)}
          />
          {/* Maison ⇢ Batterie (rail inactif décoratif quand batterie idle) */}
          {batteryCharge < 1 && batteryDischarge < 1 && (
            <path d="M 425 420 L 245 410" className="flow-idle" />
          )}

          {/* Nœuds */}
          <Node
            x={500}
            y={145}
            color={C.solar}
            label="Panneaux"
            value={fmtW(prod)}
            icon="solar"
            r={62}
          />
          <Node
            x={500}
            y={420}
            color={C.house}
            label="Maison"
            value={fmtW(cons)}
            icon="house"
            r={62}
          />
          <Node
            x={820}
            y={350}
            color={C.grid}
            label={importFromGrid > exportToGrid ? "Réseau (import)" : "Réseau (export)"}
            value={fmtW(grid)}
            icon="grid"
            r={56}
          />
          <Node
            x={185}
            y={400}
            color={C.battery}
            label={
              batteryCharge > 1
                ? "Batterie · charge ~"
                : batteryDischarge > 1
                  ? "Batterie · décharge ~"
                  : "Batterie · idle"
            }
            value={
              batteryCharge > 1
                ? fmtW(batteryCharge)
                : batteryDischarge > 1
                  ? fmtW(batteryDischarge)
                  : "0 W"
            }
            sub={soc === null ? "— %" : `${Math.round(soc)} %`}
            icon="battery"
            r={56}
            dim={batteryCharge < 1 && batteryDischarge < 1}
          />
        </svg>

        {/* Légende */}
        <div className="flex flex-wrap items-center gap-6 text-xs text-zinc-400 pt-3 border-t border-zinc-900 mt-2">
          <span className="inline-flex items-center gap-2">
            <svg width="48" height="10" viewBox="0 0 48 10">
              <line
                x1="0"
                y1="5"
                x2="42"
                y2="5"
                stroke="#22c55e"
                strokeWidth="3"
                strokeDasharray="6 4"
                className="flow-line"
              />
              <path d="M40,1 L46,5 L40,9 L42,5 z" fill="#22c55e" />
            </svg>
            flux actif
          </span>
          <span className="inline-flex items-center gap-2">
            <svg width="48" height="10" viewBox="0 0 48 10">
              <line
                x1="0"
                y1="5"
                x2="48"
                y2="5"
                stroke={C.inactive}
                strokeWidth="2"
                strokeDasharray="6 6"
              />
            </svg>
            inactif
          </span>
          <span>épaisseur ∝ puissance</span>
        </div>
      </div>
    </div>
  );
}

function BalanceBanner({
  gridW,
  surplusW,
}: {
  gridW: number;
  surplusW: number;
}) {
  // gridW signé : + import, - export. surplusW déjà calculé : + export, - import.
  if (Math.abs(gridW) < 30) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center text-2xl">
          ⚖
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-zinc-500">
            Bilan instantané
          </div>
          <div className="text-2xl font-semibold text-zinc-200">
            Équilibré
          </div>
          <div className="text-xs text-zinc-500">
            production ≈ consommation, peu d'échange réseau
          </div>
        </div>
      </div>
    );
  }
  const exporting = surplusW > 0;
  const value = Math.round(Math.abs(surplusW));
  return (
    <div
      className="rounded-2xl border p-5 flex items-center gap-5"
      style={{
        backgroundColor: exporting
          ? "rgba(16,185,129,0.08)"
          : "rgba(245,158,11,0.08)",
        borderColor: exporting
          ? "rgba(16,185,129,0.4)"
          : "rgba(245,158,11,0.4)",
        boxShadow: exporting
          ? "0 0 30px rgba(16,185,129,0.15)"
          : "0 0 30px rgba(245,158,11,0.15)",
      }}
    >
      <div
        className="w-14 h-14 rounded-full flex items-center justify-center text-3xl"
        style={{
          backgroundColor: exporting
            ? "rgba(16,185,129,0.18)"
            : "rgba(245,158,11,0.18)",
        }}
      >
        {exporting ? "↗" : "↘"}
      </div>
      <div className="flex-1">
        <div
          className="text-[10px] uppercase tracking-[0.25em] mb-1"
          style={{ color: exporting ? "#10b981" : "#f59e0b" }}
        >
          {exporting ? "Surplus · vous exportez" : "Déficit · vous importez"}
        </div>
        <div
          className="text-4xl font-bold tabular-nums leading-none"
          style={{ color: exporting ? "#10b981" : "#f59e0b" }}
        >
          {value} W
        </div>
        <div className="text-xs text-zinc-400 mt-1.5">
          {exporting
            ? "Production solaire supérieure à la consommation — l'excédent part vers le réseau"
            : "Consommation supérieure à la production — vous tirez du réseau"}
        </div>
      </div>
      <div
        className="hidden sm:block text-xs px-3 py-1.5 rounded-lg font-mono"
        style={{
          backgroundColor: exporting
            ? "rgba(16,185,129,0.15)"
            : "rgba(245,158,11,0.15)",
          color: exporting ? "#34d399" : "#fbbf24",
        }}
      >
        {exporting ? "EXPORT" : "IMPORT"}
      </div>
    </div>
  );
}

function powerWidth(w: number): number {
  if (w < 1) return 3;
  return Math.min(8, 3 + Math.log10(w) * 1.6);
}

function FlowPath({
  d,
  active,
  width,
}: {
  d: string;
  active: boolean;
  width: number;
}) {
  if (!active) {
    return <path d={d} className="flow-idle" />;
  }
  return (
    <g>
      <path d={d} className="flow-rail" />
      <path
        d={d}
        stroke="#22c55e"
        strokeWidth={width}
        fill="none"
        strokeLinecap="round"
        markerEnd="url(#chev-active)"
        className="flow-line"
      />
    </g>
  );
}

function Node({
  x,
  y,
  color,
  label,
  value,
  sub,
  icon,
  r,
  dim,
}: {
  x: number;
  y: number;
  color: string;
  label: string;
  value: string;
  sub?: string;
  icon: "solar" | "house" | "grid" | "battery";
  r: number;
  dim?: boolean;
}) {
  const opacity = dim ? 0.5 : 1;
  return (
    <g transform={`translate(${x},${y})`} style={{ opacity }}>
      {/* Anneau extérieur diffus */}
      <circle r={r + 10} fill={color} opacity={0.08} filter="url(#glow-strong)" />
      {/* Halo */}
      <circle
        r={r}
        fill="#0a0e1a"
        stroke={color}
        strokeWidth={2.5}
        filter="url(#glow-solar)"
        className="ring-pulse"
      />
      {/* Icône */}
      <g transform="translate(-14, -32)" stroke={color} fill="none" strokeWidth={1.7}>
        <NodeIcon kind={icon} />
      </g>
      <text
        textAnchor="middle"
        y={6}
        fill="#a1a1aa"
        fontSize="10"
        style={{ textTransform: "uppercase", letterSpacing: 1.5 }}
      >
        {label}
      </text>
      <text
        textAnchor="middle"
        y={28}
        fill={color}
        fontSize={r > 58 ? 22 : 19}
        fontWeight={700}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </text>
      {sub && (
        <text textAnchor="middle" y={46} fill="#71717a" fontSize="10">
          {sub}
        </text>
      )}
    </g>
  );
}

function NodeIcon({ kind }: { kind: "solar" | "house" | "grid" | "battery" }) {
  switch (kind) {
    case "solar":
      return (
        <g>
          <rect x="4" y="6" width="20" height="14" rx="1.5" />
          <path d="M8 6v14M14 6v14M20 6v14M4 13h20" />
          <path
            d="M14 0v4M14 22v4M0 14h4M24 14h4M5 5l3 3M20 20l3 3M5 23l3-3M20 8l3-3"
            strokeLinecap="round"
          />
        </g>
      );
    case "house":
      return (
        <g>
          <path d="M3 14 14 4l11 10" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M6 12v12h16V12" strokeLinejoin="round" />
        </g>
      );
    case "grid":
      return (
        <g>
          <path d="M14 4v22M9 26l5-5 5 5M10 14h8M11 9h6" strokeLinecap="round" />
        </g>
      );
    case "battery":
      return (
        <g>
          <rect x="6" y="9" width="18" height="12" rx="2" />
          <path d="M25 12v6M11 12v6M15 12v6M19 12v6" strokeLinecap="round" />
        </g>
      );
  }
}

function Kpi({
  label,
  value,
  status,
  tone,
  icon,
}: {
  label: string;
  value: string;
  status: string;
  tone: string;
  icon: React.ReactNode;
}) {
  return (
    <div
      className="rounded-2xl border p-4 flex items-center gap-4"
      style={{
        backgroundColor: `${tone}10`,
        borderColor: `${tone}30`,
      }}
    >
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
        style={{
          backgroundColor: `${tone}1A`,
          color: tone,
          boxShadow: `0 0 18px ${tone}30`,
        }}
      >
        <div className="w-6 h-6">{icon}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wider text-zinc-400 truncate">
          {label}
        </div>
        <div
          className="text-2xl font-semibold leading-tight tabular-nums"
          style={{ color: tone }}
        >
          {value}
        </div>
        <div className="text-[11px] text-zinc-500 flex items-center gap-1.5 mt-0.5">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: tone }}
          />
          {status}
        </div>
      </div>
    </div>
  );
}
