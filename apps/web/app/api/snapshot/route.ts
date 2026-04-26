import { NextResponse } from "next/server";
import { getDashboardSnapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getDashboardSnapshot();
  return NextResponse.json(s, {
    headers: { "Cache-Control": "no-store" },
  });
}
