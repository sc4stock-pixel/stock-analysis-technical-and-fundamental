#!/usr/bin/env python3
"""
Kronos config sweep — does OUR configuration cripple the model?

Two config choices were never validated for accuracy:
  * LOOKBACK=128. Chosen 2026-06-02 because at 400 a trending stock's forecast
    "teleported" toward the stale context mean on bar 1 (AMD 510 -> 243) and the
    chart looked wrong. We optimized for a CONTINUOUS-LOOKING CHART, never for
    directional accuracy. Official example uses 400; model context is 512.
  * Kronos-small (24.7M). Kronos-base (102.3M) is a drop-in swap (same tokenizer,
    same 512 context).

This scores each config on identical (ticker, date) pairs so the comparison is
paired. It reports BOTH accuracy and the teleport magnitude, so the trade-off we
implicitly made is visible: if 400 forecasts direction better while looking uglier
on bar 1, we optimized the wrong objective.

Every config is benchmarked against FADE-DRIFT (inverse of the 60d drift rule),
which is the correct control for a structurally mean-reverting model — see
scripts/forecast_probation_audit.py.

CONTAMINATION NOTE: Kronos was pretrained on market K-lines through an unknown
cutoff, so absolute hit rates here may be optimistic. The sweep is a RELATIVE test
(config A vs config B on the same dates), where that bias is largely shared. Results
are reported split by period so any drift in that bias is at least visible.

Usage:
  python3 scripts/kronos_config_sweep.py --lookback 128 --model NeoQuasar/Kronos-small \
      --stride 10 --months 12 --sample-count 5 --out sweep_128_small.json
"""
import argparse, json, math, sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf

for cand in ("./Kronos", "/tmp/Kronos"):
    if Path(cand).exists():
        sys.path.append(cand)
        break
from model import Kronos, KronosTokenizer, KronosPredictor  # noqa: E402

PRED_LEN = 20
HORIZONS = (5, 10, 20)
DRIFT_WINDOW = 60          # parity with scripts/naive_baseline.py
TICKERS = ["9988.HK", "0700.HK", "1211.HK", "1810.HK", "0175.HK", "3033.HK", "0939.HK",
           "SPY", "QQQ", "AAPL", "MSFT", "NVDA", "GOOGL", "META", "TSM", "AMD"]


def sign(x):
    return (x > 0) - (x < 0)


def drift_dir(closes):
    """Sign of mean daily log-return over the trailing DRIFT_WINDOW. None if short."""
    if len(closes) < DRIFT_WINDOW + 1:
        return None
    w = closes[-(DRIFT_WINDOW + 1):]
    r = [math.log(w[i] / w[i - 1]) for i in range(1, len(w)) if w[i - 1] > 0 and w[i] > 0]
    if not r:
        return None
    return sign(sum(r) / len(r))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lookback", type=int, required=True)
    ap.add_argument("--model", default="NeoQuasar/Kronos-small")
    ap.add_argument("--tokenizer", default="NeoQuasar/Kronos-Tokenizer-base")
    ap.add_argument("--sample-count", type=int, default=5)
    ap.add_argument("--stride", type=int, default=10, help="trading days between forecast dates")
    ap.add_argument("--months", type=int, default=12, help="how far back to sample")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    print(f"loading {a.model} (lookback={a.lookback}, samples={a.sample_count})", flush=True)
    tok = KronosTokenizer.from_pretrained(a.tokenizer)
    mdl = Kronos.from_pretrained(a.model)
    predictor = KronosPredictor(mdl, tok, device="cpu", max_context=512)

    # hits[h] = [kronos_hits, n, fade_hits]; teleport = |bar1 gap| %, rel MAE at 20d
    hits = {h: [0, 0, 0] for h in HORIZONS}
    by_period = {}          # 'YYYY-Q' -> [k_hits, n]
    teleports, maes, skipped = [], [], 0

    for tkr in TICKERS:
        try:
            raw = yf.Ticker(tkr).history(period="2y")
        except Exception as e:
            print(f"  {tkr}: fetch failed ({e})"); continue
        if len(raw) < a.lookback + PRED_LEN + 30:
            print(f"  {tkr}: insufficient data ({len(raw)})"); continue

        df = raw.rename(columns={"Open": "open", "High": "high", "Low": "low",
                                 "Close": "close", "Volume": "volume"})[
            ["open", "high", "low", "close", "volume"]].copy()
        ts = pd.Series(pd.to_datetime(df.index).tz_localize(None))
        df = df.reset_index(drop=True)
        closes = df["close"].tolist()

        # forecast indices: need `lookback` bars before and PRED_LEN after
        window_start = max(a.lookback, len(df) - PRED_LEN - int(a.months * 21))
        idxs = list(range(window_start, len(df) - PRED_LEN, a.stride))
        print(f"  {tkr}: {len(idxs)} forecast dates", flush=True)

        for i in idxs:
            x_df = df.iloc[i - a.lookback:i].reset_index(drop=True)
            x_ts = ts.iloc[i - a.lookback:i].reset_index(drop=True)
            y_ts = ts.iloc[i:i + PRED_LEN].reset_index(drop=True)
            base = closes[i - 1]
            try:
                pred = predictor.predict(df=x_df, x_timestamp=x_ts, y_timestamp=y_ts,
                                         pred_len=PRED_LEN, T=1.0, top_p=0.9,
                                         sample_count=a.sample_count, verbose=False)
            except Exception as e:
                skipped += 1
                print(f"    {tkr} @{i}: predict failed ({e})")
                continue
            p50 = pred["close"].to_numpy()

            # teleport = bar-1 discontinuity vs last actual close
            teleports.append(abs(float(p50[0]) - base) / base * 100)
            maes.append(abs(float(p50[PRED_LEN - 1]) - closes[i + PRED_LEN - 1]) / base * 100)

            fd = drift_dir(closes[:i])          # only data strictly before the date
            q = f"{ts.iloc[i].year}-Q{(ts.iloc[i].month - 1) // 3 + 1}"

            for h in HORIZONS:
                realized = closes[i + h - 1]
                act = sign(realized - base)
                if act == 0:
                    continue
                k_hit = sign(float(p50[h - 1]) - base) == act
                hits[h][0] += k_hit
                hits[h][1] += 1
                if fd is not None:
                    hits[h][2] += (-fd) == act   # fade-drift = inverse of drift
                if h == 20:
                    p = by_period.setdefault(q, [0, 0])
                    p[0] += k_hit; p[1] += 1

    out = {
        "config": {"lookback": a.lookback, "model": a.model,
                   "sample_count": a.sample_count, "stride": a.stride, "months": a.months},
        "horizons": {f"{h}d": {"kronos_hits": hits[h][0], "n": hits[h][1],
                               "kronos_rate": (hits[h][0] / hits[h][1]) if hits[h][1] else None,
                               "fade_drift_hits": hits[h][2],
                               "fade_drift_rate": (hits[h][2] / hits[h][1]) if hits[h][1] else None}
                     for h in HORIZONS},
        "teleport_bar1_pct_mean": (sum(teleports) / len(teleports)) if teleports else None,
        "teleport_bar1_pct_p90": float(np.percentile(teleports, 90)) if teleports else None,
        "rel_mae_20d_pct_mean": (sum(maes) / len(maes)) if maes else None,
        "by_period_20d": {k: {"hits": v[0], "n": v[1], "rate": v[0] / v[1]}
                          for k, v in sorted(by_period.items()) if v[1]},
        "skipped": skipped,
        "generated_utc": datetime.utcnow().isoformat(),
    }
    with open(a.out, "w") as f:
        json.dump(out, f, indent=2, allow_nan=False)
    print(f"\nwrote {a.out}")
    for h in HORIZONS:
        d = out["horizons"][f"{h}d"]
        if d["n"]:
            print(f"  {h}d: kronos {d['kronos_rate']*100:.1f}%  "
                  f"fade-drift {d['fade_drift_rate']*100:.1f}%  n={d['n']}")
    print(f"  teleport bar1: mean {out['teleport_bar1_pct_mean']:.1f}% "
          f"p90 {out['teleport_bar1_pct_p90']:.1f}%")


if __name__ == "__main__":
    main()
