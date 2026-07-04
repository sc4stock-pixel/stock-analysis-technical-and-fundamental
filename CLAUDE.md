# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠️ STRATEGY.md is normative

Before touching ANY signal-adjacent code (alerts, logs, digest, displays, backtests,
pipeline), read `STRATEGY.md`. The ST strategy = SuperTrend flip + Close>SMA50;
"LONG/entry/entered" wording may only derive from `entryReady`/`entry_buy`. New
stance-rendering surfaces must add a below-SMA50-flip-is-not-LONG test. (2026-07-04 audit)

## Commands

```bash
npm run dev      # start dev server (Next.js 14, http://localhost:3000)
npm run build    # production build
npm run lint     # ESLint
npm test         # run the vitest suite (src/**/*.test.ts)
```

Tests run on **vitest** (`vitest.config.ts`). Unit tests live alongside source as
`src/**/*.test.ts` (e.g. `src/lib/worker-events.test.ts`). Prefer extracting pure logic
into a `src/lib/*.ts` module with a colocated `.test.ts` over inlining it in components.

## Architecture

This is a **Next.js 14 App Router** stock analysis dashboard. All analysis runs in the browser or on Vercel serverless functions — there is no database.

### Data flow

1. User clicks "RUN ANALYSIS" in `src/app/page.tsx` (the single-page dashboard)
2. For each stock in the portfolio, the browser POSTs to `/api/stocks` with the full `AppConfig`
3. `/api/stocks/route.ts` fetches OHLCV data from Yahoo Finance, then calls `runPipeline()` from `src/lib/pipeline.ts`
4. `runPipeline()` is the core computation engine — it runs all indicators, scoring, SuperTrend optimization, dual backtest, Monte Carlo, and walk-forward, returning a `StockAnalysisResult`
5. Results stream back to the page incrementally and are rendered as `StockCard` components

Macro data (US and HK) is fetched in parallel via `/api/macro` and `/api/macro-hk`, then applied as a score adjustment after all stocks complete.

TimesFM forecasts are **not** computed at runtime — they're fetched as a static JSON file from GitHub (`timesfm_forecasts.json`), updated nightly by the GitHub Actions workflow in `.github/workflows/timesfm.yml` which runs `scripts/timesfm_predict.py`.

### Key library modules (`src/lib/`)

| File | Purpose |
|------|---------|
| `pipeline.ts` | Orchestrates the full per-stock analysis; entry point from the API route |
| `indicators.ts` | Pure TA functions: RSI, MACD, ADX, ATR, Bollinger Bands, SuperTrend, etc. |
| `scoring.ts` | Multi-factor score (0–10) and RSI divergence detection |
| `signals.ts` | Converts scores into BUY/SELL/HOLD signals with confirmation logic |
| `backtest.ts` | Dual backtest: score-based strategy and SuperTrend strategy |
| `supertrend_optimizer.ts` | Grid-searches ATR period and multiplier, picks params by Sharpe |
| `regime.ts` | Per-bar and current-bar market regime classification (TRENDING, RANGING, etc.) |
| `montecarlo.ts` | Block-bootstrap Monte Carlo on the equity curve |
| `macro.ts` | US Macro Breadth Score (MBS) from Fear & Greed, VIX, yield spreads, breadth |
| `macro-hk.ts` | HK-specific MBS (HSI trend, CNH/USD, Southbound flow, HK VIX proxy) |
| `config.ts` | `DEFAULT_CONFIG` — the full `AppConfig` with all tunable parameters |

### Configuration (`AppConfig`)

All analysis parameters live in `AppConfig` (`src/types/index.ts`) and are mutated at runtime via `ConfigPanel`. The defaults are in `src/lib/config.ts`. Stocks support two exchanges: `"US"` (Yahoo tickers) and `"HK"` (e.g. `"9988.HK"`). US and HK macro adjustments are applied separately based on each stock's `exchange` field.

### Component structure

`StockCard` is the main card component; it renders tabbed sub-views via components in `src/components/tabs/` — `OverviewTab`, `ChartTab`, `BacktestTab`, `MonteCarloTab`, `TradesTab`, `TradingPlanTab`.

`FundamentalReport` triggers an AI-generated analysis via `/api/fundamental`, which calls `src/lib/fundamental/generateReport.ts` to fetch data from Yahoo Finance and FMP (requires `FMP_KEY` env var), then structures prompts for DeepSeek (using the free web interface — `deepseek.ts` is deprecated/unused).

### Environment variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `FMP_KEY` | Vercel env | Financial Modeling Prep API key — fundamentals data. Free tier: 250 req/day. If absent, fundamentals columns show dashes. |

### Deployment

Deployed on Vercel. `vercel.json` sets all API routes to `maxDuration: 30s`. The heavy computation (`runPipeline`) runs server-side inside the API route, not in the browser.

## V16.1 vs GitHub Deploy Rule

**V16.1 local directory has diverged from GitHub** (different ConfigPanel props, missing components, etc.).
- NEVER copy GitHub files wholesale to V16.1 — it will break V16.1's TypeScript build.
- NEVER copy V16.1 files wholesale to GitHub — V16.1 may be behind on features.
- ALWAYS apply changes surgically: edit `/tmp/stock-analysis-push`, push to GitHub, let Vercel build.
- V16.1 is a reference copy only; the canonical codebase is GitHub → Vercel.
- Build verification: use `npm run build` in `/tmp/stock-analysis-push` (after `npm install`), not V16.1.

## Fundamentals Cache (fundamentals_cache.json)

Weekly GHA job (`scripts/fetch_fundamentals.py`) writes `fundamentals_cache.json` alongside `av_earnings_cache.json`.
Read via `GET /api/fundamentals?symbol=X` (6h TTL, same raw.githubusercontent.com pattern).

**US stocks → yfinance** (not AV). AV free tier = 25 calls/day shared with fetch_av_earnings.py (9 calls).
Adding AV calls for fundamentals exhausts the limit — NVDA/TSM show 0 periods. yfinance has no rate limits.

**HK stocks → yfinance first, Akshare fallback.** Yahoo's HK tickers (0700.HK) often have sparse CF data.
Fallback chain: yfinance HK → yfinance ADR (TCEHY/BABA/XIACY) → Akshare.

**HK ADR map for sparse yfinance coverage:**
`0700.HK→TCEHY, 9988.HK→BABA, 1810.HK→XIACY, 1211.HK→BYDDY, 0175.HK→GELYY, 0939.HK→CICHY`

**HK GAAP cash flow field names (Eastmoney, NOT mainland GAAP):**
- CFO: `经营业务现金净额` (NOT `经营活动产生的现金流量净额`)
- Capex: `购建固定资产` (NOT the long mainland GAAP version)
- Probe with: `ak.stock_financial_hk_report_em(stock="00700", symbol="现金流量表", indicator="报告期")`

**Do NOT call `_convert_ytd_to_period` on HK CF data** — Eastmoney CF is already period-specific.
The income statement IS cumulative YTD for most HK reporters; the cash flow statement is NOT.

**`_to_float` does not strip `nan`** — use `math.isnan()` guard before arithmetic on Akshare AMOUNT values.

**AV free tier budget:**
- `fetch_av_earnings.py`: 9 calls (1 EARNINGS per US ticker incl. ETFs)
- `fetch_fundamentals.py`: 0 AV calls (yfinance replaces IS/BS/CF)
- 25/day cap — leaving ~16 free for ad-hoc testing

## Recharts TypeScript Patterns

`LabelList` and `Tooltip` `formatter` callbacks require `(v: unknown)` + explicit cast:
```tsx
formatter={(v: unknown) => { const n = v as number; return n != null ? `${n.toFixed(0)}%` : ""; }}
```
Using `(v: number)` directly causes TS errors on recharts generic props.

## StockCard Global Tab Broadcast

`TABS` and `Tab` are exported from `StockCard.tsx` for use in `page.tsx`.
`forcedTab` prop + `useEffect` syncs all cards when `globalTab` state changes in `page.tsx`.
The "ALL: OVR CHT BKT MC PLN FND" strip in the header only renders when `results.length > 0`.
Clicking an active pill a second time releases the broadcast (sets `globalTab` to null).

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes — don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user
- Fix failing CI tests without being told how

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

## SEPA Metadata Layer

`sepa_metadata` on `StockAnalysisResult` is a **passive display overlay only**.

- It must never influence `signal`, `score`, `backtest`, or any strategy math
- Computed at the end of `runPipeline()` from already-available indicator arrays
- `code_33` is patched in `route.ts` after `runPipeline()` returns (from AV cache)
- HK stocks always have `code_33: null` — render as greyed `—`, never as false

### Code 33 cache dependency

`code_33` reads from `av_earnings_cache.json` (GitHub raw URL, 6h TTL).
After adding any new stock to `portfolio.json`, manually trigger the
**"Update Alpha Vantage Earnings Cache"** GitHub Actions workflow.
`AV_KEY` is a GitHub Actions secret only — not needed in Vercel.

**Data sources by exchange:**
- US stocks → Alpha Vantage EARNINGS endpoint (25 req/day free tier)
- HK stocks → Akshare `stock_financial_hk_report_em` (Eastmoney source)
- ETFs (SPY, QQQ, 3033.HK) → skipped naturally, `code_33 = null`

**Semi-annual reporters:** Geely (0175.HK) files H1+FY only.
Script computes H2 = FY − H1. Cache stores `frequency='H'` → route uses
`step=2` for YoY comparison (same half vs. 1 year ago) instead of `step=4`.

**Cache format (v2):** `{frequency: 'Q'|'H', quarters: [{fiscalDateEnding, reportedEPS}]}`
Old format (plain array) is handled transparently in `fetchCode33` for backward compat.

### HK cumulative YTD detection (critical data quality)

Akshare/Eastmoney serves **cumulative YTD EPS** for mainland-incorporated HK stocks —
not individual quarterly values. Raw cumulative YoY comparisons produce false positives
in Code 33 (e.g. CCB showed green Code 33 incorrectly before this was fixed).

**Affected stocks and fiscal years:**
| Stock | Fiscal year | Notes |
|-------|-------------|-------|
| Tencent (0700.HK) | Jan–Dec | Cumulative YTD |
| CCB (0939.HK) | Jan–Dec | Cumulative YTD |
| BYD (1211.HK) | Jan–Dec | Cumulative YTD |
| Xiaomi (1810.HK) | Jan–Dec | Cumulative YTD |
| Alibaba (9988.HK) | **Apr–Mar** | Cumulative YTD — non-calendar FY! |
| Geely (0175.HK) | Jan–Dec | Semi-annual only (H1+FY) |

**Why the naive Dec/Mar ratio (>2.5×) fails for Alibaba:**
Alibaba's Dec (FY_N Q3 cumulative) is compared against Mar (FY_N-1 annual total),
giving a ratio of 0.63× — the wrong fiscal years. Use the FY-reset detector instead.

**Correct detection algorithm (`fetch_av_earnings.py`):**
1. Sort all EPS periods by date ascending
2. Consecutive drop >40% (next/prev < 0.6) = fiscal year boundary (the YTD→Q1 reset)
3. Group periods into fiscal years at each boundary
4. Within each FY with ≥2 periods, check monotonic non-decrease (5% tolerance for rounding)
5. If >50% of FY groups pass → cumulative; convert by differencing adjacent periods within each FY

**Conversion:** Within each FY, `incremental = max(ytd_value − prev_ytd, 0)`.
Q1 is always unchanged (prev = 0). Handles Alibaba's Apr-Mar FY correctly because
the FY boundary is detected at the Mar→Jun drop (~66%), not Dec→Mar.

When adding a new HK stock, use the `/verify-hk-data-quality` skill to confirm
the format before adding to `portfolio.json`.

## External API Status (as of V17)

| API | Endpoints used | Notes |
|-----|---------------|-------|
| FMP | `/stable/ratios-ttm`, `/stable/price-target-consensus` | `/api/v3/` is legacy — returns 403 for new accounts post-Aug 2025 |
| Alpha Vantage | `EARNINGS` (quarterly EPS) | Called only from GitHub Actions, never from API route |
| Yahoo Finance | `/v8/finance/chart` (OHLCV) | `/v7/quote` and `/v11/quoteSummary` blocked from Vercel |
