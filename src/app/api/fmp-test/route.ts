// Temporary diagnostic — delete after debugging
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const apiKey = process.env.FMP_KEY;
  const fmpBase = "https://financialmodelingprep.com";
  const headers = { Accept: "application/json" };

  async function probe(label: string, url: string, extraHeaders?: Record<string,string>) {
    try {
      const res  = await fetch(url, { headers: { ...headers, ...extraHeaders } });
      const text = await res.text();
      return { label, status: res.status, preview: text.slice(0, 180) };
    } catch (e) {
      return { label, status: 0, preview: String(e) };
    }
  }

  const fmpResults = apiKey ? await Promise.all([
    probe("FMP v3/profile (legacy)",   `${fmpBase}/api/v3/profile/NVDA?apikey=${apiKey}`),
    probe("FMP stable/profile",        `${fmpBase}/stable/profile?symbol=NVDA&apikey=${apiKey}`),
    probe("FMP stable/income-stmt Q",  `${fmpBase}/stable/income-statement?symbol=NVDA&period=quarter&limit=4&apikey=${apiKey}`),
    probe("FMP stable/profile Bearer", `${fmpBase}/stable/profile?symbol=NVDA`,
          { Authorization: `Bearer ${apiKey}` }),
  ]) : [{ label: "FMP", status: 0, preview: "FMP_KEY not set" }];

  // Yahoo Finance — already used for OHLCV, test quote + quarterly endpoints
  const yahooResults = await Promise.all([
    probe("Yahoo v7/quote NVDA",
          "https://query1.finance.yahoo.com/v7/finance/quote?symbols=NVDA",
          { "User-Agent": "Mozilla/5.0" }),
    probe("Yahoo v11/quoteSummary modules",
          "https://query1.finance.yahoo.com/v11/finance/quoteSummary/NVDA?modules=incomeStatementHistoryQuarterly",
          { "User-Agent": "Mozilla/5.0" }),
  ]);

  return NextResponse.json({
    fmp_key_present: !!apiKey,
    fmp_key_prefix:  apiKey ? apiKey.slice(0, 6) + "..." : null,
    fmp: fmpResults,
    yahoo: yahooResults,
  });
}
