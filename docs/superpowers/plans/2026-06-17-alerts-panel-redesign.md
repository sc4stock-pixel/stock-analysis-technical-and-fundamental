# Alerts Panel Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three competing Alerts sections with a single event model — a tight "Act on this" block, a collapsed audit log, and an info section — shared across the web panel and both Telegram surfaces.

**Architecture:** A new pure module `src/lib/alert-model.ts` exposes `buildAlertModel(workerEvents, tickers, clientResults, opts)` returning `{ actOnThis, auditLog, otherAlerts }`, plus a swappable `isActionable(row, heldSet?)` predicate. The web panel passes real worker/KV events (full reconciliation via the existing `reconcileWorkerEvents`); the Telegram builders pass `[]` and get client-stance framing only. Consumers become presentational.

**Tech Stack:** Next.js 14 (App Router), TypeScript, React, vitest. No new dependencies.

---

## Working Directory & Repo Rules (read before any task)

- **Edit the GitHub clone, not V16.1.** Per repo `CLAUDE.md`: clone fresh and work in `/tmp/stock-analysis-push`:
  ```bash
  rm -rf /tmp/stock-analysis-push
  gh repo clone <web-repo> /tmp/stock-analysis-push
  cd /tmp/stock-analysis-push && npm install
  ```
  All file paths below are relative to that clone. Never copy files wholesale between V16.1 and GitHub.
- **Verify with** `npm run build` **and** `npm test` **in `/tmp/stock-analysis-push`** — not in the local checkout.
- **Branch:** `git checkout -b feat/alerts-panel-redesign` before the first commit.
- **Telegram guardrails:** any dynamic string in a `<pre>` block must be `htmlEscape`d; strip `.HK` from tickers (`dispSym`) so Telegram doesn't auto-linkify. Both helpers already exist in `src/lib/telegram.ts`.
- **Non-finite floats:** any value read from JSON/KV must tolerate `NaN`/`Infinity` — guard before arithmetic. The model only consumes already-parsed in-memory objects, so this mainly applies to the route layer (unchanged here), but keep `Number.isFinite` guards on any price/score math added.
- **Visual verification is the user**, signed in, on the per-branch Vercel Preview (Clerk-gated). The agent cannot see the authed UI; it provides build/test/type proof only.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/lib/alert-model.ts` | Pure model: fold worker+client events into `actOnThis`, pass through `auditLog`, extract `otherAlerts`; `isActionable` predicate | **Create** |
| `src/lib/alert-model.test.ts` | vitest unit tests for the model | **Create** |
| `src/components/AlertsPanel.tsx` | Presentational 3-zone render of the model | **Modify** (gut `generateAlerts`/flip helpers; consume model) |
| `src/lib/telegram.ts` | `buildTelegramMessage` — add an "Act on this" block from the model (`workerEvents=[]`) | **Modify** |
| `src/lib/telegram-report.ts` | `buildEodReport` — add an "Act on this" section from the model (`workerEvents=[]`) | **Modify** |

Reused as-is: `src/lib/worker-events.ts` (`reconcileWorkerEvents`, `ReconciledEvent`), `src/lib/indicators.ts` (`supertrend`, `sma`), `src/types/worker-state.ts`.

---

## Phase 1 — Shared model module (`alert-model.ts`)

### Task 1: Scaffold types, constants, and `isActionable`

**Files:**
- Create: `src/lib/alert-model.ts`
- Test: `src/lib/alert-model.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { isActionable, type ActionableRow } from "./alert-model";

const row = (symbol: string): ActionableRow => ({
  symbol, arrow: "▼", stance: "out", change: "exited uptrend",
  barsSince: 1, whipsaw: false, severity: 1, source: "worker",
});

describe("isActionable", () => {
  it("returns true for any row when no heldSet is given (Option A stance basis)", () => {
    expect(isActionable(row("SPY"))).toBe(true);
  });
  it("filters to held tickers when a heldSet is given (Option B)", () => {
    const held = new Set(["AAPL"]);
    expect(isActionable(row("AAPL"), held)).toBe(true);
    expect(isActionable(row("SPY"), held)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/alert-model.test.ts -t isActionable`
Expected: FAIL — cannot find module `./alert-model`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { StockAnalysisResult } from "@/types";
import type { WorkerEvent, WorkerTickerState } from "@/types/worker-state";
import { reconcileWorkerEvents, type ReconciledEvent } from "@/lib/worker-events";
import { supertrend, sma } from "@/lib/indicators";

export const ACT_WINDOW_SESSIONS = 10;
export const FLIP_ALERT_DAYS = 3;

export type Stance = "long" | "out";

export interface ActionableRow {
  symbol: string;
  arrow: "▲" | "▼" | "↔";
  stance: Stance;
  change: string;        // "entered uptrend" | "exited uptrend" | "whipsawing · N flips/2wk"
  barsSince: number;     // freshness; 0 => TODAY pill
  whipsaw: boolean;
  rawCount?: number;     // raw events folded (whipsaw caption)
  ttFlag?: string;       // e.g. "+ TT 5→4"
  severity: number;      // sort key, lower = more urgent
  source: "worker" | "client";
}

export interface InfoAlert {
  icon: string;
  text: string;          // may contain <strong>…</strong>
  alertType: "score_buy" | "rsi_div" | "candlestick" | "correlation" | "reentry";
  symbol?: string;
}

export interface AlertModel {
  actOnThis: ActionableRow[];
  auditLog: ReconciledEvent[];
  otherAlerts: InfoAlert[];
}

export interface BuildOpts {
  heldSet?: Set<string>;
  actWindowSessions?: number;
  now?: Date;            // injectable for tests
}

/** Swappable actionability predicate. No heldSet => stance basis (Option A);
 *  heldSet => filter to held positions (Option B). */
export function isActionable(row: ActionableRow, heldSet?: Set<string>): boolean {
  return heldSet ? heldSet.has(row.symbol) : true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/alert-model.test.ts -t isActionable`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/alert-model.ts src/lib/alert-model.test.ts
git commit -m "feat(alerts): scaffold alert-model types + isActionable predicate"
```

---

### Task 2: Pure helpers — `daysAgo` and `clientFlip`

**Files:**
- Modify: `src/lib/alert-model.ts`
- Test: `src/lib/alert-model.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { daysAgo, clientFlip } from "./alert-model";
import type { StockAnalysisResult } from "@/types";

describe("daysAgo", () => {
  it("counts whole calendar days between barDate and now", () => {
    const now = new Date("2026-06-17T12:00:00+08:00");
    expect(daysAgo("2026-06-17", now)).toBe(0);
    expect(daysAgo("2026-06-12", now)).toBe(5);
  });
});

describe("clientFlip", () => {
  it("returns null flip when there are too few bars", () => {
    const r = { chart_bars: [] } as unknown as StockAnalysisResult;
    expect(clientFlip(r).flipType).toBeNull();
  });
  it("detects the most recent SuperTrend flip direction and bars since", () => {
    // synthetic: long downtrend then a sharp move up on the last 3 bars
    const bars = [
      ...Array.from({ length: 20 }, (_, i) => ({ high: 100 - i, low: 98 - i, close: 99 - i })),
      { high: 95, low: 90, close: 94 }, { high: 110, low: 94, close: 109 }, { high: 120, low: 108, close: 119 },
    ];
    const r = { chart_bars: bars, st_opt_params: { atrPeriod: 10, multiplier: 3.0 } } as unknown as StockAnalysisResult;
    const f = clientFlip(r);
    expect(f.flipType).toBe("BULLISH");
    expect(f.barsSince).toBeGreaterThanOrEqual(0);
    expect(f.barsSince).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/alert-model.test.ts -t "daysAgo|clientFlip"`
Expected: FAIL — `daysAgo`/`clientFlip` not exported.

- [ ] **Step 3: Write minimal implementation** (append to `src/lib/alert-model.ts`)

```ts
/** Whole calendar days between a YYYY-MM-DD barDate and `now`. */
export function daysAgo(barDate: string, now: Date = new Date()): number {
  const d0 = Date.parse(`${barDate}T00:00:00+08:00`);
  const d1 = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00+08:00`);
  if (!Number.isFinite(d0) || !Number.isFinite(d1)) return 999;
  return Math.max(0, Math.round((d1 - d0) / 86_400_000));
}

export interface ClientFlip {
  flipType: "BULLISH" | "BEARISH" | null;
  barsSince: number;
}

/** Most-recent SuperTrend flip from a result's own bars (client-stance gap-fill).
 *  Ported from the former computeOptimizedFlip in AlertsPanel. */
export function clientFlip(result: StockAnalysisResult): ClientFlip {
  const bars = result.chart_bars;
  if (!bars || bars.length < 2) return { flipType: null, barsSince: 999 };
  const atr = result.st_opt_params?.atrPeriod ?? 10;
  const mul = result.st_opt_params?.multiplier ?? 3.0;
  const [, dir] = supertrend(bars.map(b => b.high), bars.map(b => b.low), bars.map(b => b.close), atr, mul);
  if (dir.length < 2) return { flipType: null, barsSince: 999 };
  for (let i = dir.length - 1; i >= 1; i--) {
    if (dir[i] !== dir[i - 1]) {
      const barsSince = dir.length - 1 - i;
      return { flipType: dir[i] === 1 ? "BULLISH" : "BEARISH", barsSince };
    }
  }
  return { flipType: null, barsSince: 999 };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/alert-model.test.ts -t "daysAgo|clientFlip"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/alert-model.ts src/lib/alert-model.test.ts
git commit -m "feat(alerts): add daysAgo + clientFlip pure helpers"
```

---

### Task 3: `buildAlertModel` — worker actionable rows (fold, whipsaw, double-signal, severity)

**Files:**
- Modify: `src/lib/alert-model.ts`
- Test: `src/lib/alert-model.test.ts`

- [ ] **Step 1: Write the failing test** (reuses the worker-events fixture shape)

```ts
import { buildAlertModel } from "./alert-model";
import type { WorkerEvent, WorkerTickerState } from "@/types/worker-state";

const NOW = new Date("2026-06-17T12:00:00+08:00");

const wEvents: WorkerEvent[] = [
  { type: "flip_exit",   ticker: "SPY",     region: "us", session: "eod",      barDate: "2026-06-16", confirmed: true },
  { type: "flip_exit",   ticker: "MSFT",    region: "us", session: "eod",      barDate: "2026-06-16", confirmed: true },
  { type: "tt_stripped", ticker: "MSFT",    region: "us", session: "eod",      barDate: "2026-06-16", confirmed: true },
  { type: "flip_buy",    ticker: "3033.HK", region: "hk", session: "eod",      barDate: "2026-06-15", confirmed: true },
  { type: "flip_exit",   ticker: "3033.HK", region: "hk", session: "eod",      barDate: "2026-06-14", confirmed: true },
  { type: "flip_buy",    ticker: "3033.HK", region: "hk", session: "eod",      barDate: "2026-06-12", confirmed: true },
  { type: "flip_buy",    ticker: "0939.HK", region: "hk", session: "eod",      barDate: "2026-06-17", confirmed: true },
];
const wTickers = {
  "SPY": { dir: "down" }, "MSFT": { dir: "down" },
  "3033.HK": { dir: "down" }, "0939.HK": { dir: "up" },
} as unknown as Record<string, WorkerTickerState>;

describe("buildAlertModel — worker actionable rows", () => {
  const m = buildAlertModel(wEvents, wTickers, [], { now: NOW });
  const bySym = (s: string) => m.actOnThis.find(r => r.symbol === s)!;

  it("emits one folded row per ticker with a current flip in window", () => {
    expect(new Set(m.actOnThis.map(r => r.symbol))).toEqual(new Set(["SPY", "MSFT", "3033.HK", "0939.HK"]));
  });
  it("uses entered/exited uptrend copy from stance", () => {
    expect(bySym("0939.HK").change).toBe("entered uptrend");
    expect(bySym("SPY").change).toBe("exited uptrend");
    expect(bySym("0939.HK").stance).toBe("long");
    expect(bySym("SPY").stance).toBe("out");
  });
  it("folds a whipsawing ticker into one row with a flip count", () => {
    const r = bySym("3033.HK");
    expect(r.whipsaw).toBe(true);
    expect(r.arrow).toBe("↔");
    expect(r.change).toBe("whipsawing · 3 flips/2wk");
    expect(r.rawCount).toBe(3);
  });
  it("escalates a coincident TT strip into the flip row", () => {
    expect(bySym("MSFT").ttFlag).toBe("+ TT 5→4");
  });
  it("sorts by severity: double-signal/exits before entries", () => {
    const order = m.actOnThis.map(r => r.symbol);
    expect(order.indexOf("MSFT")).toBeLessThan(order.indexOf("0939.HK"));
    expect(order.indexOf("SPY")).toBeLessThan(order.indexOf("0939.HK"));
  });
  it("sets TODAY (barsSince 0) for a same-day flip", () => {
    expect(bySym("0939.HK").barsSince).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/alert-model.test.ts -t "worker actionable"`
Expected: FAIL — `buildAlertModel` not defined.

- [ ] **Step 3: Write minimal implementation** (append to `src/lib/alert-model.ts`)

```ts
const FLIP_SET = new Set<WorkerEvent["type"]>(["flip_buy", "flip_exit"]);

function ttFlagFor(events: ReconciledEvent[]): string | undefined {
  const stripped = events.find(e => e.type === "tt_stripped");
  if (stripped) return "+ TT 5→4";
  const regained = events.find(e => e.type === "tt_regained");
  if (regained) return "+ TT 4→5";
  return undefined;
}

function severityOf(stance: Stance, whipsaw: boolean, ttFlag?: string): number {
  if (stance === "out" && ttFlag) return 0; // double-signal exit — most urgent
  if (stance === "out" && !whipsaw) return 1;
  if (whipsaw) return 2;
  return 3;                                  // fresh entry — opportunity, last
}

function workerActionable(
  reconciled: ReconciledEvent[],
  tickers: Record<string, WorkerTickerState>,
  window: number,
  now: Date,
): ActionableRow[] {
  const byTicker = new Map<string, ReconciledEvent[]>();
  for (const e of reconciled) {
    const list = byTicker.get(e.ticker) ?? [];
    list.push(e);
    byTicker.set(e.ticker, list);
  }

  const rows: ActionableRow[] = [];
  byTicker.forEach((events, ticker) => {
    const liveFlip = events.find(e => e.current && FLIP_SET.has(e.type));
    if (!liveFlip) return;
    const since = daysAgo(liveFlip.barDate, now);
    if (since > window) return;

    const flips = events.filter(e => FLIP_SET.has(e.type) && daysAgo(e.barDate, now) <= window);
    const whipsaw = flips.length >= 3;
    const stance: Stance = tickers[ticker]?.dir === "up" ? "long" : "out";
    const ttFlag = ttFlagFor(events.filter(e => daysAgo(e.barDate, now) <= window));

    const change = whipsaw
      ? `whipsawing · ${flips.length} flips/2wk`
      : stance === "long" ? "entered uptrend" : "exited uptrend";
    const arrow: ActionableRow["arrow"] = whipsaw ? "↔" : stance === "long" ? "▲" : "▼";

    rows.push({
      symbol: ticker, arrow, stance, change, barsSince: since, whipsaw,
      rawCount: whipsaw ? flips.length : undefined,
      ttFlag, severity: severityOf(stance, whipsaw, ttFlag), source: "worker",
    });
  });
  return rows;
}

export function buildAlertModel(
  workerEvents: WorkerEvent[],
  tickers: Record<string, WorkerTickerState>,
  clientResults: StockAnalysisResult[],
  opts: BuildOpts = {},
): AlertModel {
  const window = opts.actWindowSessions ?? ACT_WINDOW_SESSIONS;
  const now = opts.now ?? new Date();
  const reconciled = reconcileWorkerEvents(workerEvents, tickers);

  let actOnThis = workerActionable(reconciled, tickers, window, now);
  actOnThis = actOnThis
    .filter(r => isActionable(r, opts.heldSet))
    .sort((a, b) => a.severity - b.severity || a.barsSince - b.barsSince);

  return { actOnThis, auditLog: reconciled, otherAlerts: [] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/alert-model.test.ts -t "worker actionable"`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/alert-model.ts src/lib/alert-model.test.ts
git commit -m "feat(alerts): buildAlertModel worker actionable rows (fold, whipsaw, double-signal, sort)"
```

---

### Task 4: `buildAlertModel` — client gap-fill + `otherAlerts` + audit passthrough

**Files:**
- Modify: `src/lib/alert-model.ts`
- Test: `src/lib/alert-model.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import type { StockAnalysisResult } from "@/types";

const longBars = (dirUpLast: boolean) => {
  const base = Array.from({ length: 20 }, (_, i) => ({ high: 60 + i, low: 58 + i, close: 59 + i }));
  const tail = dirUpLast
    ? [{ high: 95, low: 90, close: 94 }, { high: 110, low: 94, close: 109 }]
    : [{ high: 60, low: 40, close: 41 }, { high: 50, low: 30, close: 31 }];
  return [...base, ...tail];
};

describe("buildAlertModel — client gap-fill + otherAlerts + audit", () => {
  it("passes the full reconciled list through as auditLog", () => {
    const m = buildAlertModel(wEvents, wTickers, [], { now: NOW });
    expect(m.auditLog.length).toBe(reconcileWorkerEvents(wEvents, wTickers).length);
  });

  it("gap-fills a client flip only for tickers the worker did not report", () => {
    const results = [
      { symbol: "NVDA", exchange: "US", chart_bars: longBars(false),
        st_opt_params: { atrPeriod: 10, multiplier: 3.0 } },
      // SPY is already a worker ticker → must NOT be double-counted
      { symbol: "SPY", exchange: "US", chart_bars: longBars(false),
        st_opt_params: { atrPeriod: 10, multiplier: 3.0 } },
    ] as unknown as StockAnalysisResult[];
    const m = buildAlertModel(wEvents, wTickers, results, { now: NOW });
    const syms = m.actOnThis.filter(r => r.source === "client").map(r => r.symbol);
    expect(syms).toContain("NVDA");
    expect(syms).not.toContain("SPY");
  });

  it("routes RSI divergence into otherAlerts", () => {
    const results = [
      { symbol: "TSM", exchange: "US",
        backtest: { rsi_divergence_type: "Bearish" } },
    ] as unknown as StockAnalysisResult[];
    const m = buildAlertModel([], {}, results, { now: NOW });
    expect(m.otherAlerts.some(a => a.alertType === "rsi_div" && a.symbol === "TSM")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/alert-model.test.ts -t "client gap-fill"`
Expected: FAIL — gap-fill rows and otherAlerts not produced.

- [ ] **Step 3: Write minimal implementation**

Add a client gap-fill function and an otherAlerts extractor (ported from the former `generateAlerts` info branches in `AlertsPanel.tsx`), then wire them into `buildAlertModel`.

```ts
function clientActionable(
  results: StockAnalysisResult[],
  reportedTickers: Set<string>,
  now: Date,
): ActionableRow[] {
  const rows: ActionableRow[] = [];
  for (const r of results) {
    if (reportedTickers.has(r.symbol)) continue;          // worker is truth — no double-render
    const { flipType, barsSince } = clientFlip(r);
    if (!flipType || barsSince > FLIP_ALERT_DAYS) continue;
    const stance: Stance = flipType === "BULLISH" ? "long" : "out";
    rows.push({
      symbol: r.symbol,
      arrow: stance === "long" ? "▲" : "▼",
      stance,
      change: stance === "long" ? "entered uptrend" : "exited uptrend",
      barsSince, whipsaw: false,
      severity: severityOf(stance, false, undefined),
      source: "client",
    });
  }
  return rows;
}

function extractOtherAlerts(results: StockAnalysisResult[]): InfoAlert[] {
  const out: InfoAlert[] = [];
  for (const r of results) {
    const bt = r.backtest;
    if (bt?.rsi_divergence_type && bt.rsi_divergence_type !== "None") {
      out.push({ icon: "⚠️", text: `<strong>${r.symbol}</strong>: RSI ${bt.rsi_divergence_type} Divergence`,
        alertType: "rsi_div", symbol: r.symbol });
    }
    if (r.kelly?.correlated_with) {
      out.push({ icon: "🔗", text: `<strong>${r.symbol}</strong>: Correlated with ${r.kelly.correlated_with}`,
        alertType: "correlation", symbol: r.symbol });
    }
    const patterns = bt?.candlestick_patterns || [];
    const recent = patterns.filter(p =>
      (p.bar_index !== undefined && p.bar_index <= 3) ||
      (p.label === "Latest" || /^[1-3]d ago/.test(p.label ?? "")));
    const confirm: Record<string, string[]> = {
      BUY:  ["Hammer", "Inverted Hammer", "Bull Engulfing", "Bull Marubozu"],
      SELL: ["Shooting Star", "Bear Engulfing", "Bear Marubozu", "Hanging Man"],
    };
    const caution: Record<string, string[]> = {
      BUY:  ["Shooting Star", "Bear Engulfing", "Bear Marubozu", "Hanging Man"],
      SELL: ["Hammer", "Inverted Hammer", "Bull Engulfing", "Bull Marubozu"],
    };
    for (const p of recent) {
      const label = p.label === "Latest" ? "Today" : p.label || "";
      if ((confirm[r.signal] || []).includes(p.pattern)) {
        out.push({ icon: "✅", text: `<strong>${r.symbol}</strong>: ${p.pattern} (${label}) - Confirms ${r.signal}`,
          alertType: "candlestick", symbol: r.symbol });
      } else if ((caution[r.signal] || []).includes(p.pattern)) {
        out.push({ icon: "⚠️", text: `<strong>${r.symbol}</strong>: ${p.pattern} (${label}) - Caution on ${r.signal}`,
          alertType: "candlestick", symbol: r.symbol });
      }
    }
  }
  return out;
}
```

Then update `buildAlertModel`’s body (replace the `return`):

```ts
  const reportedTickers = new Set(workerEvents.map(e => e.ticker));
  const clientRows = clientActionable(clientResults, reportedTickers, now)
    .filter(r => isActionable(r, opts.heldSet));

  actOnThis = [...actOnThis, ...clientRows]
    .sort((a, b) => a.severity - b.severity || a.barsSince - b.barsSince);

  return { actOnThis, auditLog: reconciled, otherAlerts: extractOtherAlerts(clientResults) };
```

(Remove the earlier interim `sort`/`return` added in Task 3 so there is a single sort + return.)

- [ ] **Step 4: Run the full model suite**

Run: `npx vitest run src/lib/alert-model.test.ts`
Expected: PASS (all tasks 1–4).

- [ ] **Step 5: Commit**

```bash
git add src/lib/alert-model.ts src/lib/alert-model.test.ts
git commit -m "feat(alerts): client gap-fill, otherAlerts extraction, audit passthrough"
```

---

## Phase 2 — Web panel consumer

### Task 5: Rewire `AlertsPanel.tsx` to render the model (3 zones)

**Files:**
- Modify: `src/components/AlertsPanel.tsx`

- [ ] **Step 1: Delete the in-component logic now owned by the model**

Remove from `AlertsPanel.tsx`: `interface Alert`, `generateAlerts`, `computeOptimizedFlip`, `computeSMA50Reentry`, and the `alertRowStyle`/`renderText` helpers that only served the old `Alert` shape. Keep `workerEventRow` (audit row renderer) and `EVENT_META`.

- [ ] **Step 2: Build the model in the component**

```tsx
import { buildAlertModel, type ActionableRow } from "@/lib/alert-model";

export default function AlertsPanel({ results, workerState }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const model = useMemo(
    () => buildAlertModel(
      workerState?.events ?? [],
      workerState?.tickers ?? {},
      results,
    ),
    [results, workerState],
  );
  const { actOnThis, auditLog, otherAlerts } = model;
  const total = actOnThis.length + auditLog.length + otherAlerts.length;
  if (total === 0) return null;
```

- [ ] **Step 3: Render the three zones**

```tsx
  const hasExit = actOnThis.some(r => r.stance === "out");
  const pillCls = hasExit
    ? "bg-[#ff4757]/15 border-[#ff4757]/40 text-[#ff6b78]"
    : "bg-[#f59e0b]/15 border-[#f59e0b]/40 text-[#f59e0b]";

  return (
    <div className="bg-[#0f1629] border border-[#1e2d4a] rounded p-3 my-3">
      <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => setCollapsed(!collapsed)}>
        <div className="flex items-center gap-2">
          <span className="text-[#f59e0b] text-sm font-bold">⚡ ALERTS</span>
          <InfoTooltip id="alerts" />
          <span className="text-[#4a6080] text-xs">({total})</span>
          {actOnThis.length > 0 && (
            <span className={`text-[0.6rem] font-mono font-bold px-1.5 py-0.5 rounded border ${pillCls}`}>
              {actOnThis.length} TO ACT
            </span>
          )}
        </div>
        <span className="text-[#4a6080] text-xs">{collapsed ? "▼" : "▲"}</span>
      </div>

      {!collapsed && (
        <div className="mt-2">
          {actOnThis.length > 0 && (
            <div className="mb-3">
              <div className="text-[0.6rem] font-mono text-[#e6edf5] tracking-widest mb-1.5">ACT ON THIS</div>
              {actOnThis.map((r, i) => <ActRow key={`act-${i}`} r={r} />)}
            </div>
          )}

          {auditLog.length > 0 && (
            <details className="mb-3">
              <summary className="text-[0.6rem] font-mono text-[#00d4ff] tracking-widest cursor-pointer">
                RECENT DETECTIONS — full audit log ({auditLog.length})
              </summary>
              <div className="mt-1.5">{auditLog.map((ev, i) => workerEventRow(ev, i))}</div>
            </details>
          )}

          {otherAlerts.length > 0 && (
            <div>
              <div className="text-[0.6rem] font-mono text-[#4a6080] tracking-widest mb-1.5">OTHER ALERTS</div>
              <div className="space-y-1.5">
                {otherAlerts.map((a, i) => (
                  <div key={`info-${i}`} className="flex items-start gap-2 text-[0.7rem] border-b border-[#1e2d4a]/30 pb-1 last:border-0"
                       data-alert-type={a.alertType} data-symbol={a.symbol ?? ""}>
                    <span className="shrink-0 mt-0.5">{a.icon}</span>
                    <span>{a.text.split(/(<strong>.*?<\/strong>)/g).map((p, j) =>
                      p.startsWith("<strong>") ? <strong key={j}>{p.replace(/<\/?strong>/g, "")}</strong> : p)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add the `ActRow` presentational sub-component**

```tsx
function ActRow({ r }: { r: ActionableRow }) {
  const out = r.stance === "out";
  const border = r.whipsaw ? "border-[#ffa502]/34 bg-[#ffa502]/5"
    : out ? (r.ttFlag ? "border-[#ff4757]/55 bg-[#ff4757]/8" : "border-[#ff4757]/30 bg-[#ff4757]/5")
    : "border-[#00ff88]/30 bg-[#00ff88]/5";
  const arrowColor = r.whipsaw ? "text-[#ffa502]" : out ? "text-[#ff4757]" : "text-[#00ff88]";
  const pill = out ? "bg-[#ff4757]/15 text-[#ff6b78]" : "bg-[#00ff88]/14 text-[#3affa0]";
  return (
    <div className={`flex items-center gap-2 text-[0.7rem] rounded px-2 py-1.5 mb-1.5 border ${border}`}
         data-alert-type="flip" data-symbol={r.symbol} data-stance={r.stance} data-bars-since={r.barsSince}>
      <span className={`shrink-0 ${arrowColor}`}>{r.arrow}</span>
      <span className="font-mono font-bold text-[#e6edf5]">{r.symbol.replace(".HK", "")}</span>
      <span className="text-[#8aa0bd]">
        {r.change}
        {r.ttFlag && <span className="ml-1 font-mono text-[0.6rem] px-1 py-0.5 rounded bg-[#ffa502]/18 border border-[#ffa502]/45 text-[#ffa502]">{r.ttFlag}</span>}
      </span>
      <span className="flex-1" />
      {r.barsSince === 0
        ? <span className="font-mono text-[0.55rem] font-bold px-1 py-0.5 rounded bg-[#f59e0b]/20 border border-[#f59e0b]/40 text-[#f59e0b]">TODAY</span>
        : <span className="font-mono text-[0.6rem] text-[#6b82a3]">{r.barsSince}d</span>}
      <span className={`font-mono text-[0.6rem] font-medium px-1.5 py-0.5 rounded ${pill}`}>
        {out ? "OUT · ST↓" : "LONG · ST↑"}
      </span>
    </div>
  );
}
```

(If `r.whipsaw`, also render the `rawCount` caption line below the row, mirroring the prototype.)

- [ ] **Step 5: Build + type check**

Run: `npm run build`
Expected: compiles with no type errors. If `data-stance` etc. trip lint, they are valid DOM data-attrs — no action needed.

- [ ] **Step 6: Commit**

```bash
git add src/components/AlertsPanel.tsx
git commit -m "feat(alerts): rewire web panel to 3-zone model (Act on this / audit / other)"
```

- [ ] **Step 7: Visual verification (user)**

Push the branch; the user opens the per-branch Vercel Preview (signed in) and confirms: Act-on-this ordering, whipsaw fold, TODAY pill, MSFT double-signal emphasis, audit log collapsed-by-default, no ticker rendered twice.

---

## Phase 3 — Telegram exec alert (client-stance, no plumbing)

### Task 6: Add an "Act on this" block to `buildTelegramMessage`

**Files:**
- Modify: `src/lib/telegram.ts`

- [ ] **Step 1: Import the model**

```ts
import { buildAlertModel } from "@/lib/alert-model";
```

- [ ] **Step 2: Build a client-stance model and render the block**

Inside `buildTelegramMessage`, after `valid` is computed, before the existing tier sections:

```ts
  // Act-on-this — client-stance (Engine A has no worker events → pass []).
  const actModel = buildAlertModel([], {}, valid as StockAnalysisResult[]);
  const actRows = actModel.actOnThis;
  let actBlock = "";
  if (actRows.length > 0) {
    const rows = actRows.map(r => {
      const sym = dispSym(r.symbol).padEnd(6);
      const tag = r.stance === "out" ? "OUT" : "LONG";
      const when = r.barsSince === 0 ? "today" : `${r.barsSince}d`;
      const tt = r.ttFlag ? ` ${r.ttFlag}` : "";          // "+ TT 5->4" — '>' escaped by preBlock
      return `${sym} ${r.change}${tt} (${when}) [${tag}]`;
    });
    actBlock = `\n⚡ <b>ACT ON THIS</b>\n${preBlock(rows)}`;
  }
```

Note: `preBlock` already `htmlEscape`s, so the `→` in `TT 5→4` is fine and any `>`/`<` are escaped. Replace the `→` arrow with `->` inside Telegram rows to avoid relying on emoji-width in monospace (keep `→` only on web).

- [ ] **Step 3: Insert `actBlock` into the message**

Place `actBlock` immediately after the `dataState` line in the assembled message string (top of the body, since exits are the most actionable). Confirm the final `return` concatenates it.

- [ ] **Step 4: Build + type check**

Run: `npm run build`
Expected: compiles. Verify no `StockAnalysisResult` import is missing (already imported at top of `telegram.ts`).

- [ ] **Step 5: Unit test the row text (no live send)**

Add `src/lib/telegram.test.ts` (or extend if present):

```ts
import { describe, it, expect } from "vitest";
import { buildTelegramMessage } from "./telegram";
// Provide a minimal valid result with a fresh bearish flip in chart_bars;
// assert the message contains "ACT ON THIS" and "exited uptrend" and that
// ".HK" is stripped from any HK symbol in the block.
```

Run: `npx vitest run src/lib/telegram.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/telegram.ts src/lib/telegram.test.ts
git commit -m "feat(alerts): Act-on-this block in Telegram exec alert (client-stance)"
```

---

## Phase 4 — Telegram EOD report

### Task 7: Add an "Act on this" section to `buildEodReport`

**Files:**
- Modify: `src/lib/telegram-report.ts`

- [ ] **Step 1: Import and build the model**

```ts
import { buildAlertModel } from "@/lib/alert-model";
```

Inside `buildEodReport`, after `valid` is computed:

```ts
  const actRows = buildAlertModel([], {}, valid as unknown as StockAnalysisResult[]).actOnThis;
```

- [ ] **Step 2: Render the section near the top (replaces/augments RECENT FLIPS)**

```ts
  if (actRows.length > 0) {
    lines.push(`\n⚡ <b>ACT ON THIS</b>`);
    actRows.forEach(r => {
      const tag = r.stance === "out" ? "🔴 OUT" : "🟢 LONG";
      const when = r.barsSince === 0 ? "today" : `${r.barsSince}d ago`;
      const tt = r.ttFlag ? ` ${htmlEscape(r.ttFlag.replace("→", "->"))}` : "";
      lines.push(`  • <b>${htmlEscape(dispSymForReport(r.symbol))}</b> ${r.change}${tt} (${when}) — ${tag}`);
    });
  }
```

If `telegram-report.ts` lacks a `.HK`-stripping helper, add one mirroring `dispSym`:
```ts
const dispSymForReport = (s: string) => s.replace(".HK", "");
```

- [ ] **Step 3: De-dupe with the existing `RECENT FLIPS` block**

The existing `recentFlips` block (lines ~261–270) overlaps "Act on this". Replace `RECENT FLIPS` with the new section (the model already captures recent flips), OR keep `RECENT FLIPS` but drop tickers already shown in `actRows`. Recommended: replace, to avoid the same double-render this whole effort removes.

- [ ] **Step 4: Build + type check**

Run: `npm run build`
Expected: compiles.

- [ ] **Step 5: Unit test the section**

Extend `src/lib/telegram-report.test.ts` (or create): assert `buildEodReport` output contains `ACT ON THIS` and that a fresh bearish flip renders `exited uptrend … 🔴 OUT`, `.HK` stripped.

Run: `npx vitest run src/lib/telegram-report.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/telegram-report.ts src/lib/telegram-report.test.ts
git commit -m "feat(alerts): Act-on-this section in Telegram EOD report (client-stance)"
```

---

## Phase 5 — Final verification

### Task 8: Full build, test, and cross-surface sanity

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all green, including the new `alert-model`, `telegram`, and `telegram-report` tests.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: build succeeds, no type errors.

- [ ] **Step 3: Cross-surface copy parity check (manual grep)**

Run: `grep -rn "entered uptrend\|exited uptrend\|whipsawing" src/lib src/components`
Expected: the copy strings originate only in `alert-model.ts`; consumers render `r.change` (no surface hardcodes its own wording).

- [ ] **Step 4: Push branch for the user’s visual + Telegram smoke test**

```bash
git push -u origin feat/alerts-panel-redesign
```

The user verifies the Vercel Preview (web) and triggers a Telegram smoke test via the existing webhook/`/check` path. Do not merge until the user confirms.

---

## Self-Review (completed by plan author)

**Spec coverage:** §4 zones → Task 5; §5 actionability + fold + window + B-ready → Tasks 1,3,4; §6 dedup → Task 4 (`reportedTickers`); §7 module + tests → Tasks 1–4; §8 per-surface (corrected: Telegram client-stance) → Tasks 6,7; §9 visual/copy → Task 5 + locked copy in Tasks 3–4; §10 Python deferred → not in plan (correct); §11 edge cases (provisional-only, reverted, stale window) → covered by reusing `reconcileWorkerEvents` + window gate; §12 testing → Tasks 1–8.

**Placeholder scan:** Tasks 6/7 Step 5 reference test bodies described rather than fully written — the surrounding assertions are specified (strings to assert, `.HK` stripping); acceptable as they test rendered text, but the executor should write the literal fixture. Flagged, not a logic gap.

**Type consistency:** `ActionableRow`, `Stance`, `InfoAlert`, `AlertModel`, `BuildOpts`, `buildAlertModel(workerEvents, tickers, clientResults, opts)`, `isActionable(row, heldSet?)`, `clientFlip`, `daysAgo` — names consistent across Tasks 1–7. `severityOf`/`ttFlagFor`/`workerActionable`/`clientActionable`/`extractOtherAlerts` are private helpers, used only where defined.
