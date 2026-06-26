import math
from naive_baseline import naive_5d_pct, naive_dir, DRIFT_WINDOW

def test_drift_window_is_60():
    assert DRIFT_WINDOW == 60

def test_flat_series_gives_zero_drift():
    closes = [100.0] * 80
    assert abs(naive_5d_pct(closes)) < 1e-9
    assert naive_dir(closes) == 0

def test_uptrend_gives_positive_5d_and_up_dir():
    closes = [100.0 * (1.001 ** i) for i in range(80)]
    pct = naive_5d_pct(closes)
    assert pct > 0
    assert naive_dir(closes) == 1
    assert abs(pct - (math.exp(0.001 * 5) - 1) * 100) < 0.05

def test_too_short_series_returns_none():
    assert naive_5d_pct([100.0] * 10) is None
    assert naive_dir([100.0] * 10) is None
