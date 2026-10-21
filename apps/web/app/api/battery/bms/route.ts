// État de la batterie remonté par le BMS (résumé lisible, cf. lib/bms.ts).

import { NextResponse } from "next/server";
import { fetchBms } from "@/lib/bms";

export const dynamic = "force-dynamic";

export async function GET() {
  const bms = await fetchBms();
  if (!bms) return NextResponse.json({ error: "worker injoignable" }, { status: 502 });
  return NextResponse.json(bms, { headers: { "Cache-Control": "no-store" } });
}
