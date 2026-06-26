"use client";

import { useEffect, useRef, useState } from "react";

interface ForceChargeState {
  forceChargeSoc: number | null;
  forceChargeWatts: number;
  forceChargeStartAt: string | null;
  forceChargeEndAt: string | null;
  serverNow: string;
  batterySoc: number | null;
  switchOn: boolean | null;
  batteryPowerW: number | null;
}

// "HH:MM" (heure locale) → Date ISO future. Si l'heure est déjà passée
// aujourd'hui, on cale au lendemain.
function timeToIso(hhmm: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const d = new Date();
  d.setHours(h, min, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

function fmtRemaining(ms: number): string {
  if (ms <= 0) return "0 min";
  const totalMin = Math.ceil(ms / 60_000);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}

function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ForceChargeCard() {
  const [s, setS] = useState<ForceChargeState | null>(null);
  const [targetSoc, setTargetSoc] = useState("90");
  const [watts, setWatts] = useState("1000");
  const [scheduleMode, setScheduleMode] = useState<"now" | "at">("now");
  const [startTime, setStartTime] = useState("02:00");
  const [durationMin, setDurationMin] = useState("");
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
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

  // Horloge locale pour les comptes à rebours.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
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

  function start() {
    touched.current = false;
    const payload: Record<string, unknown> = {
      forceChargeSoc: Number(targetSoc),
      forceChargeWatts: Number(watts),
    };
    if (scheduleMode === "at") {
      const iso = timeToIso(startTime);
      if (!iso) return;
      payload.startAt = iso;
    }
    const dur = Number(durationMin);
    if (durationMin.trim() && Number.isFinite(dur) && dur > 0) {
      payload.durationMin = dur;
    }
    post(payload);
  }

  const armed = s?.forceChargeSoc != null;
  const startMs = s?.forceChargeStartAt ? new Date(s.forceChargeStartAt).getTime() : null;
  const endMs = s?.forceChargeEndAt ? new Date(s.forceChargeEndAt).getTime() : null;
  const pending = armed && startMs !== null && nowMs < startMs;
  const running = armed && !pending;

  const soc = s?.batterySoc ?? null;
  const target = s?.forceChargeSoc ?? Number(targetSoc);
  const charging = s?.batteryPowerW != null && s.batteryPowerW < -30;
  const pct =
    armed && soc != null && target > 0
      ? Math.max(0, Math.min(100, Math.round((soc / target) * 100)))
      : 0;
  // Mode durée + plafond SoC atteint → on maintient jusqu'à l'échéance.
  const holding = running && endMs !== null && soc != null && soc >= target;

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

      {pending ? (
        <div className="relative space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sky-300 text-sm font-semibold">
              Programmé à {startMs ? fmtClock(s!.forceChargeStartAt!) : "—"} → {s?.forceChargeSoc} %
            </span>
            <span className="text-[11px] text-zinc-400 tabular-nums">
              dans {startMs ? fmtRemaining(startMs - nowMs) : "—"}
            </span>
          </div>
          <p className="text-[11px] text-zinc-500">
            {s?.forceChargeWatts} W
            {endMs
              ? ` · s'arrête à ${fmtClock(s!.forceChargeEndAt!)} ou à la cible`
              : " · jusqu'à la cible"}
            . Le pilotage normal continue jusqu&rsquo;au démarrage.
          </p>
          <button
            onClick={() => post({ forceChargeSoc: null })}
            disabled={busy}
            className="btn-ghost text-xs w-full justify-center"
          >
            Annuler la programmation
          </button>
        </div>
      ) : running ? (
        <div className="relative space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-amber-300 text-sm font-semibold">
              {holding
                ? `Plafond ${s?.forceChargeSoc} % atteint`
                : `Charge forcée → ${s?.forceChargeSoc} %`}
            </span>
            <span className="text-[11px] text-zinc-400 tabular-nums">
              {s?.forceChargeWatts} W
              {holding
                ? " · maintien"
                : charging
                  ? " · en charge"
                  : s?.switchOn
                    ? " · prise ON"
                    : ""}
            </span>
          </div>
          {!holding && (
            <div className="h-2 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full bg-amber-400 transition-[width] duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
          <p className="text-[11px] text-zinc-500">
            {endMs
              ? `Arrêt auto dans ${fmtRemaining(endMs - nowMs)}${holding ? "" : " (ou à la cible)"}. `
              : ""}
            {holding
              ? "Cible atteinte, charge maintenue jusqu'à la fin de la durée."
              : "Tire sur le réseau si le surplus solaire ne suffit pas."}
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

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="text-xs text-zinc-400">Démarrage</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setScheduleMode("now")}
                  className={`flex-1 px-2 py-1.5 rounded text-xs transition ${
                    scheduleMode === "now"
                      ? "bg-amber-700/80 text-white"
                      : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  }`}
                >
                  Maintenant
                </button>
                <button
                  type="button"
                  onClick={() => setScheduleMode("at")}
                  className={`flex-1 px-2 py-1.5 rounded text-xs transition ${
                    scheduleMode === "at"
                      ? "bg-sky-700/80 text-white"
                      : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  }`}
                >
                  Programmé
                </button>
              </div>
              {scheduleMode === "at" && (
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="input-base"
                />
              )}
            </div>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-xs text-zinc-400">Durée max</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step={15}
                  placeholder="illimité"
                  value={durationMin}
                  onChange={(e) => setDurationMin(e.target.value)}
                  className="input-base flex-1 min-w-0"
                />
                <span className="text-xs text-zinc-500 w-8 text-right">min</span>
              </div>
            </label>
          </div>

          {durationMin.trim() && Number(durationMin) > 0 ? (
            soc != null && Number(targetSoc) <= soc && (
              <p className="text-[11px] text-sky-400">
                Durée prioritaire : SoC actuel ({Math.round(soc)} %) ≥ cible — la
                cible sert de plafond, la charge tient toute la durée.
              </p>
            )
          ) : (
            soc != null && Number(targetSoc) <= soc && (
              <p className="text-[11px] text-amber-400">
                ⚠️ SoC actuel ({Math.round(soc)} %) ≥ cible : sans durée, le
                forçage s&rsquo;arrêtera aussitôt. Ajoute une durée ou monte la cible.
              </p>
            )
          )}
          <button
            onClick={start}
            disabled={
              busy ||
              !Number.isFinite(Number(targetSoc)) ||
              (scheduleMode === "at" && !timeToIso(startTime))
            }
            className="btn-primary w-full justify-center"
          >
            {scheduleMode === "at" ? "Programmer la charge forcée" : "Lancer la charge forcée"}
          </button>
        </div>
      )}
    </div>
  );
}
