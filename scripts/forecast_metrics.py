"""Shared forecast-accuracy metrics for TimesFM + Kronos historical track records."""
from decimal import Decimal, ROUND_HALF_UP
from typing import Sequence


def dir_hits(anchor: float, pred: Sequence[float], actual: Sequence[float]) -> int:
    """Count bars where predicted direction (vs anchor) matches actual direction (vs anchor)."""
    hits = 0
    for p, a in zip(pred, actual):
        if (p > anchor) == (a > anchor):
            hits += 1
    return hits


def mae(pred: Sequence[float], actual: Sequence[float]) -> float:
    """Mean absolute error, rounded to 2 dp."""
    n = min(len(pred), len(actual))
    if n == 0:
        return 0.0
    # Convert to Decimal for precision before calculation
    total = sum(abs(Decimal(str(p)) - Decimal(str(a))) for p, a in zip(pred, actual))
    mae_val = total / n
    # Use Decimal for proper rounding (half-up) to 2 dp
    return float(mae_val.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))
