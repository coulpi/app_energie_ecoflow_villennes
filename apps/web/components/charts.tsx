"use client";

// Graphiques partagés (recharts). Couleurs = variables CSS de thème, donc
// identiques en clair et en sombre sans code spécifique.

import {
  Area,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const tick = { fill: "var(--text-3)", fontSize: 10 };

export interface PowerPoint {
  label: string;
  [key: string]: number | string | null;
}

export interface PowerSeries {
  key: string;
  label: string;
  color: string; // var(--flow-*)
  area?: boolean;
  dashed?: boolean;
}

const fmtW = (v: number) =>
  Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(2)} kW` : `${Math.round(v)} W`;

function PowerTooltip({
  active,
  payload,
  label,
  series,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number | null }>;
  label?: string;
  series: PowerSeries[];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card !p-2.5 !rounded-lg text-xs min-w-[170px]">
      <div className="text-zinc-400 mb-1">{label}</div>
      {series.map((s) => {
        const v = payload.find((p) => p.dataKey === s.key)?.value;
        return (
          <div key={s.key} className="flex items-center gap-2 tabular-nums">
            <span className="w-2.5 h-0.5 rounded" style={{ background: s.color }} />
            <span className="text-zinc-300 flex-1">{s.label}</span>
            <span className="text-zinc-100">{v === null || v === undefined ? "—" : fmtW(v)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Courbes de puissance (W) dans le temps, une seule échelle. */
export function PowerChart({
  data,
  series,
  height = 260,
}: {
  data: PowerPoint[];
  series: PowerSeries[];
  height?: number;
}) {
  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400 mb-2">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span
              className="w-3 h-0.5 rounded"
              style={{
                background: s.dashed
                  ? `repeating-linear-gradient(90deg, ${s.color} 0 3px, transparent 3px 5px)`
                  : s.color,
              }}
            />
            {s.label}
          </span>
        ))}
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
            <defs>
              {series
                .filter((s) => s.area)
                .map((s) => (
                  <linearGradient key={s.key} id={`pc-${s.key}`} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                  </linearGradient>
                ))}
            </defs>
            <CartesianGrid stroke="var(--hairline)" vertical={false} />
            <XAxis dataKey="label" tick={tick} axisLine={{ stroke: "var(--hairline)" }} tickLine={false} minTickGap={28} />
            <YAxis
              tick={tick}
              axisLine={false}
              tickLine={false}
              width={44}
              tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${v / 1000}k` : `${v}`)}
            />
            <Tooltip cursor={{ stroke: "var(--hairline)" }} content={<PowerTooltip series={series} />} />
            {series.map((s) =>
              s.area ? (
                <Area
                  key={s.key}
                  dataKey={s.key}
                  type="monotone"
                  stroke={s.color}
                  strokeWidth={2}
                  fill={`url(#pc-${s.key})`}
                  connectNulls
                  dot={false}
                  isAnimationActive={false}
                />
              ) : (
                <Line
                  key={s.key}
                  dataKey={s.key}
                  type="monotone"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeDasharray={s.dashed ? "5 4" : undefined}
                  connectNulls
                  dot={false}
                  isAnimationActive={false}
                />
              ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export interface DonutSlice {
  label: string;
  value: number; // Wh
  color: string;
}

/** Anneau de répartition avec total au centre et légende détaillée. */
export function EnergyDonut({ slices, centerLabel }: { slices: DonutSlice[]; centerLabel: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const shown = slices.filter((s) => s.value > 0);
  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative w-44 h-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={shown.length ? shown : [{ label: "—", value: 1, color: "var(--track)" }]}
              dataKey="value"
              innerRadius="68%"
              outerRadius="100%"
              paddingAngle={shown.length > 1 ? 2 : 0}
              stroke="none"
              isAnimationActive={false}
            >
              {(shown.length ? shown : [{ color: "var(--track)" }]).map((s, i) => (
                <Cell key={i} fill={s.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-semibold tabular-nums text-zinc-100">
            {(total / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}
          </span>
          <span className="text-xs text-zinc-400">kWh {centerLabel}</span>
        </div>
      </div>
      <ul className="w-full space-y-2">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2.5 text-sm">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
            <span className="text-zinc-300 flex-1 min-w-0 truncate">{s.label}</span>
            <span className="tabular-nums text-zinc-100">
              {(s.value / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} kWh
            </span>
            <span className="tabular-nums text-zinc-500 w-10 text-right">
              {total > 0 ? Math.round((s.value / total) * 100) : 0} %
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
