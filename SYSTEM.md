# SYSTEM.md — End-to-end system reference

**Scope.** This file describes how the whole system fits together: what runs, where,
on what schedule, reading which data, writing which state, and which guard catches it
when something breaks.

**This file is descriptive, not normative.** Where it touches the ST strategy it
summarises [`STRATEGY.md`](STRATEGY.md), which is the single source of truth. If this
file and `STRATEGY.md` disagree, `STRATEGY.md` wins and this file is the bug.
`CLAUDE.md` remains the operational/build guide.

---

## 1. What the system is

A trend-following equity system over a fixed 16-name universe, split across two
markets. Three cooperating execution surfaces, no shared database:

| Surface | Runs on | Owns |
|---|---|---|
| **Web app** (this repo) | Vercel, Next.js 14 App Router | Analysis pipeline, dashboard, Telegram bot, EOD reports, all read APIs |
| **Autopilot worker** (`sc4stock-pixel/autopilot`, private) | Scheduled Python | Authoritative position state, execution alerts, trade log, research ideas |
| **GitHub Actions** (this repo) | GHA runners | Batch data production — forecasts, caches, parameter optimisation |

State lives in **Vercel KV** (worker-authored) and in **committed JSON artifacts**
(GHA-authored). There is no relational database anywhere in the system.

### The universe

16 names, fixed in `portfolio.json`:

- **HK (6):** 9988.HK Alibaba · 0700.HK Tencent · 1211.HK BYD · 1810.HK Xiaomi · 0175.HK Geely · 0939.HK CCB · *(3033.HK HSTech ETF)*
- **US (10):** AAPL · MSFT · GOOGL · META · AMD · NVDA · TSM · *(SPY, QQQ ETFs)*

ETFs (SPY, QQQ, 3033.HK) carry no fundamentals and always render `code_33 = null`.
Every stock's `exchange` field decides which macro overlay applies to it.

---

## 2. The signal path

Full definition in `STRATEGY.md`. In brief:

> Enter LONG when SuperTrend flips bullish **AND** Close > SMA50. Exit when SuperTrend
> flips bearish (ungated). Re-enter when price reclaims SMA50 while SuperTrend is still
> bullish.

Three layers that must never be conflated — indicator (raw SuperTrend), strategy
(indicator + SMA50 gate), telemetry (reporting layer-1 events with layer-2 context).

**The vocabulary contract is the load-bearing rule of this codebase.** "LONG", "entry"
and "entered" may only derive from `entryReady` / `entry_buy` / `entry_ready`. A raw
flip below SMA50 renders as "flipped up · awaiting SMA50" / `[WAIT]` / "NO ENTRY".
Every new stance-rendering surface must add a below-SMA50-flip-is-not-LONG test.

### Position sizing sits on top, and is a separate axis

Added 2026-08-27, 70% tier 2026-08-28. Target weight is **exposure, not entry state**:

| State | Weight |
|---|---|
| LONG or ENTRY-PENDING | 100% |
| OUT, Close > own SMA200 | 70% (trim) |
| OUT, Close ≤ own SMA200 | 40% (floor — never 0) |
| OUT, SMA200 unknown | 40% (a data gap must not report full size) |

A 100% weight reached via the SMA200 leg alone must never render as LONG. Surfaces
switch on `weightTone()` (`full`/`trim`/`floor`), never on the raw number.

Single derivations: web `src/lib/targetWeight.ts`, worker `signals.py compute_target_weight`.

---

## 3. Scoring, regime and signals (web pipeline)

`runPipeline()` in `src/lib/pipeline.ts` is the per-stock computation engine, called
from `/api/stocks`. It runs, in order:

1. **Indicators** (`indicators.ts`) — RSI, MACD, ADX, ATR, Bollinger, SuperTrend, SMAs
2. **Regime classification** (`regime.ts`) — per-bar and current-bar (TRENDING, RANGING, …)
3. **Multi-factor score 0–10** (`scoring.ts`) — `BASE_WEIGHTS` reweighted per regime via `REGIME_WEIGHTS`; plus RSI-divergence detection
4. **Signals** (`signals.ts`) — score → BUY/SELL/HOLD with confirmation logic
5. **SuperTrend optimisation** (`supertrend_optimizer.ts`) — grid search over ATR period × multiplier, selected by Sharpe
6. **Dual backtest** (`backtest.ts`) — score-based strategy *and* ST strategy, side by side
7. **Monte Carlo** (`montecarlo.ts`) — block bootstrap on the equity curve
8. **SEPA metadata** — a passive display overlay, computed last

**`sepa_metadata` must never influence `signal`, `score`, `backtest`, or any strategy
math.** It is display-only. `code_33` is patched in `route.ts` after the pipeline
returns, from the AV cache.

The **four-way sync rule**: a change to the strategy definition (gate, params, exits)
must land in `backtest.py`, `backtest.ts`, `pipeline.ts` and `supertrend_optimizer.ts`
in the same PR, plus the worker, plus `STRATEGY.md`.

---

## 4. Macro overlay

Two independent engines, applied as a **score adjustment after all stocks complete**,
selected per-stock by `exchange`:

| | `src/lib/macro.ts` (US) | `src/lib/macro-hk.ts` (HK) |
|---|---|---|
| Inputs | Fear & Greed (CNN), VIX structure, 10Y–2Y spread (US Treasury feed), index trends (SPY/QQQ/DIA), advance/decline, news sentiment, breadth (% of sector ETFs above own 20-day SMA) | HSI trend, CNH/USD, Southbound flow, HK VIX proxy |
| Endpoint | `/api/macro` | `/api/macro-hk` |

Both produce a Macro Breadth Score (MBS). Shared label/adjustment tiers live in
`macro-types.ts` so US and HK map scores to adjustments identically.

Note in `macro.ts`: FRED's `fredgraph.csv` is unreachable from Vercel egress (verified
TimeoutError at 12s) — the US Treasury daily par-yield feed replaced it (~55ms, no key).

---

## 5. Forecasts and the probation regime

This is the part of the system most likely to be misread, so it is spelled out.

**Kronos** forecasts are **not** computed at runtime. `.github/workflows/kronos.yml`
(cron `30 22` daily) runs `scripts/kronos_predict.py` and commits
`kronos_forecasts.json`; the app fetches that committed file.

**Forecasts are display-only. No forecast feeds the signal, the score, or position
sizing.** Nothing downstream of `forecastBox.ts` touches strategy math.

### Reading `forecast_skill.json`

`scripts/forecast_probation_audit.py` scores forecasts true-out-of-sample against a
same-horizon naive drift control and writes verdicts. Current state:

| Model | Verdict | What it means |
|---|---|---|
| NAIVE | `BASELINE` | The 60d-drift control the others must beat |
| KRONOS | `EDGE_BROAD` | Clears its own naive baseline at **longer** horizons (15d/20d) |
| TIMESFM | `EDGE_BROAD` | **Retired anyway** — see below |

**`EDGE_BROAD` is deliberately NOT surfaced as an edge.** `forecastBox.ts:92` maps it to
a muted *"No proven 5d edge · longer-horizon under study"*, because the display is
5d-primary and `EDGE_BROAD` lacks a same-horizon naive control. Only
`EDGE_HIGH_CONVICTION` — the 5d high-conviction bucket — earns an edge claim, and even
that renders as "provisional". So `KRONOS: EDGE_BROAD` in the JSON and "no proven edge"
in `CLAUDE.md` are consistent, not contradictory.

### TimesFM is retired

Scored true-OOS for ~11 weeks and dead at every horizon (5d 48%, 20d 47%). Removed from
every display surface in PR #50 (2026-08-10), runtime code deleted.
`scripts/timesfm_predict.py`, the frozen `timesfm_forecasts.json`, and the `TIMESFM` key
are kept **deliberately** so the probation audit can still reproduce the verdict.

**Never add a freshness check on `timesfm_forecasts.json`** — the file is frozen by
design and a check fires a false STALE DATA alert every trading day. `freshness.ts`
carries this as an explicit comment.

Parity constants (`CONVICTION_PCT = 5.0`, `DRIFT_WINDOW = 60`) must stay in lockstep
across `forecastBox.ts`, `scripts/naive_baseline.py` and `report/forecast_display.py`.

---

## 6. Rotation

`src/lib/rotation-ratio.ts` builds an HK-vs-US ratio series with a 50-period MA
(`RATIO_MA_PERIOD = 50`) and derives `currentLead()` → `"hk" | "us" | null`. Surfaced
by `/api/rotation` and the Rotation panel.

The longitudinal breadth-spread history behind that panel is accumulated by
`/api/cron/report`, which merges only its own region into **one shared KV key** per run
(a session's spread needs both halves). Best-effort — KV failures never block a report.

---

## 7. The daily timeline

Times UTC, with HKT in parentheses.

| Time | What | Trigger |
|---|---|---|
| 02:30, 04:30, 08:30 (10:00, 12:30, 16:30) | Southbound flow refresh → commits `southbound_data.json` | GHA `update-southbound.yml` |
| 04:00 (12:00), weekdays | Pipeline health probe → `/api/health`, Telegram on fail | GHA `health-probe.yml` |
| 08:55 / 16:30 HKT | **EOD breadth report** → `/api/cron/report` | **cron-job.org**, not GHA |
| 22:30 | Kronos forecasts → commits `kronos_forecasts.json` | GHA `kronos.yml` |
| Sun 02:00 | SuperTrend re-optimisation, gated in-job to the **first** Sunday of the month → commits `st_params.json` | GHA `optimize-supertrend.yml` |
| Sun 05:00 | AV earnings + fundamentals caches | GHA `update-av-earnings.yml` |
| Per worker schedule | Position state, execution alerts, trade log, research ideas | Autopilot worker |

### Why the EOD report is not on a GHA schedule

Removed 2026-06-04. GitHub delayed the EOD report by 2–4 hours — it landed ~16:55 HKT
instead of 16:30. It is now triggered **exclusively** by cron-job.org
(`POST /api/cron/report` with `x-cron-secret`). There is deliberately **no GHA
fallback**: if cron-job.org is down the report is skipped, which was judged better than
multi-hour-late noise. `workflow_dispatch` is retained for manual runs.

This is also why the freshness/staleness thresholds elsewhere are generous — scheduled
GHA runs drift by hours as a matter of course.

---

## 8. Data sources and artifacts

### External APIs

| API | Used for | Constraint |
|---|---|---|
| Yahoo Finance `/v8/finance/chart` | All OHLCV | `/v7/quote` and `/v11/quoteSummary` are **blocked from Vercel** |
| FMP `/stable/ratios-ttm`, `/stable/price-target-consensus` | Fundamentals, price targets | `/api/v3/` is legacy — 403 for accounts created after Aug 2025. Needs `FMP_KEY`; absent → dashes |
| Alpha Vantage `EARNINGS` | Quarterly EPS (US) | 25 req/day free tier. **Called only from GHA, never from an API route.** Budget: 9 calls |
| yfinance | US + HK fundamentals | No rate limit — this is why it replaced AV for fundamentals |
| Akshare (Eastmoney) | HK earnings + fundamentals fallback | HK GAAP field names differ from mainland GAAP |

### Committed artifacts

| File | Written by | Cadence |
|---|---|---|
| `kronos_forecasts.json` | `kronos.yml` | daily |
| `southbound_data.json` | `update-southbound.yml` | 3× daily |
| `av_earnings_cache.json`, `fundamentals_cache.json` | `update-av-earnings.yml` | weekly, Sundays |
| `st_params.json` | `optimize-supertrend.yml` | first Sunday monthly |
| `forecast_skill.json` | probation audit | daily |
| `timesfm_forecasts.json` | — | **frozen by design** |

All are read over `raw.githubusercontent.com` with a 6h TTL.

### HK data-quality traps

These have each caused a real production bug and are worth knowing before touching
HK data:

- **Cumulative YTD EPS.** Akshare/Eastmoney serves cumulative YTD for mainland-incorporated
  HK reporters (0700, 0939, 1211, 1810, and 9988 on an **Apr–Mar** fiscal year). Raw YoY
  comparison produces false-positive Code 33. Detected by an FY-reset algorithm (consecutive
  drop >40% marks the boundary), **not** by a naive Dec/Mar ratio — that gives 0.63× for
  Alibaba and compares the wrong fiscal years.
- **Semi-annual reporters.** Geely (0175.HK) files H1 + FY only. Cache stores
  `frequency: 'H'`; YoY uses `step=2`, not `step=4`.
- **HK cash flow is period-specific, income statement is cumulative.** Never call
  `_convert_ytd_to_period` on HK CF data.
- **`_to_float` does not strip `nan`** — guard with `math.isnan()` before arithmetic on
  Akshare AMOUNT values.
- **Sparse yfinance HK coverage** falls back to ADRs: 0700→TCEHY, 9988→BABA, 1810→XIACY,
  1211→BYDDY, 0175→GELYY, 0939→CICHY.

---

## 9. State and storage

**Vercel KV** (worker-authored, web reads):

| Key | Contents |
|---|---|
| `state:us`, `state:hk` | Authoritative per-region position state (`inLong`, `entryReady`, `targetWeight`, …) |
| `trade_log` | Signal-vs-execution records; web patches only `actual_fill_price` / `actual_fill_date` |
| `research_ideas_log` | Append-only fired research ideas, capped 500 |
| breadth snapshot / spread history | Per-market movers map + one shared HK/US spread series |

**Architectural rule (Approach C):** the Python worker is the sole author of trade-log
records and pairing. The web app reads, and patches exactly two fill fields. Nothing else.

---

## 10. Integrity guards

Four independent guards, each catching a different failure class:

| Guard | Where | Catches |
|---|---|---|
| **Reconcile** | `/api/reconcile`, daily | Worker and web disagreeing on `entryReady` / `inLong` / `targetWeight`. Independent recompute, not a mirror. Fires `[DRIFT] RECONCILE` on Telegram — that alert means one side broke `STRATEGY.md` |
| **Freshness sentinel** | `src/lib/freshness.ts`, `/api/freshness` | Silently frozen data. 7 checks with per-artifact thresholds; KV state and commit-time artifacts both covered |
| **Health probe** | `health-probe.yml` → `/api/health` | The pipeline itself being down. Weekday 12:00 HKT, ahead of the HK report window |
| **Vocabulary tests** | `alert-model.test.ts`, `telegram.test.ts`, worker `test_gate.py` | A new surface rendering a below-SMA50 flip as LONG |

The freshness thresholds are deliberately loose (2 trading days for daily artifacts,
9 days for weeklies, 40 days for monthly `st_params`) because GHA scheduling drifts.

---

## 11. Alerting

Two Telegram channels with different contracts:

- **ALERTS** — signal events from `/api/cron/analyze`. **Skip-gated**: silent when there
  is nothing to say.
- **REPORTS** — EOD breadth from `/api/cron/report`. **Always sends.**

`/api/cron/daily?market=us|hk` is a wrapper firing both, so one cron-job.org entry per
slot covers the full fan-out. It returns combined status so partial failures surface in
cron-job.org's logs.

`/api/telegram-bot` is the webhook (guarded by `x-telegram-bot-api-secret-token`) and
hosts `/fill`, admin-gated by `TELEGRAM_ADMIN_CHAT_ID`. `/api/telegram` is a UI test-ping
with **no secret** and is intentionally left Clerk-protected — do not add it to the
public route matcher.

`alert-model.posStateOf()` maps position state → labels for **all** narrative surfaces.
Do not derive stance labels anywhere else.

---

## 12. Auth model

Clerk protects all user-facing routes. Machine endpoints bypass Clerk and each carries
its own secret:

| Route | Guard |
|---|---|
| `/api/cron/*` | `x-cron-secret` = `CRON_SECRET` |
| `/api/reconcile` | `x-cron-secret` = `RECONCILE_SECRET` (its own secret — the worker calls it, not a browser) |
| `/api/health`, `/api/freshness` | `x-cron-secret` |
| `/api/telegram-bot` | `x-telegram-bot-api-secret-token` |

This bypass list exists because Clerk's `protect()` 404s unauthenticated machine callers
— which broke the EOD report and the `/check` `/portfolio` bot commands on 2026-06-03.

---

## 13. Research-idea engine

**v1 (shipped 2026-07-29, autopilot#16 + web#44) logs but does not score.** Each EOD the
worker runs a drawdown-recovery template over the portfolio, writes fired ideas to
`state.researchIdeas` and appends every one to `research_ideas_log`.

**Phase 2 — forward-return scorecard — is not built.** A scheduled kickoff routine exists
to plan it. Until it lands, the engine produces ideas with **no measured hit rate**, and
should be read the same way Kronos is: interesting, unvalidated. Any eventual scorecard
must carry a same-horizon naive control, per the probation methodology above.

---

## 14. Deployment and verification

Vercel, `vercel.json` sets all API routes to `maxDuration: 30s` (the cron report and
daily wrapper raise their own to 60s). Heavy computation runs server-side inside the API
route, not in the browser.

Full verification is `npx tsc --noEmit` + `npm test` + `npm run build`.

ESLint is **deliberately scoped to two rules** — `react-hooks/rules-of-hooks` and
`react-hooks/exhaustive-deps`, both errors. A full config on this codebase would surface
a style backlog that has to be triaged before the signal is usable; the hooks rules catch
a class of bug nothing else here can — a stale `useEffect` dependency in a self-fetching
panel (`NavPanel`, `TradeLogPanel`, `RotationPanel`) passes both `tsc` and vitest while
silently serving outdated data. `next build` runs it, so **a hooks violation fails the
Vercel deploy**.

### The V16.1 rule

The local V16.1 directory has diverged from GitHub. Never copy files wholesale in either
direction. Apply changes surgically; the canonical codebase is GitHub → Vercel. V16.1 is
a reference copy only.

---

## 15. Known constraints and failure modes

| Constraint | Consequence |
|---|---|
| No GHA fallback for the EOD report | cron-job.org down → that report is skipped, by design |
| AV free tier 25 req/day | Adding AV calls for fundamentals exhausted it and blanked NVDA/TSM. Fundamentals use yfinance for this reason |
| Yahoo `/v7`, `/v11` blocked from Vercel | Only `/v8/finance/chart` is usable server-side |
| FMP `/api/v3/` legacy | 403 for post-Aug-2025 accounts — use `/stable/` |
| Adding a stock to `portfolio.json` | Requires a manual run of the AV earnings workflow, or `code_33` stays null |
| HK stocks | `code_33` is always null — render greyed `—`, never `false` |
| Worker repo is private | Cloud sessions cannot clone it; anything needing worker internals must run where that repo is attached |

---

## 16. File map

| Concern | File |
|---|---|
| Strategy definition (normative) | `STRATEGY.md` |
| Build/ops guide | `CLAUDE.md` |
| Per-stock orchestration | `src/lib/pipeline.ts` |
| Pure TA | `src/lib/indicators.ts` |
| Score + divergence | `src/lib/scoring.ts` |
| Score → BUY/SELL/HOLD | `src/lib/signals.ts` |
| Position state machine | `src/lib/positionState.ts` |
| Exposure mapping | `src/lib/targetWeight.ts` |
| Trend-template criteria | `src/lib/trendTemplate.ts` |
| Dual backtest | `src/lib/backtest.ts` |
| ST param grid search | `src/lib/supertrend_optimizer.ts` |
| Regime | `src/lib/regime.ts` |
| Monte Carlo | `src/lib/montecarlo.ts` |
| Macro US / HK | `src/lib/macro.ts`, `src/lib/macro-hk.ts` |
| Forecast display + verdict gating | `src/lib/forecastBox.ts` |
| Rotation | `src/lib/rotation-ratio.ts` |
| Freshness sentinel | `src/lib/freshness.ts` |
| Stance labels (all surfaces) | `src/lib/alert-model.ts` |
| Digest assembly | `src/lib/digest/` |
| Defaults | `src/lib/config.ts` |
| Types | `src/types/index.ts` |

---

## 17. What this document does not cover

- **Worker internals.** `sc4stock-pixel/autopilot` is private; everything above about the
  worker is derived from its interfaces as consumed by this repo (`/api/reconcile`,
  `worker-events.ts`, the KV key shapes) and from `CLAUDE.md`. Treat worker specifics as
  second-hand and verify against that repo before relying on them.
- **Strategy rationale.** Backtest evidence for the sizing rule lives in `STRATEGY.md`
  and the referenced experiment scripts.
- **Historical decisions.** `CHANGELOG.md` carries dated entries with PR numbers.
