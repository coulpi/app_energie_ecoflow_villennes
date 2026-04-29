"use client";

import { useEffect, useState } from "react";
import { JacuzziPanel, type JacuzziFn } from "./JacuzziPanel";

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

function fmtSec(ms: number | null): string {
  if (ms === null) return "—";
  return `${Math.floor(ms / 1000)}s`;
}

export default function JacuzziPage() {
  const [s, setS] = useState<JacuzziState | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, []);

  async function patchCtrl(data: Record<string, unknown>) {
    await fetch("/api/jacuzzi/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    await refresh();
  }

  async function onToggle(fn: JacuzziFn, on: boolean) {
    await fetch("/api/jacuzzi/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fn, on }),
    });
    await refresh();
  }

  async function onSetPresetTemp(temp: number) {
    await fetch("/api/jacuzzi/preset-temp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ temp }),
    });
    await refresh();
  }

  if (!s) {
    return (
      <div className="p-6 text-sm text-zinc-400">
        {err ? `Erreur : ${err}` : "Chargement…"}
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-[1200px] mx-auto">
      <JacuzziPanel
        host={s.host}
        plugName={s.plug.name}
        plugPowerW={s.plug.powerW}
        plugTs={s.plug.ts}
        power={s.power ?? false}
        heaterOn={s.heaterOn ?? false}
        filterOn={s.filterOn ?? false}
        jetsOn={s.jetsOn ?? false}
        bubblesOn={s.bubblesOn ?? false}
        sanitizerOn={s.sanitizerOn ?? false}
        currentTempC={s.currentTempC ?? 0}
        presetTempC={s.presetTempC ?? 20}
        reachable={s.reachable}
        errorCode={s.errorCode}
        onToggle={onToggle}
        onSetPresetTemp={onSetPresetTemp}
        view="iso"
      />

      <div className="space-y-5">
        <section className="card p-4 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
            Mode pilotage
          </h2>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={s.ctrl.jacuzziEnabled}
              onChange={(e) => patchCtrl({ jacuzziEnabled: e.target.checked })}
            />
            <span>Pilotage automatique par surplus solaire</span>
          </label>

          <div>
            <div className="text-xs text-zinc-500 mb-2">Override manuel chauffage</div>
            <div className="flex gap-2 flex-wrap">
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
    </div>
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
