"use client";

import { useEffect, useState } from "react";

interface JacuzziState {
  host: string | null;
  enabled: boolean;
  reachable: boolean;
  power: boolean | null;
  heaterOn: boolean | null;
  filterOn: boolean | null;
  jetsOn: boolean | null;
  bubblesOn: boolean | null;
  sanitizerOn: boolean | null;
  currentTempC: number | null;
  presetTempC: number | null;
  errorCode: string | null;
  lastError: string | null;
  failureCount: number;
  lastTickAtMs: number | null;
  surplusHold: { active: boolean; elapsedMs: number | null; targetMs: number; remainingMs: number | null };
  gridHold: { active: boolean; elapsedMs: number | null; targetMs: number; remainingMs: number | null };
  plug: {
    deviceId: string | null;
    name: string | null;
    powerW: number | null;
    switchOn: boolean | null;
    ts: string | null;
  };
  ctrl: {
    jacuzziEnabled: boolean;
    jacuzziStartSurplusW: number;
    jacuzziStopGridW: number;
    jacuzziStartHoldS: number;
    jacuzziStopHoldS: number;
    jacuzziMinSocPct: number;
    jacuzziTempoBlockRedHp: boolean;
    jacuzziManualOverride: boolean | null;
  };
}

type FnKey = "power" | "heater" | "filter" | "jets" | "bubbles" | "sanitizer";

function fmtSec(ms: number | null): string {
  if (ms === null) return "—";
  return `${Math.floor(ms / 1000)}s`;
}

export default function JacuzziPage() {
  const [s, setS] = useState<JacuzziState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function refresh() {
    try {
      const r = await fetch("/api/jacuzzi/state", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setS(await r.json());
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, []);

  async function patchCtrl(data: Record<string, unknown>) {
    setBusy("ctrl");
    try {
      await fetch("/api/jacuzzi/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function toggle(fn: FnKey, on: boolean) {
    setBusy(fn);
    try {
      const r = await fetch("/api/jacuzzi/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fn, on }),
      });
      const j = await r.json();
      if (!j.ok) setErr(j.error ?? "erreur toggle");
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function setTemp(temp: number) {
    setBusy("temp");
    try {
      await fetch("/api/jacuzzi/preset-temp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ temp }),
      });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  if (!s) {
    return (
      <div className="p-6 text-sm text-zinc-400">
        {err ? `Erreur : ${err}` : "Chargement…"}
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-4xl mx-auto">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-h1">Jacuzzi</h1>
          <p className="page-sub mt-1">
            Module Wi-Fi Intex — <code className="text-zinc-300">{s.host ?? "—"}</code>{" "}
            {s.reachable ? (
              <span className="text-emerald-400">● en ligne</span>
            ) : (
              <span className="text-rose-400">● hors-ligne</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {s.plug.deviceId && (
            <div className="text-right">
              <div className="text-xs text-zinc-500">{s.plug.name ?? "Prise jacuzzi"}</div>
              <div className="text-2xl font-bold tabular-nums text-amber-300">
                {s.plug.powerW !== null ? `${Math.round(s.plug.powerW)} W` : "— W"}
              </div>
            </div>
          )}
          {s.errorCode && (
            <span className="text-rose-400 text-sm">
              Erreur module <code>{s.errorCode}</code>
            </span>
          )}
        </div>
      </div>

      <SpaSchema s={s} busy={busy} onToggle={toggle} onSetTemp={setTemp} />

      <section className="card p-4 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
          Mode pilotage
        </h2>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={s.ctrl.jacuzziEnabled}
            onChange={(e) => patchCtrl({ jacuzziEnabled: e.target.checked })}
            disabled={busy !== null}
          />
          <span>Pilotage automatique par surplus solaire</span>
        </label>

        <div>
          <div className="text-xs text-zinc-500 mb-2">Override manuel chauffage</div>
          <div className="flex gap-2">
            <button
              className={`px-3 py-1.5 rounded text-sm transition ${s.ctrl.jacuzziManualOverride === null ? "bg-emerald-700 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
              onClick={() => patchCtrl({ jacuzziManualOverride: null })}
            >
              Auto
            </button>
            <button
              className={`px-3 py-1.5 rounded text-sm transition ${s.ctrl.jacuzziManualOverride === true ? "bg-orange-700 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
              onClick={() => patchCtrl({ jacuzziManualOverride: true })}
            >
              Forcer ON
            </button>
            <button
              className={`px-3 py-1.5 rounded text-sm transition ${s.ctrl.jacuzziManualOverride === false ? "bg-rose-700 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
              onClick={() => patchCtrl({ jacuzziManualOverride: false })}
            >
              Forcer OFF
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm pt-2 border-t border-zinc-800">
          <div>
            <div className="text-xs text-zinc-500">Hold surplus (allumage)</div>
            <div className="font-mono text-emerald-300">
              {s.surplusHold.active
                ? `${fmtSec(s.surplusHold.elapsedMs)} / ${fmtSec(s.surplusHold.targetMs)}`
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Hold import (coupure)</div>
            <div className="font-mono text-rose-300">
              {s.gridHold.active
                ? `${fmtSec(s.gridHold.elapsedMs)} / ${fmtSec(s.gridHold.targetMs)}`
                : "—"}
            </div>
          </div>
        </div>
      </section>

      <section className="card p-4 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
          Seuils
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <NumField label="Surplus min allumage (W)" value={s.ctrl.jacuzziStartSurplusW} onSave={(v) => patchCtrl({ jacuzziStartSurplusW: v })} />
          <NumField label="Import max coupure (W)" value={s.ctrl.jacuzziStopGridW} onSave={(v) => patchCtrl({ jacuzziStopGridW: v })} />
          <NumField label="Hold allumage (s)" value={s.ctrl.jacuzziStartHoldS} onSave={(v) => patchCtrl({ jacuzziStartHoldS: v })} />
          <NumField label="Hold coupure (s)" value={s.ctrl.jacuzziStopHoldS} onSave={(v) => patchCtrl({ jacuzziStopHoldS: v })} />
          <NumField label="SoC batterie min (%)" value={s.ctrl.jacuzziMinSocPct} onSave={(v) => patchCtrl({ jacuzziMinSocPct: v })} />
          <label className="flex items-center gap-2 text-sm self-end">
            <input
              type="checkbox"
              checked={s.ctrl.jacuzziTempoBlockRedHp}
              onChange={(e) => patchCtrl({ jacuzziTempoBlockRedHp: e.target.checked })}
            />
            <span>Bloquer en HP Tempo rouge</span>
          </label>
        </div>
      </section>

      {s.lastError && !s.reachable && (
        <div className="text-rose-400 text-xs">{s.lastError}</div>
      )}
    </div>
  );
}

function SpaSchema({
  s,
  busy,
  onToggle,
  onSetTemp,
}: {
  s: JacuzziState;
  busy: string | null;
  onToggle: (fn: FnKey, on: boolean) => void;
  onSetTemp: (t: number) => void;
}) {
  const heat = s.heaterOn === true;
  const filter = s.filterOn === true;
  const jets = s.jetsOn === true;
  const bubbles = s.bubblesOn === true;
  const sanitizer = s.sanitizerOn === true;
  const power = s.power === true;
  const tempC = s.currentTempC ?? 0;
  const presetC = s.presetTempC ?? 0;

  // Couleur de l'eau selon T° (15°C = bleu froid → 40°C = orange chaud).
  const waterHue = Math.max(0, Math.min(220, 220 - ((tempC - 15) / 25) * 220));
  const waterColor = `hsl(${waterHue}, 70%, 55%)`;

  return (
    <section className="card p-4 sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300 mb-4">
        Schéma & commandes
      </h2>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6 items-center">
        {/* Schéma SVG */}
        <div className="flex justify-center">
          <svg viewBox="0 0 320 220" className="w-full max-w-md drop-shadow-lg">
            <defs>
              <linearGradient id="tubBody" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3f3f46" />
                <stop offset="100%" stopColor="#27272a" />
              </linearGradient>
              <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={waterColor} stopOpacity="0.8" />
                <stop offset="100%" stopColor={waterColor} stopOpacity="0.4" />
              </linearGradient>
              <radialGradient id="heaterGlow" cx="0.5" cy="0.5" r="0.6">
                <stop offset="0%" stopColor="#fb923c" stopOpacity={heat ? 0.85 : 0} />
                <stop offset="100%" stopColor="#fb923c" stopOpacity="0" />
              </radialGradient>
              <pattern id="bubblesPat" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                <circle cx="5" cy="10" r={bubbles ? 2 : 0} fill="#bae6fd" opacity="0.7">
                  {bubbles && <animate attributeName="cy" from="20" to="0" dur="1.6s" repeatCount="indefinite" />}
                </circle>
                <circle cx="14" cy="6" r={bubbles ? 1.5 : 0} fill="#bae6fd" opacity="0.6">
                  {bubbles && <animate attributeName="cy" from="20" to="0" dur="2.2s" repeatCount="indefinite" />}
                </circle>
              </pattern>
            </defs>

            {/* Corps du jacuzzi (vue isométrique simplifiée) */}
            <ellipse cx="160" cy="190" rx="140" ry="20" fill="#0a0a0a" opacity="0.6" />
            <path d="M30 80 Q30 50 60 50 H260 Q290 50 290 80 V160 Q290 200 260 200 H60 Q30 200 30 160 Z"
              fill="url(#tubBody)" stroke="#52525b" strokeWidth="1.5" />

            {/* Eau */}
            <path d="M50 90 Q50 70 70 70 H250 Q270 70 270 90 V155 Q270 180 250 180 H70 Q50 180 50 155 Z"
              fill="url(#water)" />
            {/* Surface de l'eau (vagues) */}
            <path d="M50 90 Q70 85 90 90 T130 90 T170 90 T210 90 T250 90 T270 90 V92 H50 Z"
              fill={waterColor} opacity="0.6">
              {power && <animate attributeName="d"
                values="M50 90 Q70 85 90 90 T130 90 T170 90 T210 90 T250 90 T270 90 V92 H50 Z;M50 90 Q70 92 90 88 T130 91 T170 89 T210 92 T250 88 T270 90 V92 H50 Z;M50 90 Q70 85 90 90 T130 90 T170 90 T210 90 T250 90 T270 90 V92 H50 Z"
                dur="3s" repeatCount="indefinite" />}
            </path>

            {/* Bulles animées */}
            {bubbles && (
              <rect x="50" y="92" width="220" height="88" fill="url(#bubblesPat)" />
            )}

            {/* Glow chauffage */}
            <ellipse cx="160" cy="135" rx="100" ry="40" fill="url(#heaterGlow)">
              {heat && <animate attributeName="rx" values="80;110;80" dur="2.4s" repeatCount="indefinite" />}
            </ellipse>

            {/* Jets : flèches latérales */}
            {jets && (
              <g stroke="#a5f3fc" strokeWidth="2" fill="none" strokeLinecap="round">
                <path d="M58 130 L80 132 M58 130 L65 125 M58 130 L65 135">
                  <animate attributeName="opacity" values="0.3;1;0.3" dur="0.8s" repeatCount="indefinite" />
                </path>
                <path d="M262 130 L240 132 M262 130 L255 125 M262 130 L255 135">
                  <animate attributeName="opacity" values="0.3;1;0.3" dur="0.8s" repeatCount="indefinite" />
                </path>
              </g>
            )}

            {/* Filtre : icône latérale */}
            <g transform="translate(15, 110)">
              <rect x="0" y="0" width="14" height="38" rx="2"
                fill={filter ? "#06b6d4" : "#3f3f46"} stroke="#52525b" strokeWidth="1" />
              {filter && <circle cx="7" cy="19" r="3" fill="#a5f3fc">
                <animate attributeName="r" values="2;4;2" dur="1.5s" repeatCount="indefinite" />
              </circle>}
            </g>

            {/* Sanitizer : pastille */}
            <g transform="translate(290, 110)">
              <circle cx="7" cy="19" r="8"
                fill={sanitizer ? "#a78bfa" : "#3f3f46"} stroke="#52525b" strokeWidth="1" />
              {sanitizer && <text x="7" y="22" textAnchor="middle" fontSize="9" fill="#fff">+</text>}
            </g>

            {/* Affichage température + puissance au centre */}
            <g>
              <rect x="110" y="100" width="100" height="62" rx="6" fill="#000" opacity="0.6" />
              <text x="160" y="123" textAnchor="middle" fontSize="22" fontWeight="700" fill="#fff">
                {tempC}°C
              </text>
              <text x="160" y="139" textAnchor="middle" fontSize="10" fill="#a1a1aa">
                cible {presetC}°
              </text>
              <text x="160" y="155" textAnchor="middle" fontSize="11" fontWeight="600" fill="#fcd34d">
                {s.plug.powerW !== null ? `${Math.round(s.plug.powerW)} W` : "— W"}
              </text>
            </g>

            {/* LED power */}
            <circle cx="55" cy="60" r="4"
              fill={power ? "#10b981" : "#52525b"} stroke="#000" strokeWidth="1">
              {power && <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />}
            </circle>
          </svg>
        </div>

        {/* Commandes */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <CmdButton label="Power" emoji="⏻" on={power} busy={busy === "power"} onClick={() => onToggle("power", !power)} colorOn="emerald" />
            <CmdButton label="Chauffage" emoji="🔥" on={heat} busy={busy === "heater"} onClick={() => onToggle("heater", !heat)} colorOn="orange" />
            <CmdButton label="Filtre" emoji="💧" on={filter} busy={busy === "filter"} onClick={() => onToggle("filter", !filter)} colorOn="cyan" />
            <CmdButton label="Jets" emoji="💨" on={jets} busy={busy === "jets"} onClick={() => onToggle("jets", !jets)} colorOn="sky" />
            <CmdButton label="Bulles" emoji="🫧" on={bubbles} busy={busy === "bubbles"} onClick={() => onToggle("bubbles", !bubbles)} colorOn="blue" />
            <CmdButton label="Sanit." emoji="✨" on={sanitizer} busy={busy === "sanitizer"} onClick={() => onToggle("sanitizer", !sanitizer)} colorOn="violet" />
          </div>

          <div className="card-inset p-3 rounded-lg bg-zinc-900/60 border border-zinc-800">
            <div className="text-xs text-zinc-500 mb-2">Consigne température</div>
            <div className="flex items-center justify-between">
              <button
                className="w-10 h-10 rounded-full bg-zinc-800 hover:bg-zinc-700 text-xl font-bold disabled:opacity-50"
                onClick={() => onSetTemp(Math.max(20, presetC - 1))}
                disabled={busy !== null}
              >
                −
              </button>
              <div className="text-3xl font-bold tabular-nums">{presetC}°C</div>
              <button
                className="w-10 h-10 rounded-full bg-zinc-800 hover:bg-zinc-700 text-xl font-bold disabled:opacity-50"
                onClick={() => onSetTemp(Math.min(40, presetC + 1))}
                disabled={busy !== null}
              >
                +
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CmdButton({
  label,
  emoji,
  on,
  busy,
  onClick,
  colorOn,
}: {
  label: string;
  emoji: string;
  on: boolean;
  busy: boolean;
  onClick: () => void;
  colorOn: "emerald" | "orange" | "cyan" | "sky" | "blue" | "violet";
}) {
  const onClasses: Record<string, string> = {
    emerald: "bg-emerald-600 border-emerald-400 text-white shadow-emerald-500/40",
    orange: "bg-orange-600 border-orange-400 text-white shadow-orange-500/40",
    cyan: "bg-cyan-600 border-cyan-400 text-white shadow-cyan-500/40",
    sky: "bg-sky-600 border-sky-400 text-white shadow-sky-500/40",
    blue: "bg-blue-600 border-blue-400 text-white shadow-blue-500/40",
    violet: "bg-violet-600 border-violet-400 text-white shadow-violet-500/40",
  };
  const cls = on
    ? `${onClasses[colorOn]} shadow-lg`
    : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:bg-zinc-800";
  return (
    <button
      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border transition ${cls} ${busy ? "opacity-60 animate-pulse" : ""}`}
      onClick={onClick}
      disabled={busy}
    >
      <span className="text-lg">{emoji}</span>
      <span className="text-sm font-medium">{label}</span>
      <span className="ml-auto text-xs">{on ? "ON" : "OFF"}</span>
    </button>
  );
}

function NumField({
  label,
  value,
  onSave,
}: {
  label: string;
  value: number;
  onSave: (v: number) => void;
}) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-zinc-500">{label}</span>
      <input
        type="number"
        className="input-base"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const n = Number(v);
          if (Number.isFinite(n) && n !== value) onSave(n);
        }}
      />
    </label>
  );
}
