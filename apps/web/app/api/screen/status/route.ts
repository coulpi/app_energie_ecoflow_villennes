import { NextResponse } from "next/server";
import { getScreenSeen } from "@/lib/screen-status";

export const dynamic = "force-dynamic";

export async function GET() {
  const seen = getScreenSeen();
  return NextResponse.json(
    {
      lastSeenAt: seen ? new Date(seen.at).toISOString() : null,
      ageS: seen ? Math.round((Date.now() - seen.at) / 1000) : null,
      firmware: seen?.userAgent.match(/ESPHome\/([\w.]+)/i)?.[1] ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
