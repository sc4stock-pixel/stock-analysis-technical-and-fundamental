// src/app/api/macro/route.ts
import { NextResponse } from "next/server";
import { fetchMacroData } from "@/lib/macro";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await fetchMacroData();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
