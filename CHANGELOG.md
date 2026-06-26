# Changelog

All notable changes to the web app are documented here. Dates are HKT.

## 2026-06-26 — 5d-primary forecast display redesign + dead code cleanup

Replaced the broken `dir_hits/20` forecast display with a 5d-primary layout featuring:
- **Conviction flags**: ✦ high-conviction (>5% predicted move), ⚠ low-reliability (shown together, not mutually exclusive)
- **Naive 60d-drift benchmark** column in portfolio bar and stock card
- **Model-level true-OOS skill badge** from `forecast_skill.json` (emitted by probation harness + daily GHA)
- **TimesFM removed from all display** (generation + probation harness intentionally kept through 2026-07-22)
- **Morning Digest** repointed to Kronos 5d

Dead code removed: `ForecastModelRow` component, `timesfmRow`/`agreement20` exports + tests,
`dirHits` field on `ForecastRowData`, `Agreement` type.

Key files: `src/lib/forecastBox.ts`, `src/components/StockCard.tsx`,
`src/components/PortfolioSummaryBar.tsx`, `src/lib/forecastBox.test.ts`.

## 2026-06-23 — Trade Log feature (viewer + Telegram /fill + provisional handling + legend)

Shipped via PRs #21, #22, #23 (all squash-merged to main). Surfaces the autopilot
`trade_log` KV key and records signal-vs-execution slippage.

- **Web viewer** (#21): `src/app/api/trades/route.ts` (NaN-safe KV read, mirrors `/api/nav`)
  + `src/components/TradeLogPanel.tsx` — self-fetching panel (no props) like NavPanel.
  Summary (filled/unfilled, avg/median slippage, % adverse) split by `params_source`
  (optimized vs default_fallback); sortable table, unfilled rows pin to bottom.
- **Telegram `/fill`** (#21): admin-gated (`TELEGRAM_ADMIN_CHAT_ID`) command in
  `src/app/api/telegram-bot/route.ts` patching `actual_fill_price`/`actual_fill_date`.
  Bare `/fill` lists records; `/fill TICKER PRICE [date]` infers; `/fill <id> PRICE [date]`
  explicit. Echoes computed slippage. Architecture = Approach C: Python worker stays sole
  author of records/pairing; web only reads + patches the two fill fields.
- **Shared slippage helper**: `src/lib/slippage.ts` (`computeSlippage`, `slippageLabel`,
  `summarize`) — single source reused by panel AND `/fill` echo. Pure `/fill` parsing in
  `src/lib/fill-command.ts`. NaN strip single-sourced via `fill-command.stripNaN`.
- **Provisional vs confirmed** (#22): `isFillable(rec) = confirmed && unfilled`. Provisional
  (`confirmed:false`) intraday flips may never have executed → not fillable: `/fill` rejects
  them, bare list shows them under "⏳ Provisional — not fillable", panel dims them with a
  `prov` tag.
- **Info legend** (#23): `InfoTooltip` on the panel (new `panelMeta.ts` `trades` id) with a
  `/fill TICKER PRICE [date]` reminder in the popover; glossary in the legend drawer.

Files: new `src/types/trade-log.ts`, `src/lib/slippage.ts`(+test), `src/lib/fill-command.ts`(+test),
`src/app/api/trades/route.ts`(+test), `src/components/TradeLogPanel.tsx`; edited `src/app/page.tsx`,
`src/app/api/telegram-bot/route.ts`, `src/lib/panelMeta.ts`(+test). Tests 121/121.

Deferred: slippage summary line in the Telegram EOD report (`buildEodReport`).
Live-unverified: `/fill` WRITE path + slippage echo (read path proven on prod).
New env var: `TELEGRAM_ADMIN_CHAT_ID` (set in Vercel Prod + Preview).

## 2026-06-17 — Alerts panel redesign

### Added
- `src/lib/alert-model.ts` — single source of truth for alert framing:
  `buildAlertModel(workerEvents, tickers, clientResults, opts)` → `{ actOnThis, auditLog, otherAlerts }`,
  plus a swappable `isActionable(row, heldSet?)` predicate (stance basis now, holdings-flag ready).
  Folds per-ticker (whipsaw → one row), escalates coincident ST flip + TT strip/regain, sorts by
  severity then freshness, gates on a 10-session window. 16 unit tests.
- "Act on this" block on the Telegram execution alert and EOD report (client-stance; Engine A has
  no worker/KV, so framing parity not data parity — no whipsaw fold / TT chip / audit there).

### Changed
- Web Alerts panel (`src/components/AlertsPanel.tsx`) rewritten to three zones: **Act on this**
  (folded, severity-sorted), collapsed **Recent detections** audit log (full
  confirmed/provisional/reverted/superseded state), and **Other alerts**. Worker/KV is the source
  of truth; client-computed flips only gap-fill tickers the worker hasn't reported.
- Flip detection consolidated: removed the duplicate `detectFlip` in `src/lib/telegram.ts` in favor
  of `alert-model.clientFlip` (which falls back to a precomputed `_flip` when cron routes strip
  `chart_bars`).
- Trend-Template escalation label derived from a named `TT_PASS = 5` threshold instead of a
  hardcoded `"+ TT 5→4"` string.
- EOD report `ST BEARISH` list now strips `.HK` from tickers (avoids Telegram auto-linkify).

### Fixed
- Duplicate-render bug: a SuperTrend flip no longer appears twice (once from worker/KV, once from
  client computation). The worker-truth + `reportedTickers` gap-fill guard eliminates it.

### Notes
- Python HTML report (`report/panels.py`, separate engine) is **deferred** — it keeps its existing
  two-section layout for now. See `docs/superpowers/specs/2026-06-17-alerts-panel-redesign-design.md` §10.
