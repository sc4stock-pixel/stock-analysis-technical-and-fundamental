import { NextResponse } from "next/server";
import type { WorkerState } from "@/types/worker-state";

export const dynamic = "force-dynamic";

export async function GET() {
  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (!kvUrl || !kvToken) {
    return NextResponse.json({ error: "KV not configured" }, { status: 503 });
  }

  try {
    const res = await fetch(`${kvUrl}/get/state`, {
      headers: { Authorization: `Bearer ${kvToken}` },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ error: `KV error ${res.status}` }, { status: 502 });
    }
    const { result } = await res.json() as { result: string | null };
    if (!result) {
      return NextResponse.json(null);
    }
    const state = JSON.parse(result) as WorkerState;
    return NextResponse.json(state);
  } catch (e) {
    console.error("[/api/state]", e);
    return NextResponse.json({ error: "Failed to read state" }, { status: 500 });
  }
}
