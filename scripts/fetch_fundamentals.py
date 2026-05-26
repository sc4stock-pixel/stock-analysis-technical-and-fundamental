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
from datetime import datetime, timezone
from pathlib import Path

warnings.filterwarnings("ignore")

ROOT = Path(__file__).parent.parent

ETF_TICKERS = {"SPY", "QQQ", "3033.HK"}


def load_portfolio():
    with open(ROOT / "portfolio.json") as f:
        raw = json.load(f)
    stocks = raw.get("portfolio", raw) if isinstance(raw, dict) else raw
    us = [s["symbol"] for s in stocks if s.get("exchange") == "US" and s["symbol"] not in ETF_TICKERS]
    hk = [s["symbol"] for s in stocks if s.get("exchange") == "HK" and s["symbol"] not in ETF_TICKERS]
    return us, hk


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
    # Tier 1 + Tier 2 filled in later tasks

    out = {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "data": data,
    }
    with open(args.output, "w") as f:
        json.dump(out, f, indent=2)
    print(f"\nWrote {args.output} ({len(data)} symbols)")


if __name__ == "__main__":
    main()
