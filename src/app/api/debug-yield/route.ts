// TEMPORARY diagnostic route — remove after root-causing the MBS 10Y-2Y "unavailable".
// Reports, from Vercel's egress, what each candidate data source returns.
import { NextResponse } from "next/server";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

async function probe(name: string, url: string) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    const text = await res.text();
    return { name, ok: res.ok, status: res.status, ms: Date.now() - t0, bytes: text.length, head: text.slice(0, 160) };
  } catch (e) {
    return { name, error: String(e), ms: Date.now() - t0 };
  }
}

export async function GET() {
  const cosd = new Date(Date.now() - 40 * 86400 * 1000).toISOString().slice(0, 10);
  const month = new Date().toISOString().slice(0, 7).replace("-", "");
  const results = await Promise.all([
    probe("fredgraph", `https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10,DGS2&cosd=${cosd}`),
    probe("treasury", `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=${month}`),
  ]);
  return NextResponse.json({ probedAt: new Date().toISOString(), results });
}
