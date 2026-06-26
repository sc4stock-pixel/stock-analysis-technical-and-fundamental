# Forecast Display Redesign — 5d-centric, conviction-gated, honest skill

**Date:** 2026-06-26
**Status:** Design approved (brainstorming) — pending visual prototype + implementation plan
**Author:** Steven + Claude

---

## 1. Problem

The Kronos/TimesFM forecast accuracy shown across all surfaces is wrong and misleading:

- **The `dir_hits/20` column is statistically hollow.** It counts bars where the model's
  *cumulative* move-vs-the-t-20-anchor matched actual — not 20 independent calls. Verified by
  recompute (cumulative-vs-anchor reproduces stored `dir_hits`; daily-step does not). So `16/20`
  is ≈ **one** net-direction bet inflated ~20×. It is also an *in-sample* backcast regenerated
  each run, not a real track record.
- **20-day single-name direction is coin-flip.** True out-of-sample audit (walking git history
  of the forecast JSONs via `scripts/forecast_probation_audit.py`): TimesFM is coin-flip at
  5/10d and *significantly worse than random* at 20d (p=0.01); Kronos shows no significant edge
  at 20d.
- **The real signal is conviction-driven, not horizon-driven.** Kronos at 5d, conditioned on the
  *size* of the predicted move: `<2%` = 44% (noise), `2–5%` = 58%, **`>5%` = 47/58 (81%, p<0.01)**,
  spread across 10 tickers and both directions. Forecast magnitude is itself a confidence meter.
- **TimesFM is dead**, confirmed independently: 2026 literature reports general-purpose TSFMs post
  *negative* financial R² (TimesFM ≈ −2.8%, Chronos ≈ −1.4%); in our OOS data it never predicts a
  >5% move (conviction bucket n=4) so it has no exploitable signal.

## 2. Goals

1. Flip every surface from 20d-centric to **5d-primary** (10d/20d kept secondary, greyed).
2. Delete the misleading `dir_hits/20` per-stock pseudo-accuracy everywhere.
3. Replace it with: (a) a per-stock **conviction flag**, and (b) one honest **model-level
   true-OOS skill badge** sourced from a single new data file.
4. Add a **naive drift baseline** as the benchmark so "does Kronos beat free momentum?" is
   answerable on every surface and in the probation verdict.
5. **Drop TimesFM from display**; repoint any routine that used TimesFM as its primary forecast
   to **Kronos**.
6. Keep all six surfaces **cross-surface consistent** (parity rule).

## 3. Non-goals / YAGNI

- Not reworking how Kronos feeds risk/Monte-Carlo/position-sizing (the "B3 volatility reframe" —
  separate future project).
- Not fine-tuning Kronos or swapping in another foundation model (Chronos/Moirai confirmed weak).
- Not precomputing display strings into the data layer (couples data to presentation — rejected
  Approach C).

## 4. Hard constraints

- **Probation data is untouched.** The 2026-07-22 review walks the git history of
  `kronos_forecasts.json` / `timesfm_forecasts.json` (`forward.p50` / `price_targets.p50`,
  `last_price`, `last_date`). This redesign must not change those fields or the daily-commit
  cadence.
- **"5d everywhere" is display-only.** Generators keep emitting the **full 20-point forward path**;
  surfaces merely render the 5d point. Truncating the stored path would blind the harness to the
  10/15/20d horizons and the maturing 20d data. (Explicit guardrail.)
- **TimesFM generator (`timesfm.yml`) keeps running through 2026-07-22** for formal probation
  closeout, then retire. Do not declare the infra dead by assertion before then (verified-state
  discipline).

## 5. Architecture — Approach B (centralized logic, one new data file)

Centralize the *logic* (which drifts) without coupling *presentation* (which legitimately differs
per surface).

- **One new artifact:** `forecast_skill.json` (repo root), emitted by
  `forecast_probation_audit.py`, committed daily by a GHA step. Same raw-GitHub 6h-TTL read
  pattern as `timesfm_forecasts.json`. **Data only — no display strings.**
- **Web:** `src/lib/forecastBox.ts` becomes the single source of forecast-display truth —
  add `naiveRow()`, `convictionFlag()`, `skillBadge()`, `agreement(kronos, naive)`. All web
  surfaces consume it.
- **Python:** new `report/forecast_display.py` mirrors the same rules (TS↔Py parity comment at
  both sites).
- **Telegram:** reads `forecast_skill.json` and reuses the shared display logic path.

### 5.1 `forecast_skill.json` schema (data only)

```jsonc
{
  "_metadata": {
    "generated_at_utc": "...", "generated_at_hk": "...",
    "history_days": 26, "match_tol_days": 4,
    "conviction_pct": 5.0,      // single source of the hi-conviction threshold
    "drift_window": 60          // naive baseline trailing trading days
  },
  "KRONOS": {
    "horizons": {               // true-OOS, all calls, per horizon
      "2d":  { "hits": 214, "n": 380, "rate": 0.56, "ci_lo": 0.51, "ci_hi": 0.61, "p": 0.01 },
      "5d":  { "hits": 195, "n": 354, "rate": 0.55, "ci_lo": 0.50, "ci_hi": 0.60, "p": 0.06 },
      "10d": { ... }, "15d": { ... }, "20d": null    // null = not matured
    },
    "conviction_5d": {
      "lt2":  { "hits": 75, "n": 170, "rate": 0.44, ... },
      "2to5": { "hits": 73, "n": 126, "rate": 0.58, ... },
      "gt5":  { "hits": 47, "n": 58,  "rate": 0.81, "ci_lo": 0.69, "ci_hi": 0.89, "p": 0.001, "edge": true }
    },
    "verdict": "EDGE_HIGH_CONVICTION"
  },
  "NAIVE":   { "horizons": {...}, "conviction_5d": {...}, "verdict": "BASELINE" },
  "TIMESFM": { "horizons": {...}, "conviction_5d": {...}, "verdict": "NO_EDGE" }   // generated, not displayed
}
```

### 5.2 Conviction rule (per stock) — one definition per language

```
HIGH conviction  ⇔  |5d forecast %| > conviction_pct (5.0)
```
- Cell renders `✦` + full color when HIGH; greyed/muted when LOW.
- Also a low-reliability `⚠` flag when the model's recent relative MAE is large (teleport guard,
  e.g. AMD) — threshold reused from the harness MAE.
- **The two flags are independent and shown together** when both apply (e.g. AMD `−8.1% ✦ ⚠`):
  reliability does NOT override conviction. `✦` = "model is confident", `⚠` = "model has been
  imprecise lately" — the reader sees both signals.
- TS constant in `forecastBox.ts`; Python mirror in `forecast_display.py`; both carry the parity
  comment. Threshold also rides in `forecast_skill.json._metadata.conviction_pct` so display and
  scoring cannot diverge.

### 5.3 Verdict enum (per model) — drives the skill badge

| Verdict | Condition |
|---|---|
| `EDGE_HIGH_CONVICTION` | `gt5` bucket: rate>50% AND p<0.05 AND ci_lo>50% AND n≥20 AND **rate > NAIVE rate** |
| `EDGE_BROAD` | some horizon clears: rate>50% AND p<0.05 AND ci_lo>50% AND n≥30 AND **rate > NAIVE rate** |
| `NO_EDGE` | matured data exists but nothing clears the bar |
| `INSUFFICIENT` | n below the minimums (early in probation) |
| `BASELINE` | the naive model itself (yardstick, never "edge") |

- **Beat-naive gate:** `EDGE_*` requires Kronos to beat the naive baseline's rate on the same
  calls, not merely clear 50%.
- While probation is open, the badge renders `EDGE_HIGH_CONVICTION` as
  **"⚡ edge on high-conviction calls (provisional)"** — "provisional" until 2026-07-22 confirms it
  on independent samples (overlapping daily forecasts inflate n).

## 6. Naive baseline (Section 2)

Needs only OHLCV history, so the harness **backfills it over the entire history immediately** and
scores it on the exact same dates/tickers as Kronos.

```
drift       = mean daily log-return over trailing 60 trading days
naive 5d %  = (exp(drift × 5) − 1) × 100
naive dir   = sign(drift)
```
- Identical formula in TS (`forecastBox.ts`) and Python (`forecast_display.py`); one parity comment.
- Live surfaces compute it from the OHLCV they already have.
- **Harness:** fetches a 2y daily series per ticker (one yfinance call each, like the generators)
  to look 60 days *before* each past forecast date — also makes realized-price matching more
  accurate than the current snapshot reconstruction. (Adds a network dependency to the harness;
  acceptable — it already runs in GHA where the generators fetch.)

## 7. TimesFM → Kronos source redirection (Section 2b)

When TimesFM leaves the display, every routine that used it as the **primary** forecast must be
repointed to Kronos so nothing goes blank. During planning, grep all `timesfm` / `p50` / `t1` /
`price_targets` readers and classify each as *display-removed*, *repointed-to-Kronos*, or
*kept-for-probation*. Known sites:

- `src/components/tabs/ChartTab.tsx` — forward overlay draws TimesFM `p50` as the primary line →
  switch primary to Kronos `forward.p50`; naive drift as thin dashed reference.
- `report/cards.py:~731` — "🔮 TimesFM AI Targets (5d/10d/20d)" panel → Kronos targets panel.
- Morning Digest / any Telegram routine reading TimesFM as the headline forecast → Kronos.
- `telegram-report.ts` `buildForecastSection` — becomes Kronos + naive.

## 8. Surface layouts (Section 3) — Kronos primary · Naive benchmark · TimesFM gone

**1. Telegram EOD report**
```
📊 FORECASTS 5d  ·  K=Kronos vs naive drift
SPY    K −4.6%      naive +0.3%
NVDA   K +6.3% ✦    naive +1.8%        ✦=hi-conviction (>5%)
AMD    K −8.1% ⚠    naive −0.4%        ⚠=low-reliability
─ Kronos 5d skill (OOS, provisional): hi-conv 81% vs naive 52% ⚡edge
```

**2. Portfolio summary bar:** columns `K 5d` (primary, ✦ when hi-conv) · `naive 5d` (greyed
yardstick). Drop `TFM 20d` and `acc N/20`. Default sort = Kronos 5d.

**3. Stock card panel** (renamed "Kronos Prediction"): big **5d** Kronos cell + ✦/⚠ flag;
`naive 5d` beneath as benchmark; `10d 20d` small & greyed; model-level skill badge at bottom.
No `/20`.

**4. Chart:** forward mode draws **Kronos** `forward.p50` as the primary line (was TimesFM);
naive drift as a thin dashed reference; track-record mode → rolling true-OOS 5d hits from the
harness.

**5. Python HTML report:** caption → `Kronos 5d hi-conv X% OOS · naive Y% · ⚡edge/—`; TimesFM
targets panel becomes the Kronos targets panel.

**6. Shared helpers** `forecastBox.ts` + `forecast_display.py`: add `naiveRow()`,
`convictionFlag()`, `skillBadge()`, `agreement(kronos, naive)`; surfaces read `cells[0]` = 5d
primary.

## 9. Plumbing / GHA

- New step in the forecast GHA (after `*_forecasts.json` commit): run the harness with a
  `--emit-skill-json` flag → write + commit `forecast_skill.json`.
- Surfaces read `forecast_skill.json` via raw-GitHub 6h-TTL, same as `timesfm_forecasts.json`.
- **JS-parity guard:** writer rejects/sanitizes non-finite floats; readers strip `NaN`→`null`.

## 10. Verification

- Harness unit-checks: conviction bucketing, beat-naive gate, verdict enum thresholds.
- `forecastBox.test.ts`: naive formula, conviction flag, skill-badge mapping, 5d-primary cells.
- Python parity test for `forecast_display.py` mirrors `forecastBox.test.ts` cases.
- Cross-surface manual check: same stock shows identical 5d %, flag, and badge on web card,
  portfolio bar, Telegram report, Python report.
- Web visual pass on a signed-in Vercel Preview (Clerk-gated — cannot verify locally).

## 11. Risks

- **Conviction edge may be a small-sample / overlap artifact.** Mitigated by the "provisional"
  hedge + the 2026-07-22 probation gate + the beat-naive bar.
- **Repointing misses a TimesFM reader** → a surface goes blank. Mitigated by the exhaustive grep
  classification in §7.
- **Harness network fetch flakiness** (yfinance). Mitigated by caching the 2y pull and failing
  loud, not silently.

## 12. Rollout order (for the implementation plan)

1. Harness: naive baseline + `forecast_skill.json` emit + GHA step.
2. Shared helpers (`forecastBox.ts`, `forecast_display.py`) + tests.
3. Web surfaces (card, portfolio bar, chart) — frontend-design prototype first.
4. Telegram report + Python report.
5. TimesFM display removal + Kronos redirection sweep.
6. Cleanup: deprecate `dir_hits` readers, update types/tests/CHANGELOG, parity comments.
