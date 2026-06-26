"""Naive random-walk-with-drift baseline — the benchmark Kronos must beat.

drift      = mean daily log-return over the trailing DRIFT_WINDOW closes
naive 5d % = (exp(drift * 5) - 1) * 100   ;   naive dir = sign(drift)

Pure + dependency-light so the web TS helper (forecastBox.ts) mirrors it exactly.
Keep in lockstep with forecastBox.ts naiveRow() — PARITY.
"""
import math

DRIFT_WINDOW = 60   # trailing trading days
HORIZON = 5         # business days ahead


def _drift(closes):
    if closes is None or len(closes) < DRIFT_WINDOW + 1:
        return None
    window = closes[-(DRIFT_WINDOW + 1):]
    rets = [math.log(window[i] / window[i - 1])
            for i in range(1, len(window)) if window[i - 1] > 0 and window[i] > 0]
    if not rets:
        return None
    return sum(rets) / len(rets)


def naive_5d_pct(closes):
    d = _drift(closes)
    return None if d is None else (math.exp(d * HORIZON) - 1) * 100


def naive_dir(closes):
    d = _drift(closes)
    if d is None:
        return None
    return (d > 0) - (d < 0)
