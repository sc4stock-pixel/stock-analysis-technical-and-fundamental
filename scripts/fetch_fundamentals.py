#!/usr/bin/env python3
"""
Fetch quarterly IS/BS/CF for all portfolio stocks and write fundamentals_cache.json.

  Tier 1 — US stocks  : yfinance (Yahoo Finance) — no rate limits, handles auth automatically
  Tier 2 — HK stocks  : Akshare stock_financial_hk_report_em (利润表/资产负债表/现金流量表)
  Skip   — ETFs       : No fundamentals; entry omitted from cache

AV is NOT used here (25 calls/day free limit is shared with fetch_av_earnings.py).
yfinance replaces AV for US financial statements and market cap.

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


def _to_float_yf(v) -> float | None:
    """Convert yfinance value (may be NaN, None, or numeric) to float or None."""
    import math
    if v is None:
        return None
    try:
        f = float(v)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def _yf_row(df, *names) -> float | None:
    """Extract the first available row name from a yfinance DataFrame column."""
    for name in names:
        if name in df.index:
            val = df.loc[name]
            if hasattr(val, 'iloc'):
                return _to_float_yf(val.iloc[0])
            return _to_float_yf(val)
    return None


def fetch_us_fundamentals_yf(symbol: str, periods: int = 6) -> tuple[list[dict], list[dict], list[dict], float | None]:
    """Fetch US quarterly IS/BS/CF and market cap via yfinance. No AV calls consumed."""
    try:
        import yfinance as yf
        ticker = yf.Ticker(symbol)
        fi = ticker.fast_info
        market_cap = getattr(fi, 'market_cap', None) or (ticker.info or {}).get('marketCap')
        inc, bal, cf, _ = _yf_extract_statements(ticker, periods)
        return inc, bal, cf, market_cap
    except Exception as e:
        print(f"    WARNING yfinance {symbol}: {e}")
        return [], [], [], None


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


# Map sparse-yfinance-HK tickers to their US ADRs (same financials, fuller Yahoo coverage).
# Keep original HK market cap — only fall back to ADR for IS/BS/CF data.
HK_ADR_MAP = {
    "0700.HK": "TCEHY",   # Tencent
    "9988.HK": "BABA",    # Alibaba
    "1810.HK": "XIACY",   # Xiaomi
    "1211.HK": "BYDDY",   # BYD
    "0175.HK": "GELYY",   # Geely
    "0939.HK": "CICHY",   # CCB
}


def _yf_extract_statements(ticker, periods: int = 6) -> tuple[list[dict], list[dict], list[dict], str]:
    """Pull IS/BS/CF arrays from a yfinance Ticker object. Returns (income, balance, cashflow, frequency)."""
    inc_df = ticker.quarterly_income_stmt
    bal_df = ticker.quarterly_balance_sheet
    cf_df  = ticker.quarterly_cash_flow

    income, balance, cashflow = [], [], []
    frequency = "Q"

    if inc_df is not None and not inc_df.empty:
        months = {str(col)[5:7] for col in list(inc_df.columns)[:periods]}
        frequency = "H" if months <= {"06", "12"} else "Q"
        for col in list(inc_df.columns)[:periods]:
            s = inc_df[col]
            def g(*names): return _to_float_yf(next((s.get(n) for n in names if n in s.index), None))
            income.append({
                "endDate": str(col)[:10],
                "revenue":         g("Total Revenue"),
                "grossProfit":     g("Gross Profit"),
                "operatingIncome": g("Operating Income", "EBIT"),
                "netIncome":       g("Net Income", "Net Income Common Stockholders"),
                "ebit":            g("EBIT", "Operating Income"),
            })

    if bal_df is not None and not bal_df.empty:
        for col in list(bal_df.columns)[:periods]:
            s = bal_df[col]
            def g(*names): return _to_float_yf(next((s.get(n) for n in names if n in s.index), None))
            balance.append({
                "endDate": str(col)[:10],
                "ar":               g("Accounts Receivable", "Net Receivables"),
                "inventory":        g("Inventory"),
                "ap":               g("Accounts Payable"),
                "totalAssets":      g("Total Assets"),
                "totalLiab":        g("Total Liabilities Net Minority Interest", "Total Liabilities"),
                "currentAssets":    g("Current Assets"),
                "currentLiab":      g("Current Liabilities"),
                "retainedEarnings": g("Retained Earnings"),
                "sharesOutstanding": g("Ordinary Shares Number", "Share Issued"),
                "longTermDebt":     g("Long Term Debt", "Long Term Debt And Capital Lease Obligation"),
            })

    if cf_df is not None and not cf_df.empty:
        for col in list(cf_df.columns)[:periods]:
            s = cf_df[col]
            def g(*names): return _to_float_yf(next((s.get(n) for n in names if n in s.index), None))
            cfo   = g("Operating Cash Flow")
            capex = g("Capital Expenditure")
            fcf = (cfo + capex) if (cfo is not None and capex is not None) else None
            cashflow.append({
                "endDate": str(col)[:10],
                "cfo": cfo, "capex": capex, "fcf": fcf,
            })

    return income, balance, cashflow, frequency


def fetch_hk_fundamentals_yf(symbol: str, periods: int = 6) -> tuple[list[dict], list[dict], list[dict], float | None, str]:
    """Fetch HK quarterly/semi-annual IS/BS/CF + market cap via yfinance.
    Yahoo's HK ticker financial coverage is patchy for some names (Tencent, Xiaomi, Geely).
    For sparse cases, fall back to the US ADR ticker which has fuller statement coverage.
    Market cap is always pulled from the HK ticker (avoids currency mismatch).
    Returns (income, balance, cashflow, market_cap, frequency)."""
    try:
        import yfinance as yf
        hk_ticker = yf.Ticker(symbol)

        fi = hk_ticker.fast_info
        market_cap = getattr(fi, 'market_cap', None) or (hk_ticker.info or {}).get('marketCap')

        inc, bal, cf, freq = _yf_extract_statements(hk_ticker, periods)

        # Fall back to ADR if HK ticker has sparse data
        sparse = (len(cf) < 2 or len(bal) < 2 or
                  not (inc and inc[0].get('revenue') is not None))
        if sparse and symbol in HK_ADR_MAP:
            adr = HK_ADR_MAP[symbol]
            print(f"    {symbol} sparse — fetching ADR {adr} for statements")
            adr_ticker = yf.Ticker(adr)
            inc2, bal2, cf2, freq2 = _yf_extract_statements(adr_ticker, periods)
            # Adopt ADR data where richer
            if len(inc2) > len(inc) or (inc2 and inc2[0].get('revenue') is not None and not (inc and inc[0].get('revenue'))):
                inc = inc2
            if len(bal2) > len(bal): bal = bal2
            if len(cf2)  > len(cf):  cf  = cf2
            freq = freq2 if freq2 else freq

        # Final fallback: Akshare when both yfinance paths are sparse
        still_sparse = (len(cf) < 2 or not (inc and inc[0].get('revenue') is not None))
        if still_sparse:
            print(f"    {symbol} still sparse after ADR — trying Akshare fallback")
            try:
                import akshare as ak
                import pandas as pd
                inc_ak, freq_ak = fetch_hk_income_ak(ak, pd, symbol, periods)
                bal_ak           = fetch_hk_balance_ak(ak, pd, symbol, periods)
                cf_ak            = fetch_hk_cashflow_ak(ak, pd, symbol, periods)
                if len(inc_ak) > len(inc): inc = inc_ak
                if len(bal_ak) > len(bal): bal = bal_ak
                if len(cf_ak)  > len(cf):  cf  = cf_ak
                if freq_ak: freq = freq_ak
            except ImportError:
                pass
            except Exception as e2:
                print(f"    Akshare fallback error: {e2}")

        return inc, bal, cf, market_cap, freq

    except Exception as e:
        print(f"    WARNING yfinance HK {symbol}: {e}")
        return [], [], [], None, "Q"


# ── Akshare HK fetchers — used as final fallback when yfinance is sparse ──

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


def fetch_hk_income_ak(ak, pd, symbol: str, periods: int = 6) -> tuple[list[dict], str]:
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


def fetch_hk_balance_ak(ak, pd, symbol: str, periods: int = 6) -> list[dict]:
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


def fetch_hk_cashflow_ak(ak, pd, symbol: str, periods: int = 6) -> list[dict]:
    """Akshare HK cash flow with broad keyword matching + 每股经营现金流 per-share fallback.
    HK IFRS reporters use different Chinese labels than mainland GAAP — exact match fails.
    Approach:
      1. Broad substring search for CFO row (contains '经营' + '现金'/'净额')
      2. Broad substring search for capex row (contains '购建'/'购置' + '资产'/'物业')
      3. Per-share fallback: 每股经营现金流(元) × sharesOutstanding from income statement
    """
    df_cf = _hk_fetch_statement(ak, _hk_code(symbol), "现金流量表")
    df_is = _hk_fetch_statement(ak, _hk_code(symbol), "利润表")

    if df_cf is None or df_cf.empty:
        return []

    all_names = df_cf["STD_ITEM_NAME"].dropna().unique().tolist()

    # CFO candidates — ordered by specificity.
    # Probed actual Tencent/HK Eastmoney data: top-level subtotals are:
    #   '经营业务现金净额'  (HK GAAP/IFRS — confirmed for Tencent, Xiaomi, Geely)
    #   '经营活动产生的现金流量净额'  (mainland GAAP — different companies)
    CFO_CANDIDATES = [
        "经营业务现金净额",           # HK GAAP (Tencent, Xiaomi, Geely)
        "经营活动产生的现金流量净额",  # Mainland GAAP
        "经营产生现金",               # sub-total before tax (fallback)
    ]
    cfo_name = next((n for n in CFO_CANDIDATES if n in all_names), None)

    # Capex candidates
    CAPEX_CANDIDATES = [
        "购建固定资产",                        # HK GAAP confirmed
        "购建固定资产、无形资产和其他长期资产支付的现金",  # Mainland GAAP
        "购建无形资产及其他资产",              # partial capex fallback
    ]
    capex_name = next((n for n in CAPEX_CANDIDATES if n in all_names), None)

    rows_dict: dict[str, dict] = {}

    if cfo_name:
        for _, r in df_cf[df_cf["STD_ITEM_NAME"] == cfo_name].iterrows():
            dt = str(r["REPORT_DATE"])[:10]
            v = _to_float(str(r.get("AMOUNT", "")))
            rows_dict.setdefault(dt, {"endDate": dt})["cfo"] = v

    if capex_name:
        for _, r in df_cf[df_cf["STD_ITEM_NAME"] == capex_name].iterrows():
            dt = str(r["REPORT_DATE"])[:10]
            v = _to_float(str(r.get("AMOUNT", "")))
            rows_dict.setdefault(dt, {"endDate": dt})["capex"] = v

    # Per-share CFO fallback: 每股经营现金流(元) from income statement
    if not cfo_name and df_is is not None and not df_is.empty:
        ps_cfo_df = df_is[df_is["STD_ITEM_NAME"].astype(str).str.contains("每股经营现金流", na=False)]
        if not ps_cfo_df.empty:
            # Get shares from income statement (每股基本盈利 row gives us a scaling reference)
            # Use shares from balance sheet if available; otherwise use net_income / EPS ratio
            eps_df = df_is[df_is["STD_ITEM_NAME"] == "每股基本盈利"]
            for _, r in ps_cfo_df.iterrows():
                dt = str(r["REPORT_DATE"])[:10]
                ps_cfo = _to_float(str(r.get("AMOUNT", "")))
                if ps_cfo is None:
                    continue
                # Try to compute shares from NI / EPS if both available for this date
                ni_df = df_is[df_is["STD_ITEM_NAME"] == "本公司股东应占溢利"]
                ni_row = ni_df[ni_df["REPORT_DATE"].astype(str).str[:10] == dt]
                eps_row = eps_df[eps_df["REPORT_DATE"].astype(str).str[:10] == dt]
                if not ni_row.empty and not eps_row.empty:
                    ni = _to_float(str(ni_row.iloc[0].get("AMOUNT", "")))
                    eps = _to_float(str(eps_row.iloc[0].get("AMOUNT", "")))
                    if ni and eps and abs(eps) > 0:
                        shares = ni / eps
                        cfo_total = ps_cfo * shares
                        rows_dict.setdefault(dt, {"endDate": dt})["cfo"] = cfo_total

    rows = sorted(rows_dict.values(), key=lambda r: r["endDate"], reverse=True)

    # NOTE: Do NOT call _convert_ytd_to_period here.
    # HK GAAP Eastmoney data ('经营业务现金净额') is already period-specific, not cumulative YTD.
    # Applying conversion without revenue-based FY detection zeros out negative diffs.

    for r in rows:
        cfo   = r.get("cfo")
        capex = r.get("capex")
        # Exclude nan values that may come from Eastmoney blank cells
        import math
        if cfo is not None and isinstance(cfo, float) and math.isnan(cfo):
            cfo = None
        if capex is not None and isinstance(capex, float) and math.isnan(capex):
            capex = None
        if cfo is not None and capex is not None:
            r["fcf"] = cfo - capex
        elif cfo is not None:
            r["fcf"] = cfo   # capex unavailable — use CFO as FCF proxy (capex ~5-10% of CFO)
        else:
            r["fcf"] = None
        r["cfo"] = cfo

    return rows[:periods]


def altman_z(p: dict, market_cap: float | None = None) -> float | None:
    """Altman Z = 1.2·A + 1.4·B + 3.3·C + 0.6·D + 1.0·E
       A = WC/TA, B = RE/TA, C = EBIT/TA, D = MktCap/TotalLiab, E = Sales/TA
       Returns None if any required input is missing."""
    ta = p.get("totalAssets")
    if not ta:
        return None
    wc = p.get("workingCapital")
    re_ = p.get("retainedEarnings")
    ebit = p.get("ebit") or p.get("operatingIncome")
    sales = p.get("revenue")
    tl = p.get("totalLiab")
    if None in (wc, re_, ebit, sales, tl) or not tl or not market_cap:
        return None
    return (
        1.2 * (wc / ta)
        + 1.4 * (re_ / ta)
        + 3.3 * (ebit / ta)
        + 0.6 * (market_cap / tl)
        + 1.0 * (sales / ta)
    )


def piotroski_f(curr: dict, prev: dict) -> int | None:
    """9-point Piotroski F-Score. Requires curr and prev period dicts."""
    if not curr or not prev:
        return None
    score = 0
    # Profitability (4)
    if (curr.get("netIncome") or 0) > 0: score += 1
    if (curr.get("cfo") or 0) > 0: score += 1
    ta_c, ta_p = curr.get("totalAssets"), prev.get("totalAssets")
    if ta_c and ta_p:
        roa_c = (curr.get("netIncome") or 0) / ta_c
        roa_p = (prev.get("netIncome") or 0) / ta_p
        if roa_c > roa_p: score += 1
    if (curr.get("cfo") or 0) > (curr.get("netIncome") or 0): score += 1
    # Leverage / Liquidity (3 — issuance check skipped, sharesOutstanding unreliable for HK)
    ltd_c, ltd_p = curr.get("longTermDebt"), prev.get("longTermDebt")
    if ltd_c is not None and ltd_p is not None and ltd_c < ltd_p: score += 1
    ca_c, cl_c = curr.get("currentAssets"), curr.get("currentLiab")
    ca_p, cl_p = prev.get("currentAssets"), prev.get("currentLiab")
    if ca_c and cl_c and ca_p and cl_p and (ca_c / cl_c) > (ca_p / cl_p): score += 1
    # Operating Efficiency (2)
    gp_c, gp_p = curr.get("grossProfit"), prev.get("grossProfit")
    rev_c, rev_p = curr.get("revenue"), prev.get("revenue")
    if gp_c and gp_p and rev_c and rev_p and (gp_c / rev_c) > (gp_p / rev_p): score += 1
    if ta_c and ta_p and rev_c and rev_p and (rev_c / ta_c) > (rev_p / ta_p): score += 1
    return score


def compute_derived(periods: list[dict], market_cap: float | None) -> dict:
    """Compute 4-period arrays of Z and F scores, newest-first."""
    z_arr: list[float | None] = []
    f_arr: list[int | None] = []
    for i in range(min(4, len(periods))):
        z_arr.append(altman_z(periods[i], market_cap))
    step = 4 if len(periods) >= 5 else 1
    for i in range(min(4, len(periods))):
        prev_idx = i + step
        prev = periods[prev_idx] if prev_idx < len(periods) else None
        f_arr.append(piotroski_f(periods[i], prev))
    return {"altmanZ": z_arr, "piotroskiF": f_arr}


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

    if us_syms:
        print(f"\n── Tier 1: yfinance — {len(us_syms)} US stocks (IS + BS + CF + market cap) ──")
        print("  Using yfinance instead of AV to preserve the 25 req/day AV limit for EPS.")
        for i, sym in enumerate(us_syms):
            if i > 0:
                time.sleep(2)  # brief pause; yfinance has no strict rate limit
            print(f"  [{i+1}/{len(us_syms)}] {sym} ...", flush=True)
            inc, bal, cf, market_cap = fetch_us_fundamentals_yf(sym)
            print(f"    IS={len(inc)} BS={len(bal)} CF={len(cf)} mktCap={'✓' if market_cap else '✗'}")
            periods = merge_statements(inc, bal, cf)
            data[sym] = {"frequency": "Q", "periods": periods}
            data[sym]["derived"] = compute_derived(data[sym]["periods"], market_cap=market_cap)

    if hk_syms:
        print(f"\n── Tier 2: yfinance — {len(hk_syms)} HK stocks (IS + BS + CF + market cap) ──")
        print("  yfinance for HK eliminates Akshare cumulative-YTD and field-name issues.")
        for i, sym in enumerate(hk_syms):
            if i > 0:
                time.sleep(2)
            print(f"  [{i+1}/{len(hk_syms)}] {sym} ...", flush=True)
            inc, bal, cf, market_cap, freq = fetch_hk_fundamentals_yf(sym)
            print(f"    IS={len(inc)} BS={len(bal)} CF={len(cf)} freq={freq} mktCap={'✓' if market_cap else '✗'}")
            periods = merge_statements(inc, bal, cf)
            data[sym] = {"frequency": freq, "periods": periods}
            data[sym]["derived"] = compute_derived(data[sym]["periods"], market_cap=market_cap)

    out = {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "data": data,
    }
    with open(args.output, "w") as f:
        json.dump(out, f, indent=2)
    print(f"\nWrote {args.output} ({len(data)} symbols)")


if __name__ == "__main__":
    main()
