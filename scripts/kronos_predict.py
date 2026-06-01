#!/usr/bin/env python3
"""Generate Kronos price forecasts (forward + historical track-record).
Runs on CPU, writes kronos_forecasts.json to the repo root.
Mirrors timesfm_predict.py structure. Requires numpy<2 + torch<=2.2.2.
"""
import json, sys
from datetime import datetime, timezone
from pathlib import Path
try:
    from zoneinfo import ZoneInfo
except ImportError:
    from backports.zoneinfo import ZoneInfo
import numpy as np
import pandas as pd
import yfinance as yf

# Kronos model package: cloned to ./Kronos by the workflow (or /tmp/Kronos locally)
_kronos_found = False
for cand in ("./Kronos", "/tmp/Kronos"):
    if Path(cand).exists():
        sys.path.append(cand)
        _kronos_found = True
        break
if not _kronos_found:
    print(json.dumps({"error": "Kronos repo not found at ./Kronos or /tmp/Kronos"}))
    sys.exit(1)
from model import Kronos, KronosTokenizer, KronosPredictor  # noqa: E402
from forecast_metrics import dir_hits, mae  # noqa: E402

PRED_LEN = 20
SAMPLE_COUNT = 5
LOOKBACK = 400  # context bars fed to the model (<= 512 cap)

_STOCKS_FALLBACK = [
    "9988.HK", "0700.HK", "1211.HK", "1810.HK", "0175.HK", "3033.HK",
    "SPY", "QQQ", "AAPL", "MSFT", "NVDA", "GOOGL", "META", "TSM", "AMD",
]

def _load_stocks():
    portfolio_path = Path(__file__).parent.parent / "portfolio.json"
    try:
        data = json.loads(portfolio_path.read_text())
        entries = data.get("portfolio", [])
        if entries:
            loaded = [e["symbol"] for e in entries]
            print(f"  Loaded {len(loaded)} stocks from portfolio.json")
            return loaded
    except Exception as e:
        print(f"  portfolio.json missing/invalid ({e}) - using fallback")
    return _STOCKS_FALLBACK

def _prep(df):
    """yfinance df -> lowercase OHLCV + tz-naive timestamp Series."""
    out = df.rename(columns={"Open": "open", "High": "high", "Low": "low",
                             "Close": "close", "Volume": "volume"}).copy()
    out = out[["open", "high", "low", "close", "volume"]]
    ts = pd.to_datetime(out.index).tz_localize(None)
    out = out.reset_index(drop=True)
    return out, pd.Series(ts)

def _future_timestamps(last_ts, n):
    """n future business-day timestamps after last_ts."""
    return pd.Series(pd.bdate_range(start=last_ts, periods=n + 1)[1:])

def _forecast(predictor, x_df, x_ts, y_ts):
    pred = predictor.predict(df=x_df[["open", "high", "low", "close", "volume"]],
                             x_timestamp=x_ts, y_timestamp=y_ts, pred_len=PRED_LEN,
                             T=1.0, top_p=0.9, sample_count=SAMPLE_COUNT, verbose=False)
    return [round(float(v), 2) for v in pred["close"].to_numpy()]

def main():
    print("Loading Kronos-small + tokenizer...", flush=True)
    tokenizer = KronosTokenizer.from_pretrained("NeoQuasar/Kronos-Tokenizer-base")
    model = Kronos.from_pretrained("NeoQuasar/Kronos-small")
    predictor = KronosPredictor(model, tokenizer, device="cpu", max_context=512)

    hk_now = datetime.now(ZoneInfo("Asia/Hong_Kong"))
    output = {"_metadata": {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "generated_at_hk": hk_now.strftime("%Y-%m-%d %H:%M:%S HKT"),
        "model": "Kronos-small", "data_source": "yfinance",
        "horizon_days": PRED_LEN, "sample_count": SAMPLE_COUNT, "stock_count": 0,
    }}
    processed = []

    for symbol in _load_stocks():
        print(f"Processing {symbol} ...", flush=True)
        try:
            raw = yf.Ticker(symbol).history(period="2y")
            if len(raw) < LOOKBACK + PRED_LEN + 5:
                print(f"  -> insufficient data ({len(raw)}), skipping")
                continue
            df, ts = _prep(raw)
            last_price = round(float(df["close"].iloc[-1]), 2)
            last_date = ts.iloc[-1].strftime("%Y-%m-%d")

            # FORWARD: context = last LOOKBACK bars up to today
            fx = df.iloc[-LOOKBACK:].reset_index(drop=True)
            fx_ts = ts.iloc[-LOOKBACK:].reset_index(drop=True)
            fy_ts = _future_timestamps(ts.iloc[-1], PRED_LEN)
            fwd = _forecast(predictor, fx, fx_ts, fy_ts)

            # HISTORICAL: context ends 20 bars ago; actuals are the last 20 closes
            hx = df.iloc[-(LOOKBACK + PRED_LEN):-PRED_LEN].reset_index(drop=True)
            hx_ts = ts.iloc[-(LOOKBACK + PRED_LEN):-PRED_LEN].reset_index(drop=True)
            hy_ts = ts.iloc[-PRED_LEN:].reset_index(drop=True)
            hist_pred = _forecast(predictor, hx, hx_ts, hy_ts)
            actual = [round(float(v), 2) for v in df["close"].iloc[-PRED_LEN:].to_numpy()]
            anchor = round(float(df["close"].iloc[-(PRED_LEN + 1)]), 2)

            output[symbol] = {
                "last_price": last_price, "last_date": last_date,
                "forward": {"p50": fwd},
                "historical": {
                    "anchor": anchor, "pred": hist_pred, "actual": actual,
                    "dir_hits": dir_hits(anchor, hist_pred, actual),
                    "mae": mae(hist_pred, actual),
                },
            }
            processed.append(symbol)
            h = output[symbol]["historical"]
            print(f"  -> fwd[-1]={fwd[-1]} hist dir={h['dir_hits']}/20 mae={h['mae']}")
        except Exception as e:
            print(f"  -> error: {e}")

    output["_metadata"]["stock_count"] = len(processed)
    with open("kronos_forecasts.json", "w") as f:
        json.dump(output, f, indent=2)
    print(f"\nkronos_forecasts.json written ({len(processed)} stocks)")

if __name__ == "__main__":
    main()
