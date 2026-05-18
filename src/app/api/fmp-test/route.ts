// Temporary diagnostic — delete after debugging
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const apiKey = process.env.FMP_KEY;
  if (!apiKey) return NextResponse.json({ error: "FMP_KEY not set" });

  const base    = "https://financialmodelingprep.com/stable";
  const headers = { Accept: "application/json" };

  const [profileRes, ratiosRes, targetRes, incomeRes] = await Promise.all([
    fetch(`${base}/profile?symbol=NVDA&apikey=${apiKey}`, { headers }),
    fetch(`${base}/ratios-ttm?symbol=NVDA&apikey=${apiKey}`, { headers }),
    fetch(`${base}/price-target-consensus?symbol=NVDA&apikey=${apiKey}`, { headers }),
    fetch(`${base}/income-statement?symbol=NVDA&period=quarter&limit=8&apikey=${apiKey}`, { headers }),
  ]);

  return NextResponse.json({
    profile_status:  profileRes.status,
    profile_keys:    profileRes.ok  ? Object.keys((await profileRes.json())?.[0]  ?? {}) : "error",
    ratios_status:   ratiosRes.status,
    ratios_keys:     ratiosRes.ok   ? Object.keys((await ratiosRes.json())?.[0]   ?? {}) : "error",
    target_status:   targetRes.status,
    target_keys:     targetRes.ok   ? Object.keys((await targetRes.json())?.[0]   ?? {}) : "error",
    income_status:   incomeRes.status,
    income_sample:   incomeRes.ok   ? (await incomeRes.json())?.slice(0, 2)              : "error",
  });
}
