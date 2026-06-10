"""Unit tests for the HK EPS cache-builder conversion logic
(fetch_av_earnings.py pure helpers)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from fetch_av_earnings import (
    build_hk_quarterly,
    build_hk_semiannual,
    convert_cumulative_quarters,
    detect_cumulative,
    split_fiscal_years,
)


def _eps(quarters, date):
    return float(next(q["reportedEPS"] for q in quarters if q["fiscalDateEnding"] == date))


# ── Quarterly cumulative (BYD-style, Dec FY) ───────────────────────

BYD_STYLE = [  # ascending (date, YTD value)
    ("2024-03-31", 1.0), ("2024-06-30", 2.2), ("2024-09-30", 3.5), ("2024-12-31", 5.0),
    ("2025-03-31", 1.2), ("2025-06-30", 2.6), ("2025-09-30", 4.1), ("2025-12-31", 5.8),
]


def test_profitable_dec_fy_splits_and_converts():
    groups = split_fiscal_years(BYD_STYLE)
    assert [len(g) for g in groups] == [4, 4]
    assert detect_cumulative(groups) is True

    quarters, tag = build_hk_quarterly(BYD_STYLE)
    assert tag == " (YTD→individual converted)"
    assert _eps(quarters, "2024-03-31") == 1.0           # Q1 = Q1 YTD
    assert round(_eps(quarters, "2024-12-31"), 4) == 1.5  # Q4 = 5.0 - 3.5
    assert round(_eps(quarters, "2025-03-31"), 4) == 1.2  # reset at FY boundary


# ── Alibaba-style Mar FY (fiscal year Apr–Mar) ─────────────────────

ALIBABA_STYLE = [
    ("2024-06-30", 1.5), ("2024-09-30", 3.0), ("2024-12-31", 5.0), ("2025-03-31", 6.0),
    ("2025-06-30", 1.8), ("2025-09-30", 3.6), ("2025-12-31", 5.9),
]


def test_mar_fy_boundary_detected_at_jun():
    groups = split_fiscal_years(ALIBABA_STYLE)
    assert [len(g) for g in groups] == [4, 3]
    quarters, tag = build_hk_quarterly(ALIBABA_STYLE)
    assert tag != ""
    assert round(_eps(quarters, "2025-06-30"), 4) == 1.8  # new FY Q1, NOT 1.8-6.0
    assert round(_eps(quarters, "2025-03-31"), 4) == 1.0  # FY Q4 = 6.0 - 5.0


# ── Loss-maker reset (old `prev_val > 0` guard merged these FYs) ───

LOSS_MAKER = [
    ("2024-03-31", -0.5), ("2024-06-30", -1.2), ("2024-09-30", -1.8), ("2024-12-31", -2.4),
    ("2025-03-31", -0.3), ("2025-06-30", -0.7), ("2025-09-30", -1.0), ("2025-12-31", -1.2),
]


def test_negative_ytd_reset_detected():
    groups = split_fiscal_years(LOSS_MAKER)
    assert [len(g) for g in groups] == [4, 4]
    quarters, _ = build_hk_quarterly(LOSS_MAKER)
    # Q1 of new FY is its own YTD value, not a subtraction across the boundary
    assert round(_eps(quarters, "2025-03-31"), 4) == -0.3
    # Q2 = -0.7 - (-0.3) = -0.4
    assert round(_eps(quarters, "2025-06-30"), 4) == -0.4


# ── Loss quarter inside a profitable FY survives as negative ──────

def test_loss_quarter_not_clamped_to_zero():
    fy = [[("2025-03-31", 1.0), ("2025-06-30", 0.8), ("2025-09-30", 1.5)]]
    quarters = convert_cumulative_quarters(fy)
    assert round(_eps(quarters, "2025-06-30"), 4) == -0.2  # real loss, not 0.0


# ── Missing quarter: gap creates a boundary, no cross-gap subtraction ──

def test_period_gap_splits_group():
    gapped = [
        ("2024-03-31", 1.0), ("2024-06-30", 2.2),
        # 2024-09-30 missing (>140d gap to Dec)
        ("2024-12-31", 5.0),
        ("2025-03-31", 1.2),
    ]
    groups = split_fiscal_years(gapped)
    assert [len(g) for g in groups] == [2, 1, 1]
    quarters = convert_cumulative_quarters(groups)
    # Dec is alone in its group: prev resets to 0 — emitted as YTD, which the
    # date-aware consumer will treat as an isolated period (no wrong subtraction
    # of Jun YTD from Dec YTD lumping two quarters)
    assert _eps(quarters, "2024-12-31") == 5.0


# ── Non-cumulative (already individual) passes through unchanged ───

def test_individual_values_not_converted():
    individual = [
        ("2024-03-31", 1.0), ("2024-06-30", 0.9), ("2024-09-30", 1.1), ("2024-12-31", 0.8),
        ("2025-03-31", 1.2), ("2025-06-30", 1.0), ("2025-09-30", 1.3), ("2025-12-31", 0.9),
    ]
    quarters, tag = build_hk_quarterly(individual)
    assert tag == ""
    assert _eps(quarters, "2025-12-31") == 0.9


# ── Semi-annual (Geely-style): H2 = FY − H1, FY-only years skipped ──

def test_semiannual_h2_derivation_and_fy_only_skip():
    rows = [
        ("2024-06-30", 0.6), ("2024-12-31", 1.4),   # H1 + FY → H2 = 0.8
        ("2025-12-31", 1.6),                          # FY only (H1 missing) → skipped
    ]
    periods = build_hk_semiannual(rows)
    dates = [p["fiscalDateEnding"] for p in periods]
    assert dates == ["2024-12-31", "2024-06-30"]
    assert _eps(periods, "2024-12-31") == 0.8
    assert "2025-12-31" not in dates


def test_semiannual_negative_h2_preserved():
    rows = [("2024-06-30", 1.0), ("2024-12-31", 0.7)]  # H2 = -0.3 (loss half)
    periods = build_hk_semiannual(rows)
    assert _eps(periods, "2024-12-31") == -0.3
