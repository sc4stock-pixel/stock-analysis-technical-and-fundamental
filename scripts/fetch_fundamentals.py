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


HK_INCOME_MAP = {
    "营业额": "revenue",
    "毛利": "grossProfit",
    "经营溢利": "operatingIncome",
    "本公司股东应占溢利": "netIncome",
    "每股基本盈利": "epsBasic",
}

HK_BALANCE_MAP = {
    "应收账款": "ar",
    "存货": "inventory",
    "应付账款": "ap",
    "资产总计": "totalAssets",
    "负债合计": "totalLiab",
    "流动资产合计": "currentAssets",
    "流动负债合计": "currentLiab",
    "未分配利润": "retainedEarnings",
    "长期借款": "longTermDebt",
    "股本": "sharesOutstanding",
}

HK_CASHFLOW_MAP = {
    "经营活动产生的现金流量净额": "cfo",
    "购建固定资产、无形资产和其他长期资产支付的现金": "capex",
}


def _hk_code(symbol: str) -> str:
    return symbol.replace(".HK", "").zfill(5)


def _hk_fetch_statement(ak, code: str, statement_zh: str):
    """statement_zh ∈ {'利润表','资产负债表','现金流量表'}"""
    return ak.stock_financial_hk_report_em(stock=code, symbol=statement_zh, indicator="报告期")


def _detect_cumulative_ytd(date_value_pairs: list[tuple[str, float]]) -> bool:
    """Boundary = consecutive drop of >40%. Within each FY, check monotonic non-decrease."""
    if len(date_value_pairs) < 4:
        return False
    boundaries = [0]
    for i in range(1, len(date_value_pairs)):
        prev = date_value_pairs[i - 1][1]
        curr = date_value_pairs[i][1]
        if prev > 0 and curr / prev < 0.6:
            boundaries.append(i)
    boundaries.append(len(date_value_pairs))

    groups_pass = 0
    groups_total = 0
    for a, b in zip(boundaries[:-1], boundaries[1:]):
        if b - a < 2:
            continue
        groups_total += 1
        vals = [p[1] for p in date_value_pairs[a:b]]
        ok = all(vals[i + 1] >= vals[i] * 0.95 for i in range(len(vals) - 1))
        if ok:
            groups_pass += 1
    return groups_total > 0 and (groups_pass / groups_total) > 0.5


def _convert_ytd_to_period(rows_newest_first: list[dict], fields: list[str]) -> list[dict]:
    """Within each FY, subtract prev YTD from current to get incremental period values."""
    asc = list(reversed(rows_newest_first))
    if not asc:
        return rows_newest_first
    boundaries = [0]
    for i in range(1, len(asc)):
        p_prev = asc[i - 1].get("revenue")
        p_curr = asc[i].get("revenue")
        if p_prev and p_curr and p_curr / p_prev < 0.6:
            boundaries.append(i)
    boundaries.append(len(asc))

    out = [dict(r) for r in asc]
    for a, b in zip(boundaries[:-1], boundaries[1:]):
        for j in range(a + 1, b):
            for f in fields:
                curr = asc[j].get(f)
                prev = asc[j - 1].get(f)
                if curr is not None and prev is not None:
                    out[j][f] = max(curr - prev, 0)
    return list(reversed(out))


def fetch_hk_income(ak, pd, symbol: str, periods: int = 6) -> tuple[list[dict], str]:
    """Returns (periods_list, frequency). Applies cumulative-YTD conversion when detected."""
    code = _hk_code(symbol)
    df = _hk_fetch_statement(ak, code, "利润表")
    if df is None or df.empty:
        return [], "Q"

    df = df[df["STD_ITEM_NAME"].isin(HK_INCOME_MAP.keys())].copy()
    pivot = df.pivot_table(
        index="REPORT_DATE", columns="STD_ITEM_NAME", values="AMOUNT", aggfunc="first"
    ).reset_index()
    pivot = pivot.sort_values("REPORT_DATE", ascending=False)

    months = {str(d)[5:7] for d in pivot["REPORT_DATE"]}
    frequency = "H" if months <= {"06", "12"} else "Q"

    is_cumulative = _detect_cumulative_ytd(
        [(str(r["REPORT_DATE"])[:10], float(r["营业额"])) for _, r in
         pivot.sort_values("REPORT_DATE").iterrows()
         if r.get("营业额") is not None and not pd.isna(r["营业额"])]
    )

    rows = []
    for _, r in pivot.iterrows():
        row = {"endDate": str(r["REPORT_DATE"])[:10]}
        for zh, en in HK_INCOME_MAP.items():
            val = r.get(zh)
            row[en] = None if val is None or pd.isna(val) else float(val)
        rows.append(row)

    if is_cumulative:
        rows = _convert_ytd_to_period(rows, fields=list(HK_INCOME_MAP.values()))

    return rows[:periods], frequency


def fetch_hk_balance(ak, pd, symbol: str, periods: int = 6) -> list[dict]:
    df = _hk_fetch_statement(ak, _hk_code(symbol), "资产负债表")
    if df is None or df.empty:
        return []
    df = df[df["STD_ITEM_NAME"].isin(HK_BALANCE_MAP.keys())]
    pivot = df.pivot_table(index="REPORT_DATE", columns="STD_ITEM_NAME", values="AMOUNT", aggfunc="first") \
              .reset_index().sort_values("REPORT_DATE", ascending=False)
    rows = []
    for _, r in pivot.iterrows():
        row = {"endDate": str(r["REPORT_DATE"])[:10]}
        for zh, en in HK_BALANCE_MAP.items():
            v = r.get(zh)
            row[en] = None if v is None or pd.isna(v) else float(v)
        rows.append(row)
    return rows[:periods]


def fetch_hk_cashflow(ak, pd, symbol: str, periods: int = 6, is_cumulative_hint: bool = False) -> list[dict]:
    """Cash-flow lines are typically reported cumulatively — apply conversion if hinted."""
    df = _hk_fetch_statement(ak, _hk_code(symbol), "现金流量表")
    if df is None or df.empty:
        return []
    df = df[df["STD_ITEM_NAME"].isin(HK_CASHFLOW_MAP.keys())]
    pivot = df.pivot_table(index="REPORT_DATE", columns="STD_ITEM_NAME", values="AMOUNT", aggfunc="first") \
              .reset_index().sort_values("REPORT_DATE", ascending=False)
    rows = []
    for _, r in pivot.iterrows():
        row = {"endDate": str(r["REPORT_DATE"])[:10]}
        for zh, en in HK_CASHFLOW_MAP.items():
            v = r.get(zh)
            row[en] = None if v is None or pd.isna(v) else float(v)
        rows.append(row)

    if is_cumulative_hint:
        rows = _convert_ytd_to_period(rows, fields=list(HK_CASHFLOW_MAP.values()))

    for r in rows:
        cfo, capex = r.get("cfo"), r.get("capex")
        if cfo is not None and capex is not None:
            r["fcf"] = cfo - capex
        else:
            r["fcf"] = None
    return rows[:periods]


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

    if hk_syms:
        try:
            import akshare as ak
            import pandas as pd
        except ImportError:
            print("\nWARNING: akshare/pandas not installed — skipping HK stocks")
            ak = None
        if ak:
            print(f"\n── Tier 2: Akshare — {len(hk_syms)} HK stocks × 3 endpoints ──")
            for i, sym in enumerate(hk_syms):
                if i > 0:
                    time.sleep(2)
                print(f"  [{i+1}/{len(hk_syms)}] {sym} ...", flush=True)
                inc, freq = fetch_hk_income(ak, pd, sym)
                bal = fetch_hk_balance(ak, pd, sym)
                cf = fetch_hk_cashflow(ak, pd, sym, is_cumulative_hint=True)
                print(f"    IS={len(inc)} BS={len(bal)} CF={len(cf)} freq={freq}")
                periods_merged = merge_statements(inc, bal, cf)
                data[sym] = {"frequency": freq, "periods": periods_merged}

    out = {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "data": data,
    }
    with open(args.output, "w") as f:
        json.dump(out, f, indent=2)
    print(f"\nWrote {args.output} ({len(data)} symbols)")


if __name__ == "__main__":
    main()
