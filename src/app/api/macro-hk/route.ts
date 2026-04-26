// src/app/api/macro-hk/route.ts
import { NextResponse } from "next/server";
import { fetchHKMacroData } from "@/lib/macro-hk";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await fetchHKMacroData();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
