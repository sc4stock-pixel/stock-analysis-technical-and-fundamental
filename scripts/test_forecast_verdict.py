"""Gate tests for the probation verdict — the badge that reaches Steven.

These are pure-function tests: no git walk, no network. They pin the two
corrections made 2026-08-18 (contrarian control + overlap haircut) against the
real forecast_skill.json numbers that tripped the bad gate.
"""
import os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from forecast_probation_audit import _stat, _verdict  # noqa: E402

CONV = 5  # conviction bucket horizon (business days)

# --- Real numbers from forecast_skill.json @ 61240fa (generated 2026-08-18) ---
K_GT5 = (122, 213)                      # 57.28% — flipped the badge on 2026-08-14
NAIVE_GT5_RATE = 0.5102
K_HORIZONS = {"2d": (588, 1233), "5d": (630, 1246), "10d": (591, 1130),
              "15d": (644, 1029), "20d": (568, 919)}
NAIVE_RATES = {"2d": 0.4793, "5d": 0.4872, "10d": 0.4584,
               "15d": 0.415, "20d": 0.4178}
H_DAYS = {"2d": 2, "5d": 5, "10d": 10, "15d": 15, "20d": 20}


def _live():
    gt5 = _stat(*K_GT5, overlap=CONV)
    hz = {h: _stat(*K_HORIZONS[h], overlap=H_DAYS[h]) for h in K_HORIZONS}
    return gt5, hz


def test_live_numbers_do_not_claim_high_conviction():
    """The 2026-08-14 flip was sample growth at a flat hit rate, not skill."""
    gt5, hz = _live()
    assert _verdict(gt5, hz, NAIVE_GT5_RATE, NAIVE_RATES) != "EDGE_HIGH_CONVICTION"


def test_live_numbers_land_on_edge_broad():
    """15d survives both corrections; nothing else does."""
    gt5, hz = _live()
    assert _verdict(gt5, hz, NAIVE_GT5_RATE, NAIVE_RATES) == "EDGE_BROAD"


def test_overlap_haircut_is_what_kills_the_gt5_claim():
    """Same hits/n, no overlap correction -> it WOULD clear. Proves the haircut bites."""
    naive_hz = {h: None for h in K_HORIZONS}
    indep = _stat(*K_GT5, overlap=1)
    assert _verdict(indep, {}, NAIVE_GT5_RATE, naive_hz) == "EDGE_HIGH_CONVICTION"
    overlapped = _stat(*K_GT5, overlap=CONV)
    assert _verdict(overlapped, {}, NAIVE_GT5_RATE, naive_hz) != "EDGE_HIGH_CONVICTION"


def test_contrarian_control_blocks_beating_an_anti_predictive_naive():
    """Naive 41% means the real bar is 59%, not 41%. 52% must not clear."""
    hz = {"15d": _stat(535, 1029, overlap=15)}   # 52.0%, beats naive 41.5%
    assert _verdict(None, hz, None, {"15d": 0.415}) == "NO_EDGE"


def test_genuine_edge_still_clears():
    """The gate must not be unfalsifiable — real skill still registers."""
    hz = {"15d": _stat(772, 1029, overlap=15)}   # 75%, well past inv-naive 58.5%
    assert _verdict(None, hz, None, {"15d": 0.415}) == "EDGE_BROAD"


def test_eff_fields_present_and_smaller_than_raw():
    s = _stat(*K_GT5, overlap=CONV)
    assert s["n_eff"] == round(213 / 5)
    assert s["n_eff"] < s["n"] and s["p_eff"] > s["p"]
    assert s["rate"] == 0.5728          # raw display fields untouched
    assert s["hits"] == 122 and s["n"] == 213
