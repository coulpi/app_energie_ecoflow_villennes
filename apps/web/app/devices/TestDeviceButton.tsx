"use client";

import { useState } from "react";

export default function TestDeviceButton({ deviceId }: { deviceId: string }) {
  const [state, setState] = useState<{
    loading: boolean;
    result: string | null;
    error: string | null;
  }>({ loading: false, result: null, error: null });

  async function run() {
    setState({ loading: true, result: null, error: null });
    try {
      const r = await fetch(`/api/devices/${deviceId}/test`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) {
        setState({ loading: false, result: null, error: j?.error ?? "Erreur" });
      } else {
        const parts: string[] = [];
        if (typeof j.powerW === "number") parts.push(`${Math.round(j.powerW)} W`);
        if (typeof j.switchOn === "boolean") parts.push(j.switchOn ? "ON" : "OFF");
        if (typeof j.energyWh === "number") parts.push(`${Math.round(j.energyWh)} Wh`);
        if (typeof j.soc === "number") parts.push(`SoC ${j.soc}%`);
        setState({
          loading: false,
          result: parts.length > 0 ? parts.join(" · ") : "OK (pas de mesure)",
          error: null,
        });
      }
    } catch (e) {
      setState({ loading: false, result: null, error: (e as Error).message });
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={run}
        disabled={state.loading}
        className="btn-ghost text-xs"
      >
        {state.loading ? "Test..." : "Tester"}
      </button>
      {state.result && (
        <span className="text-[11px] text-emerald-400">{state.result}</span>
      )}
      {state.error && (
        <span className="text-[11px] text-rose-400">{state.error}</span>
      )}
    </div>
  );
}
