"use client";

import { useEffect, useState } from "react";

interface ApsystemsCfg {
  url: string | null;
  username: string | null;
  hasPassword: boolean;
  topicPrefix: string;
  espIp: string | null;
  source: "db" | "env" | "none";
}

export default function ApsystemsConfigCard() {
  const [cfg, setCfg] = useState<ApsystemsCfg | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({
    mqttUrl: "",
    mqttUser: "",
    mqttPassword: "",
    topicPrefix: "",
    espIp: "",
  });
  const [pwTouched, setPwTouched] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/apsystems/config", { cache: "no-store" });
      const j = (await r.json()) as ApsystemsCfg;
      setCfg(j);
      setForm({
        mqttUrl: j.url ?? "",
        mqttUser: j.username ?? "",
        mqttPassword: "",
        topicPrefix: j.topicPrefix ?? "",
        espIp: j.espIp ?? "",
      });
      setPwTouched(false);
    } catch (e) {
      setMsg(`Erreur lecture : ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const body: Record<string, string | null> = {
        mqttUrl: form.mqttUrl.trim() || null,
        mqttUser: form.mqttUser.trim() || null,
        topicPrefix: form.topicPrefix.trim() || null,
        espIp: form.espIp.trim() || null,
      };
      // Le mot de passe n'est envoye que si l'utilisateur l'a touche
      // (sinon le champ vide ecraserait l'existant a chaque save).
      if (pwTouched) {
        body.mqttPassword = form.mqttPassword;
      }
      const r = await fetch("/api/apsystems/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string; source?: string };
      if (!j.ok) throw new Error(j.error ?? "echec");
      setMsg(`Sauvegarde + reconnexion MQTT OK (source: ${j.source ?? "?"})`);
      await load();
    } catch (e) {
      setMsg(`Erreur : ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  const sourceBadge = cfg ? (
    <span
      className={
        "ml-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide rounded " +
        (cfg.source === "db"
          ? "bg-emerald-900/60 text-emerald-200 border border-emerald-800"
          : cfg.source === "env"
            ? "bg-zinc-800 text-zinc-300 border border-zinc-700"
            : "bg-rose-900/60 text-rose-200 border border-rose-800")
      }
    >
      {cfg.source === "db" ? "DB" : cfg.source === "env" ? ".env" : "non configure"}
    </span>
  ) : null;

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500">
          Passerelle APSystems (MQTT){sourceBadge}
        </div>
        {cfg?.espIp && (
          <a
            href={`http://${cfg.espIp}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-sky-400 hover:text-sky-300 underline"
          >
            Ouvrir l&apos;interface ESP →
          </a>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-zinc-500">Chargement…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs text-zinc-400 space-y-1">
              <span>URL broker MQTT</span>
              <input
                className="input-base"
                placeholder="mqtt://192.168.0.26:1883"
                value={form.mqttUrl}
                onChange={(e) => setForm({ ...form, mqttUrl: e.target.value })}
              />
            </label>
            <label className="text-xs text-zinc-400 space-y-1">
              <span>IP locale ESP (passerelle)</span>
              <input
                className="input-base"
                placeholder="192.168.0.3"
                value={form.espIp}
                onChange={(e) => setForm({ ...form, espIp: e.target.value })}
              />
            </label>
            <label className="text-xs text-zinc-400 space-y-1">
              <span>Utilisateur MQTT (optionnel)</span>
              <input
                className="input-base"
                value={form.mqttUser}
                onChange={(e) => setForm({ ...form, mqttUser: e.target.value })}
              />
            </label>
            <label className="text-xs text-zinc-400 space-y-1">
              <span>
                Mot de passe MQTT (optionnel)
                {cfg?.hasPassword && !pwTouched && (
                  <span className="ml-2 text-[10px] text-emerald-400">
                    ●●●● defini
                  </span>
                )}
              </span>
              <input
                type="password"
                className="input-base"
                placeholder={
                  cfg?.hasPassword ? "(inchange — laisser vide)" : ""
                }
                value={form.mqttPassword}
                onChange={(e) => {
                  setForm({ ...form, mqttPassword: e.target.value });
                  setPwTouched(true);
                }}
              />
            </label>
            <label className="text-xs text-zinc-400 space-y-1 sm:col-span-2">
              <span>Topic prefix (defaut: apsystems)</span>
              <input
                className="input-base"
                placeholder="apsystems"
                value={form.topicPrefix}
                onChange={(e) =>
                  setForm({ ...form, topicPrefix: e.target.value })
                }
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="btn-primary text-xs disabled:opacity-50"
            >
              {saving ? "Sauvegarde…" : "Enregistrer + reconnecter MQTT"}
            </button>
            <p className="text-[11px] text-zinc-500 flex-1">
              {cfg?.url ? (
                <>
                  Connecte a <code className="text-zinc-300">{cfg.url}</code>{" "}
                  · topic <code className="text-zinc-300">{cfg.topicPrefix}/+/data</code>
                </>
              ) : (
                <>Aucune URL — le subscriber MQTT est arrete.</>
              )}
            </p>
          </div>
          {msg && <p className="text-xs text-zinc-400">{msg}</p>}
        </>
      )}
    </div>
  );
}
