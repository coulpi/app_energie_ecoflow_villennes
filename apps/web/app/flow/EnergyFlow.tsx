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

  // Décompose les flux observés.
  // grid_W : + import, - export
  // batteryPowerW : + injection (décharge), - charge (input)
  const prod = snap.productionW ?? 0;
  const cons = snap.consumptionW ?? 0;
  const grid = snap.gridW ?? 0;
  const bat = snap.batteryPowerW ?? 0;
  const soc = snap.batterySoc;

  const fmtW = (v: number) =>
    Math.abs(v) < 1 ? "0 W" : `${Math.round(Math.abs(v))} W`;

  // Calcul des flux directionnels affichés sur les arêtes.
  // pv → maison : min(prod, cons)
  // pv → grid (export) : max(0, -grid si grid négatif)
  // pv → batterie (charge) : max(0, -bat si bat négatif)
  // grid → maison (import) : max(0, grid)
  // batterie → maison (décharge) : max(0, bat)
  //
  // Les valeurs de production sont soit consommées, soit exportées, soit
  // utilisées pour charger la batterie. La répartition exacte n'étant pas
  // mesurée directement, on l'estime en privilégiant l'auto-conso :
  const pvToHouse = Math.min(prod, cons);
  const exportToGrid = Math.max(0, -grid);
  const importFromGrid = Math.max(0, grid);
  const batteryDischarge = Math.max(0, bat);
  const batteryCharge = Math.max(0, -bat);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Flux d'énergie</h1>
        <span className="text-xs text-zinc-500">
          MAJ {new Date(snap.ts).toLocaleTimeString("fr-FR")} · auto 5 s
        </span>
      </div>

      <svg
        viewBox="0 0 800 480"
        className="w-full max-w-4xl mx-auto"
        style={{ minHeight: 480 }}
      >
        <defs>
          {/* Marqueur de flèche */}
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="#10b981" />
          </marker>
          <marker
            id="arrow-warn"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="#f59e0b" />
          </marker>

          <style>{`
            @keyframes flow-dash {
              to { stroke-dashoffset: -24; }
            }
            .flow-active {
              stroke-dasharray: 6 6;
              animation: flow-dash 1s linear infinite;
            }
            .flow-idle {
              stroke: #2a2a2a;
              stroke-width: 2;
            }
          `}</style>
        </defs>

        {/* Lignes de flux (sous les nœuds) */}

        {/* PV (haut centre) → Maison (centre) */}
        <FlowLine
          x1={400}
          y1={120}
          x2={400}
          y2={240}
          active={pvToHouse > 1}
          color="#10b981"
          width={powerWidth(pvToHouse)}
        />
        {/* PV → Grid (haut centre → droite) */}
        <FlowLine
          x1={400}
          y1={90}
          x2={680}
          y2={90}
          active={exportToGrid > 1}
          color="#10b981"
          width={powerWidth(exportToGrid)}
        />
        {/* Grid → Maison (droite → centre) */}
        <FlowLine
          x1={680}
          y1={300}
          x2={500}
          y2={300}
          active={importFromGrid > 1}
          color="#f59e0b"
          width={powerWidth(importFromGrid)}
        />
        {/* PV → Batterie (haut centre → gauche/bas) */}
        <FlowLine
          x1={300}
          y1={150}
          x2={120}
          y2={300}
          active={batteryCharge > 1}
          color="#10b981"
          width={powerWidth(batteryCharge)}
        />
        {/* Batterie → Maison (gauche/bas → centre) */}
        <FlowLine
          x1={120}
          y1={360}
          x2={350}
          y2={360}
          active={batteryDischarge > 1}
          color="#10b981"
          width={powerWidth(batteryDischarge)}
        />

        {/* Nœuds */}
        <Node
          x={400}
          y={70}
          icon="☀"
          label="Panneaux"
          value={fmtW(prod)}
          color="#facc15"
        />
        <Node
          x={400}
          y={290}
          icon="🏠"
          label="Maison"
          value={fmtW(cons)}
          color="#a3e635"
          big
        />
        <Node
          x={700}
          y={195}
          icon="⚡"
          label={importFromGrid > exportToGrid ? "Réseau (import)" : "Réseau (export)"}
          value={fmtW(grid)}
          color={
            importFromGrid > 1 ? "#f59e0b" : exportToGrid > 1 ? "#10b981" : "#a1a1aa"
          }
        />
        <Node
          x={100}
          y={330}
          icon="🔋"
          label="Batterie"
          value={
            soc === null ? "— %" : `${Math.round(soc)} %`
          }
          sub={
            batteryCharge > 1
              ? `chg ${fmtW(batteryCharge)}`
              : batteryDischarge > 1
                ? `dch ${fmtW(batteryDischarge)}`
                : "idle"
          }
          color={
            soc === null
              ? "#a1a1aa"
              : soc < 20
                ? "#ef4444"
                : soc > 80
                  ? "#10b981"
                  : "#facc15"
          }
        />

        {/* Légende */}
        <g transform="translate(20, 440)">
          <line
            x1="0"
            y1="0"
            x2="40"
            y2="0"
            stroke="#10b981"
            strokeWidth="3"
            className="flow-active"
          />
          <text x="48" y="4" fill="#a1a1aa" fontSize="11">
            flux actif
          </text>
          <line
            x1="130"
            y1="0"
            x2="170"
            y2="0"
            stroke="#2a2a2a"
            strokeWidth="2"
          />
          <text x="178" y="4" fill="#a1a1aa" fontSize="11">
            inactif
          </text>
          <text x="260" y="4" fill="#a1a1aa" fontSize="11">
            épaisseur ∝ puissance
          </text>
        </g>
      </svg>
    </div>
  );
}

function powerWidth(w: number): number {
  if (w < 1) return 2;
  // 1 W → 2 px ; 5000 W → ~12 px (logarithmique)
  return Math.min(14, 2 + Math.log10(w) * 3);
}

function FlowLine({
  x1,
  y1,
  x2,
  y2,
  active,
  color,
  width,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  active: boolean;
  color: string;
  width: number;
}) {
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={active ? color : "#2a2a2a"}
      strokeWidth={active ? width : 2}
      strokeLinecap="round"
      className={active ? "flow-active" : "flow-idle"}
      markerEnd={
        active
          ? color === "#f59e0b"
            ? "url(#arrow-warn)"
            : "url(#arrow)"
          : undefined
      }
    />
  );
}

function Node({
  x,
  y,
  icon,
  label,
  value,
  sub,
  color,
  big,
}: {
  x: number;
  y: number;
  icon: string;
  label: string;
  value: string;
  sub?: string;
  color: string;
  big?: boolean;
}) {
  const r = big ? 60 : 50;
  return (
    <g transform={`translate(${x},${y})`}>
      <circle
        r={r}
        fill="#0a0a0a"
        stroke={color}
        strokeWidth="2"
      />
      <text
        textAnchor="middle"
        y={-r * 0.25}
        fontSize={big ? 36 : 30}
      >
        {icon}
      </text>
      <text
        textAnchor="middle"
        y={r * 0.05}
        fill="#a1a1aa"
        fontSize="10"
        style={{ textTransform: "uppercase", letterSpacing: 1 }}
      >
        {label}
      </text>
      <text
        textAnchor="middle"
        y={r * 0.35}
        fill={color}
        fontSize={big ? 18 : 16}
        fontWeight="700"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </text>
      {sub && (
        <text
          textAnchor="middle"
          y={r * 0.55}
          fill="#71717a"
          fontSize="10"
        >
          {sub}
        </text>
      )}
    </g>
  );
}
