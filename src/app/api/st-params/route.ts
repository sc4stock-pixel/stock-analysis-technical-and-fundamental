// src/app/api/st-params/route.ts
// GET  → return cache metadata from st_params.json
// POST → trigger the optimize-supertrend GitHub Actions workflow
import { NextResponse } from "next/server";

const RAW_URL =
  "https://raw.githubusercontent.com/sc4stock-pixel/stock-analysis-technical-and-fundamental/main/st_params.json";

const WORKFLOW_URL =
  "https://api.github.com/repos/sc4stock-pixel/stock-analysis-technical-and-fundamental/actions/workflows/optimize-supertrend.yml/dispatches";

export async function GET() {
  try {
    const res = await fetch(RAW_URL, { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ error: "cache not found" }, { status: 404 });
    const data = await res.json();
    return NextResponse.json({
      last_optimized:     data.last_optimized    ?? null,
      next_optimization:  data.next_optimization ?? null,
      optimization_count: data.optimization_count ?? 0,
      cached_symbols:     Object.keys(data.stocks ?? {}),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "GITHUB_TOKEN env var not set — add it in Vercel project settings" },
      { status: 500 }
    );
  }
  try {
    const res = await fetch(WORKFLOW_URL, {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${token}`,
        Accept:         "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `GitHub ${res.status}: ${text}` }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
