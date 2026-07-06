# STRATEGY.md — Normative definition of the ST strategy

**This file is the single source of truth for what "the strategy" means.**
Any development that touches signals, alerts, logs, digests, or displays MUST be
checked against this spec before merging. If code and this spec disagree, one of
them is a bug — resolve explicitly, never silently.

## The strategy (one sentence)

> **Enter LONG when SuperTrend flips bullish AND Close > SMA50; exit when
> SuperTrend flips bearish (exits are ungated). Re-enter when price reclaims
> SMA50 while SuperTrend is still bullish.**

## The three layers — never conflate them

| Layer | What it is | Where | May be called |
|---|---|---|---|
| **1. Indicator** | Raw SuperTrend: ATR bands, direction, flip. No SMA. | `indicators.py supertrend()` · `indicators.ts supertrend()` · worker `signals.py` | "flip", "dir", "trend", "ST↑/↓" — **never** "entry"/"LONG" |
| **2. Strategy** | Layer 1 + the SMA50 gate. THE tradeable signal. | py `signals.py` `SuperTrend_Signal_EMA_Only`/`_Full_Filter` · web `pipeline.ts` `stEntrySignal` · worker `entryReady`/`entry_buy` | "entry", "LONG", "entered uptrend", "BUY" |
| **3. Telemetry** | Alerts/logs reporting layer-1 events with layer-2 context. | worker `gate.py` events · `alert-model.ts` · trade_log | must label which layer each field shows |

### Entry conditions (layer 2, exact)

1. `SuperTrend_Signal == BUY` (bullish flip) **AND** `Close > SMA_50`, — or —
2. Re-entry: `SuperTrend_Direction == 1` (already bullish) AND Close crosses
   above SMA_50 (prev close ≤ prev SMA_50).
3. Full-filter mode additionally requires ATR > rolling 40th percentile AND
   ADX > dynamic threshold. Live `filter_mode` comes from config (`ema_only`).

### Exits

SELL signals pass through **ungated** (capital protection). The SuperTrend line
is the trailing stop; stop-hit exits defer to next bar's open (audit fix H3).

## The position state machine (added 2026-07-06)

`entryReady` answers "does the gate pass NOW"; the strategy's actual state is
positional. States for a dir-up ticker:

```
OUT ──(flip+gate | SMA50 reclaim)──▶ ENTRY-PENDING (signal on latest bar;
      fills next session's open) ──▶ LONG ──(ST flip down)──▶ OUT
```

- **LONG** (`inLong`): entered via the gate, held until an ST flip-down —
  stays LONG even if price later dips back under SMA50 (exits are ST-flip
  only; the META 2026-07-02 case).
- **ENTRY-PENDING** (`entryPending`): signal fired on the latest bar; no fill
  yet (the AAPL 2026-07-02 holiday-weekend case).
- **WAITING**: dir up but never entered (below SMA50 at flip, no reclaim).

Single derivations: worker `signals._position_state()` (authoritative, in KV) ·
web `positionState.simulatePositionState()` (reconcile recompute) · client
surfaces use the pipeline's own open-position sim (`st_open_return_pct`).
`alert-model.posStateOf()` maps state → labels for ALL narrative surfaces;
do not derive labels anywhere else. `/api/reconcile` cross-checks `inLong`
worker-vs-web daily.

## The vocabulary contract (enforced by tests)

- **"LONG" / "entry" / "entered" wording may only derive from `entryReady`
  (state) or `entry_buy` (event) or `entry_ready` (trade_log).** A raw flip
  below SMA50 renders as "flipped up · awaiting SMA50" / `[WAIT]` / "NO ENTRY".
- `entryReady := dir == "up" AND TT criterion c5 (Close > SMA50)`. Single
  derivations: worker `signals.py compute_ticker_state`, web
  `worker-events.ts entryReadyOf()`, trade_log `fill-command.ts entryReadyOfRecord()`.
- Trade-log records store the gate **at signal time**; live surfaces show it
  **now** — they may legitimately differ (e.g. META 2026-07-01).

## Rules for new development

1. **Read this file before touching any signal-adjacent code.**
2. Any new surface rendering stance/direction must state (in a code comment)
   which layer it displays, and gate LONG/entry wording per the contract above.
3. Any new surface must add a test: *below-SMA50 flip must not render as
   LONG/entry* (pattern: `alert-model.test.ts` "SMA50 entry gate",
   `telegram.test.ts` "[WAIT]", worker `test_gate.py`/`test_preflight.py`).
4. Strategy-definition changes (gate, params, exits) require updating THIS file
   in the same PR, plus the four-way sync rule (backtest.py / backtest.ts /
   pipeline.ts / supertrend_optimizer.ts) and the worker.
5. Runtime guard: `/api/reconcile` cross-checks worker vs web `entryReady`
   daily — a `[DRIFT] RECONCILE` Telegram alert means one side broke this spec.

## History (why this file exists)

2026-07-04 audit: all engines enforced the gate, but 5 alert/telemetry surfaces
(worker Telegram, EOD ACT ON THIS, AlertsPanel, trade_log, Morning Digest)
presented raw flips as entries — phantom 1211.HK/META "entries" reached the
trade log. Fixed in autopilot#11 + web#35/#36. The gap existed because this
definition lived only in code; hence this spec.
