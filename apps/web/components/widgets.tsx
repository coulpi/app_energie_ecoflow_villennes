// Petits widgets partagés (sans état) : liste d'alertes, badges Tempo et
// mode de pilotage.

import { Icon } from "./ui";

export interface AlertItem {
  level: "critical" | "warning" | "info";
  title: string;
  detail: string;
  at: string | null;
}

const LEVEL = {
  critical: { box: "border-rose-500/30 bg-rose-500/[0.06]", icon: "text-rose-400", title: "text-rose-400", glyph: Icon.alert },
  warning: { box: "border-amber-500/30 bg-amber-500/[0.06]", icon: "text-amber-400", title: "text-amber-400", glyph: Icon.alert },
  info: { box: "border-blue-500/25 bg-blue-500/[0.05]", icon: "text-blue-400", title: "text-blue-400", glyph: Icon.info },
};

export function AlertList({ alerts, max }: { alerts: AlertItem[]; max?: number }) {
  if (alerts.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] p-3">
        <span className="w-5 h-5 text-emerald-400 shrink-0">{Icon.check}</span>
        <span className="text-sm text-zinc-200">Tout fonctionne normalement.</span>
      </div>
    );
  }
  const list = max ? alerts.slice(0, max) : alerts;
  return (
    <ul className="space-y-2">
      {list.map((a, i) => {
        const l = LEVEL[a.level];
        return (
          <li key={i} className={`flex gap-3 rounded-xl border p-3 ${l.box}`}>
            <span className={`w-5 h-5 shrink-0 mt-0.5 ${l.icon}`}>{l.glyph}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className={`text-sm font-semibold ${l.title}`}>{a.title}</span>
                {a.at && (
                  <span className="text-[11px] text-zinc-500 tabular-nums shrink-0">
                    {new Date(a.at).toLocaleTimeString("fr-FR", {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Europe/Paris",
                    })}
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">{a.detail}</p>
            </div>
          </li>
        );
      })}
      {max && alerts.length > max && (
        <li className="text-xs text-zinc-500 px-1">+ {alerts.length - max} autre(s)</li>
      )}
    </ul>
  );
}

const TEMPO: Record<string, { label: string; cls: string }> = {
  BLUE: { label: "Bleu", cls: "bg-blue-600 text-[#fff] border-blue-600" },
  WHITE: { label: "Blanc", cls: "bg-[#f8fafc] text-[#0f172a] border-[#cbd5e1]" },
  RED: { label: "Rouge", cls: "bg-red-600 text-[#fff] border-red-600" },
};

export function TempoChip({ color, prefix = "Tempo" }: { color: string | null; prefix?: string }) {
  const t = color ? TEMPO[color] : undefined;
  return (
    <span
      className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-xs font-medium ${
        t ? t.cls : "border-zinc-800 text-zinc-400"
      }`}
    >
      {prefix} · {t ? t.label : "inconnu"}
    </span>
  );
}

const MODE_LABEL: Record<string, string> = {
  FOLLOW_LOAD: "Suivi de charge",
  RULES: "Règles",
  MANUAL: "Manuel",
  OFF: "Désactivé",
};

export function ModeChip({ mode }: { mode: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-emerald-500/40 bg-emerald-500/[0.07] text-xs font-medium text-emerald-400">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      Mode : {MODE_LABEL[mode] ?? mode}
    </span>
  );
}
