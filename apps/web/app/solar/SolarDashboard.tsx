"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface PanelData {
  panelIndex: number;
  ts: string;
  dcV: number | null;
  dcA: number | null;
  pW: number | null;
  energyWh: number | null;
  acV: number | null;
  acHz: number | null;
  tempC: number | null;
  signalDb: number | null;
}

export interface InverterCard {
  id: string;
  name: string;
  sn: string;
  panels: PanelData[];
  todayWh: number;
}

export interface AlertItem {
  id: string;
  deviceName: string;
  panelIndex: number | null;
  kind: string;
  severity: "INFO" | "WARN" | "CRITICAL";
  message: string;
  startedAt: string;
}

export interface SeriesEntry {
  inverterId: string;
  points: Array<Record<string, string | number>>;
}

interface Props {
  inverters: InverterCard[];
  series: SeriesEntry[];
  alerts: AlertItem[];
}

const PANEL_COLORS = ["#34d399", "#38bdf8", "#a78bfa", "#fbbf24", "#fb7185", "#22d3ee"];
const SEVERITY: Record<AlertItem["severity"], { ring: string; text: string; bg: string }> = {
  INFO: { ring: "ring-sky-500/40", text: "text-sky-300", bg: "bg-sky-500/10" },
  WARN: { ring: "ring-amber-500/40", text: "text-amber-300", bg: "bg-amber-500/10" },
  CRITICAL: { ring: "ring-rose-500/40", text: "text-rose-300", bg: "bg-rose-500/10" },
};

function fmtAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  return `il y a ${h} h ${m % 60} min`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function fmtKwh(wh: number): string {
  if (wh >= 1000) return `${(wh / 1000).toFixed(1)} kWh`;
  return `${Math.round(wh)} Wh`;
}

function HealthDot({
  ok,
  label,
  className = "",
}: {
  ok: boolean;
  label: string;
  className?: string;
}) {
  return (
    <span className={"inline-flex items-center gap-1.5 text-[11px] " + className}>
      <span
        className={
          "w-2 h-2 rounded-full " +
          (ok ? "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/60" : "bg-rose-400")
        }
      />
      {label}
    </span>
  );
}

function PanelTile({
  panel,
  peer,
  color,
}: {
  panel: PanelData;
  peer: PanelData | null;
  color: string;
}) {
  const pW = panel.pW ?? 0;
  const peerW = peer?.pW ?? null;
  const ratio =
    peerW !== null && peerW > 50 && pW > 0 ? pW / peerW : null;
  const imbalanced = ratio !== null && (ratio < 0.75 || ratio > 1.33);
  const stale = Date.now() - new Date(panel.ts).getTime() > 10 * 60_000;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.07] p-4 flex flex-col gap-2 min-w-0">
      <div
        className="pointer-events-none absolute inset-x-0 -top-12 h-24 blur-xl opacity-40"
        style={{ background: `linear-gradient(to bottom, ${color}33, transparent)` }}
      />
      <div className="relative flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.14em] text-zinc-400">
          Panneau {panel.panelIndex + 1}
        </span>
        <span className="flex items-center gap-2 text-[10px] text-zinc-500">
          {fmtTime(panel.ts)}
          {stale && <span className="chip bg-rose-900/40 text-rose-200 border-rose-800">offline</span>}
        </span>
      </div>
      <div
        className="relative text-3xl font-semibold tabular-nums leading-tight"
        style={{ color }}
      >
        {pW > 0 ? `${Math.round(pW)} W` : "—"}
      </div>
      <div className="relative grid grid-cols-3 gap-2 text-[11px] text-zinc-400 mt-1">
        <div>
          <div className="text-zinc-500">DC</div>
          <div className="text-zinc-200 tabular-nums">
            {panel.dcV !== null ? `${panel.dcV.toFixed(1)} V` : "—"}
          </div>
          <div className="text-zinc-200 tabular-nums">
            {panel.dcA !== null ? `${panel.dcA.toFixed(2)} A` : "—"}
          </div>
        </div>
        <div>
          <div className="text-zinc-500">Cumul</div>
          <div className="text-zinc-200 tabular-nums">
            {panel.energyWh !== null ? fmtKwh(panel.energyWh) : "—"}
          </div>
        </div>
        <div>
          <div className="text-zinc-500">Vs jumeau</div>
          <div
            className={
              "tabular-nums " +
              (imbalanced ? "text-amber-300" : "text-zinc-200")
            }
          >
            {ratio !== null ? `${Math.round(ratio * 100)} %` : "—"}
          </div>
        </div>
      </div>
      <div className="relative h-[2px] w-full rounded-full overflow-hidden bg-white/5 mt-1">
        <div
          className="h-full"
          style={{
            width: `${Math.min(100, (pW / 400) * 100).toFixed(0)}%`,
            background: color,
          }}
        />
      </div>
    </div>
  );
}

function InverterPanel({
  inv,
  series,
}: {
  inv: InverterCard;
  series: SeriesEntry | undefined;
}) {
  const totalW = inv.panels.reduce((acc, p) => acc + (p.pW ?? 0), 0);
  const tempC =
    inv.panels.find((p) => p.tempC !== null)?.tempC ?? null;
  const acV =
    inv.panels.find((p) => p.acV !== null)?.acV ?? null;
  const acHz =
    inv.panels.find((p) => p.acHz !== null)?.acHz ?? null;
  const sig =
    inv.panels.find((p) => p.signalDb !== null)?.signalDb ?? null;
  const lastTs =
    inv.panels.length > 0
      ? Math.max(...inv.panels.map((p) => new Date(p.ts).getTime()))
      : null;
  const stale = lastTs !== null && Date.now() - lastTs > 10 * 60_000;
  const noData = inv.panels.length === 0;

  const chartData = useMemo(() => {
    return (series?.points ?? []).map((p) => ({
      ...p,
      label: new Date(String(p.t)).toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    }));
  }, [series]);

  const panelKeys = useMemo(() => {
    if (!chartData.length) return [];
    const keys = new Set<string>();
    for (const p of chartData) {
      for (const k of Object.keys(p)) {
        if (k.startsWith("p")) keys.add(k);
      }
    }
    return Array.from(keys).sort();
  }, [chartData]);

  return (
    <section className="card space-y-4">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold truncate">{inv.name}</h2>
            <HealthDot ok={!stale && !noData} label={stale ? "silencieux" : noData ? "—" : "OK"} />
          </div>
          <div className="text-[11px] text-zinc-500 font-mono">SN {inv.sn}</div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-zinc-400">
          <span>
            <span className="text-zinc-500">Total · </span>
            <span className="text-emerald-300 font-semibold tabular-nums">
              {Math.round(totalW)} W
            </span>
          </span>
          <span>
            <span className="text-zinc-500">Aujourd&rsquo;hui · </span>
            <span className="text-emerald-300 font-semibold tabular-nums">
              {fmtKwh(inv.todayWh)}
            </span>
          </span>
          <span>
            <span className="text-zinc-500">T° · </span>
            <span className={"tabular-nums " + (tempC !== null && tempC > 75 ? "text-amber-300" : "text-zinc-200")}>
              {tempC !== null ? `${tempC.toFixed(1)} °C` : "—"}
            </span>
          </span>
          <span>
            <span className="text-zinc-500">AC · </span>
            <span className="tabular-nums text-zinc-200">
              {acV !== null ? `${acV.toFixed(0)} V` : "—"}{" "}
              {acHz !== null ? `${acHz.toFixed(2)} Hz` : ""}
            </span>
          </span>
          <span>
            <span className="text-zinc-500">Zigbee · </span>
            <span className="tabular-nums text-zinc-200">
              {sig !== null ? `${Math.round(sig)} dBm` : "—"}
            </span>
          </span>
        </div>
      </header>

      {noData ? (
        <div className="text-sm text-zinc-500 italic">
          Aucune trame reçue de cet onduleur. Vérifie la passerelle Zigbee
          (ESP8266 + CC2530) et l&rsquo;appairage.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-3">
            {inv.panels
              .sort((a, b) => a.panelIndex - b.panelIndex)
              .map((p, idx, arr) => {
                // Le "jumeau" = panneau pair adjacent (même MPPT pour DUO)
                const peer =
                  p.panelIndex % 2 === 0
                    ? arr.find((q) => q.panelIndex === p.panelIndex + 1) ?? null
                    : arr.find((q) => q.panelIndex === p.panelIndex - 1) ?? null;
                return (
                  <PanelTile
                    key={p.panelIndex}
                    panel={p}
                    peer={peer}
                    color={PANEL_COLORS[idx % PANEL_COLORS.length]}
                  />
                );
              })}
          </div>

          {chartData.length > 0 && (
            <div className="h-56 sm:h-64 -mx-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chartData}
                  margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                >
                  <defs>
                    {panelKeys.map((k, i) => (
                      <linearGradient
                        key={k}
                        id={`g-${inv.id}-${k}`}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor={PANEL_COLORS[i % PANEL_COLORS.length]}
                          stopOpacity={0.4}
                        />
                        <stop
                          offset="100%"
                          stopColor={PANEL_COLORS[i % PANEL_COLORS.length]}
                          stopOpacity={0}
                        />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid
                    strokeDasharray="2 4"
                    stroke="rgba(255,255,255,0.05)"
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "#a1a1aa", fontSize: 10 }}
                    axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                    tickLine={false}
                    minTickGap={32}
                  />
                  <YAxis
                    tick={{ fill: "#a1a1aa", fontSize: 10 }}
                    axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                    tickLine={false}
                    width={36}
                    tickFormatter={(v: number) => `${v} W`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#0a0a0aee",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 8,
                      fontSize: 11,
                    }}
                    labelStyle={{ color: "#a1a1aa" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                  {panelKeys.map((k, i) => (
                    <Area
                      key={k}
                      type="monotone"
                      dataKey={k}
                      name={`Panneau ${k.slice(1)}`}
                      stroke={PANEL_COLORS[i % PANEL_COLORS.length]}
                      strokeWidth={2}
                      fill={`url(#g-${inv.id}-${k})`}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default function SolarDashboard({ inverters, series, alerts }: Props) {
  const totalW = inverters.reduce(
    (acc, inv) => acc + inv.panels.reduce((a, p) => a + (p.pW ?? 0), 0),
    0,
  );
  const totalToday = inverters.reduce((acc, inv) => acc + inv.todayWh, 0);
  const totalPanels = inverters.reduce((acc, inv) => acc + inv.panels.length, 0);

  return (
    <div className="space-y-5 sm:space-y-6 max-w-[1320px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h1 className="page-h1">Production solaire</h1>
          <p className="page-sub mt-1">
            Surveillance par panneau et par micro-onduleur (APSystems DS3 via
            passerelle Zigbee).
          </p>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-400">
          <span>
            <span className="text-zinc-500">Production · </span>
            <span className="text-emerald-300 font-semibold tabular-nums">
              {Math.round(totalW)} W
            </span>
          </span>
          <span>
            <span className="text-zinc-500">Aujourd&rsquo;hui · </span>
            <span className="text-emerald-300 font-semibold tabular-nums">
              {fmtKwh(totalToday)}
            </span>
          </span>
          <span>
            <span className="text-zinc-500">{totalPanels} panneaux · </span>
            <span className="text-zinc-200 tabular-nums">{inverters.length} onduleurs</span>
          </span>
        </div>
      </div>

      {alerts.length > 0 && (
        <section className="space-y-2">
          {alerts.map((a) => {
            const sev = SEVERITY[a.severity];
            return (
              <div
                key={a.id}
                className={`rounded-xl ring-1 ${sev.ring} ${sev.bg} p-3 flex items-start gap-3`}
              >
                <span className={`chip border-0 ${sev.text} ${sev.bg}`}>
                  {a.severity}
                </span>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium ${sev.text}`}>
                    {a.deviceName}
                    {a.panelIndex !== null ? ` · Panneau ${a.panelIndex + 1}` : ""}
                  </div>
                  <div className="text-xs text-zinc-300 truncate">{a.message}</div>
                </div>
                <span className="text-[10px] text-zinc-500 shrink-0">
                  {fmtAgo(a.startedAt)}
                </span>
              </div>
            );
          })}
        </section>
      )}

      {inverters.length === 0 ? (
        <div className="card text-sm text-zinc-400 space-y-2">
          <div>Aucun onduleur APSystems déclaré.</div>
          <div className="text-zinc-500 text-xs">
            Crée un équipement de type{" "}
            <code className="text-zinc-300">APSYSTEMS_INVERTER</code> et de
            rôle <code className="text-zinc-300">SOLAR_INVERTER</code> dans{" "}
            <a href="/devices" className="text-emerald-400 underline">
              /devices
            </a>
            . L&rsquo;<code>externalId</code> doit être le SN du DS3 (ex:{" "}
            <code className="text-zinc-300 font-mono">406000123456</code>).
            Pour tester sans matos, lance le worker avec{" "}
            <code className="text-zinc-300">APSYSTEMS_MOCK=1</code>.
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {inverters.map((inv) => (
            <InverterPanel
              key={inv.id}
              inv={inv}
              series={series.find((s) => s.inverterId === inv.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
