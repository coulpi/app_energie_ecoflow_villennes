"use client";

// Réplique de l'écran ESPHome tabscreen1 (esphome/tabscreen1.yaml) : mêmes
// coordonnées (480 × 480), couleurs et règles d'affichage, alimentée par les
// mêmes routes /api/screen*. Toute évolution du YAML doit être reportée ici.

import { useEffect, useRef, useState } from "react";

interface Live {
  prod: number;
  conso: number;
  grid: number;
  aux: number;
  soc: number;
  bat: number;
  tempo: string;
  tempo_dem: string;
  temp: number;
  meteo: string;
  jac_t: number;
  jac_c: number;
  jac_h: number;
  jac_f: number;
  jac_w: number;
}
interface Chart {
  max: number;
  p: number[];
  c: number[];
}
interface Solar {
  w: number[];
  s: number[];
  z0: number;
  z1: number;
  on: number;
}
interface Status {
  ageS: number | null;
  firmware: string | null;
}

const C = {
  bg: "#0D1117",
  card: "#161B22",
  border: "#30363D",
  sep: "#21262D",
  muted: "#8B949E",
  white: "#FFFFFF",
  green: "#3FB950",
  blue: "#58A6FF",
  purple: "#A371F7",
  orange: "#F0883E",
  red: "#F85149",
  cyan: "#22D3EE",
};

const TEMPO: Record<string, { bg: string; fg: string; label: string }> = {
  BLUE: { bg: "#1F6FEB", fg: "#FFFFFF", label: "BLEU" },
  WHITE: { bg: "#E6EDF3", fg: "#0D1117", label: "BLANC" },
  RED: { bg: "#DA3633", fg: "#FFFFFF", label: "ROUGE" },
};

const METEO: Record<string, [string, string]> = {
  sunny: ["☀️", "Ensoleille"],
  "clear-night": ["🌙", "Nuit claire"],
  partlycloudy: ["⛅", "Partiell. nuageux"],
  cloudy: ["☁️", "Nuageux"],
  rainy: ["🌧️", "Pluvieux"],
  pouring: ["🌧️", "Fortes pluies"],
  snowy: ["❄️", "Neigeux"],
  fog: ["🌫️", "Brouillard"],
  lightning: ["🌩️", "Orageux"],
  "lightning-rainy": ["⛈️", "Orage et pluie"],
  windy: ["💨", "Venteux"],
  hail: ["🌨️", "Grele"],
};

const PAGES = ["Temps réel", "Jacuzzi · 24 h", "Panneaux"] as const;
const ZONES = [
  { title: "JARDIN", sns: ["201323", "724293", "728874"], y: 44 },
  { title: "ABRI", sns: ["988780", "198170", "197256"], y: 244 },
];

function useJson<T>(url: string, everyMs: number): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (r.ok && alive) setData((await r.json()) as T);
      } catch {
        // on garde la dernière valeur, comme l'écran
      }
    };
    void load();
    const t = setInterval(load, everyMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [url, everyMs]);
  return data;
}

// Texte positionné par son bord haut, comme LVGL.
function T({
  x,
  y,
  size,
  color,
  anchor = "start",
  weight = 500,
  children,
}: {
  x: number;
  y: number;
  size: number;
  color: string;
  anchor?: "start" | "middle" | "end";
  weight?: number;
  children: React.ReactNode;
}) {
  return (
    <text
      x={x}
      y={y}
      fontSize={size}
      fill={color}
      textAnchor={anchor}
      dominantBaseline="hanging"
      fontWeight={weight}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {children}
    </text>
  );
}

function Card({
  x,
  y,
  w,
  h,
  bg = C.card,
  border = C.border,
  r = 16,
  sw = 1,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  bg?: string;
  border?: string;
  r?: number;
  sw?: number;
}) {
  return <rect x={x + 0.5} y={y + 0.5} width={w - 1} height={h - 1} rx={r} fill={bg} stroke={border} strokeWidth={sw} />;
}

// Bandeau des pages 2 et 3 : conso à gauche, achat/injection réseau à droite
// (rouge = achat, vert = injection), mêmes règles que la carte de la page 1.
function GridBand({ d }: { d: Live | null }) {
  const g = d?.grid ?? 0;
  const buying = !!d && g > 30;
  const selling = !!d && g < -30;
  return (
    <g>
      <rect x={10.5} y={6.5} width={149} height={29} rx={14.5} fill={C.card} stroke={C.border} />
      <T x={85} y={14} size={14} color="#C9D1D9" anchor="middle">
        {d ? `conso ${d.conso} W` : "conso --"}
      </T>
      <rect
        x={300.5}
        y={6.5}
        width={169}
        height={29}
        rx={14.5}
        fill={buying ? "#5C1A1A" : selling ? "#1A3D2B" : C.card}
        stroke={buying ? "#F78166" : selling ? C.green : C.border}
      />
      <T x={385} y={13} size={16} color={C.white} anchor="middle" weight={600}>
        {!d ? "RESEAU --" : buying ? `ACHAT ${g} W` : selling ? `INJECT. ${-g} W` : `RESEAU ${g} W`}
      </T>
    </g>
  );
}

const hhmm = (d: Date) =>
  d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });

function Page1({ d, now }: { d: Live | null; now: Date }) {
  const date = now
    .toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Paris" })
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  const g = d?.grid ?? 0;
  const buying = !!d && g > 30;
  const selling = !!d && g < -30;
  const [icon, label] = d && METEO[d.meteo] ? METEO[d.meteo]! : ["❔", d ? "indisponible" : "chargement"];
  const today = TEMPO[d?.tempo ?? ""];
  const tomorrow = TEMPO[d?.tempo_dem ?? ""];
  const soc = d && d.soc >= 0 ? d.soc : null;
  const socColor = soc === null ? C.purple : soc < 20 ? C.red : soc < 50 ? "#D29922" : C.green;
  const base = soc === null ? 0 : (soc * 52) / 100;
  const bat = d?.bat ?? 0;
  return (
    <g>
      <T x={240} y={45} size={48} color={C.white} anchor="middle" weight={600}>
        {hhmm(now)}
      </T>
      <T x={240} y={115} size={16} color={C.muted} anchor="middle">
        {date}
      </T>
      <rect x={20} y={148} width={440} height={2} fill={C.sep} />

      {/* Météo + Tempo */}
      <Card x={10} y={162} w={220} h={308} />
      <T x={120} y={180} size={14} color={C.blue} anchor="middle" weight={600}>
        METEO
      </T>
      <T x={120} y={204} size={44} color={C.blue} anchor="middle">
        {icon}
      </T>
      <T x={120} y={264} size={16} color="#A0B4CC" anchor="middle">
        {label}
      </T>
      <T x={120} y={290} size={22} color={C.white} anchor="middle" weight={600}>
        {d && d.temp > -98 ? `${d.temp.toFixed(1)}°C` : "--°C"}
      </T>
      <rect x={35} y={328} width={170} height={1} fill={C.border} />
      <T x={120} y={340} size={14} color={C.muted} anchor="middle">
        TEMPO
      </T>
      <rect x={30} y={364} width={180} height={38} rx={19} fill={today?.bg ?? C.border} />
      <T x={120} y={375} size={16} color={today?.fg ?? C.white} anchor="middle" weight={600}>
        {`Auj. ${today?.label ?? "--"}`}
      </T>
      <rect x={30} y={412} width={180} height={30} rx={15} fill={tomorrow?.bg ?? C.border} />
      <T x={120} y={420} size={14} color={tomorrow?.fg ?? C.white} anchor="middle">
        {`Demain ${tomorrow?.label ?? "--"}`}
      </T>

      {/* Production */}
      <Card x={245} y={162} w={225} h={96} />
      <T x={357} y={172} size={14} color={C.green} anchor="middle" weight={600}>
        PRODUCTION
      </T>
      <T x={357} y={194} size={32} color={C.green} anchor="middle" weight={600}>
        {d ? d.prod : "--"}
      </T>
      <T x={357} y={236} size={12} color={C.muted} anchor="middle">
        Watts
      </T>

      {/* Réseau (achat / injection en gros, conso en petit) */}
      <Card
        x={245}
        y={266}
        w={225}
        h={96}
        bg={buying ? "#5C1A1A" : selling ? "#1A3D2B" : C.card}
        border={buying ? "#F78166" : selling ? C.green : C.border}
      />
      <T x={357} y={276} size={14} color={C.white} anchor="middle" weight={600}>
        {buying ? "ACHAT RESEAU" : selling ? "INJECTION" : "RESEAU"}
      </T>
      <T x={357} y={298} size={32} color={C.white} anchor="middle" weight={600}>
        {d ? `${Math.abs(g)} W` : "--"}
      </T>
      <T x={357} y={340} size={12} color="#C9D1D9" anchor="middle">
        {d ? `conso ${d.conso} W` : "appli injoignable"}
      </T>

      {/* Batterie */}
      <Card x={245} y={370} w={225} h={100} />
      <T x={357} y={378} size={14} color={C.purple} anchor="middle" weight={600}>
        BATTERIE
      </T>
      <rect x={262} y={407} width={56} height={28} rx={5} fill="none" stroke={C.muted} strokeWidth={2} />
      <rect x={319} y={415} width={4} height={12} rx={1} fill={C.muted} />
      <rect x={264} y={409} height={24} rx={3} width={base} fill={bat < -30 ? C.green : bat > 30 ? C.orange : socColor}>
        {bat < -30 && <animate attributeName="width" from={base} to={52} dur="1.6s" repeatCount="indefinite" />}
        {bat > 30 && <animate attributeName="width" from={base} to={0} dur="1.6s" repeatCount="indefinite" />}
      </rect>
      <T x={337} y={400} size={32} color={socColor} weight={600}>
        {soc === null ? "--" : `${soc} %`}
      </T>
      <T x={357} y={448} size={12} color={C.muted} anchor="middle">
        {!d ? "--" : bat > 30 ? `decharge ${bat} W` : bat < -30 ? `charge ${-bat} W` : "veille"}
      </T>
    </g>
  );
}

function Page2({ d, chart, now }: { d: Live | null; chart: Chart | null; now: Date }) {
  const pts = (arr: number[] | undefined) => {
    if (!arr || arr.length < 2 || !chart) return "";
    const n = arr.length;
    return arr
      .map((v, i) => {
        const w = Math.min(chart.max, Math.max(0, v));
        return `${30 + (i * 420) / (n - 1)},${260 + 170 - (w * 170) / chart.max}`;
      })
      .join(" ");
  };
  const heat = d?.jac_h ?? -1;
  const filt = d?.jac_f ?? -1;
  const mx = chart?.max ?? 0;
  return (
    <g>
      <T x={240} y={10} size={22} color={C.muted} anchor="middle">
        {hhmm(now)}
      </T>
      <GridBand d={d} />
      <Card x={10} y={46} w={460} h={154} />
      <T x={28} y={60} size={14} color={C.cyan} weight={600}>
        JACUZZI
      </T>
      <T x={28} y={92} size={48} color={heat === 1 ? C.orange : C.cyan} weight={600}>
        {d && d.jac_t > -98 ? `${d.jac_t.toFixed(1)}°C` : "--°C"}
      </T>
      <T x={28} y={158} size={14} color={C.muted}>
        {d && d.jac_c > -98 ? `consigne ${Math.round(d.jac_c)}°C` : "consigne --°C"}
      </T>
      <T x={260} y={76} size={18} color={heat === 1 ? C.orange : C.muted}>
        {heat === 1 ? "Chauffe ON" : heat === 0 ? "Chauffe OFF" : "Chauffe --"}
      </T>
      <T x={260} y={110} size={18} color={filt === 1 ? C.green : C.muted}>
        {filt === 1 ? "Filtration ON" : filt === 0 ? "Filtration OFF" : "Filtration --"}
      </T>
      <T x={260} y={144} size={18} color="#C9D1D9">
        {d ? `${d.jac_w} W` : "-- W"}
      </T>

      <Card x={10} y={210} w={460} h={260} />
      <T x={28} y={222} size={14} color={C.white} weight={600}>
        RESEAU 1 - 24 H
      </T>
      <T x={210} y={222} size={14} color={C.green}>
        production
      </T>
      <T x={325} y={222} size={14} color={C.orange}>
        conso
      </T>
      <T x={28} y={244} size={12} color={C.muted}>
        {mx >= 1000 ? `${(mx / 1000).toFixed(1)} kW` : mx > 0 ? `${mx} W` : "-- kW"}
      </T>
      <rect x={30} y={260} width={420} height={1} fill={C.sep} />
      <rect x={30} y={345} width={420} height={1} fill={C.sep} />
      <rect x={30} y={430} width={420} height={1} fill={C.border} />
      <polyline points={pts(chart?.c)} fill="none" stroke={C.orange} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <polyline points={pts(chart?.p)} fill="none" stroke={C.green} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
      <T x={28} y={438} size={12} color={C.muted}>
        -24 h
      </T>
      <T x={222} y={438} size={12} color={C.muted}>
        -12 h
      </T>
      <T x={396} y={438} size={12} color={C.muted}>
        maint.
      </T>
    </g>
  );
}

function Page3({ s, d, now }: { s: Solar | null; d: Live | null; now: Date }) {
  const TW = 68;
  const tileX = (i: number) => 16 + Math.floor(i / 2) * (2 * TW + 4 + 14) + (i % 2) * (TW + 4);
  const style = (st: number) =>
    st === 1
      ? { bg: "#12301F", border: C.green, txt: C.white }
      : st === 3
        ? { bg: "#3A1418", border: C.red, txt: C.red }
        : st === 2
          ? { bg: C.card, border: C.border, txt: "#C9D1D9" }
          : { bg: C.card, border: C.border, txt: C.muted };
  return (
    <g>
      <T x={240} y={10} size={22} color={C.muted} anchor="middle">
        {hhmm(now)}
      </T>
      <GridBand d={d} />
      {ZONES.map((z, zi) => (
        <g key={z.title}>
          <T x={16} y={z.y} size={16} color={C.white} weight={600}>
            {s ? `${z.title}   ${zi === 0 ? s.z0 : s.z1} W` : z.title}
          </T>
          {Array.from({ length: 6 }, (_, i) => {
            const n = zi * 6 + i;
            const st = s?.s[n] ?? 0;
            const w = s?.w[n] ?? -1;
            const c = style(st);
            return (
              <g key={i}>
                <Card x={tileX(i)} y={z.y + 28} w={TW} h={112} r={8} sw={2} bg={c.bg} border={c.border} />
                <T x={tileX(i) + TW / 2} y={z.y + 66} size={22} color={c.txt} anchor="middle" weight={600}>
                  {st === 0 || w < 0 ? "--" : w}
                </T>
                <T x={tileX(i) + TW / 2} y={z.y + 118} size={12} color={C.muted} anchor="middle">
                  {`P${(i % 2) + 1} W`}
                </T>
              </g>
            );
          })}
          {z.sns.map((sn, g) => (
            <T key={sn} x={16 + g * (2 * TW + 18) + TW} y={z.y + 146} size={12} color={C.muted} anchor="middle">
              {sn}
            </T>
          ))}
        </g>
      ))}
      <T x={240} y={448} size={16} color={C.green} anchor="middle">
        {s ? `Total ${s.z0 + s.z1} W  -  ${s.on}/12 en production` : "--"}
      </T>
    </g>
  );
}

export default function ScreenMirror() {
  const live = useJson<Live>("/api/screen", 5_000);
  const chart = useJson<Chart>("/api/screen/chart", 300_000);
  const solar = useJson<Solar>("/api/screen/solar", 60_000);
  const status = useJson<Status>("/api/screen/status", 10_000);
  const [page, setPage] = useState(0);
  const [auto, setAuto] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const lastClick = useRef(0);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(t);
  }, []);
  // Même règle que l'écran : page suivante toutes les 15 s, pause 1 min
  // après une action.
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => {
      if (Date.now() - lastClick.current > 60_000) setPage((p) => (p + 1) % PAGES.length);
    }, 15_000);
    return () => clearInterval(t);
  }, [auto]);

  const go = (p: number) => {
    lastClick.current = Date.now();
    setPage((p + PAGES.length) % PAGES.length);
  };
  const age = status?.ageS ?? null;
  const online = age !== null && age < 30;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,520px)_1fr] gap-5 items-start">
      <div className="space-y-3 min-w-0">
        <div className="rounded-[28px] p-3 sm:p-4 bg-zinc-950 ring-1 ring-white/[0.07] shadow-xl max-w-[520px]">
          <svg
            viewBox="0 0 480 480"
            className="w-full h-auto rounded-[14px] select-none cursor-pointer"
            style={{ background: C.bg, fontFamily: "Montserrat, ui-sans-serif, system-ui, sans-serif" }}
            role="img"
            aria-label={`Écran tabscreen1, page ${page + 1} : ${PAGES[page]}`}
            onClick={(e) => {
              const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              go(page + (e.clientX - r.left < r.width / 2 ? -1 : 1));
            }}
          >
            {page === 0 && <Page1 d={live} now={now} />}
            {page === 1 && <Page2 d={live} chart={chart} now={now} />}
            {page === 2 && <Page3 s={solar} d={live} now={now} />}
          </svg>
        </div>
        <div className="flex items-center justify-between gap-3 max-w-[520px] px-1">
          <div className="flex gap-1.5">
            {PAGES.map((p, i) => (
              <button
                key={p}
                onClick={() => go(i)}
                className={`chip ${i === page ? "!bg-emerald-500/15 !text-emerald-300 !border-emerald-500/40" : ""}`}
              >
                {i + 1} · {p}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-400 shrink-0">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            Défilement auto
          </label>
        </div>
      </div>

      <div className="card space-y-3 text-sm">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${online ? "bg-emerald-500" : "bg-rose-500"}`} />
          <span className="font-semibold text-zinc-100">
            {online ? "Écran connecté" : age === null ? "Écran pas encore vu" : "Écran silencieux"}
          </span>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
          <dt className="text-zinc-500">Dernière requête</dt>
          <dd className="text-zinc-300 tabular-nums">
            {age === null ? "—" : age < 60 ? `il y a ${age} s` : `il y a ${Math.round(age / 60)} min`}
          </dd>
          <dt className="text-zinc-500">Firmware</dt>
          <dd className="text-zinc-300">{status?.firmware ? `ESPHome ${status.firmware}` : "—"}</dd>
          <dt className="text-zinc-500">Appareil</dt>
          <dd className="text-zinc-300">tabscreen1 · 192.168.0.148 · ESP32-S3</dd>
          <dt className="text-zinc-500">Données</dt>
          <dd className="text-zinc-300 font-mono">/api/screen (5 s) · /chart (5 min) · /solar (1 min)</dd>
        </dl>
        <p className="text-xs text-zinc-500">
          Cliquez à gauche ou à droite de l&rsquo;écran pour changer de page, comme un balayage
          sur l&rsquo;appareil. Configuration : <code className="text-zinc-400">esphome/tabscreen1.yaml</code>.
        </p>
      </div>
    </div>
  );
}
