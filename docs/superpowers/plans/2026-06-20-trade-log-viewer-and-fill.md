# Trade-log viewer + Telegram `/fill` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a web viewer for the autopilot `trade_log` KV key and a Telegram `/fill` command that records actual fills, surfacing signal-vs-execution slippage.

**Architecture:** Approach C (surgical split) — the Python worker stays sole author of `trade_log` record creation/pairing; the web app only *reads* the log (`/api/trades` + `TradeLogPanel`) and *patches the two reserved fill fields* (`/fill` → `actual_fill_price`/`actual_fill_date`). Slippage is derived on read by a single shared helper (`src/lib/slippage.ts`) used by both the panel and the `/fill` echo.

**Tech Stack:** Next.js (App Router) · TypeScript · React client components · Vercel KV (REST) · Telegram Bot API · vitest.

**Spec:** `docs/superpowers/specs/2026-06-20-trade-log-viewer-and-fill-design.md`

---

## File Structure

- `src/types/trade-log.ts` (new) — `TradeLogRecord` interface mirroring the Python schema.
- `src/lib/slippage.ts` (new) — `computeSlippage`, `slippageLabel`, `summarize`. Single source of truth.
- `src/lib/slippage.test.ts` (new) — unit tests for the above.
- `src/lib/fill-command.ts` (new) — pure helpers: `parseFillCommand`, `selectFillTarget`, `applyFill`, `stripNaN`. Keeps the route thin and testable.
- `src/lib/fill-command.test.ts` (new) — unit tests for the above.
- `src/app/api/trades/route.ts` (new) — GET, reads `trade_log` from KV (mirrors `/api/state`).
- `src/app/api/trades/route.test.ts` (new) — unit test mocking `fetch`.
- `src/components/TradeLogPanel.tsx` (new) — summary block + table. Uses app default font (no monospace).
- `src/app/page.tsx` (modify) — fetch `/api/trades`, render `<TradeLogPanel>`.
- `src/app/api/telegram-bot/route.ts` (modify) — add `/fill` dispatch + handler (auth, KV read/patch/write, echo).

**Test runner:** `npm test` runs `vitest run`. Run a single file with `npx vitest run <path>`.

---

### Task 1: `TradeLogRecord` type

**Files:**
- Create: `src/types/trade-log.ts`

- [ ] **Step 1: Create the type file**

```typescript
// One record in the KV "trade_log" array, authored by the autopilot worker
// (worker/trade_log.py). The web app reads all fields and patches only
// actual_fill_price / actual_fill_date via the Telegram /fill command.
export interface TradeLogRecord {
  id: string;                 // `${ticker}|${date}|${type}`
  date: string;               // signal bar date, YYYY-MM-DD
  logged_at: string;
  session: "eod" | "intraday";
  confirmed: boolean;
  ticker: string;
  region: string;             // UPPERCASE
  type: "entry" | "exit";
  direction: "long";
  signal_price: number | null;
  stop: number | null;
  atr_period: number | null;
  multiplier: number | null;
  params_source: string | null; // "optimized" | "default_fallback" | ...
  tt_score: number | null;
  criteria: boolean[] | null;
  sma_stack: string | null;
  piotroski_f: number | null;
  altman_z: number | null;
  z_variant: string | null;
  op_margin: number[];
  actual_fill_price: number | null;
  actual_fill_date: string | null;
  // present on exit records (added by pair_exit in the worker)
  entry_id?: string | null;
  signal_return_pct?: number | null;
  hold_days?: number | null;
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `trade-log.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/types/trade-log.ts
git commit -m "feat: TradeLogRecord type for trade_log KV schema"
```

---

### Task 2: `slippage.ts` shared helper (TDD)

**Files:**
- Create: `src/lib/slippage.ts`
- Test: `src/lib/slippage.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { computeSlippage, slippageLabel, summarize } from "./slippage";
import type { TradeLogRecord } from "@/types/trade-log";

function rec(p: Partial<TradeLogRecord>): TradeLogRecord {
  return {
    id: "X|2026-01-01|entry", date: "2026-01-01", logged_at: "2026-01-01",
    session: "eod", confirmed: true, ticker: "X", region: "US", type: "entry",
    direction: "long", signal_price: 100, stop: null, atr_period: null,
    multiplier: null, params_source: "optimized", tt_score: null, criteria: null,
    sma_stack: null, piotroski_f: null, altman_z: null, z_variant: null,
    op_margin: [], actual_fill_price: null, actual_fill_date: null, ...p,
  };
}

describe("computeSlippage", () => {
  it("returns null when unfilled", () => {
    expect(computeSlippage(rec({}))).toBeNull();
  });
  it("entry filled above signal is adverse", () => {
    const s = computeSlippage(rec({ type: "entry", signal_price: 100, actual_fill_price: 102 }))!;
    expect(s.slippagePct).toBeCloseTo(2, 6);
    expect(s.adverse).toBe(true);
  });
  it("entry filled below signal is favorable", () => {
    const s = computeSlippage(rec({ type: "entry", signal_price: 100, actual_fill_price: 99 }))!;
    expect(s.adverse).toBe(false);
  });
  it("exit filled below signal is adverse", () => {
    const s = computeSlippage(rec({ type: "exit", signal_price: 100, actual_fill_price: 98 }))!;
    expect(s.slippagePct).toBeCloseTo(-2, 6);
    expect(s.adverse).toBe(true);
  });
  it("exit filled above signal is favorable", () => {
    const s = computeSlippage(rec({ type: "exit", signal_price: 100, actual_fill_price: 101 }))!;
    expect(s.adverse).toBe(false);
  });
  it("returns null on non-finite or zero signal", () => {
    expect(computeSlippage(rec({ signal_price: 0, actual_fill_price: 5 }))).toBeNull();
    expect(computeSlippage(rec({ signal_price: NaN, actual_fill_price: 5 }))).toBeNull();
    expect(computeSlippage(rec({ signal_price: 100, actual_fill_price: Infinity }))).toBeNull();
  });
});

describe("slippageLabel", () => {
  it("labels adverse and favorable", () => {
    expect(slippageLabel(rec({ type: "entry", signal_price: 100, actual_fill_price: 102 }))).toContain("adverse");
    expect(slippageLabel(rec({ type: "entry", signal_price: 100, actual_fill_price: 98 }))).toContain("favorable");
  });
  it("dash when unfilled", () => {
    expect(slippageLabel(rec({}))).toBe("—");
  });
});

describe("summarize", () => {
  it("counts, averages, and splits by params_source", () => {
    const recs = [
      rec({ type: "entry", signal_price: 100, actual_fill_price: 102, params_source: "default_fallback" }), // +2, adverse
      rec({ type: "entry", signal_price: 100, actual_fill_price: 99, params_source: "optimized" }),          // -1, favorable
      rec({ type: "exit", signal_price: 50, actual_fill_price: null, params_source: "optimized" }),          // unfilled
    ];
    const s = summarize(recs);
    expect(s.filled).toBe(2);
    expect(s.unfilled).toBe(1);
    expect(s.avgPct).toBeCloseTo(0.5, 6);
    expect(s.medianPct).toBeCloseTo(0.5, 6);
    expect(s.pctAdverse).toBeCloseTo(50, 6);
    expect(s.byParamsSource.default_fallback.filled).toBe(1);
    expect(s.byParamsSource.default_fallback.pctAdverse).toBeCloseTo(100, 6);
    expect(s.byParamsSource.optimized.filled).toBe(1);
    expect(s.byParamsSource.optimized.pctAdverse).toBeCloseTo(0, 6);
  });
  it("handles an all-unfilled log without NaN", () => {
    const s = summarize([rec({})]);
    expect(s.filled).toBe(0);
    expect(s.avgPct).toBeNull();
    expect(s.medianPct).toBeNull();
    expect(s.pctAdverse).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/slippage.test.ts`
Expected: FAIL — cannot resolve `./slippage`.

- [ ] **Step 3: Write the implementation**

```typescript
import type { TradeLogRecord } from "@/types/trade-log";

export interface Slippage {
  slippagePct: number; // signed raw: (fill/signal - 1) * 100, 4dp
  adverse: boolean;    // true = worse execution than signal
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export function computeSlippage(r: TradeLogRecord): Slippage | null {
  const sig = r.signal_price;
  const fill = r.actual_fill_price;
  if (!finite(sig) || sig === 0 || !finite(fill)) return null;
  const slippagePct = Math.round((fill / sig - 1) * 1e6) / 1e4;
  const adverse = r.type === "entry" ? fill > sig : fill < sig;
  return { slippagePct, adverse };
}

export function slippageLabel(r: TradeLogRecord): string {
  const s = computeSlippage(r);
  if (!s) return "—";
  const sign = s.slippagePct >= 0 ? "+" : "";
  return `${sign}${s.slippagePct.toFixed(2)}% (${s.adverse ? "adverse" : "favorable"})`;
}

interface Agg {
  filled: number;
  unfilled: number;
  avgPct: number | null;
  medianPct: number | null;
  pctAdverse: number | null;
}

function aggregate(recs: TradeLogRecord[]): Agg {
  const slips = recs.map(computeSlippage).filter((s): s is Slippage => s !== null);
  const filled = slips.length;
  const unfilled = recs.length - filled;
  if (filled === 0) {
    return { filled: 0, unfilled, avgPct: null, medianPct: null, pctAdverse: null };
  }
  const pcts = slips.map((s) => s.slippagePct).sort((a, b) => a - b);
  const avgPct = pcts.reduce((a, b) => a + b, 0) / filled;
  const mid = Math.floor(filled / 2);
  const medianPct = filled % 2 ? pcts[mid] : (pcts[mid - 1] + pcts[mid]) / 2;
  const pctAdverse = (slips.filter((s) => s.adverse).length / filled) * 100;
  return {
    filled,
    unfilled,
    avgPct: Math.round(avgPct * 1e4) / 1e4,
    medianPct: Math.round(medianPct * 1e4) / 1e4,
    pctAdverse: Math.round(pctAdverse * 1e4) / 1e4,
  };
}

export interface TradeLogSummary extends Agg {
  byParamsSource: Record<string, Agg>;
}

export function summarize(recs: TradeLogRecord[]): TradeLogSummary {
  const bySrc: Record<string, TradeLogRecord[]> = {};
  for (const r of recs) {
    const key = r.params_source ?? "unknown";
    (bySrc[key] ??= []).push(r);
  }
  const byParamsSource: Record<string, Agg> = {};
  for (const [key, list] of Object.entries(bySrc)) byParamsSource[key] = aggregate(list);
  return { ...aggregate(recs), byParamsSource };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/slippage.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/slippage.ts src/lib/slippage.test.ts
git commit -m "feat: slippage helper (compute, label, summarize) with params_source split"
```

---

### Task 3: `/api/trades` route (TDD)

**Files:**
- Create: `src/app/api/trades/route.ts`
- Test: `src/app/api/trades/route.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("/api/trades GET", () => {
  beforeEach(() => {
    process.env.KV_REST_API_URL = "https://kv.example";
    process.env.KV_REST_API_TOKEN = "tok";
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns parsed trade_log array", async () => {
    const arr = [{ id: "X|2026-01-01|entry", ticker: "X" }];
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ result: JSON.stringify(arr) }), { status: 200 })));
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(arr);
  });

  it("strips bare NaN before parse", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ result: '[{"id":"a","signal_price":NaN}]' }), { status: 200 })));
    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "a", signal_price: null }]);
  });

  it("returns [] when key empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ result: null }), { status: 200 })));
    const { GET } = await import("./route");
    expect(await (await GET()).json()).toEqual([]);
  });

  it("503 when KV not configured", async () => {
    delete process.env.KV_REST_API_URL;
    const { GET } = await import("./route");
    expect((await GET()).status).toBe(503);
  });
});
```

> Note: `route.ts` reads `process.env` inside the handler (not at module top) so the per-test env changes above take effect.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/trades/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Write the route**

```typescript
import { NextResponse } from "next/server";
import type { TradeLogRecord } from "@/types/trade-log";

export const dynamic = "force-dynamic";

// Reader NaN guardrail (CLAUDE.md): bare NaN parses in Python json but throws
// in JS JSON.parse. Strip to null before parsing.
function parseTradeLog(raw: string): TradeLogRecord[] {
  const safe = raw.replace(/\bNaN\b/g, "null").replace(/\b-?Infinity\b/g, "null");
  return JSON.parse(safe) as TradeLogRecord[];
}

export async function GET() {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) {
    return NextResponse.json({ error: "KV not configured" }, { status: 503 });
  }
  try {
    const res = await fetch(`${kvUrl}/get/trade_log`, {
      headers: { Authorization: `Bearer ${kvToken}` },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ error: `KV error ${res.status}` }, { status: 502 });
    }
    const { result } = (await res.json()) as { result: string | null };
    if (!result) return NextResponse.json([]);
    return NextResponse.json(parseTradeLog(result));
  } catch (e) {
    console.error("[/api/trades]", e);
    return NextResponse.json({ error: "Failed to read trade_log" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/trades/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/trades/route.ts src/app/api/trades/route.test.ts
git commit -m "feat: /api/trades route reads trade_log from KV (NaN-safe)"
```

---

### Task 4: `TradeLogPanel` component

**Files:**
- Create: `src/components/TradeLogPanel.tsx`

> No unit test: existing panels (`OpenPositionsPanel`, `AlertsPanel`) have none; verification is `tsc` + build + visual on the signed-in Vercel Preview. All numeric/label logic lives in the tested `slippage.ts`.

- [ ] **Step 1: Write the component**

```tsx
"use client";
import { useState, useMemo } from "react";
import type { TradeLogRecord } from "@/types/trade-log";
import { computeSlippage, summarize } from "@/lib/slippage";

interface Props {
  records: TradeLogRecord[];
}

type SortKey = "date" | "ticker" | "slippage";

export default function TradeLogPanel({ records }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [asc, setAsc] = useState(false);

  const summary = useMemo(() => summarize(records), [records]);

  const sorted = useMemo(() => {
    const copy = [...records];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "ticker") cmp = a.ticker.localeCompare(b.ticker);
      else if (sortKey === "slippage") {
        const sa = computeSlippage(a)?.slippagePct ?? -Infinity;
        const sb = computeSlippage(b)?.slippagePct ?? -Infinity;
        cmp = sa - sb;
      } else cmp = a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker);
      return asc ? cmp : -cmp;
    });
    return copy;
  }, [records, sortKey, asc]);

  if (records.length === 0) return null;

  const setSort = (k: SortKey) => {
    if (k === sortKey) setAsc(!asc);
    else { setSortKey(k); setAsc(false); }
  };

  const fmtPct = (n: number | null) => (n === null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);

  return (
    <section className="trade-log-panel">
      <h2>Trade log — execution attribution</h2>

      <div className="tl-summary">
        <div><span className="tl-label">Filled</span><span className="tl-val">{summary.filled} / {summary.filled + summary.unfilled}</span></div>
        <div><span className="tl-label">Avg slippage</span><span className="tl-val">{fmtPct(summary.avgPct)}</span></div>
        <div><span className="tl-label">Median</span><span className="tl-val">{fmtPct(summary.medianPct)}</span></div>
        <div><span className="tl-label">% adverse</span><span className="tl-val">{summary.pctAdverse === null ? "—" : `${summary.pctAdverse.toFixed(0)}%`}</span></div>
      </div>

      <div className="tl-split">
        {(["optimized", "default_fallback"] as const).map((src) => {
          const a = summary.byParamsSource[src];
          if (!a) return null;
          return (
            <div key={src} className="tl-split-card">
              <div className="tl-label">params_source: {src}</div>
              <div className="tl-val">{fmtPct(a.avgPct)} <span className="tl-sub">avg · {a.filled} filled · {a.pctAdverse === null ? "—" : `${a.pctAdverse.toFixed(0)}%`} adverse</span></div>
            </div>
          );
        })}
      </div>

      <table className="tl-table">
        <thead>
          <tr>
            <th onClick={() => setSort("date")}>date</th>
            <th onClick={() => setSort("ticker")}>ticker</th>
            <th>type</th>
            <th>signal</th>
            <th>fill</th>
            <th onClick={() => setSort("slippage")}>slippage</th>
            <th>source</th>
            <th>tt</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const s = computeSlippage(r);
            return (
              <tr key={r.id}>
                <td>{r.date}</td>
                <td>{r.ticker}</td>
                <td>{r.type}</td>
                <td>{r.signal_price ?? "—"}</td>
                <td>{r.actual_fill_price ?? "—"}</td>
                <td className={s ? (s.adverse ? "tl-adverse" : "tl-favorable") : "tl-muted"}>
                  {s ? `${s.slippagePct >= 0 ? "+" : ""}${s.slippagePct.toFixed(2)}%` : "—"}
                </td>
                <td>{r.params_source ?? "—"}</td>
                <td>{r.tt_score ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 2: Style to match existing panels**

Open `src/components/OpenPositionsPanel.tsx` and the project's stylesheet (search for how `OpenPositionsPanel`'s table/classes are styled — Tailwind classes or a CSS module). Match that mechanism: if the repo uses Tailwind utility classes inline, replace the `className` strings above with the same utilities used in `OpenPositionsPanel`; if it uses global CSS, add the `.trade-log-panel` rules alongside the existing panel rules. Use the app's default font (no monospace). Color `.tl-adverse` with the danger color and `.tl-favorable` with the success color already used elsewhere (grep `OpenPositionsPanel` for the pnl up/down color classes and reuse them).

- [ ] **Step 3: Verify type-check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: build succeeds (a dummy Clerk key may be required per repo README/CLAUDE.md — set the documented build-time env var if build complains about Clerk).

- [ ] **Step 4: Commit**

```bash
git add src/components/TradeLogPanel.tsx
git commit -m "feat: TradeLogPanel viewer (summary + params_source split + table)"
```

---

### Task 5: Wire panel into the dashboard

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Add the fetch + state (mirror the /api/state useEffect)**

Near the `workerState` state + its `useEffect` (around `src/app/page.tsx:76` and `:97`), add:

```tsx
import TradeLogPanel from "@/components/TradeLogPanel";
import type { TradeLogRecord } from "@/types/trade-log";
```

```tsx
const [tradeLog, setTradeLog] = useState<TradeLogRecord[]>([]);

useEffect(() => {
  fetch("/api/trades")
    .then((r) => (r.ok ? r.json() : []))
    .then((d) => setTradeLog(Array.isArray(d) ? d : []))
    .catch(() => setTradeLog([]));
}, []);
```

- [ ] **Step 2: Render the panel near OpenPositionsPanel**

Below the `<OpenPositionsPanel ... />` render (around `src/app/page.tsx:562`), add:

```tsx
<TradeLogPanel records={tradeLog} />
```

- [ ] **Step 3: Verify type-check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: render TradeLogPanel on dashboard"
```

---

### Task 6: `/fill` pure helpers (TDD)

**Files:**
- Create: `src/lib/fill-command.ts`
- Test: `src/lib/fill-command.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { parseFillCommand, selectFillTarget, applyFill, stripNaN } from "./fill-command";
import type { TradeLogRecord } from "@/types/trade-log";

function rec(p: Partial<TradeLogRecord>): TradeLogRecord {
  return {
    id: "X|2026-01-01|entry", date: "2026-01-01", logged_at: "2026-01-01",
    session: "eod", confirmed: true, ticker: "X", region: "US", type: "entry",
    direction: "long", signal_price: 100, stop: null, atr_period: null,
    multiplier: null, params_source: "optimized", tt_score: null, criteria: null,
    sma_stack: null, piotroski_f: null, altman_z: null, z_variant: null,
    op_margin: [], actual_fill_price: null, actual_fill_date: null, ...p,
  };
}

describe("parseFillCommand", () => {
  it("bare /fill → list mode", () => {
    expect(parseFillCommand("/fill")).toEqual({ mode: "list" });
  });
  it("ticker + price", () => {
    expect(parseFillCommand("/fill 3033.HK 4.58")).toEqual({
      mode: "fill", selector: { kind: "ticker", ticker: "3033.HK" }, price: 4.58, date: null });
  });
  it("ticker + price + date", () => {
    expect(parseFillCommand("/fill 3033.HK 4.58 2026-06-12")).toEqual({
      mode: "fill", selector: { kind: "ticker", ticker: "3033.HK" }, price: 4.58, date: "2026-06-12" });
  });
  it("explicit id (has |) + price", () => {
    expect(parseFillCommand("/fill 3033.HK|2026-06-12|entry 4.58")).toEqual({
      mode: "fill", selector: { kind: "id", id: "3033.HK|2026-06-12|entry" }, price: 4.58, date: null });
  });
  it("invalid price → error", () => {
    expect(parseFillCommand("/fill 3033.HK abc")).toEqual({ mode: "error", reason: "price" });
  });
  it("invalid date → error", () => {
    expect(parseFillCommand("/fill 3033.HK 4.5 6/12")).toEqual({ mode: "error", reason: "date" });
  });
  it("non-positive price → error", () => {
    expect(parseFillCommand("/fill 3033.HK 0")).toEqual({ mode: "error", reason: "price" });
  });
});

describe("selectFillTarget", () => {
  const log = [
    rec({ id: "A|2026-06-10|entry", ticker: "A", date: "2026-06-10" }),
    rec({ id: "A|2026-06-12|exit", ticker: "A", date: "2026-06-12", type: "exit" }),
    rec({ id: "B|2026-06-11|entry", ticker: "B", date: "2026-06-11", actual_fill_price: 5 }), // filled
  ];
  it("by id", () => {
    expect(selectFillTarget(log, { kind: "id", id: "A|2026-06-10|entry" })).toEqual({ kind: "one", id: "A|2026-06-10|entry" });
  });
  it("by id not found", () => {
    expect(selectFillTarget(log, { kind: "id", id: "Z|x|entry" })).toEqual({ kind: "none" });
  });
  it("ticker with multiple unfilled → ambiguous", () => {
    const r = selectFillTarget(log, { kind: "ticker", ticker: "A" });
    expect(r.kind).toBe("ambiguous");
  });
  it("ticker with one unfilled → one", () => {
    const single = [rec({ id: "C|2026-06-10|entry", ticker: "C" })];
    expect(selectFillTarget(single, { kind: "ticker", ticker: "C" })).toEqual({ kind: "one", id: "C|2026-06-10|entry" });
  });
  it("ticker all filled → none", () => {
    expect(selectFillTarget(log, { kind: "ticker", ticker: "B" })).toEqual({ kind: "none" });
  });
});

describe("applyFill", () => {
  it("patches only fill fields by id, preserves others, trailing-slices", () => {
    const log = [rec({ id: "A|2026-06-10|entry", ticker: "A", signal_price: 100 })];
    const out = applyFill(log, "A|2026-06-10|entry", 102, "2026-06-12");
    expect(out[0].actual_fill_price).toBe(102);
    expect(out[0].actual_fill_date).toBe("2026-06-12");
    expect(out[0].signal_price).toBe(100); // untouched
  });
  it("throws on non-finite price", () => {
    const log = [rec({ id: "A|2026-06-10|entry" })];
    expect(() => applyFill(log, "A|2026-06-10|entry", NaN, "2026-06-12")).toThrow();
  });
});

describe("stripNaN", () => {
  it("replaces bare NaN/Infinity with null", () => {
    expect(stripNaN('[{"a":NaN,"b":-Infinity,"c":1}]')).toBe('[{"a":null,"b":null,"c":1}]');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/fill-command.test.ts`
Expected: FAIL — cannot resolve `./fill-command`.

- [ ] **Step 3: Write the implementation**

```typescript
import type { TradeLogRecord } from "@/types/trade-log";

const MAX_ENTRIES = 500; // mirror worker/trade_log.py

export type FillSelector =
  | { kind: "id"; id: string }
  | { kind: "ticker"; ticker: string };

export type FillCommand =
  | { mode: "list" }
  | { mode: "error"; reason: "price" | "date" | "usage" }
  | { mode: "fill"; selector: FillSelector; price: number; date: string | null };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseFillCommand(text: string): FillCommand {
  const parts = text.trim().split(/\s+/);
  // parts[0] is the command token (e.g. "/fill")
  const args = parts.slice(1);
  if (args.length === 0) return { mode: "list" };
  if (args.length < 2) return { mode: "error", reason: "usage" };
  const [target, priceStr, dateStr] = args;
  const price = Number(priceStr);
  if (!Number.isFinite(price) || price <= 0) return { mode: "error", reason: "price" };
  if (dateStr !== undefined && !DATE_RE.test(dateStr)) return { mode: "error", reason: "date" };
  const selector: FillSelector = target.includes("|")
    ? { kind: "id", id: target }
    : { kind: "ticker", ticker: target.toUpperCase() };
  return { mode: "fill", selector, price, date: dateStr ?? null };
}

export type TargetResult =
  | { kind: "one"; id: string }
  | { kind: "none" }
  | { kind: "ambiguous"; ids: string[] };

export function selectFillTarget(log: TradeLogRecord[], sel: FillSelector): TargetResult {
  if (sel.kind === "id") {
    return log.some((r) => r.id === sel.id) ? { kind: "one", id: sel.id } : { kind: "none" };
  }
  const unfilled = log
    .filter((r) => r.ticker.toUpperCase() === sel.ticker && r.actual_fill_price == null)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (unfilled.length === 0) return { kind: "none" };
  if (unfilled.length === 1) return { kind: "one", id: unfilled[0].id };
  return { kind: "ambiguous", ids: unfilled.map((r) => r.id) };
}

export function applyFill(
  log: TradeLogRecord[], id: string, price: number, date: string,
): TradeLogRecord[] {
  if (!Number.isFinite(price)) throw new Error("non-finite fill price");
  const out = log.map((r) =>
    r.id === id ? { ...r, actual_fill_price: price, actual_fill_date: date } : r);
  return out.slice(-MAX_ENTRIES);
}

export function stripNaN(raw: string): string {
  return raw.replace(/\bNaN\b/g, "null").replace(/\b-?Infinity\b/g, "null");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/fill-command.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fill-command.ts src/lib/fill-command.test.ts
git commit -m "feat: /fill command pure helpers (parse, select, apply)"
```

---

### Task 7: Wire `/fill` into the Telegram bot route

**Files:**
- Modify: `src/app/api/telegram-bot/route.ts`

> Read the whole file first (144 lines). It defines `replyTo(token, chatId, html)`, `handleCheck`, `handlePortfolio`, and the POST dispatcher (`if (cmd === "/check") ... else if (cmd === "/portfolio") ...`). The new handler reuses `replyTo` and the existing `htmlEscape` discipline.

- [ ] **Step 1: Add the `handleFill` handler function**

Add near `handlePortfolio` (uses the helpers from Task 6 + `computeSlippage`/`slippageLabel` from Task 2):

```typescript
import { parseFillCommand, selectFillTarget, applyFill, stripNaN } from "@/lib/fill-command";
import { slippageLabel } from "@/lib/slippage";
import type { TradeLogRecord } from "@/types/trade-log";

async function readTradeLog(kvUrl: string, kvToken: string): Promise<TradeLogRecord[]> {
  const res = await fetch(`${kvUrl}/get/trade_log`, {
    headers: { Authorization: `Bearer ${kvToken}` }, cache: "no-store",
  });
  if (!res.ok) throw new Error(`KV get ${res.status}`);
  const { result } = (await res.json()) as { result: string | null };
  return result ? (JSON.parse(stripNaN(result)) as TradeLogRecord[]) : [];
}

async function writeTradeLog(kvUrl: string, kvToken: string, log: TradeLogRecord[]) {
  const body = JSON.stringify(log);
  if (/\bNaN\b|\bInfinity\b/.test(body)) throw new Error("refusing to write non-finite to trade_log");
  const res = await fetch(`${kvUrl}/set/trade_log`, {
    method: "POST",
    headers: { Authorization: `Bearer ${kvToken}`, "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`KV set ${res.status}`);
}

function todayHKT(): string {
  // YYYY-MM-DD in Asia/Hong_Kong
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

async function handleFill(token: string, chatId: number, text: string) {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) {
    await replyTo(token, chatId, "KV not configured.");
    return;
  }
  const cmd = parseFillCommand(text);
  if (cmd.mode === "error") {
    const msg = cmd.reason === "price" ? "Invalid price." : cmd.reason === "date" ? "Invalid date (use YYYY-MM-DD)." : "Usage: <code>/fill TICKER PRICE [YYYY-MM-DD]</code>";
    await replyTo(token, chatId, msg);
    return;
  }

  const log = await readTradeLog(kvUrl, kvToken);

  if (cmd.mode === "list") {
    const unfilled = log.filter((r) => r.actual_fill_price == null);
    if (unfilled.length === 0) { await replyTo(token, chatId, "No unfilled records."); return; }
    const lines = unfilled.map((r, i) =>
      `${i + 1}. <code>${r.id.replace(/\.HK/g, "")}</code> @ ${r.signal_price}`);
    await replyTo(token, chatId, ["<b>Unfilled records</b>", ...lines,
      "", "Reply: <code>/fill TICKER PRICE [date]</code>"].join("\n"));
    return;
  }

  const target = selectFillTarget(log, cmd.selector);
  if (target.kind === "none") {
    await replyTo(token, chatId, "No matching unfilled record. Try <code>/fill</code> to list.");
    return;
  }
  if (target.kind === "ambiguous") {
    const lines = target.ids.map((id) => `<code>${id.replace(/\.HK/g, "")}</code>`);
    await replyTo(token, chatId, ["Multiple unfilled records — specify the id:", ...lines].join("\n"));
    return;
  }

  const date = cmd.date ?? todayHKT();
  const updated = applyFill(log, target.id, cmd.price, date);
  await writeTradeLog(kvUrl, kvToken, updated);

  const rec = updated.find((r) => r.id === target.id)!;
  const label = slippageLabel(rec);
  await replyTo(token, chatId, [
    `Filled <b>${rec.ticker.replace(/\.HK/g, "")}</b> ${rec.type}`,
    `signal ${rec.signal_price} → fill ${rec.actual_fill_price} (${date})`,
    `slippage: ${label}`,
  ].join("\n"));
}
```

> Note: `todayHKT()` is the date source for omitted dates. Confirm the existing `replyTo` signature matches `(token, chatId, html)` when you wire this in; adapt the calls if the real signature differs.

- [ ] **Step 2: Add the dispatch branch + admin auth**

In the POST handler, after the existing `else if (cmd === "/portfolio")` branch, add:

```typescript
} else if (cmd === "/fill") {
  const adminId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!adminId || String(chatId) !== adminId) {
    await replyTo(token, chatId, "⛔ Not authorized.").catch(() => {});
  } else {
    await handleFill(token, chatId, text).catch(() => {});
  }
}
```

- [ ] **Step 3: Verify type-check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/telegram-bot/route.ts
git commit -m "feat: Telegram /fill command (admin-gated, patches trade_log, echoes slippage)"
```

---

### Task 8: Full test pass + env + integration

**Files:** none (verification + config)

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: all tests pass (including the 3 new files).

- [ ] **Step 2: Set the new env var**

Add `TELEGRAM_ADMIN_CHAT_ID` to Vercel project env (Production + Preview) and to local `.env.local` for reference. Value = Steven's Telegram chat id (the user pastes it; do not guess). This is required for `/fill` to act — without it every `/fill` replies "Not authorized."

- [ ] **Step 3: Deploy preview + visual + live smoke (user-driven)**

- Push the branch; open the per-branch Vercel Preview **signed in** (Clerk-gated) and confirm `TradeLogPanel` renders the 4 live records with the summary + params_source split.
- In a controlled chat as the admin, run `/fill` (list), then `/fill SPY 721.10 2026-06-10` against a real record id; confirm the echo shows the right slippage and direction, and re-read `/api/trades` to confirm the KV record was patched (only `actual_fill_price`/`actual_fill_date` changed).
- Confirm a non-admin chat gets "⛔ Not authorized."

- [ ] **Step 4: Open the PR**

```bash
git push -u origin feat/trade-log-viewer-and-fill
gh pr create --title "Trade-log viewer + Telegram /fill" --body "Implements docs/superpowers/specs/2026-06-20-trade-log-viewer-and-fill-design.md"
```

---

## Cross-surface note (deferred, per spec)
Slippage lives on the web panel + `/fill` echo only this session. The natural follow-up is a slippage summary line in the Telegram EOD report (`src/lib/telegram-report.ts` → `buildEodReport()`) — flagged per the cross-platform consistency rule, not built here.
