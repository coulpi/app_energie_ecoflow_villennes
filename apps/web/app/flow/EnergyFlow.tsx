"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

interface FlowSnapshot {
  productionW: number | null;
  consumptionW: number | null;
  gridW: number | null;
  batteryPowerW: number | null;
  batterySoc: number | null;
  switchOn: boolean | null;
  acSwitchPowerW: number | null;
  controlMode: string;
  followLoadOffsetW: number | null;
  followLoadMinW: number | null;
  followLoadMaxW: number | null;
  chargeMaxW: number | null;
  chargeMinW: number | null;
  chargeOffsetW: number | null;
  ts: string;
}

interface Scenario {
  production: number;
  consumption: number;
  gridFlow: number;     // + import, - export
  batteryFlow: number;  // + charge, - décharge
  batteryLevel: number; // %
}

const POLL_MS = 5000;

const C = {
  bg: "#07080c",
  bg2: "#0c0e14",
  panel: "rgba(255,255,255,0.025)",
  panelHi: "rgba(255,255,255,0.045)",
  border: "rgba(255,255,255,0.07)",
  borderHi: "rgba(255,255,255,0.12)",
  text: "rgba(245,245,250,0.95)",
  textDim: "rgba(245,245,250,0.55)",
  textMute: "rgba(245,245,250,0.35)",
  solar: "oklch(82% 0.16 75)",
  home: "oklch(78% 0.17 155)",
  grid: "oklch(78% 0.13 220)",
  battery: "oklch(75% 0.16 305)",
  importRed: "oklch(70% 0.21 25)",
} as const;

interface ColorScheme {
  base: string;
  glow: string;
}

const FD: Record<"solar" | "home" | "grid" | "battery" | "importRed", ColorScheme> = {
  solar: { base: C.solar, glow: "oklch(82% 0.18 75 / 0.35)" },
  home: { base: C.home, glow: "oklch(78% 0.18 155 / 0.35)" },
  grid: { base: C.grid, glow: "oklch(78% 0.15 220 / 0.35)" },
  battery: { base: C.battery, glow: "oklch(75% 0.18 305 / 0.35)" },
  importRed: { base: C.importRed, glow: "oklch(70% 0.21 25 / 0.35)" },
};
const FD_DIM = "rgba(255,255,255,0.08)";

const GEO = {
  W: 1000,
  H: 560,
  solar: { x: 500, y: 110, r: 58 },
  home: { x: 500, y: 430, r: 64 },
  battery: { x: 180, y: 380, r: 54 },
  grid: { x: 820, y: 380, r: 54 },
} as const;

export default function EnergyFlow({ initial }: { initial: FlowSnapshot }) {
  const [snap, setSnap] = useState<FlowSnapshot>(initial);

  useEffect(() => {
    const tick = async () => {
      try {
        const res = await fetch("/api/snapshot", { cache: "no-store" });
        if (res.ok) setSnap(await res.json());
      } catch {
        // ignore
      }
    };
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, []);

  // Conversion snapshot → scenario (template).
  // Snapshot: batteryPowerW + = décharge, - = charge.
  // Scenario: batteryFlow + = charge, - = décharge.
  const scenario: Scenario = {
    production: Math.max(0, Math.round(snap.productionW ?? 0)),
    consumption: Math.max(0, Math.round(snap.consumptionW ?? 0)),
    gridFlow: Math.round(snap.gridW ?? 0),
    batteryFlow: Math.round(-(snap.batteryPowerW ?? 0)),
    batteryLevel: snap.batterySoc === null ? 0 : Math.round(snap.batterySoc),
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: `radial-gradient(circle at 20% 0%, #0e1220 0%, ${C.bg} 50%, ${C.bg2} 100%)`,
        color: C.text,
        font: "400 14px ui-sans-serif, system-ui, -apple-system, sans-serif",
        padding: "28px 32px 40px",
      }}
    >
      <style>{`
        @keyframes fx-pulse {
          0%   { transform: scale(1);   opacity: 0.6; }
          70%  { transform: scale(2.4); opacity: 0;   }
          100% { transform: scale(2.4); opacity: 0;   }
        }
      `}</style>
      <div style={{ maxWidth: 1320, margin: "0 auto" }}>
        <Header />
        <StatusBanner scenario={scenario} />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 14,
            marginTop: 14,
          }}
        >
          <KpiCard
            label="PRODUCTION SOLAIRE"
            color={C.solar}
            sparkSeed={3}
            value={fmtW(scenario.production)}
            unit={unitFor(scenario.production)}
            active={scenario.production > 0}
            sub={scenario.production > 0 ? "En cours" : "Inactif"}
            icon={<SunIcon />}
          />
          <KpiCard
            label="CONSOMMATION MAISON"
            color={C.home}
            sparkSeed={11}
            value={fmtW(scenario.consumption)}
            unit={unitFor(scenario.consumption)}
            active={scenario.consumption > 0}
            sub="En cours"
            icon={<HouseIcon />}
          />
          <KpiCard
            label={scenario.gridFlow >= 0 ? "IMPORT RÉSEAU" : "EXPORT RÉSEAU"}
            color={scenario.gridFlow > 0 ? C.importRed : C.grid}
            sparkSeed={17}
            value={fmtW(Math.abs(scenario.gridFlow))}
            unit={unitFor(scenario.gridFlow)}
            active={Math.abs(scenario.gridFlow) > 0}
            sub={
              scenario.gridFlow > 0
                ? "Vous achetez"
                : scenario.gridFlow < 0
                  ? "Vous revendez"
                  : "Aucun échange"
            }
            icon={<PlugIcon />}
          />
          <KpiCard
            label="NIVEAU BATTERIE"
            color={C.battery}
            sparkSeed={23}
            value={String(scenario.batteryLevel)}
            unit="%"
            active={true}
            sub={
              scenario.batteryFlow > 0
                ? `Charge · ${fmtW(scenario.batteryFlow)} ${unitFor(scenario.batteryFlow)}`
                : scenario.batteryFlow < 0
                  ? `Décharge · ${fmtW(-scenario.batteryFlow)} ${unitFor(scenario.batteryFlow)}`
                  : "En veille"
            }
            icon={<BattIcon />}
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 320px",
            gap: 14,
            marginTop: 14,
          }}
        >
          <div
            style={{
              position: "relative",
              background: `linear-gradient(180deg, ${C.panelHi}, ${C.panel})`,
              border: `1px solid ${C.border}`,
              borderRadius: 18,
              padding: 18,
              minHeight: 540,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 4,
                padding: "0 6px",
              }}
            >
              <div
                style={{
                  font: "600 10px ui-sans-serif, system-ui",
                  color: C.textDim,
                  letterSpacing: "0.14em",
                }}
              >
                FLUX EN TEMPS RÉEL
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  font: "500 10.5px ui-sans-serif, system-ui",
                  color: C.textMute,
                }}
              >
                <Legend color={C.solar} label="Solaire" />
                <Legend color={C.battery} label="Batterie" />
                <Legend color={C.grid} label="Réseau" />
                <Legend color={C.importRed} label="Import" />
              </div>
            </div>

            <div style={{ position: "relative", height: 510 }}>
              <FlowDiagram scenario={scenario} />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <SelfConsumption scenario={scenario} />
            <BatteryControl snap={snap} scenario={scenario} />
            <TodaySummary scenario={scenario} />
          </div>
        </div>

        <div
          style={{
            marginTop: 24,
            font: "400 11px ui-sans-serif, system-ui",
            color: C.textMute,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>Données mises à jour en temps réel · {new Date(snap.ts).toLocaleTimeString("fr-FR")}</span>
          <span
            style={{
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              letterSpacing: "0.06em",
            }}
          >
            v2.4 · {new Date().toLocaleDateString("fr-FR")}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Header ──────────────────────────────────────────────────────────
function Header() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 24,
      }}
    >
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: `linear-gradient(135deg, ${C.solar}33, ${C.home}33)`,
              border: `1px solid ${C.border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="-12 -12 24 24"
              fill="none"
              stroke={C.text}
              strokeWidth="1.7"
              strokeLinecap="round"
            >
              <path
                d="M -2 -8 L -6 2 L 0 2 L -2 8 L 6 -2 L 0 -2 L 2 -8 Z"
                fill="currentColor"
                fillOpacity="0.2"
              />
            </svg>
          </div>
          <h1
            style={{
              font: "600 22px ui-sans-serif, system-ui",
              color: C.text,
              margin: 0,
              letterSpacing: "-0.01em",
            }}
          >
            Flux d&rsquo;énergie
          </h1>
          <span
            style={{
              padding: "4px 9px",
              borderRadius: 6,
              background: `${C.home}14`,
              border: `1px solid ${C.home}33`,
              color: C.home,
              font: "600 9.5px ui-sans-serif, system-ui",
              letterSpacing: "0.14em",
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            <Pulse color={C.home} size={5} /> EN DIRECT
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Status banner ───────────────────────────────────────────────────
function StatusBanner({ scenario }: { scenario: Scenario }) {
  const { gridFlow, batteryFlow } = scenario;
  let kind: "import" | "export" | "charging" | "discharging" | "balanced";
  let color: string;
  let title: string;
  let sub: string;
  let badge: string;

  if (gridFlow > 30) {
    kind = "import";
    color = C.importRed;
    title = "Déficit · vous importez";
    sub = "Consommation supérieure à la production — appoint depuis le réseau.";
    badge = "IMPORT";
  } else if (gridFlow < -30) {
    kind = "export";
    color = C.home;
    title = "Surplus · vous exportez";
    sub = "Production excédentaire — l'énergie est revendue au réseau.";
    badge = "EXPORT";
  } else if (batteryFlow > 30) {
    kind = "charging";
    color = C.battery;
    title = "Charge batterie en cours";
    sub = "Le surplus solaire alimente la batterie pour un usage différé.";
    badge = "CHARGE";
  } else if (batteryFlow < -30) {
    kind = "discharging";
    color = C.battery;
    title = "Autonomie batterie";
    sub = "La batterie alimente la maison sans recourir au réseau.";
    badge = "AUTONOMIE";
  } else {
    kind = "balanced";
    color = C.home;
    title = "Équilibre parfait";
    sub = "Production et consommation sont alignées en temps réel.";
    badge = "BALANCE";
  }

  const value =
    kind === "import"
      ? gridFlow
      : kind === "export"
        ? -gridFlow
        : kind === "charging"
          ? batteryFlow
          : kind === "discharging"
            ? -batteryFlow
            : 0;

  return (
    <div
      style={{
        position: "relative",
        background: `linear-gradient(180deg, ${C.panelHi}, ${C.panel})`,
        border: `1px solid ${C.border}`,
        borderRadius: 18,
        padding: "20px 22px",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        gap: 22,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: `radial-gradient(60% 100% at 0% 50%, ${color}1f, transparent 70%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: `linear-gradient(180deg, transparent, ${color}, transparent)`,
          opacity: 0.7,
        }}
      />

      <div
        style={{
          position: "relative",
          width: 56,
          height: 56,
          borderRadius: 14,
          background: `linear-gradient(135deg, ${color}33, ${color}0c)`,
          border: `1px solid ${color}55`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: color,
          flexShrink: 0,
          boxShadow: `0 0 24px ${color}33, inset 0 0 12px ${color}11`,
        }}
      >
        <BannerIcon kind={kind} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            font: "600 9.5px ui-sans-serif, system-ui",
            color: C.textDim,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            marginBottom: 4,
          }}
        >
          {title}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span
            style={{
              font: '600 36px "JetBrains Mono", ui-monospace, monospace',
              color,
              letterSpacing: "-0.025em",
              textShadow: `0 0 28px ${color}55`,
            }}
          >
            {fmtW(value)}
          </span>
          <span
            style={{
              font: '500 18px "JetBrains Mono", ui-monospace, monospace',
              color,
              opacity: 0.7,
            }}
          >
            {unitFor(value)}
          </span>
        </div>
        <div
          style={{
            marginTop: 4,
            font: "400 12.5px ui-sans-serif, system-ui",
            color: C.textDim,
            maxWidth: 600,
          }}
        >
          {sub}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <Sparkline color={color} seed={kind === "import" ? 7 : 19} width={140} height={42} />
        <div
          style={{
            padding: "6px 12px",
            borderRadius: 8,
            font: "600 10px ui-sans-serif, system-ui",
            letterSpacing: "0.16em",
            color,
            background: `${color}14`,
            border: `1px solid ${color}33`,
          }}
        >
          {badge}
        </div>
      </div>
    </div>
  );
}

function BannerIcon({ kind }: { kind: string }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "-12 -12 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (kind === "import")
    return (
      <svg {...common}>
        <path d="M -7 0 L 7 0" />
        <path d="M 2 -5 L 7 0 L 2 5" />
      </svg>
    );
  if (kind === "export")
    return (
      <svg {...common}>
        <path d="M -7 0 L 7 0" />
        <path d="M -2 -5 L -7 0 L -2 5" />
      </svg>
    );
  if (kind === "charging")
    return (
      <svg {...common}>
        <path d="M -1 -8 L -5 1 L 0 1 L -2 8 L 5 -2 L 0 -2 L 2 -8 Z" />
      </svg>
    );
  if (kind === "discharging")
    return (
      <svg {...common}>
        <path d="M -7 -3 L 7 -3" />
        <path d="M -7 3 L 7 3" />
      </svg>
    );
  return (
    <svg {...common}>
      <circle r="7" />
    </svg>
  );
}

// ── KPI Card ────────────────────────────────────────────────────────
function KpiCard({
  label,
  value,
  unit,
  color,
  sub,
  active,
  sparkSeed,
  icon,
}: {
  label: string;
  value: string;
  unit: string;
  color: string;
  sub: string;
  active: boolean;
  sparkSeed: number;
  icon: ReactNode;
}) {
  return (
    <div
      style={{
        position: "relative",
        background: `linear-gradient(180deg, ${C.panelHi}, ${C.panel})`,
        border: `1px solid ${C.border}`,
        borderRadius: 16,
        padding: "18px 18px 16px",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 1,
          background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
          opacity: 0.5,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: -40,
          right: -40,
          width: 110,
          height: 110,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${color}22 0%, transparent 70%)`,
        }}
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: `linear-gradient(135deg, ${color}33, ${color}11)`,
              border: `1px solid ${color}55`,
              color,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {icon}
          </div>
          <div
            style={{
              font: "600 9.5px ui-sans-serif, system-ui",
              color: C.textDim,
              letterSpacing: "0.14em",
            }}
          >
            {label}
          </div>
        </div>
        <Sparkline color={color} seed={sparkSeed} height={26} width={70} />
      </div>

      <div style={{ marginTop: 12, display: "flex", alignItems: "baseline", gap: 6 }}>
        <span
          style={{
            font: '600 30px "JetBrains Mono", ui-monospace, monospace',
            color: active ? color : C.textDim,
            letterSpacing: "-0.02em",
            textShadow: active ? `0 0 24px ${color}55` : "none",
          }}
        >
          {value}
        </span>
        <span
          style={{
            font: '500 14px "JetBrains Mono", ui-monospace, monospace',
            color: active ? color : C.textMute,
            opacity: 0.7,
          }}
        >
          {unit}
        </span>
      </div>

      <div style={{ marginTop: 8, display: "flex", alignItems: "center" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            font: "500 11px ui-sans-serif, system-ui",
            color: C.textDim,
          }}
        >
          <Pulse color={active ? color : C.textMute} size={5} />
          {sub}
        </div>
      </div>
    </div>
  );
}

// ── Self consumption gauge ──────────────────────────────────────────
function SelfConsumption({ scenario }: { scenario: Scenario }) {
  const { consumption, gridFlow } = scenario;
  const selfMet = Math.max(0, consumption - Math.max(0, gridFlow));
  const ratio = consumption > 0 ? Math.min(1, selfMet / consumption) : 1;
  const pct = Math.round(ratio * 100);
  const R = 36,
    Cc = 2 * Math.PI * R;
  return (
    <div
      style={{
        background: `linear-gradient(180deg, ${C.panelHi}, ${C.panel})`,
        border: `1px solid ${C.border}`,
        borderRadius: 16,
        padding: 18,
        display: "flex",
        alignItems: "center",
        gap: 16,
      }}
    >
      <svg width="84" height="84" viewBox="-42 -42 84 84">
        <circle r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
        <circle
          r={R}
          fill="none"
          stroke={C.home}
          strokeWidth="6"
          strokeDasharray={`${Cc * ratio} ${Cc}`}
          strokeLinecap="round"
          transform="rotate(-90)"
          style={{
            transition: "stroke-dasharray .8s cubic-bezier(.2,.7,.3,1)",
            filter: `drop-shadow(0 0 6px ${C.home}55)`,
          }}
        />
        <text
          textAnchor="middle"
          y="5"
          style={{
            font: '600 20px "JetBrains Mono", ui-monospace, monospace',
            fill: C.text,
            letterSpacing: "-0.02em",
          }}
        >
          {pct}
          <tspan style={{ fontSize: 11, fill: C.textDim }}>%</tspan>
        </text>
      </svg>
      <div>
        <div
          style={{
            font: "600 9.5px ui-sans-serif, system-ui",
            color: C.textDim,
            letterSpacing: "0.14em",
          }}
        >
          AUTOCONSOMMATION
        </div>
        <div
          style={{
            font: "500 12.5px ui-sans-serif, system-ui",
            color: C.text,
            marginTop: 4,
            lineHeight: 1.45,
          }}
        >
          {pct >= 90
            ? "Quasi-autonome"
            : pct >= 60
              ? "Bonne autonomie"
              : pct >= 30
                ? "Autonomie partielle"
                : "Faible autonomie"}
        </div>
        <div
          style={{
            font: "500 11px ui-sans-serif, system-ui",
            color: C.textMute,
            marginTop: 2,
          }}
        >
          {fmtW(selfMet)} {unitFor(selfMet)} sur {fmtW(consumption)} {unitFor(consumption)}
        </div>
      </div>
    </div>
  );
}

// ── Battery control panel ───────────────────────────────────────────
function BatteryControl({
  snap,
  scenario,
}: {
  snap: FlowSnapshot;
  scenario: Scenario;
}) {
  const acOn = snap.switchOn === true;
  const acUnknown = snap.switchOn === null;
  const acPower = Math.max(0, Math.round(snap.acSwitchPowerW ?? 0));
  const dischargeW = scenario.batteryFlow < 0 ? -scenario.batteryFlow : 0;
  const isFollowLoad = snap.controlMode === "FOLLOW_LOAD";
  const offset = snap.followLoadOffsetW ?? 0;
  const minW = snap.followLoadMinW ?? 0;
  const maxW = snap.followLoadMaxW ?? 0;
  const target = Math.max(minW, Math.min(maxW, scenario.consumption - offset));
  const range = Math.max(1, maxW - minW);
  const actualPct = Math.min(1, Math.max(0, (dischargeW - minW) / range));
  const targetPct = Math.min(1, Math.max(0, (target - minW) / range));

  const [dischargeMax, setDischargeMax] = useState<number>(maxW);
  const [chargeMax, setChargeMax] = useState<number>(snap.chargeMaxW ?? 800);
  const [chargeMin, setChargeMin] = useState<number>(snap.chargeMinW ?? 400);
  const [chargeOffsetEdit, setChargeOffsetEdit] = useState<number>(
    snap.chargeOffsetW ?? 100,
  );
  const [saving, setSaving] = useState<"idle" | "saving" | "ok" | "err">("idle");
  const [dirty, setDirty] = useState(false);

  // Re-sync depuis le snapshot tant que l'utilisateur n'a pas édité.
  useEffect(() => {
    if (!dirty) {
      setDischargeMax(snap.followLoadMaxW ?? 800);
      setChargeMax(snap.chargeMaxW ?? 800);
      setChargeMin(snap.chargeMinW ?? 400);
      setChargeOffsetEdit(snap.chargeOffsetW ?? 100);
    }
  }, [
    snap.followLoadMaxW,
    snap.chargeMaxW,
    snap.chargeMinW,
    snap.chargeOffsetW,
    dirty,
  ]);

  async function apply() {
    setSaving("saving");
    try {
      const res = await fetch("/api/control/battery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          followLoadMaxW: dischargeMax,
          chargeMaxW: chargeMax,
          chargeMinW: chargeMin,
          chargeOffsetW: chargeOffsetEdit,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setSaving("ok");
      setDirty(false);
      setTimeout(() => setSaving("idle"), 1400);
    } catch {
      setSaving("err");
      setTimeout(() => setSaving("idle"), 1800);
    }
  }

  const modeLabel: Record<string, string> = {
    FOLLOW_LOAD: "Suivi de charge",
    RULES: "Règles",
    MANUAL: "Manuel",
    OFF: "Désactivé",
  };

  return (
    <div
      style={{
        background: `linear-gradient(180deg, ${C.panelHi}, ${C.panel})`,
        border: `1px solid ${C.border}`,
        borderRadius: 16,
        padding: 18,
      }}
    >
      <div
        style={{
          font: "600 9.5px ui-sans-serif, system-ui",
          color: C.textDim,
          letterSpacing: "0.14em",
          marginBottom: 14,
        }}
      >
        PILOTAGE BATTERIE
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 12px",
          borderRadius: 10,
          background: `${acOn ? C.battery : C.textMute}10`,
          border: `1px solid ${acOn ? C.battery : C.borderHi}33`,
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Pulse color={acOn ? C.battery : C.textMute} size={6} />
          <div>
            <div
              style={{
                font: "600 10px ui-sans-serif, system-ui",
                color: C.textDim,
                letterSpacing: "0.12em",
              }}
            >
              PRISE AC · CHARGE
            </div>
            <div
              style={{
                font: "500 12.5px ui-sans-serif, system-ui",
                color: C.text,
                marginTop: 2,
              }}
            >
              {acUnknown
                ? "Inconnu"
                : acOn
                  ? acPower > 5
                    ? `Active · charge à ${fmtW(acPower)} ${unitFor(acPower)}`
                    : "Active · veille"
                  : "Inactive"}
            </div>
          </div>
        </div>
        <div
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            font: "600 10px ui-sans-serif, system-ui",
            letterSpacing: "0.14em",
            color: acOn ? C.battery : C.textMute,
            background: `${acOn ? C.battery : C.textMute}14`,
            border: `1px solid ${acOn ? C.battery : C.textMute}33`,
          }}
        >
          {acUnknown ? "—" : acOn ? "ON" : "OFF"}
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 6,
          }}
        >
          <span
            style={{
              font: "600 10px ui-sans-serif, system-ui",
              color: C.textDim,
              letterSpacing: "0.12em",
            }}
          >
            SORTIE VERS LA MAISON
          </span>
          <span
            style={{
              font: '600 16px "JetBrains Mono", ui-monospace, monospace',
              color: dischargeW > 0 ? C.battery : C.textMute,
              letterSpacing: "-0.01em",
            }}
          >
            {fmtW(dischargeW)}
            <span style={{ fontSize: 10, opacity: 0.7 }}> {unitFor(dischargeW)}</span>
          </span>
        </div>
        <div
          style={{
            position: "relative",
            height: 8,
            borderRadius: 4,
            background: "rgba(255,255,255,0.06)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${actualPct * 100}%`,
              background: `linear-gradient(90deg, ${C.battery}55, ${C.battery})`,
              boxShadow: `0 0 8px ${C.battery}77`,
              transition: "width .8s cubic-bezier(.2,.7,.3,1)",
            }}
          />
          {isFollowLoad && (
            <div
              style={{
                position: "absolute",
                top: -2,
                bottom: -2,
                left: `${targetPct * 100}%`,
                width: 2,
                background: C.home,
                boxShadow: `0 0 6px ${C.home}`,
                transform: "translateX(-1px)",
              }}
            />
          )}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            font: "500 10px ui-sans-serif, system-ui",
            color: C.textMute,
            marginTop: 4,
          }}
        >
          <span>{minW} W</span>
          {isFollowLoad && (
            <span style={{ color: C.home }}>
              cible {Math.round(target)} W
            </span>
          )}
          <span>{maxW} W</span>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: 10,
          borderTop: `1px solid ${C.border}`,
          font: "500 11px ui-sans-serif, system-ui",
          color: C.textDim,
        }}
      >
        <span>Mode</span>
        <span
          style={{
            padding: "3px 8px",
            borderRadius: 6,
            font: "600 10px ui-sans-serif, system-ui",
            letterSpacing: "0.12em",
            color: isFollowLoad ? C.home : C.textDim,
            background: `${isFollowLoad ? C.home : C.textMute}14`,
            border: `1px solid ${isFollowLoad ? C.home : C.textMute}33`,
          }}
        >
          {modeLabel[snap.controlMode] ?? snap.controlMode}
        </span>
      </div>
      {isFollowLoad && (
        <div
          style={{
            marginTop: 8,
            font: "400 11px ui-sans-serif, system-ui",
            color: C.textMute,
            lineHeight: 1.45,
          }}
        >
          Ajustement automatique : conso − {offset} W, borné [{minW} W, {maxW} W].
        </div>
      )}

      <div
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: `1px solid ${C.border}`,
        }}
      >
        <div
          style={{
            font: "600 9.5px ui-sans-serif, system-ui",
            color: C.textDim,
            letterSpacing: "0.14em",
            marginBottom: 10,
          }}
        >
          PARAMÈTRES
        </div>
        <ParamRow
          label="Sortie max → maison"
          color={C.battery}
          value={dischargeMax}
          onChange={(v) => {
            setDischargeMax(v);
            setDirty(true);
          }}
        />
        <ParamRow
          label="Charge max"
          color={C.solar}
          value={chargeMax}
          onChange={(v) => {
            setChargeMax(v);
            setDirty(true);
          }}
        />
        <ParamRow
          label="Charge min (seuil prise)"
          color={C.solar}
          value={chargeMin}
          onChange={(v) => {
            setChargeMin(v);
            setDirty(true);
          }}
        />
        <ParamRow
          label="Marge surplus"
          color={C.home}
          value={chargeOffsetEdit}
          onChange={(v) => {
            setChargeOffsetEdit(v);
            setDirty(true);
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 10,
            gap: 10,
          }}
        >
          <span
            style={{
              font: "500 10.5px ui-sans-serif, system-ui",
              color:
                saving === "ok"
                  ? C.home
                  : saving === "err"
                    ? C.importRed
                    : C.textMute,
            }}
          >
            {saving === "saving"
              ? "Application…"
              : saving === "ok"
                ? "Appliqué ✓"
                : saving === "err"
                  ? "Erreur"
                  : dirty
                    ? "Modifications non appliquées"
                    : ""}
          </span>
          <button
            type="button"
            onClick={apply}
            disabled={!dirty || saving === "saving"}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: `1px solid ${dirty ? C.home : C.border}`,
              background: dirty ? `${C.home}1a` : "transparent",
              color: dirty ? C.home : C.textMute,
              font: "600 11px ui-sans-serif, system-ui",
              letterSpacing: "0.08em",
              cursor: dirty && saving !== "saving" ? "pointer" : "default",
              opacity: dirty && saving !== "saving" ? 1 : 0.6,
            }}
          >
            APPLIQUER
          </button>
        </div>
      </div>
    </div>
  );
}

function ParamRow({
  label,
  value,
  onChange,
  color,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  color: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "6px 0",
      }}
    >
      <span
        style={{
          font: "500 11.5px ui-sans-serif, system-ui",
          color: C.text,
        }}
      >
        {label}
      </span>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "rgba(255,255,255,0.04)",
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          padding: "4px 6px",
        }}
      >
        <input
          type="number"
          min={0}
          max={2200}
          step={50}
          value={value}
          onChange={(e) => onChange(Math.round(Number(e.target.value) || 0))}
          style={{
            width: 64,
            background: "transparent",
            border: "none",
            outline: "none",
            color,
            font: '600 14px "JetBrains Mono", ui-monospace, monospace',
            textAlign: "right",
            letterSpacing: "-0.01em",
          }}
        />
        <span
          style={{
            font: '500 10px "JetBrains Mono", ui-monospace, monospace',
            color: C.textMute,
          }}
        >
          W
        </span>
      </div>
    </div>
  );
}

// ── Today summary ───────────────────────────────────────────────────
function TodaySummary({ scenario }: { scenario: Scenario }) {
  const produced = ((scenario.production / 1000) * 7.4 + 4).toFixed(1);
  const consumed = ((scenario.consumption / 1000) * 9 + 6).toFixed(1);
  const exported = Math.max(0, +produced - +consumed).toFixed(1);
  const saved = (+produced * 0.18).toFixed(2);
  const items = [
    { k: "Produit", v: produced, u: "kWh", c: C.solar },
    { k: "Consommé", v: consumed, u: "kWh", c: C.home },
    { k: "Exporté", v: exported, u: "kWh", c: C.grid },
    { k: "Économisé", v: saved, u: "€", c: C.battery },
  ];
  return (
    <div
      style={{
        background: `linear-gradient(180deg, ${C.panelHi}, ${C.panel})`,
        border: `1px solid ${C.border}`,
        borderRadius: 16,
        padding: 18,
      }}
    >
      <div
        style={{
          font: "600 9.5px ui-sans-serif, system-ui",
          color: C.textDim,
          letterSpacing: "0.14em",
          marginBottom: 14,
        }}
      >
        BILAN DU JOUR · 24H
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {items.map((it) => (
          <div key={it.k}>
            <div
              style={{
                font: "500 10px ui-sans-serif, system-ui",
                color: C.textMute,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              {it.k}
            </div>
            <div style={{ marginTop: 2, display: "flex", alignItems: "baseline", gap: 4 }}>
              <span
                style={{
                  font: '600 20px "JetBrains Mono", ui-monospace, monospace',
                  color: it.c,
                  letterSpacing: "-0.02em",
                }}
              >
                {it.v}
              </span>
              <span
                style={{
                  font: '500 11px "JetBrains Mono", ui-monospace, monospace',
                  color: C.textMute,
                }}
              >
                {it.u}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Flow diagram ────────────────────────────────────────────────────
function FlowDiagram({ scenario }: { scenario: Scenario }) {
  const { production, consumption, gridFlow, batteryFlow, batteryLevel } = scenario;

  const solarToHome = Math.max(0, Math.min(production, consumption));
  const gridToHome = Math.max(0, gridFlow > 0 ? gridFlow : 0);
  const homeToGrid = Math.max(0, gridFlow < 0 ? -gridFlow : 0);
  const batteryToHome = Math.max(0, batteryFlow < 0 ? -batteryFlow : 0);
  const homeToBattery = Math.max(0, batteryFlow > 0 ? batteryFlow : 0);

  const pSolarHome = curvePath(GEO.solar, GEO.home, 0);
  const pGridHome = curvePath(GEO.grid, GEO.home, 0.18);
  const pBatteryHome = curvePath(GEO.battery, GEO.home, -0.18);

  return (
    <svg
      viewBox={`0 0 ${GEO.W} ${GEO.H}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: "100%", height: "100%", display: "block" }}
    >
      <defs>
        {(
          [
            ["SOLAIRE", FD.solar],
            ["MAISON", FD.home],
            ["BATTERIE", FD.battery],
            ["RESEAU", FD.grid],
          ] as const
        ).map(([k, c]) => (
          <radialGradient key={k} id={`fd-grad-${k}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={c.base} stopOpacity="0.22" />
            <stop offset="70%" stopColor={c.base} stopOpacity="0.04" />
            <stop offset="100%" stopColor={c.base} stopOpacity="0" />
          </radialGradient>
        ))}
        <pattern id="fd-grid" width="32" height="32" patternUnits="userSpaceOnUse">
          <path
            d="M 32 0 L 0 0 0 32"
            fill="none"
            stroke="rgba(255,255,255,0.025)"
            strokeWidth="1"
          />
        </pattern>
        <radialGradient id="fd-vignette" cx="50%" cy="60%" r="65%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.04)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
      </defs>

      <rect x="0" y="0" width={GEO.W} height={GEO.H} fill="url(#fd-grid)" />
      <rect x="0" y="0" width={GEO.W} height={GEO.H} fill="url(#fd-vignette)" />

      <FlowPath d={pSolarHome} color={FD.solar} power={solarToHome} />
      <FlowPath
        d={pGridHome}
        color={gridToHome > 0 ? FD.importRed : FD.grid}
        power={Math.max(gridToHome, homeToGrid)}
        reverse={homeToGrid > 0}
      />
      <FlowPath
        d={pBatteryHome}
        color={FD.battery}
        power={Math.max(batteryToHome, homeToBattery)}
        reverse={homeToBattery > 0}
      />

      <Node
        cx={GEO.solar.x}
        cy={GEO.solar.y}
        r={GEO.solar.r}
        color={FD.solar}
        gradId="SOLAIRE"
        active={production > 0}
        label="SOLAIRE"
        value={production}
        unit="W"
        icon="solar"
      />
      <Node
        cx={GEO.home.x}
        cy={GEO.home.y}
        r={GEO.home.r}
        color={FD.home}
        gradId="MAISON"
        active={consumption > 0}
        label="MAISON"
        value={consumption}
        unit="W"
        icon="home"
      />
      <Node
        cx={GEO.grid.x}
        cy={GEO.grid.y}
        r={GEO.grid.r}
        color={gridFlow > 0 ? FD.importRed : FD.grid}
        gradId="RESEAU"
        active={Math.abs(gridFlow) > 0}
        label={gridFlow >= 0 ? "IMPORT" : "EXPORT"}
        value={Math.abs(gridFlow)}
        unit="W"
        sub="RÉSEAU"
        icon="grid"
      />
      <Node
        cx={GEO.battery.x}
        cy={GEO.battery.y}
        r={GEO.battery.r}
        color={FD.battery}
        gradId="BATTERIE"
        active={Math.abs(batteryFlow) > 0}
        label={batteryFlow > 0 ? "CHARGE" : batteryFlow < 0 ? "DÉCHARGE" : "IDLE"}
        value={Math.abs(batteryFlow)}
        unit="W"
        sub={`${batteryLevel}%`}
        icon="battery"
        batteryLevel={batteryLevel / 100}
      />
    </svg>
  );
}

function curvePath(
  a: { x: number; y: number; r: number },
  b: { x: number; y: number; r: number },
  bow = 0.18,
): string {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const sa = a.r + 4,
    sb = b.r + 4;
  const ax = a.x + (dx / dist) * sa;
  const ay = a.y + (dy / dist) * sa;
  const bx = b.x - (dx / dist) * sb;
  const by = b.y - (dy / dist) * sb;
  const mx = (ax + bx) / 2,
    my = (ay + by) / 2;
  const px = -(by - ay),
    py = bx - ax;
  const plen = Math.hypot(px, py) || 1;
  const cx = mx + (px / plen) * dist * bow;
  const cy = my + (py / plen) * dist * bow;
  return `M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`;
}

function FlowPath({
  d,
  color,
  power,
  reverse = false,
}: {
  d: string;
  color: ColorScheme;
  power: number;
  reverse?: boolean;
}) {
  if (power <= 0) {
    return (
      <path d={d} fill="none" stroke={FD_DIM} strokeWidth="1.2" strokeDasharray="3 6" />
    );
  }
  const intensity = Math.min(1, power / 1500);
  const period = 2400 - intensity * 1400;
  const count = Math.max(2, Math.round(2 + intensity * 4));
  const dash = `${2 + intensity * 2} ${10 - intensity * 4}`;

  return (
    <g>
      <path d={d} fill="none" stroke={color.base} strokeOpacity="0.18" strokeWidth="2.2" />
      <path
        d={d}
        fill="none"
        stroke={color.base}
        strokeOpacity="0.55"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeDasharray={dash}
      >
        <animate
          attributeName="stroke-dashoffset"
          from={reverse ? 0 : 24}
          to={reverse ? 24 : 0}
          dur={`${period}ms`}
          repeatCount="indefinite"
        />
      </path>
      {Array.from({ length: count }).map((_, i) => (
        <circle
          key={i}
          r={3.2}
          fill={color.base}
          style={{ filter: `drop-shadow(0 0 6px ${color.base})` }}
        >
          <animateMotion
            dur={`${period}ms`}
            repeatCount="indefinite"
            keyPoints={reverse ? "1;0" : "0;1"}
            keyTimes="0;1"
            begin={`${(i * period) / count}ms`}
            path={d}
            rotate="auto"
          />
          <animate
            attributeName="opacity"
            values="0;1;1;0"
            keyTimes="0;0.1;0.9;1"
            dur={`${period}ms`}
            repeatCount="indefinite"
            begin={`${(i * period) / count}ms`}
          />
        </circle>
      ))}
    </g>
  );
}

function Node({
  cx,
  cy,
  r,
  color,
  gradId,
  active,
  label,
  value,
  unit,
  sub,
  icon,
  batteryLevel,
}: {
  cx: number;
  cy: number;
  r: number;
  color: ColorScheme;
  gradId: string;
  active: boolean;
  label: string;
  value: number;
  unit: string;
  sub?: string;
  icon: "solar" | "home" | "grid" | "battery";
  batteryLevel?: number;
}) {
  return (
    <g transform={`translate(${cx} ${cy})`}>
      {active && <circle r={r + 18} fill={color.glow} />}
      <circle
        r={r}
        fill="rgba(10,12,18,0.85)"
        stroke={active ? color.base : "rgba(255,255,255,0.12)"}
        strokeWidth={active ? 1.6 : 1}
      />
      <circle r={r - 2} fill={`url(#fd-grad-${gradId})`} opacity={active ? 0.9 : 0.35} />
      <g
        style={{ color: active ? color.base : "rgba(255,255,255,0.45)" }}
        transform="translate(0 -22)"
      >
        <NodeIcon kind={icon} level={batteryLevel ?? 0} />
      </g>
      <text
        textAnchor="middle"
        y={2}
        style={{
          font: "600 9px ui-sans-serif, system-ui",
          letterSpacing: "0.14em",
          fill: "rgba(245,245,250,0.55)",
          textTransform: "uppercase",
        }}
      >
        {label}
      </text>
      <text
        textAnchor="middle"
        y={20}
        style={{
          font: '600 18px "JetBrains Mono", ui-monospace, monospace',
          fill: active ? color.base : "rgba(255,255,255,0.45)",
          letterSpacing: "-0.01em",
        }}
      >
        {value}
        <tspan style={{ fontSize: 10, opacity: 0.7 }}> {unit}</tspan>
      </text>
      {sub && (
        <text
          textAnchor="middle"
          y={34}
          style={{
            font: "500 8.5px ui-sans-serif, system-ui",
            fill: "rgba(245,245,250,0.55)",
            letterSpacing: "0.06em",
          }}
        >
          {sub}
        </text>
      )}
    </g>
  );
}

function NodeIcon({
  kind,
  level,
}: {
  kind: "solar" | "home" | "grid" | "battery";
  level: number;
}) {
  switch (kind) {
    case "solar":
      return (
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        >
          <rect x="-12" y="-9" width="24" height="18" rx="1.5" />
          <line x1="-12" y1="-3" x2="12" y2="-3" />
          <line x1="-12" y1="3" x2="12" y2="3" />
          <line x1="-4" y1="-9" x2="-4" y2="9" />
          <line x1="4" y1="-9" x2="4" y2="9" />
        </g>
      );
    case "home":
      return (
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M -12 2 L 0 -10 L 12 2 L 12 11 L -12 11 Z" />
          <path d="M -3 11 L -3 4 L 3 4 L 3 11" />
        </g>
      );
    case "grid":
      return (
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M 0 -11 L 0 11" />
          <path d="M -8 -3 L 0 -8 L 8 -3" />
          <path d="M -10 4 L 0 -2 L 10 4" />
          <path d="M -6 11 L 0 5 L 6 11" />
        </g>
      );
    case "battery":
      return (
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        >
          <rect x="-11" y="-6" width="20" height="12" rx="2" />
          <rect
            x="9"
            y="-3"
            width="2.5"
            height="6"
            rx="1"
            fill="currentColor"
            stroke="none"
          />
          {level > 0 && (
            <rect
              x="-9"
              y="-4"
              width={Math.max(0, Math.min(16, 16 * level))}
              height="8"
              rx="1"
              fill="currentColor"
              stroke="none"
              opacity="0.55"
            />
          )}
        </g>
      );
  }
}

// ── KPI inline icons ────────────────────────────────────────────────
function SunIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="-12 -12 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <circle r="4" />
      <line x1="0" y1="-9" x2="0" y2="-7" />
      <line x1="0" y1="7" x2="0" y2="9" />
      <line x1="-9" y1="0" x2="-7" y2="0" />
      <line x1="7" y1="0" x2="9" y2="0" />
      <line x1="-6.4" y1="-6.4" x2="-5" y2="-5" />
      <line x1="5" y1="5" x2="6.4" y2="6.4" />
      <line x1="-6.4" y1="6.4" x2="-5" y2="5" />
      <line x1="5" y1="-5" x2="6.4" y2="-6.4" />
    </svg>
  );
}
function HouseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="-12 -12 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <path d="M -8 1 L 0 -7 L 8 1 L 8 8 L -8 8 Z" />
      <path d="M -2 8 L -2 3 L 2 3 L 2 8" />
    </svg>
  );
}
function PlugIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="-12 -12 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="M 0 -8 L 0 8" />
      <path d="M -6 -2 L 0 -6 L 6 -2" />
      <path d="M -7 4 L 0 0 L 7 4" />
    </svg>
  );
}
function BattIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="-12 -12 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <rect x="-8" y="-5" width="14" height="10" rx="1.5" />
      <rect x="6" y="-2" width="2" height="4" rx="0.5" fill="currentColor" stroke="none" />
      <rect
        x="-6"
        y="-3"
        width="6"
        height="6"
        rx="0.5"
        fill="currentColor"
        stroke="none"
        opacity="0.5"
      />
    </svg>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────
function fmtW(w: number): string {
  if (Math.abs(w) >= 1000) return (w / 1000).toFixed(2);
  return Math.round(w).toString();
}
function unitFor(w: number): string {
  return Math.abs(w) >= 1000 ? "kW" : "W";
}

function Pulse({ color, size = 6 }: { color: string; size?: number }) {
  const inner: CSSProperties = {
    position: "absolute",
    inset: 0,
    borderRadius: "50%",
    background: color,
    boxShadow: `0 0 8px ${color}`,
  };
  const ring: CSSProperties = {
    position: "absolute",
    inset: 0,
    borderRadius: "50%",
    background: color,
    opacity: 0.5,
    animation: "fx-pulse 1.6s ease-out infinite",
  };
  return (
    <span
      style={{
        position: "relative",
        display: "inline-block",
        width: size,
        height: size,
        marginRight: 8,
      }}
    >
      <span style={inner} />
      <span style={ring} />
    </span>
  );
}

function Sparkline({
  color,
  seed = 1,
  height = 36,
  width = 120,
}: {
  color: string;
  seed?: number;
  height?: number;
  width?: number;
}) {
  const N = 28;
  const pts: [number, number][] = [];
  let v = 0.5;
  let r = seed;
  for (let i = 0; i < N; i++) {
    r = (r * 9301 + 49297) % 233280;
    const noise = (r / 233280 - 0.5) * 0.35;
    v = Math.max(0.08, Math.min(0.92, v + noise));
    pts.push([(i / (N - 1)) * width, height - v * height]);
  }
  const d = pts
    .map((p, i) =>
      i === 0
        ? `M ${p[0]} ${p[1]}`
        : `L ${p[0].toFixed(1)} ${p[1].toFixed(1)}`,
    )
    .join(" ");
  const fill = `${d} L ${width} ${height} L 0 ${height} Z`;
  const gradId = `spk-${seed}`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      style={{ display: "block" }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill={`url(#${gradId})`} />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          width: 8,
          height: 2,
          borderRadius: 1,
          background: color,
          boxShadow: `0 0 6px ${color}`,
        }}
      />
      {label}
    </span>
  );
}
