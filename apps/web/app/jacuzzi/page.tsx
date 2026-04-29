"use client";

import { useEffect, useState } from "react";

interface JacuzziState {
  host: string | null;
  enabled: boolean;
  reachable: boolean;
  heaterOn: boolean | null;
  currentTempC: number | null;
  presetTempC: number | null;
  errorCode: string | null;
  lastError: string | null;
  failureCount: number;
  lastTickAtMs: number | null;
  surplusHold: { active: boolean; elapsedMs: number | null; targetMs: number; remainingMs: number | null };
  gridHold: { active: boolean; elapsedMs: number | null; targetMs: number; remainingMs: number | null };
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
  const [saving, setSaving] = useState(false);

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

  async function patch(data: Record<string, unknown>) {
    setSaving(true);
    try {
      await fetch("/api/jacuzzi/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  if (!s) {
    return (
      <div className="p-6 text-sm text-zinc-400">
        {err ? `Erreur : ${err}` : "Chargement…"}
      </div>
    );
  }

  const heaterColor =
    s.heaterOn === true ? "text-orange-400" : s.heaterOn === false ? "text-zinc-400" : "text-zinc-600";
  const reachableColor = s.reachable ? "text-emerald-400" : "text-rose-400";

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div>
        <h1 className="page-h1">Jacuzzi</h1>
        <p className="page-sub mt-1">
          Pilotage du chauffage Intex via module Wi-Fi local (
          <code className="text-zinc-300">{s.host ?? "—"}</code>).
        </p>
      </div>

      <section className="card p-4 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
          État live
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-xs text-zinc-500">Module</div>
            <div className={reachableColor}>
              {s.reachable ? "Joignable" : "Injoignable"}
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Chauffage</div>
            <div className={heaterColor}>
              {s.heaterOn === null ? "—" : s.heaterOn ? "ON" : "OFF"}
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Eau</div>
            <div>{s.currentTempC ?? "—"} °C</div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Consigne</div>
            <div>{s.presetTempC ?? "—"} °C</div>
          </div>
        </div>
        {s.errorCode && (
          <div className="text-rose-400 text-sm">
            Erreur module : <code>{s.errorCode}</code>
          </div>
        )}
        {s.lastError && !s.reachable && (
          <div className="text-rose-400 text-xs">{s.lastError}</div>
        )}
      </section>

      <section className="card p-4 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
          Asservissement
        </h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs text-zinc-500">Hold surplus (allumage)</div>
            <div>
              {s.surplusHold.active
                ? `${fmtSec(s.surplusHold.elapsedMs)} / ${fmtSec(s.surplusHold.targetMs)}`
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Hold import (coupure)</div>
            <div>
              {s.gridHold.active
                ? `${fmtSec(s.gridHold.elapsedMs)} / ${fmtSec(s.gridHold.targetMs)}`
                : "—"}
            </div>
          </div>
        </div>
      </section>

      <section className="card p-4 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
          Mode
        </h2>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={s.ctrl.jacuzziEnabled}
            onChange={(e) => patch({ jacuzziEnabled: e.target.checked })}
            disabled={saving}
          />
          <span>Pilotage automatique par surplus</span>
        </label>

        <div>
          <div className="text-xs text-zinc-500 mb-2">Override manuel</div>
          <div className="flex gap-2">
            <button
              className={`px-3 py-1.5 rounded text-sm ${s.ctrl.jacuzziManualOverride === null ? "bg-emerald-700 text-white" : "bg-zinc-800 text-zinc-300"}`}
              onClick={() => patch({ jacuzziManualOverride: null })}
              disabled={saving}
            >
              Auto
            </button>
            <button
              className={`px-3 py-1.5 rounded text-sm ${s.ctrl.jacuzziManualOverride === true ? "bg-orange-700 text-white" : "bg-zinc-800 text-zinc-300"}`}
              onClick={() => patch({ jacuzziManualOverride: true })}
              disabled={saving}
            >
              Forcer ON
            </button>
            <button
              className={`px-3 py-1.5 rounded text-sm ${s.ctrl.jacuzziManualOverride === false ? "bg-rose-700 text-white" : "bg-zinc-800 text-zinc-300"}`}
              onClick={() => patch({ jacuzziManualOverride: false })}
              disabled={saving}
            >
              Forcer OFF
            </button>
          </div>
        </div>
      </section>

      <section className="card p-4 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
          Seuils
        </h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <NumField
            label="Surplus min allumage (W)"
            value={s.ctrl.jacuzziStartSurplusW}
            onSave={(v) => patch({ jacuzziStartSurplusW: v })}
          />
          <NumField
            label="Import max coupure (W)"
            value={s.ctrl.jacuzziStopGridW}
            onSave={(v) => patch({ jacuzziStopGridW: v })}
          />
          <NumField
            label="Hold allumage (s)"
            value={s.ctrl.jacuzziStartHoldS}
            onSave={(v) => patch({ jacuzziStartHoldS: v })}
          />
          <NumField
            label="Hold coupure (s)"
            value={s.ctrl.jacuzziStopHoldS}
            onSave={(v) => patch({ jacuzziStopHoldS: v })}
          />
          <NumField
            label="SoC batterie min (%)"
            value={s.ctrl.jacuzziMinSocPct}
            onSave={(v) => patch({ jacuzziMinSocPct: v })}
          />
          <label className="flex items-center gap-2 text-sm mt-1">
            <input
              type="checkbox"
              checked={s.ctrl.jacuzziTempoBlockRedHp}
              onChange={(e) => patch({ jacuzziTempoBlockRedHp: e.target.checked })}
              disabled={saving}
            />
            <span>Bloquer en HP Tempo rouge</span>
          </label>
        </div>
      </section>
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
