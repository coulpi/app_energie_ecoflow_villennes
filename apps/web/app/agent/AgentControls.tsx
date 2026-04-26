"use client";

import { useEffect, useState } from "react";

export function ModelSelect({ defaultModel }: { defaultModel: string }) {
  const [models, setModels] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/agent/models", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { models?: string[]; error?: string }) => {
        if (cancelled) return;
        setModels(j.models ?? []);
        setError(j.error ?? null);
        setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setError((e as Error).message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <select
        name="model"
        defaultValue={defaultModel}
        className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2"
      >
        {defaultModel && !models.includes(defaultModel) && (
          <option value={defaultModel}>{defaultModel} (actuel)</option>
        )}
        {models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
        {!loading && models.length === 0 && (
          <option value="">— aucun modèle disponible —</option>
        )}
      </select>
      {error && (
        <span className="text-[11px] text-rose-400 mt-1">
          Ollama injoignable : {error}
        </span>
      )}
    </>
  );
}

export function RunNowButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const onClick = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch("/api/agent/run", { method: "POST" });
      const j = (await r.json()) as { applied?: boolean; error?: string };
      setResult(
        j.error
          ? `❌ ${j.error}`
          : j.applied
            ? "✓ Appliqué"
            : "✓ Terminé (rien à appliquer)",
      );
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      setResult(`❌ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      {result && <span className="text-xs text-zinc-400">{result}</span>}
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded px-4 py-2 text-sm"
      >
        {busy ? "Analyse en cours…" : "Lancer maintenant"}
      </button>
    </div>
  );
}
