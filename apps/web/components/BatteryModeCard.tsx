"use client";

// Choix du pilotage batterie : automatique (l'app pilote charge, décharge,
// Tempo, PowerStream) ou manuel (l'utilisateur pilote via l'app EcoFlow et
// allume / éteint lui-même la prise AC de charge, ici).

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { DashboardSnapshot } from "@/lib/snapshot";
import { fmtPower, Icon } from "./ui";

export default function BatteryModeCard({ initial }: { initial: DashboardSnapshot }) {
  const router = useRouter();
  const [snap, setSnap] = useState(initial);
  const [busy, setBusy] = useState<"" | "mode" | "plug">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const manual = snap.controlMode === "MANUAL";

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

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 4000);
  };

  async function setMode(mode: "MANUAL" | "FOLLOW_LOAD") {
    setBusy("mode");
    try {
      const r = await fetch("/api/control/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setSnap((s) => ({ ...s, controlMode: mode }));
      router.refresh();
    } catch {
      flash(false, "Changement de mode refusé");
    } finally {
      setBusy("");
    }
  }

  async function setPlug(on: boolean) {
    setBusy("plug");
    try {
      const r = await fetch("/api/control/battery-plug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on }),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string; result?: { delivered?: boolean } };
      if (!r.ok || !j.ok) flash(false, j.error ?? "Commande refusée");
      else if (j.result?.delivered === false)
        flash(false, "Commande non délivrée : la prise est hors ligne (Wi-Fi / cloud Tuya)");
      else {
        flash(true, on ? "Prise allumée" : "Prise éteinte");
        setSnap((s) => ({ ...s, switchOn: on }));
      }
    } catch (e) {
      flash(false, (e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const plugW = fmtPower(Math.max(0, snap.acSwitchPowerW ?? 0));
  const seg = (active: boolean) =>
    "flex-1 h-10 rounded-lg text-sm font-medium transition " +
    (active ? "bg-blue-600 text-[#fff] shadow-sm" : "text-zinc-300 hover:bg-zinc-900");

  return (
    <section className={`card ${manual ? "ring-1 ring-amber-500/40" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="card-title">Pilotage de la batterie</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            {manual
              ? "Manuel : l'application n'envoie plus aucune commande. Pilotez la batterie depuis l'app EcoFlow."
              : "Automatique : l'application gère la charge, la décharge, Tempo et le PowerStream."}
          </p>
        </div>
        <div className="flex gap-1 rounded-xl border border-zinc-800 p-1 w-full sm:w-80">
          <button type="button" disabled={busy !== ""} onClick={() => setMode("FOLLOW_LOAD")} className={seg(!manual)}>
            Automatique
          </button>
          <button type="button" disabled={busy !== ""} onClick={() => setMode("MANUAL")} className={seg(manual)}>
            Manuel
          </button>
        </div>
      </div>

      {manual && (
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] items-center rounded-xl border border-zinc-800 p-4">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                snap.acSwitchOnline === false
                  ? "bg-rose-500/10 text-rose-400"
                  : snap.switchOn
                    ? "bg-violet-500/10 text-violet-400"
                    : "bg-zinc-500/10 text-zinc-400"
              }`}
            >
              <span className="w-5 h-5">{Icon.plug}</span>
            </span>
            <div className="min-w-0">
              <div className="text-sm font-medium text-zinc-100">Prise d&rsquo;alimentation de la batterie</div>
              <div className="text-xs text-zinc-500">
                {snap.acSwitchOnline === false
                  ? "Hors ligne : commandes non délivrées"
                  : snap.switchOn === null
                    ? "État inconnu"
                    : snap.switchOn
                      ? `Allumée · ${plugW.value} ${plugW.unit} tirés`
                      : "Éteinte"}{" "}
                · réseau 2
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy !== "" || snap.switchOn === true}
              onClick={() => setPlug(true)}
              className="btn-primary flex-1 sm:flex-none sm:w-28"
            >
              {busy === "plug" && snap.switchOn !== true ? "…" : "Allumer"}
            </button>
            <button
              type="button"
              disabled={busy !== "" || snap.switchOn === false}
              onClick={() => setPlug(false)}
              className="btn-ghost flex-1 sm:flex-none sm:w-28"
            >
              {busy === "plug" && snap.switchOn !== false ? "…" : "Éteindre"}
            </button>
          </div>
        </div>
      )}
      {msg && <p className={`mt-3 text-xs ${msg.ok ? "text-emerald-400" : "text-rose-400"}`}>{msg.text}</p>}
    </section>
  );
}
