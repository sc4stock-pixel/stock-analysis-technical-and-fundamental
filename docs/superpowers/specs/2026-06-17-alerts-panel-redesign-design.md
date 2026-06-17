# Alerts Panel Redesign — Design Doc

**Date:** 2026-06-17
**Status:** DRAFT — awaiting user review
**Scope:** 3 surfaces (web panel + Telegram execution alert + Telegram EOD report). Python HTML report **deferred** (see §10).

---

## 1. Problem

The Alerts panel currently renders three competing sections — `AUTOPILOT SIGNALS` (worker/KV
reconciled events), `SIGNAL ALERTS` (client-computed flips), `OTHER ALERTS` (info) — with real
defects:

1. **Same event renders twice.** A SuperTrend flip appears in `AUTOPILOT SIGNALS` (worker) *and* in
   `SIGNAL ALERTS` (client-computed) — e.g. `3033.HK FLIP EXIT 06-11` shows in both, two formats,
   two sections. A reader can't tell if it's one event or two.
2. **Two "signal" sections compete.** Autopilot (KV) vs Signal (client) are the same concept
   (SuperTrend flips) sourced differently. The reader shouldn't need to know the data-pipeline
   topology to read the panel.
3. **Date formats clash.** Autopilot uses absolute `[2026-06-12]`; others use relative `(3d ago)`.
4. **Whipsaw spam.** One flip-flopping ticker (3033.HK = 5 events) occupies 5 equal-weight rows and
   dominates the panel.
5. **Rows state facts, not actions.** "FLIP EXIT ✓ current (ST↓)" is a fact; the missing framing is
   "what should I do about this."
6. **Wasted vertical space.** The ⬆/⬇ stance icon sits on its own line above each row.

---

## 2. Goals / Non-goals

**Goals**
- One canonical event model — nothing renders twice.
- A tight, scannable "what do I act on" block at the top; full detail demoted but preserved.
- Per-ticker folding so a whipsaw is one row, not five.
- Consistent formatting (dates, stance, severity color).
- Logic lives in a shared, tested module reused across the 3 TS surfaces so they can't drift.

**Non-goals (this effort)**
- No new data field or alert *type* — this is reframing existing signals, not new detection.
- No holdings/position UI (but see B-ready filter, §5).
- No settings control for tunable windows (hardcode consts).
- No Python HTML report changes (deferred, §10).

---

## 3. Decisions (locked with user)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Panel purpose | **Both, clearly split** — tight "Act on this" block + collapsed audit log |
| D2 | Actionability basis | **Option A now, B-ready** — stance-based, via a swappable filter fn |
| D3 | Flip source of truth | **Worker/KV is canonical; client-computed flips only gap-fill** tickers the worker hasn't reported |
| D4 | Cross-surface scope | **3 TS surfaces now** (web + Telegram alert + Telegram EOD); Python deferred |

---

## 4. Information architecture — 3 zones

Replaces today's 3 sections.

1. **Header** — `⚡ ALERTS` · total count · one severity pill `N TO ACT`
   (red if any actionable EXIT/OUT, amber otherwise).
2. **ACT ON THIS** — always expanded. One row per ticker. The decision block.
3. **RECENT DETECTIONS** — collapsed by default. The full reconciled audit log
   (today's `AUTOPILOT SIGNALS` content), preserving every
   `confirmed/provisional · ✓ current · ↳ reverted · ↳ superseded` state.
4. **OTHER ALERTS** — unchanged content: candlestick / RSI divergence / correlation. Below the fold.

---

## 5. Actionability rule — what enters "ACT ON THIS"

Implemented as a pure function so the basis is swappable:

```
isActionable(row, heldSet?) -> boolean
```

- **`heldSet === undefined` (today, Option A):** a ticker is actionable when its **current confirmed
  stance** results from a flip within `ACT_WINDOW_SESSIONS` (default **10** trading sessions) and is
  still current. Older standing positions live in the audit log only.
- **`heldSet` provided (future, Option B):** filter to held tickers; a fresh BUY on a non-held name
  drops to a "watchlist" sub-line. **No layout change** — only the predicate differs.

**Per-ticker fold.** One row = a ticker's *net current confirmed stance*. A whipsawing ticker
(≥2 flips in the window) collapses to a single `↔ whipsawing · N flips/2wk` row; the raw events
remain in the audit log.

**Double-signal escalation.** When an ST flip and a TT strip/regain hit the *same ticker* in-window,
they merge into one row (`+ TT 5→4`) with bumped border emphasis.

---

## 6. Data flow & dedup

- Build `reportedTickers = set(workerEvents.map(e => e.ticker))`.
- Client-computed flips (`computeOptimizedFlip`) are dropped from the actionable/audit flip lists for
  any ticker in `reportedTickers` → eliminates the double-render (problem #1).
- Client logic still owns **reentry / score-BUY / candlestick / RSI div** (the worker doesn't emit
  these) — those flow into OTHER ALERTS untouched.

---

## 7. Shared module design

New pure module: **`src/lib/alert-model.ts`**

```
buildAlertModel(workerEvents, clientResults, opts?) -> {
  actOnThis:  ActionableRow[],   // folded, per-ticker, sorted by severity then freshness
  auditLog:   ReconciledEvent[], // full worker history (existing reconcileWorkerEvents output)
  otherAlerts: InfoAlert[],      // candlestick / rsi_div / correlation
}
isActionable(row, heldSet?) -> boolean
```

- Colocated `src/lib/alert-model.test.ts` (repo convention: pure logic in `lib/` + vitest).
- Consumers:
  - **Web:** `AlertsPanel.tsx` becomes mostly presentational — consumes `buildAlertModel`.
  - **Telegram exec alert:** `src/lib/telegram.ts → buildTelegramMessage()` (telegram.ts:134).
  - **Telegram EOD report:** `src/lib/telegram-report.ts → buildEodReport()` (telegram-report.ts:201).
- This mirrors the existing shared-helper pattern (`forecastBox.ts` / `buildForecastSection`) that
  already keeps forecast cells in lockstep across web + Telegram.

---

## 8. Per-surface rendering

**Data-source reality (verified 2026-06-17):** only the **web panel** reads worker/KV state
(Engine B). The Telegram builders are called from Engine A cron routes
(`api/telegram`, `api/cron/analyze`, `api/cron/report`) which do **not** read KV. So Telegram
surfaces get **client-stance** framing (computed from `results`, like the web gap-fill path) — not
worker reconciliation. This avoids any change to the live alert plumbing. `buildAlertModel` takes
worker events as an argument; web passes the real array, Telegram passes `[]`.

| Surface | Engine | "Act on this" basis | Audit log |
|---------|--------|---------------------|-----------|
| Web panel | reads KV (B) | worker-truth + client gap-fill | `RECENT DETECTIONS`, collapsed `<details>` — full state |
| Telegram exec alert | A cron | client-stance (`workerEvents=[]`) | omit (too long for push) |
| Telegram EOD report | A cron | client-stance (`workerEvents=[]`) | omit / compact summary |

So **parity = framing parity, not data parity**: the Act-on-this fold + `entered/exited uptrend`
copy appear on all three; only the web panel shows the rich `confirmed/reverted/superseded` audit
(it alone has the worker events).

**Telegram guardrails (from CLAUDE.md):** `<pre>` content must be `htmlEscape`d (literal `<`/`>` in
e.g. `TT 5→4` or `ST↓` is safe, but any `>`/`<` must be escaped); strip `.HK` from tickers to avoid
auto-linkify (`0700.HK` → `0700`).

---

## 9. Visual spec (web)

- **Inline stance arrow** into the row — remove the standalone arrow line (problem #6), halving row height.
- **Unify dates:** relative (`3d ago`) everywhere; absolute on hover via `title` (problem #3).
- **Severity color:** red = OUT/exit, green = LONG/entry, amber = whipsaw / TT-strip.
- **Row anatomy:** `[stance arrow] [TICKER] [plain-English change] … [freshness] [stance pill: LONG·ST↑ / OUT·ST↓]`.
- **Row copy (locked):** bullish = `entered uptrend`, bearish = `exited uptrend` (parallel pair,
  echoes the `BUY`/`EXIT` event names), whipsaw = `whipsawing · N flips/2wk`. The stance pill
  carries the mechanic (`OUT · ST↓`), so the description only states the transition. Double-signal
  row appends an inline chip, e.g. `exited uptrend + TT 5→4`.
- **`TODAY` pill** preserved for `barsSince === 0`.
- Palette unchanged: panel `#0f1629`, border `#1e2d4a`, green `#00ff88`, red `#ff4757`,
  cyan `#00d4ff`, amber `#f59e0b`/`#ffa502`, muted `#4a6080`.
- `data-*` attributes on rows preserved for external tooling.

A frontend-design prototype will validate this before the implementation plan.

---

## 10. Deferred: Python HTML report (PLANNED, not in this effort)

`report/panels.py` computes flips from its **own** SuperTrend (`r.get('st_flip_type')`,
`FLIP_ALERT_DAYS=3`) — it has **no** worker/KV data, so it can never render
`reverted/superseded` state. Including it would mean a cross-engine TS→Python port with the
staleness risk the TS-port-drift convention warns about, for the lowest-traffic, lowest-fidelity
surface.

**Consequence of deferral:** a temporary *framing* divergence — the Python report keeps today's
`SIGNAL ALERTS / OTHER ALERTS` two-section layout while web + Telegram move to
`Act on this / audit`. This is framing drift, not data drift (every underlying signal is still
present on all surfaces).

**When picked up later:** port the `alert-model.ts` actionability + fold logic into `panels.py`
(stance-only basis — Option A always, since no worker state), and add
`# PARITY VERIFIED with alert-model.ts — keep in sync` comments at both sites.

---

## 11. Edge cases

- Empty state: no actionable rows + no audit + no info → panel returns null (as today).
- A ticker confirmed-current but flipped > `ACT_WINDOW_SESSIONS` ago → audit only, not "act".
- Provisional-only event (never confirmed) → audit log only, never "act".
- Reverted/superseded events → never "act"; shown faded in audit.
- Non-finite floats from any JSON/KV reader → strip `NaN`/`Infinity` before parse (CLAUDE.md rule).

---

## 12. Testing

- `alert-model.test.ts`: dedup (worker wins over client), per-ticker fold, whipsaw detection,
  freshness gate, `isActionable` with/without `heldSet`, double-signal merge, empty state.
- `npm run build` + `npm test` green in `/tmp/stock-analysis-push` (per V16.1 deploy rule).
- Visual verification on the per-branch Vercel Preview (Clerk-gated; user, signed in).
- Telegram smoke test via the existing webhook path.

---

## 13. Open questions

- `ACT_WINDOW_SESSIONS` default = 10 — confirm during prototype.
- EOD report: include a compact audit summary, or "Act on this" only? (Lean: compact summary.)
