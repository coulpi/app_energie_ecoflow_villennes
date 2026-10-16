"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface HistoryPoint {
  ts: string;        // ISO
  label: string;     // "28/04 14h"
  prodWh: number;
  /** Conso réseau 1 = solaire autoconsommé + décharge batterie + achat. */
  conso1Wh: number;
  /** Achat réseau 1 (compteur réseau). */
  import1Wh: number;
  /** Conso réseau 2 (compteur piscine / jacuzzi / PAC / voiture). */
  conso2Wh: number;
  soc: number | null;
}

export type NetFilter = "all" | "1" | "2";

interface Serie {
  key: keyof HistoryPoint;
  name: string;
  color: string;
}

const SERIES: Record<NetFilter, Serie[]> = {
  all: [
    { key: "prodWh", name: "Production solaire", color: "var(--flow-solar)" },
    { key: "conso1Wh", name: "Conso réseau 1", color: "var(--flow-home)" },
    { key: "conso2Wh", name: "Conso réseau 2", color: "var(--flow-aux)" },
  ],
  "1": [
    { key: "prodWh", name: "Production solaire", color: "var(--flow-solar)" },
    { key: "conso1Wh", name: "Conso réseau 1", color: "var(--flow-home)" },
    { key: "import1Wh", name: "Achat réseau 1", color: "var(--flow-import)" },
  ],
  "2": [{ key: "conso2Wh", name: "Conso réseau 2", color: "var(--flow-aux)" }],
};

const TITLE: Record<NetFilter, string> = {
  all: "Production · Consommation des 2 réseaux",
  "1": "Réseau 1 · maison",
  "2": "Réseau 2 · piscine, jacuzzi, PAC, voiture",
};

const tickStyle = { fill: "var(--text-3)", fontSize: 10 };
const axisLine = { stroke: "var(--hairline)" };

function fmtWh(v: number) {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)} kWh`;
  return `${Math.round(v)} Wh`;
}

function TooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string; dataKey: string }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-zinc-950/95 backdrop-blur px-3 py-2 text-xs shadow-xl">
      <div className="text-zinc-400 mb-1">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 tabular-nums">
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: p.color }}
          />
          <span className="text-zinc-300">{p.name}</span>
          <span className="ml-auto font-medium" style={{ color: p.color }}>
            {p.dataKey === "soc"
              ? `${Math.round(p.value)} %`
              : fmtWh(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function HistoryChart({
  data,
  net = "all",
}: {
  data: HistoryPoint[];
  net?: NetFilter;
}) {
  const hasSoc = data.some((d) => d.soc !== null);
  const series = SERIES[net];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
      {/* Production / consommation */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">
            {TITLE[net]}
          </div>
          <div className="text-[11px] text-zinc-500">7 derniers jours</div>
        </div>
        <div className="h-64 sm:h-72 -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                {series.map((s) => (
                  <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="2 4" stroke="var(--hairline)" />
              <XAxis
                dataKey="label"
                tick={tickStyle}
                axisLine={axisLine}
                tickLine={false}
                minTickGap={32}
              />
              <YAxis
                tick={tickStyle}
                axisLine={axisLine}
                tickLine={false}
                width={48}
                tickFormatter={(v: number) =>
                  Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`
                }
              />
              <Tooltip
                content={<TooltipContent />}
                cursor={{ stroke: "var(--text-3)" }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, color: "var(--text-3)" }}
                iconType="circle"
              />
              {series.map((s) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.name}
                  stroke={s.color}
                  strokeWidth={2}
                  fill={`url(#g-${s.key})`}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* SoC batterie */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">
            Niveau batterie (SoC)
          </div>
          <div className="text-[11px] text-zinc-500">7 derniers jours</div>
        </div>
        <div className="h-64 sm:h-72 -mx-2">
          {hasSoc ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={data}
                margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="2 4"
                  stroke="var(--hairline)"
                />
                <XAxis
                  dataKey="label"
                  tick={tickStyle}
                  axisLine={axisLine}
                  tickLine={false}
                  minTickGap={32}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={tickStyle}
                  axisLine={axisLine}
                  tickLine={false}
                  width={36}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip
                  content={<TooltipContent />}
                  cursor={{ stroke: "var(--text-3)" }}
                />
                <Line
                  type="monotone"
                  dataKey="soc"
                  name="SoC"
                  stroke="#a78bfa"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-zinc-500">
              Aucune donnée SoC pour la période.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
