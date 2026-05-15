#!/usr/bin/env python3
"""
SuperTrend Parameter Optimizer — single source of truth for st_params.json.

Produces the shared st_params.json consumed by both:
  - The Next.js web app  (fetched at runtime from raw.githubusercontent.com)
  - The local Python script (fetched from GitHub URL; local file as fallback)

Grid  : ATR periods [10, 12, 14] × Multipliers [2.5, 2.75, 3.0, 3.25, 3.5]
Metric: Sharpe ratio  (fallback: total_return when < 2 trades)

Indicator logic:  exact port of Python indicators.py (Wilder's EWM ATR)
Backtest logic:   matches Python BacktestEngine (strategy_type='supertrend')
                  and web app runSupertrendBacktest()

Dependencies: yfinance pandas numpy   (no local package imports)
"""
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf

# ─── Portfolio — loaded from portfolio.json; hardcoded list is the fallback ───
_PORTFOLIO_FALLBACK = [
    {"symbol": "9988.HK", "name": "Alibaba"},
    {"symbol": "0700.HK", "name": "Tencent"},
    {"symbol": "1211.HK", "name": "BYD"},
    {"symbol": "1810.HK", "name": "Xiaomi"},
    {"symbol": "0175.HK", "name": "Geely"},
    {"symbol": "3033.HK", "name": "HSTech"},
    {"symbol": "SPY",     "name": "SPY"},
    {"symbol": "QQQ",     "name": "QQQ"},
    {"symbol": "AAPL",    "name": "Apple"},
    {"symbol": "MSFT",    "name": "Microsoft"},
    {"symbol": "NVDA",    "name": "NVIDIA"},
    {"symbol": "GOOGL",   "name": "Alphabet"},
    {"symbol": "META",    "name": "Meta"},
    {"symbol": "TSM",     "name": "TSMC"},
    {"symbol": "AMD",     "name": "AMD"},
]

def _load_portfolio() -> list[dict]:
    """Read portfolio.json from repo root (one level up from scripts/).
    Falls back to hardcoded list if the file is missing or malformed."""
    portfolio_path = Path(__file__).parent.parent / "portfolio.json"
    try:
        data = json.loads(portfolio_path.read_text())
        entries = data.get("portfolio", [])
        if entries:
            loaded = [{"symbol": e["symbol"], "name": e.get("name", e["symbol"])} for e in entries]
            print(f"  📋 Loaded {len(loaded)} stocks from portfolio.json")
            return loaded
    except Exception as e:
        print(f"  ⚠  portfolio.json not found or invalid ({e}) — using fallback list")
    return _PORTFOLIO_FALLBACK

PORTFOLIO = _load_portfolio()

ATR_PERIODS   = [10, 12, 14]
MULTIPLIERS   = [2.5, 2.75, 3.0, 3.25, 3.5]
LOOKBACK_DAYS = 500       # trading days kept after fetch
COMMISSION    = 0.001     # 0.1% — matches Python config commissionRate
SLIPPAGE      = 0.0005    # 0.05% — matches Python config slippageRate
INITIAL_CAP   = 10_000

# Output: repo root/st_params.json  (script lives in repo root/scripts/)
OUTPUT_PATH = Path(__file__).parent.parent / "st_params.json"


# ─── Scheduling ───────────────────────────────────────────────────────────────

def _next_first_sunday(from_date: date) -> date:
    """First Sunday of the month following from_date — matches Python st_params_cache.py."""
    if from_date.month == 12:
        first_of_next = date(from_date.year + 1, 1, 1)
    else:
        first_of_next = date(from_date.year, from_date.month + 1, 1)
    days_ahead = (6 - first_of_next.weekday()) % 7   # 6 = Sunday
    return first_of_next + timedelta(days=days_ahead)


# ─── Indicators — exact port of Python indicators.py ─────────────────────────

def _calc_atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int) -> pd.Series:
    """Wilder's ATR — identical to TechnicalIndicators.atr()."""
    tr = pd.concat([
        high - low,
        (high - close.shift()).abs(),
        (low  - close.shift()).abs(),
    ], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / period, adjust=False).mean()


def _calc_sma(series: pd.Series, period: int) -> pd.Series:
    return series.rolling(window=period).mean()


def _calc_supertrend(high: pd.Series, low: pd.Series, close: pd.Series,
                     atr_period: int, multiplier: float):
    """
    Exact port of Python TechnicalIndicators.supertrend().
    Returns: (st_values, direction, signal)
      direction: 1 = uptrend, -1 = downtrend
      signal   : 'BUY' on bullish flip, 'SELL' on bearish flip, 'HOLD' otherwise
    """
    atr  = _calc_atr(high, low, close, atr_period)
    hl2  = (high + low) / 2
    ub   = hl2 + multiplier * atr
    lb   = hl2 - multiplier * atr

    st  = pd.Series(index=close.index, dtype=float)
    dir = pd.Series(index=close.index, dtype=float)

    first_valid = atr.first_valid_index()
    if first_valid is None:
        return st, dir, pd.Series("HOLD", index=close.index)

    fi = close.index.get_loc(first_valid)
    st.iloc[fi]  = ub.iloc[fi]
    dir.iloc[fi] = 1 if close.iloc[fi] > ub.iloc[fi] else -1

    ub_copy = ub.copy()
    lb_copy = lb.copy()

    for i in range(fi + 1, len(close)):
        if close.iloc[i - 1] > st.iloc[i - 1]:
            lb_copy.iloc[i] = max(lb_copy.iloc[i], lb_copy.iloc[i - 1])
        else:
            ub_copy.iloc[i] = min(ub_copy.iloc[i], ub_copy.iloc[i - 1])

        if close.iloc[i] > ub_copy.iloc[i - 1]:
            dir.iloc[i] = 1
            st.iloc[i]  = lb_copy.iloc[i]
        elif close.iloc[i] < lb_copy.iloc[i - 1]:
            dir.iloc[i] = -1
            st.iloc[i]  = ub_copy.iloc[i]
        else:
            dir.iloc[i] = dir.iloc[i - 1]
            st.iloc[i]  = lb_copy.iloc[i] if dir.iloc[i] == 1 else ub_copy.iloc[i]

    st  = st.bfill().ffill()
    dir = dir.bfill().ffill()

    # Flip signal — matches Python: signal at bars where direction changes
    prev_dir = dir.shift(1)
    sig = pd.Series("HOLD", index=close.index)
    sig = sig.mask(dir != prev_dir, np.where(dir == 1, "BUY", "SELL"))
    sig.iloc[fi] = "HOLD"   # no prev for first bar

    return st, dir, sig


# ─── Backtest ─────────────────────────────────────────────────────────────────

def _run_st_backtest(df: pd.DataFrame, atr_period: int, multiplier: float) -> dict:
    """
    SuperTrend backtest matching Python BacktestEngine (strategy_type='supertrend').

    Entry:  stEntrySignal == 'BUY' at bar i → enter at bar i's open
            Signal generated at bar i-1: ST BUY flip AND close > SMA50
                                      OR ST bullish AND SMA50 cross-up
    Stop:   ST line at signal bar; trails upward, never down
    Exit:   Low ≤ trailing stop → exit at min(stop, open)
         OR SELL entry signal (ST flipped bearish previous bar) → exit at open
    Costs:  SLIPPAGE + COMMISSION at entry and exit.
    Metric: Sharpe ratio from daily equity curve (annualised × √252).
            Falls back to total_return when < 2 trades.
    """
    high  = df["High"]
    low   = df["Low"]
    close = df["Close"]
    opens = df["Open"]

    st_v, st_d, st_s = _calc_supertrend(high, low, close, atr_period, multiplier)
    sma50            = _calc_sma(close, 50)

    n          = len(df)
    closes_a   = close.values
    highs_a    = high.values
    lows_a     = low.values
    opens_a    = opens.values
    st_vals    = st_v.values
    st_dirs    = st_d.values
    st_sigs    = st_s.values
    sma50_a    = sma50.values

    # ── Generate entry signals — matches web app pipeline.ts ST signal logic ──
    # Signal at bar i → entry_signal at bar i+1 (shift 1)
    entry_sigs = ["HOLD"] * n
    for i in range(1, n - 1):
        if st_sigs[i] == "SELL":
            entry_sigs[i + 1] = "SELL"
        elif st_sigs[i] == "BUY" and closes_a[i] > sma50_a[i]:
            entry_sigs[i + 1] = "BUY"
        elif st_dirs[i] == 1 and closes_a[i] > sma50_a[i] and closes_a[i - 1] <= sma50_a[i - 1]:
            # Price crosses above SMA50 while ST already bullish → BUY entry
            entry_sigs[i + 1] = "BUY"

    # ── Simulate ──────────────────────────────────────────────────────────────
    equity       = float(INITIAL_CAP)
    position     = None
    equity_curve = [equity]
    trades       = []

    for i in range(1, n):
        sig = entry_sigs[i]

        if position is None:
            if sig == "BUY":
                raw_entry  = opens_a[i] * (1 + SLIPPAGE)
                cost_per   = raw_entry  * (1 + COMMISSION)
                shares     = int(equity / cost_per)
                if shares > 0:
                    # Initial stop: ST line at signal bar (previous bar)
                    position = {
                        "entry": raw_entry,
                        "shares": shares,
                        "stop": st_vals[i - 1],
                    }
        else:
            # Trail stop upward only
            if st_vals[i] > position["stop"]:
                position["stop"] = st_vals[i]

            stop_hit    = lows_a[i] <= position["stop"]
            signal_exit = sig == "SELL"

            if stop_hit or signal_exit:
                raw_exit = min(position["stop"], opens_a[i]) if stop_hit else opens_a[i]
                net_exit = raw_exit * (1 - SLIPPAGE) * (1 - COMMISSION)

                pnl    = (net_exit - position["entry"]) * position["shares"]
                equity += pnl
                trades.append((net_exit - position["entry"]) / position["entry"])
                position = None

        equity_curve.append(equity)

    # ── Metrics ───────────────────────────────────────────────────────────────
    total_return = (equity - INITIAL_CAP) / INITIAL_CAP * 100
    num_trades   = len(trades)

    daily_rets = np.diff(equity_curve) / np.array(equity_curve[:-1])
    std_r      = float(np.std(daily_rets))
    sharpe     = float(np.mean(daily_rets)) / std_r * np.sqrt(252) if std_r > 0 else 0.0

    return {"total_return": total_return, "sharpe": sharpe, "num_trades": num_trades}


# ─── Per-symbol optimisation ──────────────────────────────────────────────────

def _optimize_symbol(stock: dict) -> tuple[str, dict | None]:
    symbol = stock["symbol"]
    print(f"  Optimizing {symbol} ({stock['name']})...", flush=True)

    try:
        df = yf.Ticker(symbol).history(
            period=f"{int(LOOKBACK_DAYS * 1.5)}d", auto_adjust=True
        )
        if df.empty or len(df) < 100:
            print(f"    ⚠  {symbol}: insufficient data ({len(df)} bars)")
            return symbol, None
        df = df.tail(LOOKBACK_DAYS).copy()
    except Exception as e:
        print(f"    ⚠  {symbol}: data fetch failed — {e}")
        return symbol, None

    best_score  = -999.0
    best_params = {"atr_period": 10, "multiplier": 3.0,
                   "total_return": 0.0, "sharpe": 0.0, "num_trades": 0}

    for atr_p in ATR_PERIODS:
        for mult in MULTIPLIERS:
            try:
                r = _run_st_backtest(df, atr_p, mult)
                # Primary: Sharpe; fallback to total_return if too few trades
                score = r["sharpe"] if r["num_trades"] >= 2 else r["total_return"]
                if score > best_score:
                    best_score  = score
                    best_params = {
                        "atr_period":   atr_p,
                        "multiplier":   mult,
                        "total_return": round(r["total_return"], 2),
                        "sharpe":       round(r["sharpe"], 2),
                        "num_trades":   r["num_trades"],
                    }
            except Exception as e:
                print(f"    ⚠  {symbol} ATR={atr_p} Mult={mult}: {e}")

    bp = best_params
    print(f"    ✅ {symbol}: ATR={bp['atr_period']}, Mult={bp['multiplier']} "
          f"→ Return={bp['total_return']:.1f}%, Sharpe={bp['sharpe']:.2f}, "
          f"Trades={bp['num_trades']}")
    return symbol, best_params


# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    today    = date.today()
    next_opt = _next_first_sunday(today)

    # Preserve optimization_count across monthly runs
    opt_count = 0
    if OUTPUT_PATH.exists():
        try:
            opt_count = json.loads(OUTPUT_PATH.read_text()).get("optimization_count", 0)
        except Exception:
            pass

    combos = len(ATR_PERIODS) * len(MULTIPLIERS)
    print(f"SuperTrend Optimizer (Python) — {today.isoformat()}")
    print(f"Grid: ATR={ATR_PERIODS} × Mult={MULTIPLIERS} = {combos} combos/stock")
    print(f"Metric: Sharpe (fallback total_return if <2 trades)\n")

    stocks_out: dict = {}
    errors:     list = []

    # cap workers at 3 — I/O bound (yfinance), matches Python hardware guideline
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(_optimize_symbol, s): s for s in PORTFOLIO}
        for fut in as_completed(futures):
            symbol, result = fut.result()
            if result is not None:
                stocks_out[symbol] = result
            else:
                errors.append(symbol)

    output = {
        "last_optimized":     today.isoformat(),
        "next_optimization":  next_opt.isoformat(),
        "optimization_count": opt_count + 1,
        "stocks":             stocks_out,
    }
    OUTPUT_PATH.write_text(json.dumps(output, indent=2))

    print(f"\n✅ Wrote {len(stocks_out)}/{len(PORTFOLIO)} stocks → {OUTPUT_PATH}")
    if errors:
        print(f"⚠  Failed symbols: {errors}")
    print(f"   Next optimization scheduled: {next_opt.isoformat()}")

    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
