#!/usr/bin/env python3
"""
Fetch quarterly EPS for all portfolio stocks and write av_earnings_cache.json.

Tiered data sources:
  Tier 1 — US stocks  : Alpha Vantage EARNINGS endpoint
  Tier 2 — HK stocks  : Akshare (Eastmoney) stock_financial_hk_report_em
  Skip   — ETFs       : No EPS data; Code 33 returns null naturally

Semi-annual reporters (e.g. Geely) are detected automatically.
H2 EPS is computed as FY − H1 and stored with frequency='H'. The web consumer
(analyze-stock.ts) matches year-ago periods by fiscalDateEnding (date-aware),
so gaps in the series degrade to "no data" instead of wrong comparisons.

Runs weekly via GitHub Actions. AV_KEY must be set as a GitHub secret.
"""
import json, os, sys, time, warnings
from datetime import date as _date
from datetime import datetime, timezone
from pathlib import Path

warnings.filterwarnings("ignore")

ROOT = Path(__file__).parent.parent


# ═══════════════════════════════════════════════════════════════════
# Pure helpers — unit-tested in test_av_earnings_conversion.py
# ═══════════════════════════════════════════════════════════════════

def _days_between(d1: str, d2: str) -> int:
    a = _date(int(d1[:4]), int(d1[5:7]), int(d1[8:10]))
    b = _date(int(d2[:4]), int(d2[5:7]), int(d2[8:10]))
    return (b - a).days


def split_fiscal_years(all_periods: list) -> list:
    """Split ascending (date, ytd_value) pairs into fiscal-year groups.

    Boundary (YTD reset) when:
      a) profitable reset: value drops >40% vs previous YTD
      b) loss-maker reset: negative YTD shrinks >40% toward zero
         (e.g. -2.4 YTD FY-end → -0.3 new-FY Q1); the old `prev_val > 0`
         guard made loss-makers invisible and merged fiscal years
      c) calendar gap: >140 days since the previous period — a missing
         quarter must not let the YTD subtraction lump two quarters together
      d) group already has 4 quarters — a fiscal year cannot have more;
         caps damage if a)/b) miss a reset
    """
    fiscal_groups: list = [[all_periods[0]]] if all_periods else []
    for i in range(1, len(all_periods)):
        prev_dt, prev_val = all_periods[i - 1]
        curr_dt, curr_val = all_periods[i]
        profit_reset = prev_val > 0 and curr_val / prev_val < 0.6
        loss_reset   = prev_val < 0 and curr_val > prev_val * 0.6
        period_gap   = _days_between(prev_dt, curr_dt) > 140
        group_full   = len(fiscal_groups[-1]) >= 4
        if profit_reset or loss_reset or period_gap or group_full:
            fiscal_groups.append([])
        fiscal_groups[-1].append(all_periods[i])
    return fiscal_groups


def detect_cumulative(fiscal_groups: list) -> bool:
    """True when most multi-period fiscal years have monotonically
    non-decreasing |YTD| (5% tolerance absorbs rounding noise like BYD Q2
    2024) — the signature of cumulative YTD reporting.

    Absolute value, not raw value: a cumulative LOSS-maker's YTD series is
    monotonically decreasing (-0.5 → -1.2 → -1.8 → -2.4); the old raw-value
    non-decrease check classified those as individual quarters and skipped
    the conversion entirely."""
    cumul_fy = sum(
        1 for fy in fiscal_groups if len(fy) >= 2
        and all(
            abs(fy[j + 1][1]) >= abs(fy[j][1]) * 0.95
            for j in range(len(fy) - 1)
        )
    )
    total_fy = sum(1 for fy in fiscal_groups if len(fy) >= 2)
    return total_fy > 0 and cumul_fy / total_fy > 0.5


def convert_cumulative_quarters(fiscal_groups: list) -> list:
    """Convert YTD groups → individual quarters (newest-first dicts).

    Within each fiscal year subtract the previous period; prev resets to 0.0
    at each FY boundary so Q1 = Q1_ytd. The difference is SIGNED — a loss
    quarter inside a profitable FY is a real negative EPS, not 0. (The old
    max(…, 0.0) clamp hid losses and fed phony 0s into the YoY growth math.)
    """
    quarters = []
    for fy in reversed(fiscal_groups):   # newest FY first
        prev = 0.0
        for dt, eps_val in fy:           # ascending within FY
            incremental = eps_val - prev
            quarters.append({
                "fiscalDateEnding": dt,
                "reportedEPS": str(round(incremental, 4)),
            })
            prev = eps_val
    quarters.sort(key=lambda x: x["fiscalDateEnding"], reverse=True)
    return quarters


def build_hk_quarterly(all_periods: list) -> tuple[list, str]:
    """Full HK quarterly path: detect cumulative YTD reporting and convert.

    all_periods: ascending (date, value) pairs.
    Returns (quarters newest-first, tag for logging).
    """
    fiscal_groups = split_fiscal_years(all_periods)
    if detect_cumulative(fiscal_groups):
        return convert_cumulative_quarters(fiscal_groups), " (YTD→individual converted)"
    # Already individual quarterly values — use as-is
    quarters = [
        {"fiscalDateEnding": dt, "reportedEPS": str(round(val, 4))}
        for dt, val in reversed(all_periods)
    ]
    return quarters, ""


def build_hk_semiannual(rows: list) -> list:
    """Semi-annual path: rows of (date, value) where Jun = H1 YTD, Dec = FY.
    H2 = FY − H1 (signed). Years with FY but no H1 are skipped — the
    date-aware consumer treats the gap as 'no data', not a wrong compare."""
    ann: dict = {}  # year → {H1, FY}
    for dt, val in rows:
        yr, mo = int(dt[:4]), int(dt[5:7])
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
    return periods


# ═══════════════════════════════════════════════════════════════════
# Script body
# ═══════════════════════════════════════════════════════════════════

def main() -> None:
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

                    # Build flat (date, value) list, drop invalid values
                    all_rows = []
                    for _, r in eps_df.iterrows():
                        dt  = str(r["REPORT_DATE"])[:10]
                        val = r["AMOUNT"]
                        if val is None or str(val) in ("None", "", "nan"):
                            continue
                        all_rows.append((dt, float(val)))

                    # Detect reporting frequency from period months
                    months = set(dt[5:7] for dt, _ in all_rows)

                    if months <= {"06", "12"}:
                        # ── Semi-annual reporter ──────────────────────────
                        periods = build_hk_semiannual(all_rows)
                        if len(periods) >= 6:
                            data[symbol] = {"frequency": "H", "quarters": periods}
                            print(f"{len(periods)} semi-annual periods  latest: {periods[0]['fiscalDateEnding']} EPS={periods[0]['reportedEPS']}")
                        else:
                            print(f"only {len(periods)} semi-annual periods — insufficient")

                    else:
                        # ── Quarterly reporter (cumulative YTD aware) ─────
                        # Fiscal-year-aware: the old Dec/Mar calendar-year
                        # ratio failed for non-calendar FY stocks (e.g.
                        # Alibaba, FY Apr–Mar). See split_fiscal_years().
                        all_periods = sorted(all_rows, key=lambda x: x[0])
                        quarters, cumulative_tag = build_hk_quarterly(all_periods)

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


if __name__ == "__main__":
    main()
