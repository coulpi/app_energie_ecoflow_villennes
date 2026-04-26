import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const WORKER = process.env.WORKER_INTERNAL_URL ?? "http://worker:3100";

export async function POST() {
  try {
    const r = await fetch(`${WORKER}/run`, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(1810_000),
    });
    const json = await r.json();
    return NextResponse.json(json, { status: r.status });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 502 },
    );
  }
}
