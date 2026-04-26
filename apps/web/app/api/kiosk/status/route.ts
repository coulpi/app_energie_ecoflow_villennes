import { NextResponse } from "next/server";
import { getDashboardSnapshot } from "@/lib/snapshot";

// Endpoint optimisé pour un afficheur ESP32-S3 :
//   - Charge utile minimale (entiers arrondis, clés courtes)
//   - JSON plat → parsing trivial avec ArduinoJson
//   - Pas de cache HTTP
//
// Format :
//   { p: 1234, c: 543, s: 691, soc: 78, sw: 1, m: "RULES", t: 1700000000 }

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getDashboardSnapshot();
  const pack = {
    p: s.productionW === null ? null : Math.round(s.productionW),
    c: s.consumptionW === null ? null : Math.round(s.consumptionW),
    g: s.gridW === null ? null : Math.round(s.gridW),
    s: s.surplusW === null ? null : Math.round(s.surplusW),
    soc: s.batterySoc === null ? null : Math.round(s.batterySoc),
    bp: s.batteryPowerW === null ? null : Math.round(s.batteryPowerW),
    sw: s.switchOn === null ? null : s.switchOn ? 1 : 0,
    m: s.controlMode,
    t: Math.floor(Date.now() / 1000),
  };
  return NextResponse.json(pack, {
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
