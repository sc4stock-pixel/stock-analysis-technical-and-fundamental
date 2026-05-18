// Temporary diagnostic endpoint — delete after debugging
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const apiKey = process.env.FMP_KEY;
  if (!apiKey) return NextResponse.json({ error: "FMP_KEY env var is not set" });

  const base    = "https://financialmodelingprep.com";
  const headers = { Accept: "application/json" };

  async function probe(label: string, url: string) {
    try {
      const res  = await fetch(url, { headers });
      const text = await res.text();
      return { label, status: res.status, preview: text.slice(0, 200) };
    } catch (e) {
      return { label, status: 0, preview: String(e) };
    }
  }

  const results = await Promise.all([
    probe("v3/profile (legacy)",        `${base}/api/v3/profile/NVDA?apikey=${apiKey}`),
    probe("stable/profile",             `${base}/stable/profile?symbol=NVDA&apikey=${apiKey}`),
    probe("stable/income-statement Q",  `${base}/stable/income-statement?symbol=NVDA&period=quarter&limit=4&apikey=${apiKey}`),
    probe("stable/ratios-ttm",          `${base}/stable/ratios-ttm?symbol=NVDA&apikey=${apiKey}`),
  ]);

  return NextResponse.json({ key_prefix: apiKey.slice(0, 6) + "...", results });
}
