"use client";

import { useEffect, useRef, useState } from "react";

interface ForceChargeState {
  forceChargeSoc: number | null;
  forceChargeWatts: number;
  batterySoc: number | null;
  switchOn: boolean | null;
  batteryPowerW: number | null;
}

export default function ForceChargeCard() {
  const [s, setS] = useState<ForceChargeState | null>(null);
  const [targetSoc, setTargetSoc] = useState("90");
  const [watts, setWatts] = useState("1000");
  const [busy, setBusy] = useState(false);
  // Tant que l'utilisateur n'a pas touché les champs, on les garde alignés
  // sur la dernière valeur serveur.
  const touched = useRef(false);

  async function refresh() {
    try {
      const r = await fetch("/api/control/force-charge", { cache: "no-store" });
      if (!r.ok) return;
      const d: ForceChargeState = await r.json();
      setS(d);
      if (!touched.current && d.forceChargeWatts) setWatts(String(d.forceChargeWatts));
      if (!touched.current && d.forceChargeSoc != null)
        setTargetSoc(String(d.forceChargeSoc));
    } catch {
      /* réseau LAN, on réessaie au prochain tick */
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, []);

  async function post(payload: Record<string, unknown>) {
    setBusy(true);
    try {
      await fetch("/api/control/force-charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const active = s?.forceChargeSoc != null;
  const soc = s?.batterySoc ?? null;
  const target = s?.forceChargeSoc ?? Number(targetSoc);
  const charging = s?.batteryPowerW != null && s.batteryPowerW < -30;
  const pct =
    active && soc != null && target > 0
      ? Math.max(0, Math.min(100, Math.round((soc / target) * 100)))
      : 0;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-white/[0.03] backdrop-blur-sm ring-1 ring-amber-500/30 p-4 sm:p-5">
      <div className="pointer-events-none absolute inset-x-0 -top-12 h-24 bg-gradient-to-b from-amber-500/15 to-transparent blur-xl" />
      <div className="relative flex items-center justify-between gap-3 mb-3">
        <span className="text-[10px] sm:text-[11px] uppercase tracking-[0.14em] text-zinc-400">
          Forcer la recharge
        </span>
        <span className="text-[11px] text-zinc-500 tabular-nums">
          SoC {soc === null ? "—" : `${Math.round(soc)} %`}
        </span>
      </div>

      {active ? (
        <div className="relative space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-amber-300 text-sm font-semibold">
              Charge forcée → {s?.forceChargeSoc} %
            </span>
            <span className="text-[11px] text-zinc-400 tabular-nums">
              {s?.forceChargeWatts} W{charging ? " · en charge" : s?.switchOn ? " · prise ON" : ""}
            </span>
          </div>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-amber-400 transition-[width] duration-700"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-[11px] text-zinc-500">
            Tire sur le réseau si le surplus solaire ne suffit pas. S&rsquo;arrête
            automatiquement à la cible.
          </p>
          <button
            onClick={() => post({ forceChargeSoc: null })}
            disabled={busy}
            className="btn-ghost text-xs w-full justify-center"
          >
            Arrêter le forçage
          </button>
        </div>
      ) : (
        <div className="relative space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-xs text-zinc-400">SoC cible</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={5}
                  max={100}
                  value={targetSoc}
                  onChange={(e) => {
                    touched.current = true;
                    setTargetSoc(e.target.value);
                  }}
                  className="input-base flex-1 min-w-0"
                />
                <span className="text-xs text-zinc-500 w-4 text-right">%</span>
              </div>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-xs text-zinc-400">Puissance</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={100}
                  max={2000}
                  step={100}
                  value={watts}
                  onChange={(e) => {
                    touched.current = true;
                    setWatts(e.target.value);
                  }}
                  className="input-base flex-1 min-w-0"
                />
                <span className="text-xs text-zinc-500 w-4 text-right">W</span>
              </div>
            </label>
          </div>
          <button
            onClick={() => {
              touched.current = false;
              post({
                forceChargeSoc: Number(targetSoc),
                forceChargeWatts: Number(watts),
              });
            }}
            disabled={busy || !Number.isFinite(Number(targetSoc))}
            className="btn-primary w-full justify-center"
          >
            Lancer la charge forcée
          </button>
        </div>
      )}
    </div>
  );
}
