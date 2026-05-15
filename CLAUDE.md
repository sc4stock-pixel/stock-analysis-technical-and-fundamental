# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # start dev server (Next.js 14, http://localhost:3000)
npm run build    # production build
npm run lint     # ESLint
```

No test suite is configured.

## Architecture

This is a **Next.js 14 App Router** stock analysis dashboard. All analysis runs inside Vercel serverless functions — there is no database.

### Request flow

1. User clicks "RUN ANALYSIS" in `src/app/page.tsx`
2. For each stock, the browser POSTs to `/api/stocks` with the full `AppConfig`
3. `/api/stocks/route.ts` fetches OHLCV from Yahoo Finance (`v8/finance/chart`), fundamentals from FMP, and cached SuperTrend params from `st_params.json` on GitHub, then calls `runPipeline()`
4. `runPipeline()` (`src/lib/pipeline.ts`) runs all indicators → scoring → signal generation → dual backtest → Monte Carlo → walk-forward, returning `StockAnalysisResult`
5. Results stream back to the page incrementally and render as `StockCard` components

Macro data is fetched in parallel via `/api/macro` (US) and `/api/macro-hk` (HK), applied as score adjustments after all stocks complete.

TimesFM forecasts are **not** computed at runtime — fetched as `timesfm_forecasts.json` from the repo root (updated by `.github/workflows/timesfm.yml`).

### Key library modules (`src/lib/`)

| File | Purpose |
|------|---------|
| `pipeline.ts` | Orchestrates the full per-stock analysis; entry point from the API route |
| `indicators.ts` | Pure TA: RSI, MACD, ADX, ATR, Bollinger Bands, EMA, SMA, SuperTrend (Wilder's EWM ATR) |
| `regime.ts` | Per-bar regime classification + all regime-adaptive parameter lookup tables |
| `scoring.ts` | Multi-factor score (0–10) with per-bar regime-weighted components |
| `signals.ts` | BUY/SELL/HOLD signal pipeline: volume surge → raw signal → velocity filter → confirm bars → entry signal (shift 1) |
| `backtest.ts` | Dual backtest: Score Alpha strategy + SuperTrend strategy |
| `supertrend_optimizer.ts` | Grid-searches ATR period [10,12,14] × multiplier [2.5–3.5] by Sharpe ratio |
| `montecarlo.ts` | Block-bootstrap Monte Carlo on the equity curve |
| `macro.ts` / `macro-hk.ts` | US and HK macro breadth scores |
| `config.ts` | `DEFAULT_CONFIG` — all tunable `AppConfig` parameters |

### Signal pipeline order (signals.ts)

The order is critical and must match the Python reference:
1. Volume surge detection → `scoreAdjusted = score + 2.0` if surge
2. Raw signal from `scoreAdjusted` vs `entryThreshold` / `exitThreshold`
3. Block BUY on bearish RSI divergence
4. **Velocity Entry filter applied to `rawSignal`** (price > EMA20 && relative EMA slope > 0) — volume surge bypasses this
5. Force Entry = `volumeSurge && rawSignal === 'BUY'`
6. Regime-adaptive confirm bars window checks velocity-filtered `rawSignal`
7. `entrySignal = signalConfirmed.shift(1)`

### Regime system

`regime.ts` defines ~25 regime labels (e.g. `STRONG_UPTREND`, `WEAKENING_DOWNTREND`, `RANGING`). Each regime has a dedicated row in six lookup tables:
- `REGIME_MAX_HOLDING_DAYS`, `REGIME_ATR_MULTIPLIER`, `REGIME_PROFIT_TARGET_ATR`
- `ALPHA_MODE_TRAILING_ATR_MULT`, `ALPHA_MODE_PROFIT_TARGET_ATR`, `ALPHA_MODE_IGNORE_SIGNAL_EXIT`
- `EXCHANGE_CONFIRM_BARS` (regime × exchange matrix)

The Score Alpha backtest uses **Alpha Mode** in `STRONG_UPTREND` / `STRENGTHENING_UPTREND`: 4× trailing ATR, 999× profit target (no cap), ignores SELL exits.

### SuperTrend parameter caching (V17)

Optimal ST params are cached in `st_params.json` (repo root) to avoid running the grid search on every analysis call:
- **Monthly refresh**: `.github/workflows/optimize-supertrend.yml` runs the first Sunday of each month (cron `0 2 1-7 * 0`) via `scripts/optimize-supertrend.mjs`
- **Manual trigger**: "⚡ OPTIMIZE ST" button in the UI POSTs to `/api/st-params`, which triggers `workflow_dispatch` using `GITHUB_TOKEN`
- **Runtime fetch**: `/api/stocks` fetches `st_params.json` from `raw.githubusercontent.com` with a 5-min module-level TTL; stocks not in cache fall back to live optimization

### Scoring design note

The web app applies each bar's own detected regime's weights to compute that bar's score (per-bar regime weighting). The Python reference script uses a single global regime (detected at analysis time) applied to all bars. This is a known intentional divergence — per-bar weighting is more methodologically sound but produces different historical numbers than Python.

### Configuration

All analysis parameters live in `AppConfig` (`src/types/index.ts`). Defaults are in `src/lib/config.ts`. Stocks support `"US"` and `"HK"` exchanges; HK symbols use Yahoo suffixes (e.g. `"9988.HK"`).

### Environment variables

| Variable | Purpose |
|----------|---------|
| `FMP_KEY` | Financial Modeling Prep API key — fundamentals (P/E, EPS, analyst targets). Free tier: 250 req/day. If absent, fundamentals columns show dashes. |
| `GITHUB_TOKEN` | GitHub PAT with `repo` + `workflow` scopes — required for "⚡ OPTIMIZE ST" button to trigger `workflow_dispatch` |

### Deployment

Deployed on Vercel. `vercel.json` sets `maxDuration: 30s` for all API routes. The heavy computation (`runPipeline`) runs server-side in the API route.

## Standing Conventions

### Editing this repo

The local directory `stock-analysis-technical-and-fundamental-timesFM V16.1/` is **not** linked to GitHub. Always make changes by cloning the repo to `/tmp`, editing, committing, and pushing:

```bash
git clone https://github.com/sc4stock-pixel/stock-analysis-technical-and-fundamental.git /tmp/stock-analysis-repo
# edit files
cd /tmp/stock-analysis-repo && git add <files> && git commit -m "..." && git pull --rebase origin main && git push origin main
```

### backtest.ts — entryRegime must use current bar

`entryRegime` at line 258 reads `cur.regime` (not `prev.regime`). This matches Python's `backtest.py` which uses the current bar's regime for all entry parameter lookups (ATR mult, trailing mult, max hold days, profit target, trail trigger, Alpha Mode). Do not revert this.

### Scoring divergence from Python is intentional

The web app scores each bar with its own detected regime's weights (per-bar). Python applies one global regime (detected at analysis time) to all bars. This is a known, accepted divergence — the web app approach is more methodologically sound. Do not "fix" it to match Python without explicit instruction.

### ST optimizer is Python-only — do not re-introduce JS

`scripts/optimize_supertrend.py` is the single source of truth for `st_params.json`. The old `scripts/optimize-supertrend.mjs` was deleted. The GH Actions workflow runs the Python script monthly. Do not create a JS/TS replacement.

### GITHUB_TOKEN scope for workflow_dispatch

The Vercel env var `GITHUB_TOKEN` must be a classic PAT with **both** `repo` and `workflow` scopes. `repo` alone returns 403 when triggering `workflow_dispatch` via the GitHub API.

### Alert automation hook pattern

Flip and reentry alerts in `AlertsPanel.tsx` carry structured `data-*` attributes
on their DOM nodes for external tooling and future automation:

- `data-alert-type` — `"flip"` | `"reentry"` | `"score_buy"` | `"rsi_div"` | `"candlestick"` | `"correlation"`
- `data-symbol` — ticker symbol (e.g. `"0700.HK"`)
- `data-flip-type` — `"BULLISH"` | `"BEARISH"` (flip and reentry alerts only)
- `data-bars-since` — integer, bars since the flip/reentry (0 = today)

Any future automation features (webhooks, bots, browser extensions) should query
these attributes rather than parsing the alert text. Do not remove or rename them.

### GitHub Actions workflows

| Workflow | Schedule | Purpose |
|----------|----------|---------|
| `optimize-supertrend.yml` | First Sunday of month, 02:00 UTC | Runs `scripts/optimize-supertrend.mjs`, commits `st_params.json` |
| `timesfm.yml` | Daily after HK market close | Runs `scripts/timesfm_predict.py`, commits `timesfm_forecasts.json` |
| `update-southbound.yml` | Scheduled | Updates `southbound_data.json` (HK Southbound flow) |
