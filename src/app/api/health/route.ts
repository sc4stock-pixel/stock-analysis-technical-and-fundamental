import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_CONFIG } from "@/lib/config";
import { analyzeStock } from "@/lib/analyze-stock";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const checks: Record<string, boolean> = { data: false, params: false, kv: false };

  let sampleValid = false;
  try {
    const sample = DEFAULT_CONFIG.stocks.PORTFOLIO[0];
    const r = await analyzeStock(sample, DEFAULT_CONFIG) as Record<string, unknown>;
    sampleValid = !r.error && typeof r.current_price === "number" && (r.current_price as number) > 0;
    checks.data = sampleValid;
    checks.params = !!(r as { st_opt_params?: unknown }).st_opt_params || sampleValid;
  } catch { /* checks.data stays false */ }

  try {
    const kvUrl = process.env.KV_REST_API_URL, kvToken = process.env.KV_REST_API_TOKEN;
    if (kvUrl && kvToken) {
      const res = await fetch(`${kvUrl}/get/state`, { headers: { Authorization: `Bearer ${kvToken}` }, cache: "no-store" });
      checks.kv = res.ok;
    }
  } catch { /* checks.kv stays false */ }

  const ok = checks.data && checks.kv;
  return NextResponse.json({ ok, checks, sampleValid }, { status: ok ? 200 : 503 });
}
