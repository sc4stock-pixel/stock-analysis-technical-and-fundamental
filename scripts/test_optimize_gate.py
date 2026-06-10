"""Unit tests for the A1 walk-forward gate in optimize_supertrend.py."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))
import optimize_supertrend as opt


GRID_WINNER = {"atr_period": 12, "multiplier": 2.5,
               "total_return": 83.87, "sharpe": 0.92, "num_trades": 6}

OOS_FAILED = {"wf_train_sharpe": 1.26, "wf_test_sharpe": -1.55,
              "wf_efficiency_ratio": 0.0, "wf_efficiency_quality": "FAILED OOS",
              "wf_passed": False, "wf_is_true_oos": True}

OOS_PASSED = dict(OOS_FAILED, wf_test_sharpe=1.1, wf_efficiency_ratio=0.87,
                  wf_efficiency_quality="GOOD", wf_passed=True)


def _rerun_ok(atr_p, mult):
    assert (atr_p, mult) == (opt.DEFAULT_ATR_PERIOD, opt.DEFAULT_MULTIPLIER)
    return {"total_return": 41.234, "sharpe": 0.789, "num_trades": 5}


def test_passed_keeps_grid_params():
    out = opt._apply_wf_gate(dict(GRID_WINNER), dict(OOS_PASSED), _rerun_ok)
    assert out["atr_period"] == 12 and out["multiplier"] == 2.5
    assert out["params_source"] == "optimized"
    assert "grid_atr_period" not in out
    assert out["wf_passed"] is True          # wf_* fields preserved


def test_failed_falls_back_to_defaults_with_recomputed_stats():
    out = opt._apply_wf_gate(dict(GRID_WINNER), dict(OOS_FAILED), _rerun_ok)
    assert out["atr_period"] == opt.DEFAULT_ATR_PERIOD
    assert out["multiplier"] == opt.DEFAULT_MULTIPLIER
    assert out["params_source"] == "default_fallback"
    # stats describe the params actually written, not the rejected winner
    assert out["total_return"] == 41.23 and out["sharpe"] == 0.79
    assert out["num_trades"] == 5
    # rejected grid winner kept for transparency
    assert out["grid_atr_period"] == 12 and out["grid_multiplier"] == 2.5
    assert out["grid_total_return"] == 83.87 and out["grid_sharpe"] == 0.92
    assert out["wf_passed"] is False


def test_empty_oos_keeps_legacy_behavior():
    out = opt._apply_wf_gate(dict(GRID_WINNER), {}, _rerun_ok)
    assert out["atr_period"] == 12
    assert out["params_source"] == "optimized"


def test_rerun_failure_fails_open_to_grid_winner():
    def _boom(a, m):
        raise RuntimeError("backtest exploded")
    out = opt._apply_wf_gate(dict(GRID_WINNER), dict(OOS_FAILED), _boom)
    assert out["atr_period"] == 12 and out["params_source"] == "optimized"
