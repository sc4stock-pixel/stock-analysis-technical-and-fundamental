// src/app/api/save-portfolio/route.ts
// PUT  → commit updated portfolio.json to GitHub (persists custom portfolio)
import { NextRequest, NextResponse } from "next/server";

const REPO   = "sc4stock-pixel/stock-analysis-technical-and-fundamental";
const FILE   = "portfolio.json";
const BRANCH = "main";
const API    = `https://api.github.com/repos/${REPO}/contents/${FILE}`;

interface PortfolioEntry { symbol: string; name: string; exchange: string }

export async function PUT(req: NextRequest) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "GITHUB_TOKEN not set — add it in Vercel project settings" },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const portfolio: PortfolioEntry[] = body.portfolio;
  if (!Array.isArray(portfolio) || portfolio.length === 0) {
    return NextResponse.json({ error: "portfolio array required" }, { status: 400 });
  }

  const headers = {
    Authorization:  `Bearer ${token}`,
    Accept:         "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  // Fetch current file SHA (needed to update an existing file; omit for new file)
  let sha: string | undefined;
  try {
    const getRes = await fetch(`${API}?ref=${BRANCH}`, { headers, cache: "no-store" });
    if (getRes.ok) {
      const data = await getRes.json();
      sha = data.sha;
    }
  } catch {
    // file may not exist yet — first save will create it
  }

  const content = Buffer.from(
    JSON.stringify({ portfolio }, null, 2) + "\n"
  ).toString("base64");

  const payload: Record<string, string> = {
    message: `Update portfolio via dashboard (${portfolio.length} stocks)`,
    content,
    branch: BRANCH,
  };
  if (sha) payload.sha = sha;

  const putRes = await fetch(API, {
    method:  "PUT",
    headers,
    body:    JSON.stringify(payload),
  });

  if (!putRes.ok) {
    const errText = await putRes.text();
    return NextResponse.json(
      { error: `GitHub ${putRes.status}: ${errText}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, count: portfolio.length });
}
