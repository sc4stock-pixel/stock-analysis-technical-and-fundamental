#!/usr/bin/env python3
"""Generate price-target forecasts using TimesFM (fine‑tuned on financial data).
   Runs on CPU, writes timesfm_forecasts.json to the current directory.
"""
import json, sys, os
import numpy as np
import yfinance as yf

# ── Load model ──────────────────────────────────────────────────
try:
    import timesfm
    from timesfm import ForecastConfig
except ImportError:
    print(json.dumps({"error": "timesfm not installed"}))
    sys.exit(1)

print("Loading TimesFM model (v2.5, 200M, torch)…", flush=True)
model = timesfm.TimesFM_2p5_200M_torch.from_pretrained(
    "google/timesfm-2.5-200m-pytorch"       # ← official v2.5 weights
)
model.compile(ForecastConfig(
    max_context=1024,
    max_horizon=256,
    normalize_inputs=True,
    use_continuous_quantile_head=True,
    force_flip_invariance=True,
    infer_is_positive=True,
    fix_quantile_crossing=True,
))
print("Model ready.")

# ── Stock universe ──────────────────────────────────────────────
stocks = [
    "9988.HK", "0700.HK", "1211.HK", "1810.HK", "0175.HK", "3033.HK",
    "SPY", "QQQ", "AAPL", "MSFT", "NVDA", "GOOGL", "META", "TSM", "AMD",
]

forecasts = {}
for symbol in stocks:
    print(f"Processing {symbol} …", flush=True)
    try:
        df = yf.Ticker(symbol).history(period="2y")
        if len(df) < 200:
            print(f"  → insufficient data ({len(df)} bars), skipping")
            continue

        closes = df["Close"].tail(512).values.astype(np.float32)
        # Ensure no NaN
        if np.isnan(closes).any():
            raises = df["Close"].ffill().tail(512).values.astype(np.float32)
        else:
            raises = closes

        # Forecast 20 bars
        point, quantile = model.forecast(horizon=20, inputs=[raises])
        p10 = quantile[0, :, 1]
        p50 = quantile[0, :, 0]
        p90 = quantile[0, :, 9]   # quantile head returns mean + 9 deciles, index 9 = P90

        forecasts[symbol] = {
            "t1": round(float(p50[4]), 2),
            "t2": round(float(p50[9]), 2),
            "t3": round(float(p50[19]), 2),
            "p10": [round(float(v), 2) for v in p10],
            "p50": [round(float(v), 2) for v in p50],
            "p90": [round(float(v), 2) for v in p90],
        }
        print(f"  → T1={forecasts[symbol]['t1']} T2={forecasts[symbol]['t2']} T3={forecasts[symbol]['t3']}")
    except Exception as e:
        print(f"  → error: {e}")

with open("timesfm_forecasts.json", "w") as f:
    json.dump(forecasts, f, indent=2)

print("✅ timesfm_forecasts.json written")
