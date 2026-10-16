"use client";

import type { InverterCard } from "./SolarDashboard";

// Disposition physique des panneaux (de gauche à droite, vue de face).
// 1 micro-onduleur DS3 = 2 panneaux (panelIndex 0 à gauche, 1 à droite).
export const ARRAYS: Array<{ title: string; kind: "ground" | "roof"; sns: string[] }> = [
  { title: "Jardin · au sol", kind: "ground", sns: ["703000201323", "703000724293", "703000728874"] },
  { title: "Abri · toiture", kind: "roof", sns: ["703000988780", "703000198170", "703000197256"] },
];

const STALE_MS = 20 * 60_000; // ECU : relevé toutes les 5 min
const AC_MIN_V = 100;

type State = "prod" | "idle" | "noac" | "off";
const STATE: Record<State, { color: string; label: string }> = {
  prod: { color: "#10b981", label: "Production" },
  idle: { color: "#94a3b8", label: "0 W" },
  noac: { color: "#f43f5e", label: "Pas de réseau AC" },
  off: { color: "#64748b", label: "Indisponible" },
};

interface PanelView {
  w: number | null;
  state: State;
}

function panelsOf(inv: InverterCard | undefined): [PanelView, PanelView] {
  const off: PanelView = { w: null, state: "off" };
  if (!inv || inv.panels.length === 0) return [off, off];
  const last = Math.max(...inv.panels.map((p) => new Date(p.ts).getTime()));
  if (Date.now() - last > STALE_MS) return [off, off];
  const view = (i: number): PanelView => {
    const p = inv.panels.find((q) => q.panelIndex === i);
    if (!p) return off;
    const w = Math.max(0, Math.round(p.pW ?? 0));
    if (p.acV !== null && p.acV < AC_MIN_V) return { w, state: "noac" };
    return { w, state: w > 0 ? "prod" : "idle" };
  };
  return [view(0), view(1)];
}

// Géométrie (viewBox 640 × 250) : 3 paires de panneaux.
const PW = 92; // largeur d'un panneau
const PAIR_GAP = 4;
const GROUP_GAP = 16;
const X0 = 22;
const PANEL_TOP = 96;
const PANEL_BOT = 150;
const SKEW = 7;

const groupX = (g: number) => X0 + g * (2 * PW + PAIR_GAP + GROUP_GAP);
const panelX = (g: number, i: number) => groupX(g) + i * (PW + PAIR_GAP);

function Panel({ x, view }: { x: number; view: PanelView }) {
  const pts = `${x + SKEW},${PANEL_TOP} ${x + PW + SKEW},${PANEL_TOP} ${x + PW - SKEW},${PANEL_BOT} ${x - SKEW},${PANEL_BOT}`;
  const dim = view.state === "off";
  const cells = [1, 2, 3, 4, 5].map((k) => {
    const t = k / 6;
    return (
      <line
        key={k}
        x1={x + SKEW + PW * t}
        y1={PANEL_TOP}
        x2={x - SKEW + PW * t}
        y2={PANEL_BOT}
        stroke="#334155"
        strokeWidth={0.6}
      />
    );
  });
  return (
    <g opacity={dim ? 0.45 : 1}>
      <polygon points={pts} fill="url(#pv-glass)" stroke="#0b1220" strokeWidth={1.2} />
      {cells}
      <line
        x1={x}
        y1={(PANEL_TOP + PANEL_BOT) / 2}
        x2={x + PW}
        y2={(PANEL_TOP + PANEL_BOT) / 2}
        stroke="#334155"
        strokeWidth={0.6}
      />
      {view.state === "noac" && <polygon points={pts} fill="#f43f5e" opacity={0.18} />}
    </g>
  );
}

function Badge({ cx, view }: { cx: number; view: PanelView }) {
  const s = STATE[view.state];
  const off = view.state === "off";
  return (
    <g>
      <title>{off ? "Indisponible" : `${view.w} W · ${s.label}`}</title>
      <circle cx={cx} cy={46} r={23} fill="var(--card-solid)" stroke={s.color} strokeWidth={2.5} />
      <text
        x={cx}
        y={off ? 52 : 53}
        textAnchor="middle"
        fontSize={off ? 18 : 17}
        fontWeight={600}
        fill="var(--text)"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {off ? "—" : view.w}
      </text>
      <rect x={cx - (off ? 22 : 11)} y={63} width={off ? 44 : 22} height={13} rx={6.5} fill={s.color} />
      <text x={cx} y={72.5} textAnchor="middle" fontSize={8.5} fontWeight={700} fill="#fff">
        {off ? "Indispo." : "W"}
      </text>
    </g>
  );
}

function Structure({ kind }: { kind: "ground" | "roof" }) {
  if (kind === "ground") {
    const legs = [40, 140, 240, 330, 420, 520, 610];
    return (
      <g stroke="var(--text-3)" strokeWidth={2}>
        <line x1={10} y1={156} x2={632} y2={156} strokeWidth={4} stroke="#7c5a3a" />
        {legs.map((x) => (
          <g key={x}>
            <line x1={x} y1={158} x2={x} y2={192} />
            <rect x={x - 9} y={192} width={18} height={12} fill="var(--track)" stroke="var(--text-3)" strokeWidth={1} />
          </g>
        ))}
        <line x1={0} y1={204} x2={640} y2={204} stroke="#65a30d" strokeWidth={2} opacity={0.6} />
      </g>
    );
  }
  return (
    <g stroke="var(--text-3)" strokeWidth={2}>
      <line x1={4} y1={156} x2={636} y2={156} strokeWidth={5} stroke="var(--text-2)" />
      {[60, 210, 330, 450, 580].map((x) => (
        <line key={x} x1={x} y1={159} x2={x} y2={204} strokeWidth={5} stroke="var(--text-2)" />
      ))}
      <rect x={60} y={159} width={520} height={45} fill="var(--track)" stroke="none" />
      <rect x={255} y={170} width={60} height={34} fill="var(--card-solid)" stroke="var(--text-3)" strokeWidth={1} />
      <line x1={0} y1={204} x2={640} y2={204} stroke="var(--text-3)" strokeWidth={1.5} />
    </g>
  );
}

function ArrayCard({
  title,
  kind,
  sns,
  bySn,
}: {
  title: string;
  kind: "ground" | "roof";
  sns: string[];
  bySn: Map<string, InverterCard>;
}) {
  const groups = sns.map((sn) => ({ sn, inv: bySn.get(sn), panels: panelsOf(bySn.get(sn)) }));
  const totalW = groups.reduce((a, g) => a + g.panels.reduce((b, p) => b + (p.w ?? 0), 0), 0);
  const producing = groups.reduce((a, g) => a + g.panels.filter((p) => p.state === "prod").length, 0);
  return (
    <div className="card !p-3 sm:!p-4 min-w-0">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
        <span className="text-xs text-zinc-500 tabular-nums">
          <span className="text-emerald-300 font-semibold">{totalW} W</span> · {producing}/
          {groups.length * 2} panneaux en production
        </span>
      </div>
      <svg viewBox="0 0 640 250" className="w-full h-auto mt-1" role="img" aria-label={`Schéma ${title}`}>
        <defs>
          <linearGradient id="pv-glass" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#334a6e" />
            <stop offset="0.45" stopColor="#1b2a44" />
            <stop offset="1" stopColor="#0f1a2e" />
          </linearGradient>
        </defs>
        <Structure kind={kind} />
        {groups.map((g, gi) => {
          const cx = groupX(gi) + PW + PAIR_GAP / 2;
          const muted = g.panels.every((p) => p.state === "off");
          return (
            <a key={g.sn} href={g.inv ? `#inv-${g.sn}` : undefined}>
              <title>{g.inv ? `${g.inv.name} — voir le détail` : `${g.sn} (non déclaré)`}</title>
              {g.panels.map((p, i) => (
                <Panel key={i} x={panelX(gi, i)} view={p} />
              ))}
              {g.panels.map((p, i) => (
                <Badge key={i} cx={panelX(gi, i) + PW / 2} view={p} />
              ))}
              <rect
                x={cx - 62}
                y={214}
                width={124}
                height={24}
                rx={4}
                fill="var(--card-solid)"
                stroke="var(--hairline)"
              />
              <text
                x={cx}
                y={230.5}
                textAnchor="middle"
                fontSize={12.5}
                fontFamily="ui-monospace, monospace"
                fill={muted ? "var(--text-3)" : "var(--text)"}
              >
                {g.sn}
              </text>
            </a>
          );
        })}
      </svg>
    </div>
  );
}

export default function SolarLayout({ inverters }: { inverters: InverterCard[] }) {
  const bySn = new Map(inverters.map((i) => [i.sn, i]));
  const placed = new Set(ARRAYS.flatMap((a) => a.sns));
  const others = inverters.filter((i) => !placed.has(i.sn));
  return (
    <section className="space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {ARRAYS.map((a) => (
          <ArrayCard key={a.title} {...a} bySn={bySn} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-zinc-500">
        {(Object.keys(STATE) as State[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: STATE[k].color }} />
            {STATE[k].label}
          </span>
        ))}
        {others.length > 0 && (
          <span className="sm:ml-auto">
            Hors schéma :{" "}
            {others.map((i, k) => {
              const [a, b] = panelsOf(i);
              const w = (a.w ?? 0) + (b.w ?? 0);
              return (
                <a key={i.sn} href={`#inv-${i.sn}`} className="font-mono text-zinc-400 hover:underline">
                  {k > 0 && ", "}
                  {i.sn} ({a.state === "off" ? "indispo." : a.state === "noac" ? "pas de réseau AC" : `${w} W`})
                </a>
              );
            })}
          </span>
        )}
      </div>
    </section>
  );
}
