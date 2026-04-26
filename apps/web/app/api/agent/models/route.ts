import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const WORKER = process.env.WORKER_INTERNAL_URL ?? "http://worker:3100";

export async function GET() {
  try {
    const r = await fetch(`${WORKER}/models`, {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      return NextResponse.json(
        { models: [], error: `worker HTTP ${r.status}` },
        { status: 502 },
      );
    }
    const json = (await r.json()) as { models?: string[] };
    return NextResponse.json({ models: json.models ?? [] });
  } catch (e) {
    return NextResponse.json(
      { models: [], error: (e as Error).message },
      { status: 502 },
    );
  }
}
