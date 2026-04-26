"use client";

import { useState } from "react";

export default function DetectButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const onClick = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/loads/detect", { method: "POST" });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      setMsg(j.error ? `❌ ${j.error}` : "✓ Détection lancée");
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setMsg(`❌ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      {msg && <span className="text-xs text-zinc-400">{msg}</span>}
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded px-3 py-1.5 text-sm"
      >
        {busy ? "Analyse…" : "Détecter maintenant"}
      </button>
    </div>
  );
}
