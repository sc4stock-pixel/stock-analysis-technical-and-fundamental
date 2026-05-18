#!/usr/bin/env python3
"""
Fetch quarterly EPS from Alpha Vantage for all US stocks in portfolio.json.
Writes av_earnings_cache.json to the repo root.

Runs weekly via GitHub Actions to stay within the 25 req/day free tier.
AV_KEY must be set as a GitHub Actions secret (not needed in Vercel).

Rate limit: AV free tier allows 5 req/min → 13-second sleep between calls.
"""
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent.parent

# ── Load AV key ──────────────────────────────────────────────────
AV_KEY = os.environ.get("AV_KEY")
if not AV_KEY:
    print("ERROR: AV_KEY environment variable not set.")
    sys.exit(1)

# ── Load portfolio ────────────────────────────────────────────────
portfolio_path = ROOT / "portfolio.json"
with open(portfolio_path) as f:
    raw = json.load(f)

# portfolio.json stores stocks under "portfolio" key
stocks = raw.get("portfolio", raw) if isinstance(raw, dict) else raw
us_stocks = [s["symbol"] for s in stocks if s.get("exchange") == "US"]

if not us_stocks:
    print("No US stocks found in portfolio.json — nothing to fetch.")
    sys.exit(0)

print(f"Fetching quarterly earnings for {len(us_stocks)} US stocks: {us_stocks}")
print(f"Estimated time: ~{len(us_stocks) * 13} seconds (AV rate limit: 5 req/min)\n")

# ── Fetch each symbol ─────────────────────────────────────────────
data: dict = {}

for i, symbol in enumerate(us_stocks):
    if i > 0:
        time.sleep(13)  # 5 req/min → 1 req per 12 s; 13 s gives margin

    url = (
        f"https://www.alphavantage.co/query"
        f"?function=EARNINGS&symbol={symbol}&apikey={AV_KEY}"
    )
    print(f"[{i+1}/{len(us_stocks)}] {symbol} ...", end=" ", flush=True)

    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            result = json.loads(resp.read())

        # Detect rate-limit or invalid-key messages
        note = result.get("Note") or result.get("Information") or result.get("Error Message")
        if note:
            print(f"WARNING: {note[:120]}")
            continue

        quarters = result.get("quarterlyEarnings", [])
        # Keep last 12 quarters (3 years), drop rows where EPS is missing
        valid = [
            {
                "fiscalDateEnding": q["fiscalDateEnding"],
                "reportedEPS":      q["reportedEPS"],
            }
            for q in quarters[:12]
            if q.get("reportedEPS") not in (None, "None", "", "0.0000")
        ]

        if valid:
            data[symbol] = valid
            print(f"{len(valid)} quarters  (latest: {valid[0]['fiscalDateEnding']} EPS={valid[0]['reportedEPS']})")
        else:
            print("no valid EPS data returned")

    except Exception as e:
        print(f"ERROR: {e}")

# ── Write cache file ──────────────────────────────────────────────
cache = {
    "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "stocks":  us_stocks,
    "data":    data,
}

out_path = ROOT / "av_earnings_cache.json"
with open(out_path, "w") as f:
    json.dump(cache, f, indent=2)

print(f"\n✓ Wrote {out_path}  ({len(data)}/{len(us_stocks)} stocks populated)")
