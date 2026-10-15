"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { IsoTub, useKeyframes, type JacuzziFn } from "./JacuzziPanel";
import SubNav from "@/components/SubNav";
import { EQUIPMENT_TABS } from "@/components/nav-tabs";
import { PowerChart, type PowerPoint } from "@/components/charts";
import { fmtKWh, fmtPower, Icon, KpiCard, PageHeader, Section } from "@/components/ui";

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

interface History {
  todayWh: number;
  points: Array<{ label: string; spa: number | null; aux: number | null }>;
}

const TEMP_MIN = 15;
const TEMP_MAX = 40;

function fmtSec(ms: number | null): string {
  if (ms === null) return "—";
  return `${Math.floor(ms / 1000)} s`;
}

const fmtTemp = (t: number | null) =>
  t === null ? "—" : t.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export default function JacuzziPage() {
  useKeyframes();
  const [s, setS] = useState<JacuzziState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hist, setHist] = useState<History | null>(null);
  const [busy, setBusy] = useState<Partial<Record<JacuzziFn | "temp", boolean>>>({});

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

  async function refreshHistory() {
    try {
      const r = await fetch("/api/jacuzzi/history", { cache: "no-store" });
      if (r.ok) setHist(await r.json());
    } catch {
      // graphique indisponible : on garde le précédent
    }
  }

  useEffect(() => {
    void refresh();
    void refreshHistory();
    const a = setInterval(refresh, 3000);
    const b = setInterval(refreshHistory, 60_000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
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
    setBusy((b) => ({ ...b, [fn]: true }));
    try {
      await fetch("/api/jacuzzi/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fn, on }),
      });
      await refresh();
    } finally {
      setBusy((b) => ({ ...b, [fn]: false }));
    }
  }

  async function onSetPresetTemp(temp: number) {
    setBusy((b) => ({ ...b, temp: true }));
    try {
      await fetch("/api/jacuzzi/preset-temp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ temp }),
      });
      await refresh();
    } finally {
      setBusy((b) => ({ ...b, temp: false }));
    }
  }

  if (!s) {
    return (
      <div className="space-y-5 max-w-[1500px] mx-auto">
        <SubNav items={EQUIPMENT_TABS} />
        <div className="card text-sm text-zinc-400">{err ? `Erreur : ${err}` : "Chargement…"}</div>
      </div>
    );
  }

  const offline = !s.reachable;
  const cur = s.currentTempC;
  const preset = s.presetTempC;
  const heating = s.heaterOn === true;
  const ready = s.power === true && cur !== null && preset !== null && cur >= preset - 0.5;
  const plugW = s.plug.powerW;
  const pw = fmtPower(plugW);
  const status = offline
    ? { label: "Hors ligne", cls: "border-rose-500/40 bg-rose-500/[0.07] text-rose-400" }
    : s.power
      ? { label: "En fonctionnement", cls: "border-emerald-500/40 bg-emerald-500/[0.07] text-emerald-400" }
      : { label: "À l'arrêt", cls: "border-zinc-700 text-zinc-400" };
  const pilotLabel =
    s.ctrl.jacuzziManualOverride === true
      ? "Forcé ON"
      : s.ctrl.jacuzziManualOverride === false
        ? "Forcé OFF"
        : s.ctrl.jacuzziEnabled
          ? "Auto · surplus"
          : "Manuel";

  const tub = {
    power: s.power ?? false,
    heaterOn: s.heaterOn ?? false,
    filterOn: s.filterOn ?? false,
    jetsOn: s.jetsOn ?? false,
    bubblesOn: s.bubblesOn ?? false,
    sanitizerOn: s.sanitizerOn ?? false,
    currentTempC: cur ?? 0,
    presetTempC: preset ?? 20,
  };

  const lastSpa = [...(hist?.points ?? [])].reverse().find((p) => p.aux !== null && p.spa !== null);
  const share = lastSpa && lastSpa.aux ? Math.min(100, Math.round(((lastSpa.spa ?? 0) / lastSpa.aux) * 100)) : null;

  return (
    <div className="space-y-5 sm:space-y-6 max-w-[1500px] mx-auto">
      <SubNav items={EQUIPMENT_TABS} />
      <PageHeader
        title="Jacuzzi / Spa"
        sub={`Supervision et contrôle · réseau 2 · module ${s.host ?? "—"}`}
        right={
          <span className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-xs font-medium ${status.cls}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-current" />
            {status.label}
          </span>
        }
      />

      {offline && (
        <div className="card !py-3 border-rose-500/40 bg-rose-500/5 text-sm text-zinc-200">
          <strong className="text-rose-400">Module Wi-Fi injoignable.</strong> Les commandes ne seront pas
          délivrées. {s.lastError ?? ""}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 min-[1760px]:grid-cols-7 gap-3 sm:gap-4">
        <KpiCard label="Température eau" value={fmtTemp(cur)} unit="°C" icon={Icon.gauge} accent="grid" sub={preset !== null && cur !== null ? `${cur >= preset ? "+" : ""}${(cur - preset).toFixed(1)} °C vs cible` : undefined} />
        <KpiCard label="Température cible" value={preset === null ? "—" : String(preset)} unit="°C" icon={Icon.gauge} accent="import" sub={`Plage ${TEMP_MIN}–${TEMP_MAX} °C`} />
        <KpiCard label="Conso électrique" value={pw.value} unit={pw.unit} icon={Icon.bolt} accent="solar" sub={hist ? `Aujourd'hui ${fmtKWh(hist.todayWh)}` : s.plug.name ?? undefined} />
        <KpiCard label="Chauffage" value={heating ? "En chauffe" : "Arrêt"} icon={Icon.fan} accent={heating ? "cost" : "neutral"} valueAccent={heating} sub={heating ? "résistance active" : undefined} />
        <KpiCard label="Filtration" value={s.filterOn ? "En cours" : "Arrêt"} icon={Icon.fan} accent="aux" valueAccent={s.filterOn === true} />
        <KpiCard label="Pilotage" value={pilotLabel} icon={Icon.leaf} accent="home" valueAccent sub={s.ctrl.jacuzziEnabled ? "chauffe sur surplus solaire" : "commande manuelle"} />
        <KpiCard label="Connexion" value={offline ? "Hors ligne" : "En ligne"} icon={Icon.plug} accent={offline ? "import" : "home"} valueAccent sub={s.failureCount > 0 ? `${s.failureCount} échec(s)` : "module Wi-Fi Intex"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 sm:gap-5">
        <Section
          title="Mon jacuzzi"
          className="xl:col-span-6"
          action={
            ready ? (
              <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-emerald-500/40 bg-emerald-500/[0.07] text-xs font-medium text-emerald-400">
                <span className="w-3.5 h-3.5">{Icon.check}</span> Spa prêt · température atteinte
              </span>
            ) : heating ? (
              <span className="inline-flex items-center h-7 px-2.5 rounded-full border border-orange-500/40 bg-orange-500/[0.07] text-xs font-medium text-orange-400">
                En chauffe vers {preset} °C
              </span>
            ) : undefined
          }
        >
          {/* Scène : rendu isométrique du spa, toujours sur fond sombre. */}
          <div
            className="dark relative rounded-xl overflow-hidden aspect-[4/3] sm:aspect-[16/10]"
            style={{ background: "radial-gradient(ellipse at 50% 35%, #1b2a3f 0%, #0b1220 55%, #070a12 100%)" }}
          >
            <div className="absolute inset-x-[12%] top-[14%] bottom-[2%]">
              <IsoTub state={tub} />
            </div>
            <Callout className="left-3 top-3" label="Température eau" value={`${fmtTemp(cur)} °C`} tone="text-sky-300" />
            <Callout className="right-3 top-3" label="Chauffage" value={heating ? "En chauffe" : "Arrêt"} tone={heating ? "text-orange-300" : "text-zinc-400"} />
            <Callout className="left-3 bottom-3 hidden sm:block" label="Filtration" value={s.filterOn ? "En marche" : "Arrêt"} tone={s.filterOn ? "text-cyan-300" : "text-zinc-400"} />
            <Callout className="right-3 bottom-3 hidden sm:block" label="Jets / bulles" value={s.jetsOn || s.bubblesOn ? "Activés" : "Arrêt"} tone={s.jetsOn || s.bubblesOn ? "text-violet-300" : "text-zinc-400"} />
            <Callout className="left-1/2 -translate-x-1/2 top-3 hidden md:block" label="Prise" value={`${pw.value} ${pw.unit}`} tone="text-amber-300" />
          </div>
        </Section>

        <Section title="Commandes rapides" className="xl:col-span-3">
          <div className="grid grid-cols-2 gap-2.5">
            <ToggleTile label="Marche / arrêt" icon={Icon.bolt} on={s.power === true} busy={busy.power} disabled={offline} onChange={(v) => onToggle("power", v)} />
            <ToggleTile label="Chauffage" icon={Icon.fan} on={heating} busy={busy.heater} disabled={offline} onChange={(v) => onToggle("heater", v)} />
            <ToggleTile label="Filtration" icon={Icon.fan} on={s.filterOn === true} busy={busy.filter} disabled={offline} onChange={(v) => onToggle("filter", v)} />
            <ToggleTile label="Jets" icon={Icon.pool} on={s.jetsOn === true} busy={busy.jets} disabled={offline} onChange={(v) => onToggle("jets", v)} />
            <ToggleTile label="Bulles" icon={Icon.pool} on={s.bubblesOn === true} busy={busy.bubbles} disabled={offline} onChange={(v) => onToggle("bubbles", v)} />
            <ToggleTile label="Désinfection" icon={Icon.check} on={s.sanitizerOn === true} busy={busy.sanitizer} disabled={offline} onChange={(v) => onToggle("sanitizer", v)} />
          </div>
          <div className="mt-4 rounded-xl border border-zinc-800 p-3">
            <div className="text-xs text-zinc-400 mb-2">Consigne de température</div>
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                className="btn-ghost w-10 h-10 !p-0 text-lg"
                disabled={offline || busy.temp || preset === null || preset <= TEMP_MIN}
                onClick={() => preset !== null && onSetPresetTemp(preset - 1)}
                aria-label="Baisser la consigne"
              >
                −
              </button>
              <span className="text-2xl font-semibold tabular-nums text-zinc-100">
                {preset ?? "—"}
                <span className="text-sm text-zinc-400"> °C</span>
              </span>
              <button
                type="button"
                className="btn-ghost w-10 h-10 !p-0 text-lg"
                disabled={offline || busy.temp || preset === null || preset >= TEMP_MAX}
                onClick={() => preset !== null && onSetPresetTemp(preset + 1)}
                aria-label="Monter la consigne"
              >
                +
              </button>
            </div>
          </div>
        </Section>

        <Section title="Pilotage automatique" sub="Chauffe sur surplus solaire" className="xl:col-span-3">
          <label className="flex items-center justify-between gap-3 py-1">
            <span className="text-sm text-zinc-200">Pilotage par surplus</span>
            <Switch on={s.ctrl.jacuzziEnabled} onChange={(v) => patchCtrl({ jacuzziEnabled: v })} />
          </label>
          <div className="mt-3">
            <div className="text-xs text-zinc-400 mb-1.5">Chauffage</div>
            <div className="grid grid-cols-3 gap-1 rounded-lg border border-zinc-800 p-1">
              {(
                [
                  [null, "Auto"],
                  [true, "Forcer ON"],
                  [false, "Forcer OFF"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => patchCtrl({ jacuzziManualOverride: v })}
                  className={`h-8 rounded-md text-xs font-medium transition ${
                    s.ctrl.jacuzziManualOverride === v ? "bg-blue-600 text-[#fff]" : "text-zinc-300 hover:bg-zinc-900"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
            <div className="rounded-lg border border-zinc-800 p-2.5">
              <div className="text-[11px] text-zinc-500">Attente allumage</div>
              <div className="font-mono text-emerald-400">
                {s.surplusHold.active ? `${fmtSec(s.surplusHold.elapsedMs)} / ${fmtSec(s.surplusHold.targetMs)}` : "—"}
              </div>
            </div>
            <div className="rounded-lg border border-zinc-800 p-2.5">
              <div className="text-[11px] text-zinc-500">Attente coupure</div>
              <div className="font-mono text-rose-400">
                {s.gridHold.active ? `${fmtSec(s.gridHold.elapsedMs)} / ${fmtSec(s.gridHold.targetMs)}` : "—"}
              </div>
            </div>
          </div>
          <details className="mt-4 group">
            <summary className="cursor-pointer text-sm text-blue-400 select-none">Seuils de pilotage</summary>
            <div className="grid grid-cols-2 gap-3 mt-3 text-sm">
              <NumField label="Surplus min allumage (W)" value={s.ctrl.jacuzziStartSurplusW} onSave={(v) => patchCtrl({ jacuzziStartSurplusW: v })} />
              <NumField label="Import max coupure (W)" value={s.ctrl.jacuzziStopGridW} onSave={(v) => patchCtrl({ jacuzziStopGridW: v })} />
              <NumField label="Attente allumage (s)" value={s.ctrl.jacuzziStartHoldS} onSave={(v) => patchCtrl({ jacuzziStartHoldS: v })} />
              <NumField label="Attente coupure (s)" value={s.ctrl.jacuzziStopHoldS} onSave={(v) => patchCtrl({ jacuzziStopHoldS: v })} />
              <NumField label="SoC batterie min (%)" value={s.ctrl.jacuzziMinSocPct} onSave={(v) => patchCtrl({ jacuzziMinSocPct: v })} />
              <label className="flex items-center gap-2 text-sm self-end pb-2">
                <input
                  type="checkbox"
                  checked={s.ctrl.jacuzziTempoBlockRedHp}
                  onChange={(e) => patchCtrl({ jacuzziTempoBlockRedHp: e.target.checked })}
                  className="accent-emerald-500 w-4 h-4"
                />
                <span className="text-zinc-200">Bloquer en HP rouge</span>
              </label>
            </div>
          </details>
        </Section>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 sm:gap-5">
        <Section title="Consommation électrique sur 24 h" sub="Prise jacuzzi et total du réseau 2" className="xl:col-span-2">
          {hist ? (
            <PowerChart
              data={hist.points as unknown as PowerPoint[]}
              series={[
                { key: "spa", label: "Jacuzzi", color: "var(--flow-solar)", area: true },
                { key: "aux", label: "Réseau 2 (total)", color: "var(--flow-aux)", dashed: true },
              ]}
            />
          ) : (
            <div className="h-[260px] flex items-center justify-center text-sm text-zinc-500">Chargement…</div>
          )}
        </Section>
        <Section
          title="Intégration avec la maison"
          action={
            <Link href="/networks" className="text-xs text-blue-400 hover:underline">
              Voir les réseaux →
            </Link>
          }
        >
          <ul className="space-y-3 text-sm">
            <li className="flex items-center gap-3">
              <span className="w-9 h-9 rounded-lg flex items-center justify-center bg-cyan-500/10 text-cyan-400 shrink-0">
                <span className="w-5 h-5">{Icon.pool}</span>
              </span>
              <div>
                <div className="text-zinc-100 font-medium">Circuit réseau 2</div>
                <div className="text-xs text-zinc-500">Compteur piscine, jacuzzi et voiture, séparé de la maison</div>
              </div>
            </li>
            <li className="flex justify-between border-t pt-3" style={{ borderColor: "var(--hairline)" }}>
              <span className="text-zinc-400">Puissance actuelle</span>
              <span className="font-semibold tabular-nums text-zinc-100">
                {pw.value} {pw.unit}
              </span>
            </li>
            <li className="flex justify-between">
              <span className="text-zinc-400">Part du réseau 2</span>
              <span className="font-semibold tabular-nums text-zinc-100">{share === null ? "—" : `${share} %`}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-zinc-400">Énergie aujourd&rsquo;hui</span>
              <span className="font-semibold tabular-nums text-zinc-100">{hist ? fmtKWh(hist.todayWh) : "—"}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-zinc-400">Prise mesurée</span>
              <span className="text-zinc-200">{s.plug.name ?? "—"}</span>
            </li>
          </ul>
        </Section>
      </div>
    </div>
  );
}

function Callout({ className, label, value, tone }: { className: string; label: string; value: string; tone: string }) {
  return (
    <div className={`absolute rounded-lg border border-white/10 bg-black/45 backdrop-blur px-3 py-1.5 ${className}`}>
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className={`text-sm font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function Switch({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-50 ${on ? "bg-blue-600" : "bg-zinc-700"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full shadow transition-transform ${on ? "translate-x-5" : ""}`}
        style={{ background: "#fff" }}
      />
    </button>
  );
}

function ToggleTile({
  label,
  icon,
  on,
  busy,
  disabled,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  on: boolean;
  busy?: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className={`rounded-xl border p-3 flex flex-col gap-2.5 ${on ? "border-blue-500/40 bg-blue-500/[0.05]" : "border-zinc-800"}`}>
      <div className="flex items-center gap-2">
        <span className={`w-5 h-5 ${on ? "text-blue-400" : "text-zinc-500"}`}>{icon}</span>
        <span className="text-xs font-medium text-zinc-200 leading-tight">{label}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-zinc-500">{busy ? "…" : on ? "Activé" : "Arrêt"}</span>
        <Switch on={on} disabled={disabled || busy} onChange={onChange} />
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
      <span className="text-[11px] text-zinc-500">{label}</span>
      <input
        type="number"
        className="input-base !py-1.5"
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
