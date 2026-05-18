// Temporary diagnostic endpoint — delete after debugging
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const apiKey = process.env.FMP_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "FMP_KEY env var is not set" });
  }

  try {
    const res = await fetch(
      `https://financialmodelingprep.com/api/v3/profile/NVDA?apikey=${apiKey}`,
      { headers: { Accept: "application/json" } }
    );
    const text = await res.text();
    return NextResponse.json({
      key_present: true,
      key_prefix: apiKey.slice(0, 6) + "...",
      http_status: res.status,
      fmp_response_preview: text.slice(0, 300),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) });
  }
}
