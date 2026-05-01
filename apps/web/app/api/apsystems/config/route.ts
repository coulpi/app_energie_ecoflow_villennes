import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const WORKER = process.env.WORKER_INTERNAL_URL ?? "http://worker:3100";

export async function GET() {
  try {
    const res = await fetch(`${WORKER}/apsystems/config`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.text();
    const res = await fetch(`${WORKER}/apsystems/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
