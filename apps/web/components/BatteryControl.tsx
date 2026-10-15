"use client";

// Pilotage batterie (ex-bloc « Pilotage batterie » de /flow) : état live
// de la boucle FOLLOW_LOAD (prise AC, tolérance déficit, verrou), réglages
// charge / décharge et décharge programmée Tempo → POST /api/control/battery.
// Commandes PowerStream → POST /api/ecoflow/powerstream.

import { useEffect, useState } from "react";
import type { DashboardSnapshot } from "@/lib/snapshot";
import { fmtPower, Section } from "./ui";
import { TempoChip } from "./widgets";

interface FollowLoadState {
  switchOn: boolean | null;
  chargeW: number | null;
  deficit: { active: boolean; remainingMs: number | null };
  offLock: { active: boolean; remainingMs: number | null };
}

interface Settings {
  followLoadMaxW: number;
  chargeMaxW: number;
  chargeMinW: number;
  chargeOffsetW: number;
  chargeDeficitTimeoutMin: number;
  chargeOffToOnLockMin: number;
  tempoEnabled: boolean;
  tempoRedDischargeHour: number;
  tempoOtherDischargeHour: number;
  tempoDischargeEndHour: number;
  tempoDischargeTargetW: number;
}

const fromSnap = (s: DashboardSnapshot): Settings => ({
  followLoadMaxW: s.followLoadMaxW ?? 800,
  chargeMaxW: s.chargeMaxW ?? 800,
  chargeMinW: s.chargeMinW ?? 400,
  chargeOffsetW: s.chargeOffsetW ?? 100,
  chargeDeficitTimeoutMin: s.chargeDeficitTimeoutMin ?? 10,
  chargeOffToOnLockMin: s.chargeOffToOnLockMin ?? 5,
  tempoEnabled: s.tempoEnabled ?? true,
  tempoRedDischargeHour: s.tempoRedDischargeHour ?? 17,
  tempoOtherDischargeHour: s.tempoOtherDischargeHour ?? 22,
  tempoDischargeEndHour: s.tempoDischargeEndHour ?? 6,
  tempoDischargeTargetW: s.tempoDischargeTargetW ?? 400,
});

const fmtCountdown = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function useSnapshot(initial: DashboardSnapshot) {
  const [snap, setSnap] = useState(initial);
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const r = await fetch("/api/snapshot", { cache: "no-store" });
        if (r.ok) setSnap(await r.json());
      } catch {
        // garde la dernière valeur
      }
    }, 5000);
    return () => clearInterval(id);
  }, []);
  return snap;
}

export default function BatteryControl({ initial }: { initial: DashboardSnapshot }) {
  const snap = useSnapshot(initial);
  const [form, setForm] = useState<Settings>(() => fromSnap(initial));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState<"idle" | "saving" | "ok" | "err">("idle");
  const [follow, setFollow] = useState<(FollowLoadState & { at: number }) | null>(null);
  const [, tick] = useState(0);

  // Re-synchronise depuis le serveur tant que l'utilisateur n'édite pas.
  useEffect(() => {
    if (!dirty) setForm(fromSnap(snap));
  }, [snap, dirty]);

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch("/api/follow-load/state", { cache: "no-store" });
        if (r.ok) setFollow({ ...((await r.json()) as FollowLoadState), at: Date.now() });
      } catch {
        // worker injoignable : pas de compte à rebours
      }
    };
    void load();
    const a = setInterval(load, 5000);
    const b = setInterval(() => tick((t) => t + 1), 1000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, []);

  const remaining = (ms: number | null | undefined) =>
    ms === null || ms === undefined || !follow ? null : Math.max(0, ms - (Date.now() - follow.at));
  const deficitMs = follow?.deficit.active ? remaining(follow.deficit.remainingMs) : null;
  const offLockMs = follow?.offLock.active ? remaining(follow.offLock.remainingMs) : null;

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };

  async function apply() {
    setSaving("saving");
    try {
      const r = await fetch("/api/control/battery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error(String(r.status));
      setSaving("ok");
      setDirty(false);
      setTimeout(() => setSaving("idle"), 1500);
    } catch {
      setSaving("err");
      setTimeout(() => setSaving("idle"), 2000);
    }
  }

  // Sortie vers la maison vs cible du suivi de charge.
  const dischargeW = Math.max(0, snap.batteryPowerW ?? 0);
  const isFollow = snap.controlMode === "FOLLOW_LOAD";
  const minW = snap.followLoadMinW ?? 0;
  const maxW = snap.followLoadMaxW ?? 0;
  const target = Math.max(minW, Math.min(maxW, (snap.consumptionW ?? 0) - (snap.followLoadOffsetW ?? 0)));
  const range = Math.max(1, maxW - minW);
  const pct = (w: number) => Math.min(100, Math.max(0, ((w - minW) / range) * 100));
  const acOn = snap.switchOn === true;
  const acPower = Math.max(0, snap.acSwitchPowerW ?? 0);
  const ac = fmtPower(acPower);
  const out = fmtPower(dischargeW);

  const applyBar = (
    <div className="flex items-center justify-end gap-3 pt-2">
      <span
        className={`text-xs ${saving === "ok" ? "text-emerald-400" : saving === "err" ? "text-rose-400" : "text-zinc-500"}`}
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
      <button type="button" onClick={apply} disabled={!dirty || saving === "saving"} className="btn-primary">
        Appliquer
      </button>
    </div>
  );

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-5">
      <Section title="Suivi en temps réel" sub="Boucle de pilotage automatique (worker)">
        <div className="space-y-4">
          <div
            className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${
              snap.acSwitchOnline === false
                ? "border-rose-500/30 bg-rose-500/[0.06]"
                : acOn
                  ? "border-violet-500/30 bg-violet-500/[0.06]"
                  : "border-zinc-800"
            }`}
          >
            <div>
              <div className="text-xs text-zinc-500">Prise AC de charge · réseau 2</div>
              <div className="text-sm text-zinc-100 mt-0.5">
                {snap.acSwitchOnline === false
                  ? "Hors ligne : commandes non délivrées"
                  : snap.switchOn === null
                    ? "État inconnu"
                    : acOn
                      ? acPower > 5
                        ? `Active · charge à ${ac.value} ${ac.unit}`
                        : "Active · veille"
                      : "Coupée"}
              </div>
            </div>
            <span
              className={`chip ${acOn ? "border-violet-500/40 text-violet-400" : "border-zinc-700 text-zinc-400"}`}
            >
              {snap.switchOn === null ? "—" : acOn ? "ON" : "OFF"}
            </span>
          </div>

          {deficitMs !== null && deficitMs > 0 && (
            <div className="flex items-center justify-between rounded-lg border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-sm">
              <span className="text-zinc-200">Tolérance déficit · coupure dans</span>
              <span className="font-mono font-semibold text-rose-400">{fmtCountdown(deficitMs)}</span>
            </div>
          )}
          {offLockMs !== null && offLockMs > 0 && (
            <div className="flex items-center justify-between rounded-lg border border-zinc-800 px-3 py-2 text-sm">
              <span className="text-zinc-200">Verrou redémarrage · ON possible dans</span>
              <span className="font-mono font-semibold text-zinc-400">{fmtCountdown(offLockMs)}</span>
            </div>
          )}

          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-xs text-zinc-500">Sortie vers la maison (PowerStream)</span>
              <span className="text-lg font-semibold tabular-nums text-violet-400">
                {out.value} <span className="text-xs text-zinc-400">{out.unit}</span>
              </span>
            </div>
            <div className="relative h-2 rounded-full overflow-hidden" style={{ background: "var(--track)" }}>
              <div className="absolute inset-y-0 left-0 rounded-full bg-violet-500" style={{ width: `${pct(dischargeW)}%` }} />
              {isFollow && (
                <div className="absolute -inset-y-0.5 w-0.5 bg-emerald-500" style={{ left: `${pct(target)}%` }} />
              )}
            </div>
            <div className="flex justify-between text-[11px] text-zinc-500 mt-1">
              <span>{minW} W</span>
              {isFollow && <span className="text-emerald-400">cible {Math.round(target)} W</span>}
              <span>{maxW} W</span>
            </div>
          </div>

          <div className="border-t pt-4" style={{ borderColor: "var(--hairline)" }}>
            <div className="card-kicker mb-2">Réglages charge / décharge</div>
            <ParamRow label="Sortie max → maison" value={form.followLoadMaxW} onChange={(v) => set("followLoadMaxW", v)} />
            <ParamRow label="Charge max" value={form.chargeMaxW} onChange={(v) => set("chargeMaxW", v)} />
            <ParamRow label="Charge min (seuil prise)" value={form.chargeMinW} onChange={(v) => set("chargeMinW", v)} />
            <ParamRow label="Marge sur surplus" value={form.chargeOffsetW} onChange={(v) => set("chargeOffsetW", v)} />
            <ParamRow label="Tolérance déficit" unit="min" value={form.chargeDeficitTimeoutMin} onChange={(v) => set("chargeDeficitTimeoutMin", v)} />
            <ParamRow label="Verrou redémarrage" unit="min" value={form.chargeOffToOnLockMin} onChange={(v) => set("chargeOffToOnLockMin", v)} />
            {applyBar}
          </div>
        </div>
      </Section>

      <div className="space-y-4 sm:space-y-5 min-w-0">
        <Section
          title="Décharge programmée · EDF Tempo"
          sub="Le PowerStream passe en alimentation pendant la fenêtre"
          action={
            <label className="inline-flex items-center gap-2 text-sm text-zinc-200 cursor-pointer">
              <input
                type="checkbox"
                checked={form.tempoEnabled}
                onChange={(e) => set("tempoEnabled", e.target.checked)}
                className="accent-emerald-500 w-4 h-4"
              />
              Activée
            </label>
          }
        >
          <div className="flex flex-wrap gap-2 mb-3">
            <TempoChip color={snap.tempoColor} prefix="Aujourd'hui" />
            <TempoChip color={snap.tempoColorTomorrow} prefix="Demain" />
          </div>
          <ParamRow label="Début · jour rouge" unit="h" value={form.tempoRedDischargeHour} onChange={(v) => set("tempoRedDischargeHour", v)} />
          <ParamRow label="Début · jours bleu / blanc" unit="h" value={form.tempoOtherDischargeHour} onChange={(v) => set("tempoOtherDischargeHour", v)} />
          <ParamRow label="Fin" unit="h" value={form.tempoDischargeEndHour} onChange={(v) => set("tempoDischargeEndHour", v)} />
          <ParamRow label="Puissance cible" value={form.tempoDischargeTargetW} onChange={(v) => set("tempoDischargeTargetW", v)} />
          {applyBar}
        </Section>

        {snap.powerstreamSn && (
          <Section title="PowerStream" sub={`Micro-onduleur ${snap.powerstreamSn}`}>
            <PowerStreamControls
              sn={snap.powerstreamSn}
              priority={snap.powerstreamPriority ?? 0}
              permanentW={snap.powerstreamPermanentW ?? 0}
            />
          </Section>
        )}
      </div>
    </div>
  );
}

function ParamRow({
  label,
  value,
  onChange,
  unit = "W",
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-zinc-200">{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          type="number"
          min={0}
          max={unit === "h" ? 23 : unit === "min" ? 120 : 2200}
          step={unit === "h" || unit === "min" ? 1 : 50}
          value={value}
          onChange={(e) => onChange(Math.round(Number(e.target.value) || 0))}
          className="input-base w-24 !py-1.5 text-right font-mono"
        />
        <span className="text-xs text-zinc-500 w-7">{unit}</span>
      </span>
    </label>
  );
}

function PowerStreamControls({
  sn,
  priority,
  permanentW,
}: {
  sn: string;
  priority: number;
  permanentW: number;
}) {
  const [busy, setBusy] = useState<"" | "supply" | "storage" | "watts">("");
  const [msg, setMsg] = useState<string | null>(null);
  const [watts, setWatts] = useState(permanentW);
  useEffect(() => setWatts(permanentW), [permanentW]);

  const send = async (body: Record<string, unknown>, kind: "supply" | "storage" | "watts", okMsg: string) => {
    setBusy(kind);
    setMsg(null);
    try {
      const r = await fetch("/api/ecoflow/powerstream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sn, ...body }),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      setMsg(j.ok ? `✓ ${okMsg}` : `✗ ${j.error ?? "erreur"}`);
      setTimeout(() => setMsg(null), 2500);
    } catch (e) {
      setMsg(`✗ ${(e as Error).message}`);
    } finally {
      setBusy("");
    }
  };

  const modeBtn = (active: boolean) =>
    "btn flex-1 border " +
    (active ? "border-violet-500/50 bg-violet-500/10 text-violet-400" : "border-zinc-800 text-zinc-300 hover:bg-zinc-900");

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button type="button" disabled={busy !== ""} onClick={() => send({ kind: "supplyPriority", priority: 0 }, "supply", "Mode appliqué")} className={modeBtn(priority === 0)}>
          {busy === "supply" ? "…" : "Alimentation maison"}
        </button>
        <button type="button" disabled={busy !== ""} onClick={() => send({ kind: "supplyPriority", priority: 1 }, "storage", "Mode appliqué")} className={modeBtn(priority === 1)}>
          {busy === "storage" ? "…" : "Stockage batterie"}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-300">Injection fixe</span>
        <input
          type="number"
          min={0}
          max={800}
          step={50}
          value={watts}
          onChange={(e) => setWatts(Math.round(Number(e.target.value) || 0))}
          className="input-base w-24 !py-1.5 text-right font-mono"
        />
        <span className="text-xs text-zinc-500">W</span>
        <button type="button" disabled={busy !== ""} onClick={() => send({ kind: "permanentWatts", watts }, "watts", `${watts} W appliqué`)} className="btn-ghost ml-auto">
          {busy === "watts" ? "…" : "Envoyer"}
        </button>
      </div>
      {msg && <p className={`text-xs ${msg.startsWith("✓") ? "text-emerald-400" : "text-rose-400"}`}>{msg}</p>}
    </div>
  );
}
