"use client";

import { useState } from "react";

interface Atom {
  metric: string;
  op: string;
  value: unknown;
}
type Condition =
  | Atom
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };
interface Action {
  action: string;
  params?: Record<string, unknown>;
}
interface RuleDef {
  name: string;
  priority?: number;
  if: Condition;
  then: Action[];
  minHoldSeconds?: number;
  enabled?: boolean;
}
interface Proposal {
  control?: {
    mode?: string;
    followLoadOffsetW?: number;
    followLoadMinW?: number;
    followLoadMaxW?: number;
    minDischargeSoc?: number;
    maxChargeSoc?: number;
  };
  rules?: RuleDef[];
  rationale?: string;
}

const MODE_LABEL: Record<string, string> = {
  RULES: "Règles",
  FOLLOW_LOAD: "Suivi de charge (auto-conso)",
  MANUAL: "Manuel",
  OFF: "Désactivé",
};

const METRIC_LABEL: Record<string, string> = {
  production_W: "production",
  consumption_W: "conso maison",
  grid_W: "réseau (signé)",
  surplus_W: "surplus",
  "battery.soc": "SoC batterie",
  "tuya.switch.state": "prise AC",
  "tariff.period": "période tarifaire",
  "time.minute": "heure (en minutes)",
  "time.dow": "jour de semaine",
};

const OP_LABEL: Record<string, string> = {
  "<": "<",
  "<=": "≤",
  "==": "=",
  "!=": "≠",
  ">=": "≥",
  ">": ">",
  in: "∈",
};

const ACTION_LABEL: Record<string, (p: Record<string, unknown>) => string> = {
  "tuya.switch.on": () => "Allumer la prise AC (charge possible)",
  "tuya.switch.off": () => "Couper la prise AC (stop charge)",
  "ecoflow.setChargeWatts": (p) =>
    `Régler la puissance de charge à ${p.watts} W`,
  "ecoflow.setDischargeWatts": (p) =>
    `Limiter la décharge à ${p.watts} W`,
  "ecoflow.setMaxChargeSoc": (p) => `SoC max charge → ${p.soc} %`,
  "ecoflow.setMinDischargeSoc": (p) => `SoC min décharge → ${p.soc} %`,
  "ecoflow.setOutputMode": (p) =>
    p.acOn ? "Activer la sortie AC" : "Désactiver la sortie AC",
  "powerstream.setPermanentWatts": (p) =>
    `Régler l'injection PowerStream à ${p.watts} W`,
  "powerstream.setSupplyPriority": (p) =>
    p.priority === 1
      ? "PowerStream → mode stockage (priorité charge batterie)"
      : "PowerStream → mode alimentation (la batterie alimente la maison)",
  "control.setMode": (p) => `Basculer en mode ${p.mode}`,
  "control.setFollowLoad": (p) =>
    `Mode FOLLOW_LOAD : offset ${p.offsetW} W, [${p.minW} W, ${p.maxW} W]`,
};

function fmtAtom(a: Atom): string {
  const m = METRIC_LABEL[a.metric] ?? a.metric;
  const op = OP_LABEL[a.op] ?? a.op;
  return `${m} ${op} ${JSON.stringify(a.value)}`;
}

function fmtCondition(c: Condition): string {
  if ("metric" in c) return fmtAtom(c);
  if ("all" in c) return c.all.map(fmtCondition).join(" ET ");
  if ("any" in c) return c.any.map(fmtCondition).join(" OU ");
  if ("not" in c) return `NON (${fmtCondition(c.not)})`;
  return "";
}

function fmtAction(a: Action): string {
  const fn = ACTION_LABEL[a.action];
  return fn ? fn(a.params ?? {}) : `${a.action}(${JSON.stringify(a.params ?? {})})`;
}

export function ProposalView({ proposal }: { proposal: Proposal | null }) {
  const [showRaw, setShowRaw] = useState(false);

  if (!proposal) {
    return <div className="text-sm text-zinc-500">Pas de proposition.</div>;
  }

  const c = proposal.control;
  const rules = proposal.rules ?? [];

  return (
    <div className="space-y-3 text-sm">
      {proposal.rationale && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 text-zinc-300">
          <span className="text-xs uppercase tracking-wider text-zinc-500 mr-2">
            Raisonnement
          </span>
          {proposal.rationale}
        </div>
      )}

      {c && (
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1.5">
            Paramètres globaux
          </div>
          <ul className="space-y-1 text-zinc-300">
            {c.mode && (
              <li>
                <span className="text-zinc-500">Mode :</span>{" "}
                <span className="text-emerald-300">
                  {MODE_LABEL[c.mode] ?? c.mode}
                </span>
              </li>
            )}
            {(c.followLoadMinW !== undefined ||
              c.followLoadMaxW !== undefined ||
              c.followLoadOffsetW !== undefined) && (
              <li>
                <span className="text-zinc-500">Suivi de charge :</span>{" "}
                {c.followLoadMinW !== undefined && (
                  <>min {c.followLoadMinW} W · </>
                )}
                {c.followLoadMaxW !== undefined && (
                  <>max {c.followLoadMaxW} W · </>
                )}
                {c.followLoadOffsetW !== undefined && (
                  <>offset {c.followLoadOffsetW} W</>
                )}
              </li>
            )}
            {c.minDischargeSoc !== undefined && (
              <li>
                <span className="text-zinc-500">SoC min décharge :</span>{" "}
                {c.minDischargeSoc} %
              </li>
            )}
            {c.maxChargeSoc !== undefined && (
              <li>
                <span className="text-zinc-500">SoC max charge :</span>{" "}
                {c.maxChargeSoc} %
              </li>
            )}
          </ul>
        </div>
      )}

      {rules.length > 0 && (
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500 mb-1.5">
            Règles ({rules.length})
          </div>
          <ul className="space-y-2">
            {rules.map((r, i) => (
              <li
                key={i}
                className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-zinc-200">{r.name}</span>
                  {typeof r.priority === "number" && (
                    <span className="text-xs text-zinc-500">
                      priorité {r.priority}
                    </span>
                  )}
                  {r.enabled === false && (
                    <span className="text-xs bg-zinc-800 px-1.5 rounded text-zinc-400">
                      désactivée
                    </span>
                  )}
                </div>
                <div className="text-zinc-400">
                  <span className="text-zinc-500">Si</span>{" "}
                  <span className="text-zinc-300">{fmtCondition(r.if)}</span>
                </div>
                <div className="text-zinc-400 mt-1">
                  <span className="text-zinc-500">Alors :</span>
                  <ul className="list-disc list-inside ml-2 text-zinc-300">
                    {r.then.map((a, j) => (
                      <li key={j}>{fmtAction(a)}</li>
                    ))}
                  </ul>
                </div>
                {typeof r.minHoldSeconds === "number" &&
                  r.minHoldSeconds > 0 && (
                    <div className="text-xs text-zinc-500 mt-1">
                      Ne se redéclenche pas plus souvent que toutes les{" "}
                      {r.minHoldSeconds} s
                    </div>
                  )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={() => setShowRaw((s) => !s)}
          className="text-xs text-zinc-500 hover:text-zinc-300 underline"
        >
          {showRaw ? "Masquer JSON brut" : "Voir JSON brut"}
        </button>
        {showRaw && (
          <pre className="mt-2 text-xs text-zinc-400 overflow-x-auto bg-zinc-950/60 border border-zinc-900 rounded p-2">
            {JSON.stringify(proposal, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
