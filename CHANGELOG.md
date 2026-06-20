# Changelog

All notable changes to the web app are documented here. Dates are HKT.

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
