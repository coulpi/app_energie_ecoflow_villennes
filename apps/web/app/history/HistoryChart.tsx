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
  consoWh: number;
  soc: number | null;
}

const tickStyle = { fill: "#a1a1aa", fontSize: 10 };
const axisLine = { stroke: "rgba(255,255,255,0.08)" };

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

export default function HistoryChart({ data }: { data: HistoryPoint[] }) {
  const hasSoc = data.some((d) => d.soc !== null);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
      {/* Production / consommation */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">
            Production · Consommation
          </div>
          <div className="text-[11px] text-zinc-500">7 derniers jours</div>
        </div>
        <div className="h-64 sm:h-72 -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="g-prod" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34d399" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="g-conso" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.05)" />
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
                cursor={{ stroke: "rgba(255,255,255,0.1)" }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, color: "#a1a1aa" }}
                iconType="circle"
              />
              <Area
                type="monotone"
                dataKey="prodWh"
                name="Production"
                stroke="#34d399"
                strokeWidth={2}
                fill="url(#g-prod)"
              />
              <Area
                type="monotone"
                dataKey="consoWh"
                name="Consommation"
                stroke="#38bdf8"
                strokeWidth={2}
                fill="url(#g-conso)"
              />
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
                  stroke="rgba(255,255,255,0.05)"
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
                  cursor={{ stroke: "rgba(255,255,255,0.1)" }}
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
