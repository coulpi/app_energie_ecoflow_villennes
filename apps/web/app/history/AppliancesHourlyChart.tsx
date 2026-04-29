"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface ApplianceHourlyPoint {
  label: string;
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

function fmtW(v: number) {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(2)} kW`;
  return `${Math.round(v)} W`;
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
              {fmtW(p.value)}
            </span>
          </div>
        ))}
    </div>
  );
}

export default function AppliancesHourlyChart({
  data,
  deviceNames,
}: {
  data: ApplianceHourlyPoint[];
  deviceNames: string[];
}) {
  return (
    <div className="card p-3 sm:p-4">
      <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500 mb-3 px-1">
        Conso par équipement à l&rsquo;heure (48 dernières heures)
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="rgba(255,255,255,0.05)" />
            <XAxis
              dataKey="label"
              tick={tickStyle}
              axisLine={axisLine}
              tickLine={axisLine}
              interval="preserveStartEnd"
              minTickGap={28}
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
              cursor={{ stroke: "rgba(255,255,255,0.1)" }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, color: "#a1a1aa" }}
              iconType="circle"
            />
            {deviceNames.map((name, i) => (
              <Line
                key={name}
                type="monotone"
                dataKey={name}
                stroke={PALETTE[i % PALETTE.length]}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
