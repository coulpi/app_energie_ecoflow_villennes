"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface CostPoint {
  label: string;
  r1: number;
  r2: number;
  sub: number; // abonnement (0 si non affiché)
  savings: number;
}

// Palette catégorielle validée (CVD, étapes claire et sombre dans globals.css) : réseau 1 bleu, réseau 2
// orange, économies aqua ; abonnement en gris neutre (ce n'est pas une série
// d'identité, juste une part fixe).
const COLORS = {
  r1: "var(--series-1)",
  r2: "var(--series-2)",
  sub: "var(--series-sub)",
  savings: "var(--series-3)",
};
const SURFACE = "var(--card-solid)";
const tickStyle = { fill: "var(--text-3)", fontSize: 10 };
const axisLine = { stroke: "var(--hairline)" };

const eur = (v: number) =>
  v.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

interface Visible {
  showSub: boolean;
  show1: boolean;
  show2: boolean;
}

function TooltipContent({
  active,
  payload,
  label,
  showSub,
  show1,
  show2,
}: {
  active?: boolean;
  payload?: Array<{ payload: CostPoint }>;
  label?: string;
} & Visible) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  const rows: Array<[string, string, number]> = [];
  if (show1) rows.push(["Réseau 1", COLORS.r1, p.r1]);
  if (show2) rows.push(["Réseau 2", COLORS.r2, p.r2]);
  if (showSub) rows.push(["Abonnement", COLORS.sub, p.sub]);
  return (
    <div className="rounded-lg border border-white/10 bg-zinc-950/95 backdrop-blur px-3 py-2 text-xs shadow-xl min-w-[180px]">
      <div className="text-zinc-400 mb-1">{label}</div>
      {rows.map(([name, color, v]) => (
        <div key={name} className="flex items-center gap-2 tabular-nums">
          <span className="w-2 h-2 rounded-sm" style={{ background: color }} />
          <span className="text-zinc-300 flex-1">{name}</span>
          <span className="text-zinc-100">{eur(v)}</span>
        </div>
      ))}
      {rows.length > 1 && (
        <div className="flex items-center gap-2 tabular-nums border-t border-white/10 mt-1 pt-1">
          <span className="w-2 h-2" />
          <span className="text-zinc-300 flex-1">Total</span>
          <span className="text-zinc-100 font-semibold">{eur(p.r1 + p.r2 + p.sub)}</span>
        </div>
      )}
      {show1 && (
        <div className="flex items-center gap-2 tabular-nums">
          <span className="w-2 h-0.5" style={{ background: COLORS.savings }} />
          <span className="text-zinc-300 flex-1">Économies</span>
          <span className="text-zinc-100">{eur(p.savings)}</span>
        </div>
      )}
    </div>
  );
}

function LegendItem({ color, label, line = false }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={line ? "w-3 h-0.5 rounded" : "w-2.5 h-2.5 rounded-sm"}
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

export default function CostChart({
  data,
  showSub,
  show1 = true,
  show2 = true,
  height = 260,
}: {
  data: CostPoint[];
  showSub: boolean;
  show1?: boolean;
  show2?: boolean;
  height?: number;
}) {
  // Barres empilées : seul le segment du haut a les coins arrondis.
  const stack = [
    show1 && { key: "r1", color: COLORS.r1 },
    show2 && { key: "r2", color: COLORS.r2 },
    showSub && { key: "sub", color: COLORS.sub },
  ].filter(Boolean) as Array<{ key: string; color: string }>;
  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400 mb-2">
        {show1 && <LegendItem color={COLORS.r1} label="Réseau 1" />}
        {show2 && <LegendItem color={COLORS.r2} label="Réseau 2" />}
        {showSub && <LegendItem color={COLORS.sub} label="Abonnement" />}
        {show1 && <LegendItem color={COLORS.savings} label="Économies solaire + batterie" line />}
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--hairline)" vertical={false} />
            <XAxis dataKey="label" tick={tickStyle} axisLine={axisLine} tickLine={false} minTickGap={8} />
            <YAxis
              tick={tickStyle}
              axisLine={false}
              tickLine={false}
              width={44}
              tickFormatter={(v: number) => `${v} €`}
            />
            <Tooltip
              cursor={{ fill: "var(--hairline)" }}
              content={<TooltipContent showSub={showSub} show1={show1} show2={show2} />}
            />
            {stack.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                stackId="c"
                fill={s.color}
                stroke={SURFACE}
                strokeWidth={1}
                maxBarSize={36}
                isAnimationActive={false}
                radius={i === stack.length - 1 ? [4, 4, 0, 0] : 0}
              />
            ))}
            {show1 && (
              <Line
                dataKey="savings"
                type="monotone"
                stroke={COLORS.savings}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                activeDot={{ r: 4, stroke: SURFACE, strokeWidth: 2 }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
