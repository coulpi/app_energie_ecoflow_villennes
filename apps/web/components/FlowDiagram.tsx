// Schéma des flux d'énergie, style « cartes » : chaque source / usage est
// une carte illustrée, reliée par des connecteurs fléchés animés portant
// la puissance qui y circule. Deux réseaux :
//   - Réseau 1 (maison) : solaire, réseau 1, maison, équipements maison ;
//   - Réseau 2 (piscine + jacuzzi) : réseau 2, piscine/spa, équipements.
// La batterie est à cheval : charge depuis le réseau 2 (prise AC IN),
// décharge vers la maison (PowerStream).
// Desktop/tablette : SVG (viewBox fixe, mis à l'échelle). Mobile : cartes
// HTML empilées, lisibles sans zoom. Couleurs = variables CSS de thème.

export interface FlowLoad {
  id: string;
  name: string;
  expectedW: number;
  currentlyOn: boolean;
  source?: "measured" | "heuristic" | "out-of-window";
  measuredW?: number;
}

export interface FlowData {
  production: number;
  consumption: number; // réseau 1
  gridFlow: number; // réseau 1 : + import, − export
  batteryFlow: number; // + charge, − décharge
  batteryLevel: number | null; // %
  auxNetworkW: number | null; // réseau 2 (mesure pince), null = non mesuré
  loads: FlowLoad[];
}

// Piscine et jacuzzi sont sur le réseau 2 : leurs profils de charge sont
// rattachés au nœud de ce réseau, pas à la maison.
const AUX_LOAD_RE = /piscine|jacuzzi|\bspa\b|pool/i;
export const isAuxLoad = (p: { id: string; name: string }) =>
  AUX_LOAD_RE.test(`${p.id} ${p.name}`);
export const loadPower = (p: FlowLoad) =>
  p.source === "measured" && typeof p.measuredW === "number" ? p.measuredW : p.expectedW;

const C = {
  solar: "var(--flow-solar)",
  home: "var(--flow-home)",
  grid: "var(--flow-grid)",
  battery: "var(--flow-battery)",
  import: "var(--flow-import)",
  aux: "var(--flow-aux)",
  dim: "var(--flow-dim)",
  text: "var(--text)",
  text2: "var(--text-2)",
  text3: "var(--text-3)",
};

function fmt(w: number): string {
  const a = Math.abs(w);
  return a >= 1000
    ? `${(a / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 2, minimumFractionDigits: 1 })} kW`
    : `${Math.round(a)} W`;
}

interface Model {
  solarToHome: number;
  gridImport: number;
  gridExport: number;
  batteryToHome: number;
  auxToBattery: number;
  aux: number;
  auxMeasured: boolean;
  homeLoads: FlowLoad[];
  auxLoads: FlowLoad[];
}

function model(d: FlowData): Model {
  const gridImport = Math.max(0, d.gridFlow);
  const gridExport = Math.max(0, -d.gridFlow);
  const batteryToHome = Math.max(0, -d.batteryFlow);
  const auxToBattery = Math.max(0, d.batteryFlow);
  const homeLoads = d.loads.filter((p) => !isAuxLoad(p));
  const auxLoads = d.loads.filter(isAuxLoad);
  const auxMeasured = d.auxNetworkW !== null;
  const aux = Math.round(
    auxMeasured
      ? Math.max(0, d.auxNetworkW!)
      : auxLoads.reduce((s, p) => s + (p.currentlyOn ? loadPower(p) : 0), 0) + auxToBattery,
  );
  // La maison est un nœud passif : le solaire qui y entre = conso + export,
  // borné par la production.
  const solarToHome = Math.max(0, Math.min(d.production, Math.max(0, d.consumption) + gridExport));
  return { solarToHome, gridImport, gridExport, batteryToHome, auxToBattery, aux, auxMeasured, homeLoads, auxLoads };
}

export default function FlowDiagram({ data }: { data: FlowData }) {
  const m = model(data);
  return (
    <>
      <div className="hidden md:block">
        <FlowSvg d={data} m={m} />
      </div>
      <div className="md:hidden">
        <FlowCompact d={data} m={m} />
      </div>
    </>
  );
}

// ── Version SVG (md+) ───────────────────────────────────────────────

const W = 1000;
const H = 900;

function FlowSvg({ d, m }: { d: FlowData; m: Model }) {
  const soc = d.batteryLevel;
  const eqW = 150;
  const eqGap = 26;
  const row = (n: number, i: number) => 500 - ((n * eqW + (n - 1) * eqGap) / 2) + i * (eqW + eqGap);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto block"
      role="img"
      aria-label="Schéma des flux d'énergie : solaire, réseau 1, maison, batterie, réseau 2, piscine et jacuzzi"
    >
      <defs>
        <filter id="fd-shadow" x="-10%" y="-10%" width="120%" height="140%">
          <feDropShadow dx="0" dy="3" stdDeviation="6" floodColor="#0f172a" floodOpacity="0.07" />
        </filter>
      </defs>

      {/* Périmètres des 2 réseaux */}
      <Zone x={8} y={8} w={984} h={492} color={C.grid} label="Réseau 1 · maison" />
      <Zone x={8} y={522} w={984} h={370} color={C.aux} label="Réseau 2 · piscine + jacuzzi" />

      {/* ── Connecteurs réseau 1 ── */}
      <Link d="M 500 112 L 500 168" color={C.solar} power={m.solarToHome} arrow="down" lx={514} ly={146} anchor="start" />
      <Link d="M 252 232 L 400 232" color={C.import} power={m.gridImport} arrow="right" lx={326} ly={220} label={m.gridImport > 0 ? `Achat ${fmt(m.gridImport)}` : undefined} />
      <Link d="M 400 272 L 252 272" color={C.grid} power={m.gridExport} arrow="left" lx={326} ly={292} label={m.gridExport > 0 ? `Injection ${fmt(m.gridExport)}` : undefined} />
      <Link d="M 748 250 L 600 250" color={C.battery} power={m.batteryToHome} arrow="left" lx={674} ly={238} label={m.batteryToHome > 0 ? `Décharge ${fmt(m.batteryToHome)}` : undefined} />

      {/* Branches maison → équipements du réseau 1 */}
      {m.homeLoads.length > 0 && (
        <Tree
          fromX={500}
          fromY={352}
          busY={386}
          toY={410}
          xs={m.homeLoads.map((_, i) => row(m.homeLoads.length, i) + eqW / 2)}
          color={C.home}
          active={m.homeLoads.map((p) => p.currentlyOn)}
        />
      )}

      {/* ── Connecteurs réseau 2 ── */}
      <Link d="M 252 640 L 388 640" color={C.import} power={m.aux} arrow="right" lx={320} ly={628} label={m.aux > 0 ? `Achat ${fmt(m.aux)}` : undefined} />
      <Link
        d="M 612 640 L 864 640 L 864 314"
        color={C.battery}
        power={m.auxToBattery}
        arrow="up"
        lx={740}
        ly={628}
        label={m.auxToBattery > 0 ? `Charge ${fmt(m.auxToBattery)}` : undefined}
      />
      {m.auxLoads.length > 0 && (
        <Tree
          fromX={500}
          fromY={700}
          busY={734}
          toY={758}
          xs={m.auxLoads.map((_, i) => row(m.auxLoads.length, i) + eqW / 2)}
          color={C.aux}
          active={m.auxLoads.map((p) => p.currentlyOn)}
        />
      )}

      {/* ── Cartes ── */}
      <Card x={390} y={20} w={220} h={92} active={d.production > 0} color={C.solar}>
        <SolarArt x={406} y={42} />
        <CardText x={486} y={52} title="Panneaux solaires" value={fmt(d.production)} color={C.solar} active={d.production > 0} />
      </Card>

      <Card x={20} y={186} w={232} h={130} active={m.gridImport > 0 || m.gridExport > 0} color={m.gridImport > 0 ? C.import : C.grid}>
        <PylonArt x={40} y={206} color={m.gridImport > 0 ? C.import : C.grid} />
        <CardText
          x={104}
          y={218}
          title="Réseau 1"
          value={fmt(m.gridImport || m.gridExport)}
          color={m.gridImport > 0 ? C.import : C.grid}
          active={m.gridImport > 0 || m.gridExport > 0}
        />
        <text x={104} y={276} style={{ font: "500 12px ui-sans-serif, system-ui", fill: C.text2 }}>
          Achat : {fmt(m.gridImport)}
        </text>
        <text x={104} y={294} style={{ font: "500 12px ui-sans-serif, system-ui", fill: C.text2 }}>
          Injection : {fmt(m.gridExport)}
        </text>
      </Card>

      <HouseArt cx={500} y={168} />
      <Card x={404} y={298} w={192} h={54} active={d.consumption > 0} color={C.home}>
        <text x={500} y={319} textAnchor="middle" style={{ font: "600 12px ui-sans-serif, system-ui", fill: C.text2 }}>
          Maison
        </text>
        <text x={500} y={341} textAnchor="middle" style={{ font: "700 18px ui-sans-serif, system-ui", fill: C.text }}>
          {fmt(d.consumption)}
        </text>
      </Card>

      <Card x={748} y={186} w={232} h={128} active={d.batteryFlow !== 0} color={C.battery}>
        <BatteryArt x={768} y={202} level={soc} />
        <CardText
          x={828}
          y={218}
          title="Batterie"
          value={d.batteryFlow === 0 ? "Veille" : fmt(d.batteryFlow)}
          color={C.battery}
          active={d.batteryFlow !== 0}
        />
        <text x={828} y={278} style={{ font: "600 15px ui-sans-serif, system-ui", fill: soc !== null && soc <= 20 ? C.import : C.home }}>
          {soc === null ? "—" : `${soc} %`}
        </text>
        <text x={828} y={298} style={{ font: "500 12px ui-sans-serif, system-ui", fill: C.text2 }}>
          {d.batteryFlow > 0 ? "En charge (R2)" : d.batteryFlow < 0 ? "Vers la maison" : "Delta Max 2000"}
        </text>
      </Card>

      {m.homeLoads.map((p, i) => (
        <EquipmentCard key={p.id} x={row(m.homeLoads.length, i)} y={410} w={eqW} load={p} color={C.home} />
      ))}

      <Card x={20} y={584} w={232} h={112} active={m.aux > 0} color={m.aux > 0 ? C.import : C.grid}>
        <PylonArt x={40} y={604} color={m.aux > 0 ? C.import : C.grid} />
        <CardText x={104} y={616} title="Réseau 2" value={fmt(m.aux)} color={m.aux > 0 ? C.import : C.grid} active={m.aux > 0} />
        <text x={104} y={676} style={{ font: "500 12px ui-sans-serif, system-ui", fill: C.text2 }}>
          {m.auxMeasured ? "Compteur dédié" : "Estimé (prises)"}
        </text>
      </Card>

      <Card x={388} y={580} w={224} h={120} active={m.aux > 0} color={C.aux}>
        <PoolArt x={404} y={598} />
        <CardText x={490} y={612} title="Piscine · spa" value={fmt(m.aux)} color={C.aux} active={m.aux > 0} />
        <text x={490} y={672} style={{ font: "500 12px ui-sans-serif, system-ui", fill: C.text2 }}>
          {m.auxLoads.filter((p) => p.currentlyOn).length} actif(s) sur {m.auxLoads.length}
        </text>
      </Card>

      {m.auxLoads.map((p, i) => (
        <EquipmentCard key={p.id} x={row(m.auxLoads.length, i)} y={758} w={eqW} load={p} color={C.aux} />
      ))}
    </svg>
  );
}

function Zone({ x, y, w, h, color, label }: { x: number; y: number; w: number; h: number; color: string; label: string }) {
  return (
    <g style={{ pointerEvents: "none" }}>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={20}
        style={{ fill: `color-mix(in srgb, ${color} 4%, transparent)`, stroke: `color-mix(in srgb, ${color} 35%, transparent)` }}
        strokeWidth={1.2}
        strokeDasharray="6 6"
      />
      <text x={x + 18} y={y + 24} style={{ font: "700 10px ui-sans-serif, system-ui", letterSpacing: "0.16em", fill: color, textTransform: "uppercase" }}>
        {label}
      </text>
    </g>
  );
}

function Card({
  x,
  y,
  w,
  h,
  active,
  color,
  children,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  active: boolean;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={14}
        filter="url(#fd-shadow)"
        style={{ fill: "var(--node-bg)", stroke: active ? `color-mix(in srgb, ${color} 55%, transparent)` : "var(--node-border)" }}
        strokeWidth={active ? 1.6 : 1}
      />
      {children}
    </g>
  );
}

function CardText({
  x,
  y,
  title,
  value,
  color,
  active,
}: {
  x: number;
  y: number;
  title: string;
  value: string;
  color: string;
  active: boolean;
}) {
  return (
    <>
      <text x={x} y={y} style={{ font: "600 13px ui-sans-serif, system-ui", fill: C.text }}>
        {title}
      </text>
      <text x={x} y={y + 30} style={{ font: "700 24px ui-sans-serif, system-ui", fill: active ? color : C.text3 }}>
        {value}
      </text>
    </>
  );
}

/** Connecteur fléché animé ; grisé et pointillé quand rien ne circule. */
function Link({
  d,
  color,
  power,
  arrow,
  lx,
  ly,
  label,
  anchor = "middle",
}: {
  d: string;
  color: string;
  power: number;
  arrow: "up" | "down" | "left" | "right";
  lx: number;
  ly: number;
  label?: string;
  anchor?: "start" | "middle";
}) {
  const on = power > 0;
  const end = d.trim().split(/\s+/).slice(-2).map(Number) as [number, number];
  const speed = Math.max(0.6, 2.2 - Math.min(1, power / 2000) * 1.6);
  const text = label ?? (on ? fmt(power) : undefined);
  return (
    <g>
      <path d={d} fill="none" style={{ stroke: on ? color : C.dim }} strokeWidth={on ? 2.6 : 1.6} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={on ? "7 7" : "3 6"}>
        {on && <animate attributeName="stroke-dashoffset" from="28" to="0" dur={`${speed}s`} repeatCount="indefinite" />}
      </path>
      {on && <Arrow x={end[0]} y={end[1]} dir={arrow} color={color} />}
      {text && (
        <text x={lx} y={ly} textAnchor={anchor} style={{ font: "700 13px ui-sans-serif, system-ui", fill: color, paintOrder: "stroke", stroke: "var(--node-bg)", strokeWidth: 4 }}>
          {text}
        </text>
      )}
    </g>
  );
}

function Arrow({ x, y, dir, color }: { x: number; y: number; dir: "up" | "down" | "left" | "right"; color: string }) {
  const s = 7;
  const pts = {
    right: `${x},${y} ${x - s * 1.4},${y - s} ${x - s * 1.4},${y + s}`,
    left: `${x},${y} ${x + s * 1.4},${y - s} ${x + s * 1.4},${y + s}`,
    down: `${x},${y} ${x - s},${y - s * 1.4} ${x + s},${y - s * 1.4}`,
    up: `${x},${y} ${x - s},${y + s * 1.4} ${x + s},${y + s * 1.4}`,
  }[dir];
  return <polygon points={pts} style={{ fill: color }} />;
}

/** Bus en arbre : du nœud parent vers une rangée de cartes équipements. */
function Tree({
  fromX,
  fromY,
  busY,
  toY,
  xs,
  color,
  active,
}: {
  fromX: number;
  fromY: number;
  busY: number;
  toY: number;
  xs: number[];
  color: string;
  active: boolean[];
}) {
  const anyOn = active.some(Boolean);
  const minX = Math.min(...xs, fromX);
  const maxX = Math.max(...xs, fromX);
  return (
    <g fill="none" strokeLinecap="round">
      <path d={`M ${fromX} ${fromY} L ${fromX} ${busY} M ${minX} ${busY} L ${maxX} ${busY}`} style={{ stroke: anyOn ? color : C.dim }} strokeWidth={anyOn ? 2.2 : 1.4} />
      {xs.map((x, i) => (
        <g key={i}>
          <path d={`M ${x} ${busY} L ${x} ${toY - 2}`} style={{ stroke: active[i] ? color : C.dim }} strokeWidth={active[i] ? 2.2 : 1.4} strokeDasharray={active[i] ? undefined : "3 5"} />
          {active[i] && <Arrow x={x} y={toY - 1} dir="down" color={color} />}
        </g>
      ))}
    </g>
  );
}

function EquipmentCard({ x, y, w, load, color }: { x: number; y: number; w: number; load: FlowLoad; color: string }) {
  const on = load.currentlyOn;
  const p = loadPower(load);
  return (
    <Card x={x} y={y} w={w} h={64} active={on} color={color}>
      <circle cx={x + 24} cy={y + 32} r={14} style={{ fill: `color-mix(in srgb, ${color} ${on ? 16 : 6}%, transparent)` }} />
      <g transform={`translate(${x + 24} ${y + 32})`} style={{ color: on ? color : C.text3 }}>
        <EquipGlyph name={load.name} />
      </g>
      <text x={x + 46} y={y + 27} style={{ font: "600 11.5px ui-sans-serif, system-ui", fill: C.text }}>
        {load.name.length > 15 ? `${load.name.slice(0, 14)}…` : load.name}
      </text>
      <text x={x + 46} y={y + 47} style={{ font: "700 15px ui-sans-serif, system-ui", fill: on ? color : C.text3 }}>
        {on ? fmt(p) : "Arrêt"}
      </text>
    </Card>
  );
}

function EquipGlyph({ name }: { name: string }) {
  const s = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (/voiture|car|ev\b/i.test(name)) {
    return (
      <g {...s}>
        <path d="M -8 3 V -1 L -6 -6 H 6 L 8 -1 V 3 Z M -6 3 V 6 M 6 3 V 6 M -8 -1 H 8" />
      </g>
    );
  }
  if (/jacuzzi|spa/i.test(name)) {
    return (
      <g {...s}>
        <path d="M -8 0 H 8 V 4 A 3 3 0 0 1 5 7 H -5 A 3 3 0 0 1 -8 4 Z M -4 -3 Q -2 -6 -4 -8 M 0 -3 Q 2 -6 0 -8 M 4 -3 Q 6 -6 4 -8" />
      </g>
    );
  }
  if (/piscine|pool/i.test(name)) {
    return (
      <g {...s}>
        <path d="M -8 2 Q -6 0 -4 2 T 0 2 T 4 2 T 8 2 M -8 6 Q -6 4 -4 6 T 0 6 T 4 6 T 8 6 M -3 -1 V -8 M 3 -1 V -8 M -3 -5 H 3" />
      </g>
    );
  }
  if (/chaleur|pac|chauff/i.test(name)) {
    return (
      <g {...s}>
        <rect x={-8} y={-6} width={16} height={12} rx={2} />
        <circle cx={-1} cy={0} r={3.5} />
        <path d="M 5 -3 V 3" />
      </g>
    );
  }
  return (
    <g {...s}>
      <path d="M -3 -7 V -3 M 3 -7 V -3 M -6 -3 H 6 V 0 A 6 6 0 0 1 -6 0 Z M 0 5 V 8" />
    </g>
  );
}

// ── Illustrations ───────────────────────────────────────────────────

function SolarArt({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M 8 0 H 66 L 58 48 H 0 Z" fill="#1d4ed8" stroke="#1e3a8a" strokeWidth={1.5} />
      {[1, 2, 3].map((i) => (
        <line key={`v${i}`} x1={8 + i * 14.5} y1={0} x2={i * 14.5} y2={48} stroke="#93c5fd" strokeOpacity={0.55} strokeWidth={1} />
      ))}
      {[1, 2].map((i) => (
        <line key={`h${i}`} x1={8 - (8 * i) / 3} y1={i * 16} x2={66 - (8 * i) / 3} y2={i * 16} stroke="#93c5fd" strokeOpacity={0.55} strokeWidth={1} />
      ))}
      <path d="M 12 3 H 30 L 26 14 H 9 Z" fill="#ffffff" opacity={0.18} />
    </g>
  );
}

function PylonArt({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y})`} fill="none" style={{ stroke: color }} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M 24 2 L 10 86 M 24 2 L 38 86 M 4 22 H 44 M 8 38 H 40 M 14 22 L 33 38 M 34 22 L 15 38 M 13 58 L 35 58 M 15 38 L 34 58 M 33 38 L 14 58 M 12 70 L 36 86 M 36 70 L 12 86" />
    </g>
  );
}

function HouseArt({ cx, y }: { cx: number; y: number }) {
  const x = cx - 82;
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx={82} cy={128} rx={96} ry={10} fill="#16a34a" opacity={0.18} />
      <circle cx={6} cy={104} r={16} fill="#22c55e" opacity={0.8} />
      <circle cx={160} cy={102} r={18} fill="#16a34a" opacity={0.8} />
      <rect x={18} y={56} width={128} height={72} rx={3} fill="#f1f5f9" stroke="#cbd5e1" />
      <path d="M 6 62 L 82 6 L 158 62 Z" fill="#1e3a8a" />
      <path d="M 14 60 L 82 12 L 150 60" fill="none" stroke="#3b82f6" strokeWidth={3} />
      <rect x={70} y={88} width={24} height={40} rx={2} fill="#334155" />
      <rect x={30} y={74} width={28} height={22} rx={2} fill="#fde68a" stroke="#f59e0b" />
      <rect x={106} y={74} width={28} height={22} rx={2} fill="#fde68a" stroke="#f59e0b" />
      <path d="M 44 74 V 96 M 30 85 H 58 M 120 74 V 96 M 106 85 H 134" stroke="#f59e0b" strokeWidth={1} />
      <rect x={112} y={20} width={12} height={22} fill="#475569" />
    </g>
  );
}

function BatteryArt({ x, y, level }: { x: number; y: number; level: number | null }) {
  const h = 76;
  const fillH = Math.max(0, Math.min(1, (level ?? 0) / 100)) * (h - 8);
  const low = level !== null && level <= 20;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={14} y={0} width={20} height={8} rx={2} fill="#94a3b8" />
      <rect x={4} y={6} width={40} height={h} rx={7} style={{ fill: "var(--track)", stroke: "var(--node-border)" }} strokeWidth={1.5} />
      <rect x={8} y={6 + 4 + (h - 8 - fillH)} width={32} height={fillH} rx={4} fill={low ? "#ef4444" : "#22c55e"} />
      <path d="M 26 26 L 18 46 H 25 L 21 62 L 31 40 H 24 Z" fill="#ffffff" opacity={0.9} />
    </g>
  );
}

function PoolArt({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={0} y={20} width={72} height={56} rx={10} fill="#0891b2" opacity={0.9} />
      <path d="M 4 40 Q 13 34 22 40 T 40 40 T 58 40 T 70 40" fill="none" stroke="#a5f3fc" strokeWidth={2} />
      <path d="M 4 56 Q 13 50 22 56 T 40 56 T 58 56 T 70 56" fill="none" stroke="#a5f3fc" strokeWidth={2} opacity={0.7} />
      <path d="M 50 22 V 2 Q 50 -4 56 -4 M 62 22 V 2 Q 62 -4 68 -4 M 50 10 H 62" fill="none" stroke="#94a3b8" strokeWidth={2.5} strokeLinecap="round" />
    </g>
  );
}

// ── Version mobile (< md) ───────────────────────────────────────────

function FlowCompact({ d, m }: { d: FlowData; m: Model }) {
  const flows: Array<{ from: string; to: string; w: number; color: string }> = [
    { from: "Solaire", to: "Maison", w: m.solarToHome, color: C.solar },
    { from: "Réseau 1", to: "Maison", w: m.gridImport, color: C.import },
    { from: "Maison", to: "Réseau 1", w: m.gridExport, color: C.grid },
    { from: "Batterie", to: "Maison", w: m.batteryToHome, color: C.battery },
    { from: "Réseau 2", to: "Piscine · spa", w: m.aux, color: C.import },
    { from: "Réseau 2", to: "Batterie", w: m.auxToBattery, color: C.battery },
  ].filter((f) => f.w > 0);
  const tile = (label: string, value: string, color: string, sub?: string) => (
    <div className="rounded-xl border p-3" style={{ borderColor: "var(--node-border)", background: "var(--node-bg)" }}>
      <div className="text-[11px] text-zinc-400">{label}</div>
      <div className="text-lg font-bold tabular-nums" style={{ color }}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-zinc-500">{sub}</div>}
    </div>
  );
  return (
    <div className="space-y-4">
      <div>
        <div className="text-[10px] font-bold tracking-[0.16em] uppercase mb-2" style={{ color: C.grid }}>
          Réseau 1 · maison
        </div>
        <div className="grid grid-cols-2 gap-2">
          {tile("Panneaux solaires", fmt(d.production), C.solar)}
          {tile("Maison", fmt(d.consumption), C.home)}
          {tile(m.gridExport > 0 ? "Réseau 1 · injection" : "Réseau 1 · achat", fmt(m.gridImport || m.gridExport), m.gridImport > 0 ? C.import : C.grid)}
          {tile("Batterie", d.batteryLevel === null ? "—" : `${d.batteryLevel} %`, C.battery, d.batteryFlow > 0 ? `Charge ${fmt(d.batteryFlow)}` : d.batteryFlow < 0 ? `Décharge ${fmt(d.batteryFlow)}` : "Veille")}
        </div>
      </div>
      <div>
        <div className="text-[10px] font-bold tracking-[0.16em] uppercase mb-2" style={{ color: C.aux }}>
          Réseau 2 · piscine + jacuzzi
        </div>
        <div className="grid grid-cols-2 gap-2">
          {tile("Réseau 2 · achat", fmt(m.aux), m.aux > 0 ? C.import : C.grid)}
          {m.auxLoads.map((p) => (
            <div key={p.id}>{tile(p.name, p.currentlyOn ? fmt(loadPower(p)) : "Arrêt", p.currentlyOn ? C.aux : C.text3)}</div>
          ))}
        </div>
      </div>
      {flows.length > 0 && (
        <ul className="space-y-1.5">
          {flows.map((f, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <span className="text-zinc-300">{f.from}</span>
              <span className="flex-1 h-0.5 rounded relative" style={{ background: f.color }}>
                <span className="absolute -right-1 -top-[3px] w-0 h-0 border-y-[4px] border-y-transparent border-l-[6px]" style={{ borderLeftColor: f.color }} />
              </span>
              <span className="text-zinc-300">{f.to}</span>
              <span className="font-semibold tabular-nums w-20 text-right" style={{ color: f.color }}>
                {fmt(f.w)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
