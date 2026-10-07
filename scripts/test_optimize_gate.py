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


def test_rerun_failure_prints_warning(capsys):
    def _boom(a, m):
        raise RuntimeError("backtest exploded")
    opt._apply_wf_gate(dict(GRID_WINNER), dict(OOS_FAILED), _boom, symbol="TEST")
    captured = capsys.readouterr()
    assert "TEST" in captured.out and "fallback rerun failed" in captured.out


# ── AUDIT FIX C3 (2026-10-07): the publication rule ───────────────────────────
# The 2026-10-07 red-team audit cited wf_test_sharpe = +1.89 (MSFT) and +1.85
# (TSM) as genuine out-of-sample evidence. Both were computed over ZERO test
# trades. The gate's verdict was right; what got published was not. These tests
# pin the rule: no OOS evidence -> publish null, and never move the gate.

def test_zero_test_trades_publishes_null_not_a_sharpe():
    out = opt._oos_verdict(14, 2.5, 0.71, 12.0, 4, 1.89, 0.0, 0)
    assert out["wf_test_sharpe"] is None
    assert out["wf_test_return"] is None
    assert out["wf_efficiency_ratio"] is None
    assert out["wf_efficiency_quality"] == "NO DATA"
    # The count that explains the nulls is always published.
    assert out["wf_test_trades"] == 0
    assert out["wf_is_true_oos"] is True


def test_one_test_trade_is_still_no_data():
    out = opt._oos_verdict(14, 2.5, 0.90, 20.0, 4, -0.02, -1.57, 1)
    assert out["wf_test_sharpe"] is None
    assert out["wf_test_return"] is None
    assert out["wf_efficiency_ratio"] is None
    assert out["wf_test_trades"] == 1


def test_at_threshold_the_numbers_are_real_evidence_and_published():
    """At/above MIN_OOS_TEST_TRADES the OOS numbers mean something — publish them."""
    out = opt._oos_verdict(10, 3.0, 0.93, 37.0, 3, -1.84, -20.32, 2)
    assert out["wf_test_sharpe"] == -1.84
    assert out["wf_test_return"] == -20.32
    assert out["wf_efficiency_ratio"] == 0.0
    assert out["wf_efficiency_quality"] == "FAILED OOS"


def test_publication_rule_does_not_move_the_gate():
    """C3 changes what is REPORTED, never what is PUBLISHED. A flattering raw
    Sharpe over no trades must still be rejected, and genuine evidence must
    still be promoted — exactly as before the fix."""
    nodata = opt._oos_verdict(14, 2.5, 0.71, 12.0, 4, 1.89, 0.0, 0)
    assert nodata["wf_passed"] is False
    out = opt._apply_wf_gate(dict(GRID_WINNER), nodata, _rerun_ok)
    assert out["params_source"] == "default_fallback"
    assert out["atr_period"] == opt.DEFAULT_ATR_PERIOD
    assert out["multiplier"] == opt.DEFAULT_MULTIPLIER

    good = opt._oos_verdict(14, 2.5, 1.26, 40.0, 6, 1.1, 22.0, 4)
    assert good["wf_passed"] is True
    out2 = opt._apply_wf_gate(dict(GRID_WINNER), good, _rerun_ok)
    assert out2["params_source"] == "optimized"
    assert out2["atr_period"] == 12 and out2["multiplier"] == 2.5
