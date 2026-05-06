#!/usr/bin/env python3
"""Generate price-target and ST-persistence forecasts using TimesFM.
   Runs on CPU, writes timesfm_forecasts.json to the current directory.
   
   V16: Added _metadata section for tracking generation time.
"""
import json, sys, os
from datetime import datetime, timezone
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
    "google/timesfm-2.5-200m-pytorch"
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

# ── Initialize output with metadata at root level (backward compatible) ──
# Structure: { "_metadata": {...}, "9988.HK": {...}, "0700.HK": {...}, ... }
# This keeps stocks at root level (existing code works) and adds metadata
output = {
    "_metadata": {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generated_at_hk": datetime.now().strftime("%Y-%m-%d %H:%M:%S HKT"),
        "model": "TimesFM 2.5 200M PyTorch",
        "data_source": "yfinance",
        "horizon_days": 20,
        "stock_count": 0,
    }
}

stocks_processed = []

for symbol in stocks:
    print(f"Processing {symbol} …", flush=True)
    try:
        df = yf.Ticker(symbol).history(period="2y")
        if len(df) < 200:
            print(f"  → insufficient data ({len(df)} bars), skipping")
            continue

        closes = df["Close"].tail(512).values.astype(np.float32)
        highs  = df["High"].tail(512).values.astype(np.float32)
        lows   = df["Low"].tail(512).values.astype(np.float32)
        volumes = df["Volume"].tail(512).values.astype(np.float32)

        # Ensure no NaN
        if np.isnan(closes).any():
            closes = df["Close"].ffill().tail(512).values.astype(np.float32)

        # Get last price and date for metadata
        last_price = float(closes[-1])
        last_date = df.index[-1].strftime("%Y-%m-%d")

        # ── Application 1: Price Targets (existing) ─────────────
        point, quantile = model.forecast(horizon=20, inputs=[closes])
        p10 = quantile[0, :, 1]
        p50 = quantile[0, :, 0]
        p90 = quantile[0, :, 9]

        # V16: Add last_price/last_date alongside existing fields
        output[symbol] = {
            "last_price": round(last_price, 2),
            "last_date": last_date,
            "price_targets": {
                "t1": round(float(p50[4]), 2),
                "t2": round(float(p50[9]), 2),
                "t3": round(float(p50[19]), 2),
                "p10": [round(float(v), 2) for v in p10],
                "p50": [round(float(v), 2) for v in p50],
                "p90": [round(float(v), 2) for v in p90],
            }
        }

        # ── Application 2: SuperTrend Persistence ───────────────
        def compute_supertrend(highs, lows, closes, period=10, multiplier=3.0):
            n = len(closes)
            atr_arr = np.zeros(n)
            tr = np.zeros(n)
            for i in range(1, n):
                tr[i] = max(
                    highs[i] - lows[i],
                    abs(highs[i] - closes[i-1]),
                    abs(lows[i] - closes[i-1])
                )
            alpha = 1.0 / period
            atr_arr[period] = np.mean(tr[1:period+1])
            for i in range(period+1, n):
                atr_arr[i] = alpha * tr[i] + (1 - alpha) * atr_arr[i-1]

            st_line = np.full(n, np.nan)
            st_dir  = np.zeros(n)
            upper = np.full(n, np.nan)
            lower = np.full(n, np.nan)

            for i in range(n):
                if np.isnan(atr_arr[i]):
                    continue
                hl2 = (highs[i] + lows[i]) / 2
                upper[i] = hl2 + multiplier * atr_arr[i]
                lower[i] = hl2 - multiplier * atr_arr[i]

            first_valid = np.where(~np.isnan(atr_arr))[0][0]
            st_line[first_valid] = upper[first_valid]
            st_dir[first_valid] = 1 if closes[first_valid] > upper[first_valid] else -1

            for i in range(first_valid+1, n):
                if np.isnan(upper[i]) or np.isnan(lower[i]):
                    upper[i] = upper[i-1]
                    lower[i] = lower[i-1]
                    st_dir[i] = st_dir[i-1]
                    st_line[i] = st_line[i-1]
                    continue

                if closes[i-1] > st_line[i-1]:
                    lower[i] = max(lower[i], lower[i-1])
                else:
                    upper[i] = min(upper[i], upper[i-1])

                if closes[i] > upper[i-1]:
                    st_dir[i] = 1
                elif closes[i] < lower[i-1]:
                    st_dir[i] = -1
                else:
                    st_dir[i] = st_dir[i-1]

                st_line[i] = lower[i] if st_dir[i] == 1 else upper[i]

            for i in range(1, n):
                if np.isnan(st_line[i]) and not np.isnan(st_line[i-1]):
                    st_line[i] = st_line[i-1]
                if st_dir[i] == 0 and st_dir[i-1] != 0:
                    st_dir[i] = st_dir[i-1]

            return st_line, st_dir

        opt_atr_period = 10
        opt_multiplier = 3.0
        st_line, st_dir = compute_supertrend(highs, lows, closes, opt_atr_period, opt_multiplier)

        st_distance_pct = np.full(len(closes), np.nan)
        for i in range(len(closes)):
            if closes[i] > 0 and not np.isnan(st_line[i]) and st_line[i] > 0:
                st_distance_pct[i] = ((closes[i] - st_line[i]) / closes[i]) * 100

        valid_dists = st_distance_pct[~np.isnan(st_distance_pct)]
        if len(valid_dists) >= 100:
            input_dists = valid_dists[-512:].astype(np.float32)
            
            point2, quantile2 = model.forecast(horizon=10, inputs=[input_dists])
            p50_dist = quantile2[0, :, 0]

            current_dir = int(st_dir[-1])
            flip_sign = 1 if current_dir > 0 else -1
            distances_same_sign = sum(1 for v in p50_dist if v * flip_sign > 0)
            persistence_prob = (distances_same_sign / len(p50_dist)) * 100

            output[symbol]["st_persistence"] = {
                "current_dir": current_dir,
                "persistence_prob": round(float(persistence_prob), 1),
                "flip_risk": "low" if persistence_prob >= 70 else ("medium" if persistence_prob >= 40 else "high"),
                "p50_distances": [round(float(v), 2) for v in p50_dist],
            }
        else:
            output[symbol]["st_persistence"] = {
                "current_dir": int(st_dir[-1]),
                "persistence_prob": 50,
                "flip_risk": "unknown",
                "p50_distances": [],
            }

        stocks_processed.append(symbol)
        print(f"  → T1={output[symbol]['price_targets']['t1']} "
              f"ST persist={output[symbol]['st_persistence']['persistence_prob']:.0f}% "
              f"risk={output[symbol]['st_persistence']['flip_risk']}")

    except Exception as e:
        print(f"  → error: {e}")

# Update metadata
output["_metadata"]["stock_count"] = len(stocks_processed)

with open("timesfm_forecasts.json", "w") as f:
    json.dump(output, f, indent=2)

print(f"\n✅ timesfm_forecasts.json written")
print(f"   📅 Generated: {output['_metadata']['generated_at_hk']}")
print(f"   📊 Stocks: {len(stocks_processed)}")
