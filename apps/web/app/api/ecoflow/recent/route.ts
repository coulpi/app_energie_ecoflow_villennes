import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const WORKER = process.env.WORKER_INTERNAL_URL ?? "http://worker:3100";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const n = url.searchParams.get("n") ?? "20";
  try {
    const res = await fetch(`${WORKER}/ecoflow/recent?n=${n}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    const json = await res.json();
    return NextResponse.json(json, { status: res.status });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 502 },
    );
  }
}
