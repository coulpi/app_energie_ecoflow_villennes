// Courbe 24 h (pas de 15 min) production / consommation réseau 1 pour
// l'écran ESPHome tabscreen1, tracée côté ESP avec deux widgets LVGL
// `line`. Lue toutes les 5 min. Valeurs en W entiers, -1 = pas de mesure.

import { NextResponse } from "next/server";
import { getSeries } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

/** Plafond « rond » de l'axe : 500 W, 1 kW, 1,5 kW, 2 kW, 3 kW… */
function niceMax(v: number): number {
  const steps = [500, 1000, 1500, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 12000];
  return steps.find((s) => s >= v) ?? Math.ceil(v / 1000) * 1000;
}

export async function GET() {
  const series = await getSeries(24);
  const p = series.map((x) => (x.production === null ? -1 : Math.round(x.production)));
  const c = series.map((x) => (x.conso1 === null ? -1 : Math.round(x.conso1)));
  const peak = Math.max(0, ...p, ...c);
  return NextResponse.json(
    { max: niceMax(peak), n: series.length, p, c },
    { headers: { "Cache-Control": "no-store" } },
  );
}
