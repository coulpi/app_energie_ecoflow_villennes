"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface AppliancePoint {
  label: string;
  // Une clé par appareil : valeur = Wh consommés ce jour-là.
  [deviceName: string]: number | string;
}

const tickStyle = { fill: "#a1a1aa", fontSize: 10 };
const axisLine = { stroke: "rgba(255,255,255,0.08)" };

const PALETTE = [
  "#10b981",
  "#3b82f6",
  "#f59e0b",
  "#8b5cf6",
  "#ef4444",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
];

function fmtWh(v: number) {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(2)} kWh`;
  return `${Math.round(v)} Wh`;
}

function TooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const total = payload.reduce((acc, p) => acc + (p.value || 0), 0);
  return (
    <div className="rounded-lg border border-white/10 bg-zinc-950/95 backdrop-blur px-3 py-2 text-xs shadow-xl min-w-[180px]">
      <div className="text-zinc-400 mb-1">{label}</div>
      {payload
        .slice()
        .sort((a, b) => (b.value || 0) - (a.value || 0))
        .map((p) => (
          <div key={p.name} className="flex items-center gap-2 tabular-nums">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: p.color }}
            />
            <span className="text-zinc-300">{p.name}</span>
            <span className="ml-auto font-medium" style={{ color: p.color }}>
              {fmtWh(p.value)}
            </span>
          </div>
        ))}
      <div className="border-t border-white/10 mt-1.5 pt-1.5 flex items-center gap-2 tabular-nums">
        <span className="text-zinc-400">Total</span>
        <span className="ml-auto font-semibold text-zinc-100">
          {fmtWh(total)}
        </span>
      </div>
    </div>
  );
}

export default function AppliancesChart({
  data,
  deviceNames,
}: {
  data: AppliancePoint[];
  deviceNames: string[];
}) {
  return (
    <div className="card p-3 sm:p-4">
      <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500 mb-3 px-1">
        Conso par équipement (7 jours)
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.05)" />
            <XAxis
              dataKey="label"
              tick={tickStyle}
              axisLine={axisLine}
              tickLine={axisLine}
            />
            <YAxis
              tick={tickStyle}
              axisLine={axisLine}
              tickLine={axisLine}
              tickFormatter={(v) =>
                Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`
              }
            />
            <Tooltip
              content={<TooltipContent />}
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, color: "#a1a1aa" }}
              iconType="circle"
            />
            {deviceNames.map((name, i) => (
              <Bar
                key={name}
                dataKey={name}
                stackId="a"
                fill={PALETTE[i % PALETTE.length]}
                radius={
                  i === deviceNames.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]
                }
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
