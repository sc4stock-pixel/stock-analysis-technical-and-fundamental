#!/usr/bin/env python3
"""
Fetch quarterly EPS for all portfolio stocks and write av_earnings_cache.json.

Tiered data sources:
  Tier 1 — US stocks  : Alpha Vantage EARNINGS endpoint
  Tier 2 — HK stocks  : Akshare (Eastmoney) stock_financial_hk_report_em
  Skip   — ETFs       : No EPS data; Code 33 returns null naturally

Semi-annual reporters (e.g. Geely) are detected automatically.
H2 EPS is computed as FY − H1 and stored with frequency='H' so the
route can use step=2 instead of step=4 for YoY comparisons.

Runs weekly via GitHub Actions. AV_KEY must be set as a GitHub secret.
"""
import json, os, sys, time, warnings
from datetime import datetime, timezone
from pathlib import Path

warnings.filterwarnings("ignore")

ROOT = Path(__file__).parent.parent

# ── Load portfolio ────────────────────────────────────────────────
with open(ROOT / "portfolio.json") as f:
    raw = json.load(f)
stocks   = raw.get("portfolio", raw) if isinstance(raw, dict) else raw
us_syms  = [s["symbol"] for s in stocks if s.get("exchange") == "US"]
hk_syms  = [s["symbol"] for s in stocks if s.get("exchange") == "HK"]

print(f"US stocks  ({len(us_syms)}): {us_syms}")
print(f"HK stocks  ({len(hk_syms)}): {hk_syms}")

data: dict = {}

# ═══════════════════════════════════════════════════════════════════
# TIER 1 — Alpha Vantage (US)
# ═══════════════════════════════════════════════════════════════════
AV_KEY = os.environ.get("AV_KEY")

if us_syms:
    if not AV_KEY:
        print("\nWARNING: AV_KEY not set — skipping US stocks")
    else:
        import urllib.request
        print(f"\n── Tier 1: Alpha Vantage — {len(us_syms)} US stocks ──")
        print(f"   Estimated time: ~{len(us_syms) * 13}s (5 req/min rate limit)\n")

        for i, symbol in enumerate(us_syms):
            if i > 0:
                time.sleep(13)

            url = f"https://www.alphavantage.co/query?function=EARNINGS&symbol={symbol}&apikey={AV_KEY}"
            print(f"  [{i+1}/{len(us_syms)}] {symbol} ...", end=" ", flush=True)

            try:
                with urllib.request.urlopen(url, timeout=30) as resp:
                    result = json.loads(resp.read())

                note = result.get("Note") or result.get("Information") or result.get("Error Message")
                if note:
                    print(f"WARNING: {note[:100]}")
                    continue

                quarters = result.get("quarterlyEarnings", [])
                valid = [
                    {"fiscalDateEnding": q["fiscalDateEnding"], "reportedEPS": q["reportedEPS"]}
                    for q in quarters[:12]
                    if q.get("reportedEPS") not in (None, "None", "", "0.0000")
                ]
                if valid:
                    data[symbol] = {"frequency": "Q", "quarters": valid}
                    print(f"{len(valid)} quarters  latest: {valid[0]['fiscalDateEnding']} EPS={valid[0]['reportedEPS']}")
                else:
                    print("no valid EPS data")

            except Exception as e:
                print(f"ERROR: {e}")

# ═══════════════════════════════════════════════════════════════════
# TIER 2 — Akshare / Eastmoney (HK)
# ═══════════════════════════════════════════════════════════════════
if hk_syms:
    try:
        import akshare as ak
        import pandas as pd
        print(f"\n── Tier 2: Akshare — {len(hk_syms)} HK stocks ──\n")
    except ImportError:
        print("\nWARNING: akshare not installed — skipping HK stocks")
        ak = None

    if ak:
        for symbol in hk_syms:
            # Convert "0700.HK" → "00700", "9988.HK" → "09988"
            raw_code = symbol.replace(".HK", "")
            code = raw_code.zfill(5)   # pad to 5 digits (HK convention)

            print(f"  {symbol} ({code}) ...", end=" ", flush=True)
            time.sleep(2)  # brief pause between Akshare calls

            try:
                df = ak.stock_financial_hk_report_em(
                    stock=code, symbol="利润表", indicator="报告期"
                )

                # Extract Basic EPS rows (fallback to diluted)
                eps_df = df[df["STD_ITEM_NAME"] == "每股基本盈利"].copy()
                if eps_df.empty:
                    eps_df = df[df["STD_ITEM_NAME"] == "每股摊薄盈利"].copy()
                if eps_df.empty:
                    print("no EPS row found")
                    continue

                eps_df = eps_df.sort_values("REPORT_DATE", ascending=False).head(16)

                # Detect reporting frequency from period months
                dates = [str(r["REPORT_DATE"])[:10] for _, r in eps_df.iterrows()]
                months = set(d[5:7] for d in dates)

                if months <= {"06", "12"}:
                    # ── Semi-annual reporter ──────────────────────────
                    frequency = "H"
                    ann = {}  # year → {H1, FY}
                    for _, r in eps_df.iterrows():
                        dt  = str(r["REPORT_DATE"])[:10]
                        yr  = int(dt[:4])
                        mo  = int(dt[5:7])
                        val = float(r["AMOUNT"])
                        if mo == 6:
                            ann.setdefault(yr, {})["H1"] = (dt, val)
                        elif mo == 12:
                            ann.setdefault(yr, {})["FY"] = (dt, val)

                    periods = []
                    for yr in sorted(ann.keys(), reverse=True):
                        d = ann[yr]
                        if "H1" in d:
                            periods.append({"fiscalDateEnding": d["H1"][0], "reportedEPS": str(round(d["H1"][1], 4))})
                        if "H1" in d and "FY" in d:
                            h2 = d["FY"][1] - d["H1"][1]
                            periods.append({"fiscalDateEnding": d["FY"][0], "reportedEPS": str(round(h2, 4))})

                    # Sort newest-first (H2/FY before H1 within same year)
                    periods.sort(key=lambda x: x["fiscalDateEnding"], reverse=True)

                    if len(periods) >= 6:
                        data[symbol] = {"frequency": frequency, "quarters": periods}
                        print(f"{len(periods)} semi-annual periods  latest: {periods[0]['fiscalDateEnding']} EPS={periods[0]['reportedEPS']}")
                    else:
                        print(f"only {len(periods)} semi-annual periods — insufficient")

                else:
                    # ── Quarterly reporter ────────────────────────────
                    # First, detect whether Eastmoney is serving cumulative YTD values
                    # (common for mainland-incorporated HK stocks) vs true individual quarters.
                    # Heuristic: if Dec EPS / Mar EPS > 2.5x consistently, data is cumulative.
                    by_year: dict = {}
                    for _, r in eps_df.iterrows():
                        dt  = str(r["REPORT_DATE"])[:10]
                        yr  = dt[:4]
                        mo  = int(dt[5:7])
                        val = r["AMOUNT"]
                        if val is None or str(val) in ("None", "", "nan"):
                            continue
                        by_year.setdefault(yr, {})[mo] = (dt, float(val))

                    dec_mar_ratios = [
                        by_year[yr][12][1] / by_year[yr][3][1]
                        for yr in sorted(by_year.keys(), reverse=True)[:3]
                        if 3 in by_year[yr] and 12 in by_year[yr] and by_year[yr][3][1] != 0
                    ]
                    is_cumulative = bool(
                        dec_mar_ratios and
                        sum(dec_mar_ratios) / len(dec_mar_ratios) > 2.5
                    )

                    if is_cumulative:
                        # Convert cumulative YTD → individual quarterly by differencing.
                        # Within each year, reset prev=0 so Q1 = Q1_ytd unchanged.
                        quarters = []
                        for yr in sorted(by_year.keys(), reverse=True):
                            prev = 0.0
                            for mo, (dt, eps_val) in sorted(by_year[yr].items()):
                                incremental = max(eps_val - prev, 0.0)  # clamp rounding noise
                                quarters.append({
                                    "fiscalDateEnding": dt,
                                    "reportedEPS": str(round(incremental, 4)),
                                })
                                prev = eps_val
                        quarters.sort(key=lambda x: x["fiscalDateEnding"], reverse=True)
                        cumulative_tag = " (YTD→individual converted)"
                    else:
                        # Already individual quarterly values — use as-is
                        quarters = []
                        for _, r in eps_df.iterrows():
                            dt  = str(r["REPORT_DATE"])[:10]
                            val = r["AMOUNT"]
                            if val is None or str(val) in ("None", "", "nan"):
                                continue
                            quarters.append({"fiscalDateEnding": dt, "reportedEPS": str(round(float(val), 4))})
                        cumulative_tag = ""

                    if len(quarters) >= 7:
                        data[symbol] = {"frequency": "Q", "quarters": quarters}
                        print(f"{len(quarters)} quarters{cumulative_tag}  latest: {quarters[0]['fiscalDateEnding']} EPS={quarters[0]['reportedEPS']}")
                    else:
                        print(f"only {len(quarters)} quarters — insufficient")

            except Exception as e:
                print(f"ERROR: {e}")

# ═══════════════════════════════════════════════════════════════════
# Write cache
# ═══════════════════════════════════════════════════════════════════
cache = {
    "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "stocks":  us_syms + hk_syms,
    "data":    data,
}

out_path = ROOT / "av_earnings_cache.json"
with open(out_path, "w") as f:
    json.dump(cache, f, indent=2)

total = len(data)
print(f"\n✓ Wrote {out_path}  ({total}/{len(us_syms + hk_syms)} stocks populated)")
for sym, v in data.items():
    freq = v["frequency"]
    n    = len(v["quarters"])
    print(f"  {sym:<12} freq={freq}  n={n}")
