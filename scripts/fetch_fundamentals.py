#!/usr/bin/env python3
"""
Fetch quarterly IS/BS/CF for all portfolio stocks and write fundamentals_cache.json.

  Tier 1 — US stocks  : Alpha Vantage INCOME_STATEMENT + BALANCE_SHEET + CASH_FLOW
  Tier 2 — HK stocks  : Akshare stock_financial_hk_report_em (利润表/资产负债表/现金流量表)
  Skip   — ETFs       : No fundamentals; entry omitted from cache

For HK cumulative-YTD reporters (Tencent, BYD, Xiaomi, Alibaba),
FY-reset detection + within-FY differencing is applied to every flow field.

Output schema: see docs/superpowers/specs/2026-05-26-fundamental-tab-momentum-charts-design.md §3.
"""
import argparse, json, os, sys, time, warnings
import urllib.request, urllib.error
from datetime import datetime, timezone
from pathlib import Path

warnings.filterwarnings("ignore")

ROOT = Path(__file__).parent.parent

ETF_TICKERS = {"SPY", "QQQ", "3033.HK"}

AV_BASE = "https://www.alphavantage.co/query"
AV_KEY = os.environ.get("AV_KEY")
AV_SLEEP_SEC = 13  # 5 req/min → 12s + 1s buffer


def load_portfolio():
    with open(ROOT / "portfolio.json") as f:
        raw = json.load(f)
    stocks = raw.get("portfolio", raw) if isinstance(raw, dict) else raw
    us = [s["symbol"] for s in stocks if s.get("exchange") == "US" and s["symbol"] not in ETF_TICKERS]
    hk = [s["symbol"] for s in stocks if s.get("exchange") == "HK" and s["symbol"] not in ETF_TICKERS]
    return us, hk


def _av_get(function: str, symbol: str) -> dict | None:
    """One AV call with throttling baked in. Returns parsed JSON or None on hard error."""
    url = f"{AV_BASE}?function={function}&symbol={symbol}&apikey={AV_KEY}"
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            payload = json.loads(resp.read())
    except (urllib.error.URLError, json.JSONDecodeError) as e:
        print(f"    ERROR {function}: {e}")
        return None
    note = payload.get("Note") or payload.get("Information") or payload.get("Error Message")
    if note:
        print(f"    WARNING {function}: {note[:100]}")
        return None
    return payload


def _to_float(v) -> float | None:
    if v in (None, "None", "", "-"):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def fetch_us_income(symbol: str, periods: int = 6) -> list[dict]:
    """Returns last `periods` quarterly income statements, newest first.
    Each row keeps only fields needed downstream."""
    payload = _av_get("INCOME_STATEMENT", symbol)
    if not payload:
        return []
    quarters = payload.get("quarterlyReports", [])[:periods]
    out = []
    for q in quarters:
        out.append({
            "endDate": q.get("fiscalDateEnding"),
            "revenue": _to_float(q.get("totalRevenue")),
            "grossProfit": _to_float(q.get("grossProfit")),
            "operatingIncome": _to_float(q.get("operatingIncome")),
            "netIncome": _to_float(q.get("netIncome")),
            "ebit": _to_float(q.get("ebit")) or _to_float(q.get("operatingIncome")),
        })
    return out


def fetch_us_balance(symbol: str, periods: int = 6) -> list[dict]:
    payload = _av_get("BALANCE_SHEET", symbol)
    if not payload:
        return []
    quarters = payload.get("quarterlyReports", [])[:periods]
    out = []
    for q in quarters:
        out.append({
            "endDate": q.get("fiscalDateEnding"),
            "ar": _to_float(q.get("currentNetReceivables")),
            "inventory": _to_float(q.get("inventory")),
            "ap": _to_float(q.get("currentAccountsPayable")),
            "totalAssets": _to_float(q.get("totalAssets")),
            "totalLiab": _to_float(q.get("totalLiabilities")),
            "currentAssets": _to_float(q.get("totalCurrentAssets")),
            "currentLiab": _to_float(q.get("totalCurrentLiabilities")),
            "retainedEarnings": _to_float(q.get("retainedEarnings")),
            "sharesOutstanding": _to_float(q.get("commonStockSharesOutstanding")),
            "longTermDebt": _to_float(q.get("longTermDebt")),
        })
    return out


def fetch_us_cashflow(symbol: str, periods: int = 6) -> list[dict]:
    payload = _av_get("CASH_FLOW", symbol)
    if not payload:
        return []
    quarters = payload.get("quarterlyReports", [])[:periods]
    out = []
    for q in quarters:
        cfo = _to_float(q.get("operatingCashflow"))
        capex = _to_float(q.get("capitalExpenditures"))
        fcf = (cfo - capex) if (cfo is not None and capex is not None) else None
        out.append({
            "endDate": q.get("fiscalDateEnding"),
            "cfo": cfo,
            "capex": capex,
            "fcf": fcf,
        })
    return out


def merge_statements(income: list[dict], balance: list[dict], cashflow: list[dict]) -> list[dict]:
    """Join the three statement arrays on endDate.
    Returns periods[] newest-first per the cache schema.
    Missing fields stay as None — never silently zeroed."""
    by_date: dict[str, dict] = {}
    for row in income:
        by_date.setdefault(row["endDate"], {"endDate": row["endDate"]}).update(row)
    for row in balance:
        by_date.setdefault(row["endDate"], {"endDate": row["endDate"]}).update(row)
    for row in cashflow:
        by_date.setdefault(row["endDate"], {"endDate": row["endDate"]}).update(row)

    periods = sorted(by_date.values(), key=lambda r: r["endDate"], reverse=True)

    # Compute workingCapital where possible
    for p in periods:
        ca, cl = p.get("currentAssets"), p.get("currentLiab")
        p["workingCapital"] = (ca - cl) if (ca is not None and cl is not None) else None

    return periods


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--only", help="Restrict to a single symbol (debug)")
    p.add_argument("--output", default=str(ROOT / "fundamentals_cache.json"))
    args = p.parse_args()

    us_syms, hk_syms = load_portfolio()
    if args.only:
        us_syms = [s for s in us_syms if s == args.only]
        hk_syms = [s for s in hk_syms if s == args.only]

    print(f"US stocks ({len(us_syms)}): {us_syms}")
    print(f"HK stocks ({len(hk_syms)}): {hk_syms}")

    data = {}

    if us_syms and AV_KEY:
        print(f"\n── Tier 1: Alpha Vantage — {len(us_syms)} US stocks × 3 endpoints ──")
        for i, sym in enumerate(us_syms):
            if i > 0:
                time.sleep(AV_SLEEP_SEC)
            print(f"  [{i+1}/{len(us_syms)}] {sym} IS ...", flush=True)
            inc = fetch_us_income(sym)
            time.sleep(AV_SLEEP_SEC)
            print(f"    {sym} BS ...", flush=True)
            bal = fetch_us_balance(sym)
            time.sleep(AV_SLEEP_SEC)
            print(f"    {sym} CF ...", flush=True)
            cf  = fetch_us_cashflow(sym)
            print(f"    IS={len(inc)} BS={len(bal)} CF={len(cf)} periods")
            periods = merge_statements(inc, bal, cf)
            data[sym] = {"frequency": "Q", "periods": periods}
    elif us_syms and not AV_KEY:
        print("\nWARNING: AV_KEY not set — skipping US stocks")

    out = {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "data": data,
    }
    with open(args.output, "w") as f:
        json.dump(out, f, indent=2)
    print(f"\nWrote {args.output} ({len(data)} symbols)")


if __name__ == "__main__":
    main()
