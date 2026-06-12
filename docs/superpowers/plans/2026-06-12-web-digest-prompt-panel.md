# Daily Digest Prompt Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an always-expanded "Daily Digest" prompt-builder panel at the top of the web dashboard that embeds live data into a ready-to-paste DeepSeek/Gemini prompt — no LLM API call.

**Architecture:** Clone of the Fundamental-tab prompt pattern. A server lib fetches KV `state` + the two raw-GitHub forecast JSONs, pre-computes per-ticker metrics with the SAME formulas as the `stock-morning-digest` scheduled task, and assembles a single prompt string. A Clerk-protected GET route exposes it; a client component renders it with copy + chat links.

**Tech Stack:** Next.js (App Router), TypeScript, React, Clerk, Vitest. Vercel KV (Upstash REST). Tailwind classes (match existing dark theme).

**Pre-work (not a code task):** Fresh-clone the repo via `gh repo clone` (local checkout may be stale per project convention); create a feature branch `feat/web-daily-digest-panel`. Confirm `src/lib/kronos.ts` and `src/lib/timesfm.ts` exist and the raw URLs in them match those below. Do NOT push or open a PR without Steven's go-ahead.

**Forecast data note:** This lib fetches the raw forecast JSON URLs DIRECTLY (not via `fetchKronosForecasts`/`fetchTimesfmForecasts`) so the raw shapes (`forward.p50`, `price_targets.p50`, `st_persistence.flip_risk`) are guaranteed regardless of any web-side transform — matching the scheduled task exactly.

---

### Task 1: Metric helpers + editorial-spec constant

**Files:**
- Create: `src/lib/digest/metrics.ts`
- Test: `src/lib/digest/metrics.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { pct20d, downsideToStopPct, distanceToFlipPct, eventCount, isDefaultParams, fmtPct, fmtKronos } from "./metrics";

describe("digest metrics", () => {
  it("pct20d: last/last_price - 1 as percent, 1dp", () => {
    expect(pct20d([100, 102, 110], 100)).toBeCloseTo(10, 5);
    expect(pct20d([], 100)).toBeNull();
    expect(pct20d([110], 0)).toBeNull();
    expect(pct20d(undefined, 100)).toBeNull();
  });
  it("downsideToStopPct: only for dir up", () => {
    expect(downsideToStopPct({ dir: "up", price: 421.07, stop: 395.9 } as any)).toBeCloseTo(5.98, 1);
    expect(downsideToStopPct({ dir: "down", price: 100, stop: 110 } as any)).toBeNull();
  });
  it("distanceToFlipPct: (price-flipPx)/price", () => {
    expect(distanceToFlipPct({ price: 737.76, flipPx: 737.55 } as any)).toBeCloseTo(0.028, 2);
    expect(distanceToFlipPct({ price: 100, flipPx: 0 } as any)).toBeNull();
  });
  it("eventCount tallies events for a ticker", () => {
    const ev = [{ ticker: "3033.HK" }, { ticker: "3033.HK" }, { ticker: "TSM" }] as any;
    expect(eventCount(ev, "3033.HK")).toBe(2);
    expect(eventCount(ev, "AAPL")).toBe(0);
  });
  it("isDefaultParams: ATR10 x3.0", () => {
    expect(isDefaultParams({ atrPeriod: 10, mult: 3.0 } as any)).toBe(true);
    expect(isDefaultParams({ atrPeriod: 10, mult: 2.5 } as any)).toBe(false);
  });
  it("fmtPct: signed 1dp or dash", () => {
    expect(fmtPct(6.0)).toBe("+6.0");
    expect(fmtPct(-1.3)).toBe("-1.3");
    expect(fmtPct(null)).toBe("—");
  });
  it("fmtKronos: flags noise beyond ±25", () => {
    expect(fmtKronos(-7.4)).toBe("-7.4");
    expect(fmtKronos(-50.7)).toBe("noise");
    expect(fmtKronos(null)).toBe("—");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/digest/metrics.test.ts`
Expected: FAIL — cannot find module `./metrics`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { WorkerTickerState, WorkerEvent } from "@/types/worker-state";

export const KRONOS_NOISE_THRESHOLD = 25;

export function pct20d(p50: number[] | undefined, lastPrice: number | undefined): number | null {
  if (!p50 || p50.length === 0 || !lastPrice) return null;
  return Math.round((p50[p50.length - 1] / lastPrice - 1) * 1000) / 10;
}

export function downsideToStopPct(t: Pick<WorkerTickerState, "dir" | "price" | "stop">): number | null {
  if (t.dir !== "up" || !t.stop || !t.price) return null;
  return Math.round(((t.price - t.stop) / t.price) * 1000) / 10;
}

export function distanceToFlipPct(t: Pick<WorkerTickerState, "price" | "flipPx">): number | null {
  if (!t.flipPx || !t.price) return null;
  return Math.round(((t.price - t.flipPx) / t.price) * 1000) / 10;
}

export function eventCount(events: WorkerEvent[], ticker: string): number {
  return events.filter((e) => (e as { ticker?: string }).ticker === ticker).length;
}

export function isDefaultParams(t: Pick<WorkerTickerState, "atrPeriod" | "mult">): boolean {
  return t.atrPeriod === 10 && t.mult === 3.0;
}

export function fmtPct(v: number | null): string {
  if (v === null) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(1);
}

export function fmtKronos(v: number | null): string {
  if (v === null) return "—";
  if (Math.abs(v) > KRONOS_NOISE_THRESHOLD) return "noise";
  return (v >= 0 ? "+" : "") + v.toFixed(1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/digest/metrics.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Add the editorial-spec constant**

Create `src/lib/digest/editorialSpec.ts`:

```typescript
// MIRROR of the `stock-morning-digest` scheduled task prompt (~/.claude/scheduled-tasks/).
// Edit BOTH together — Cross-Platform Consistency Rule (see LIVE_STATE.md "Daily Morning Digest").
export const DIGEST_EDITORIAL_SPEC = `You are an equity analyst writing a sharp, CONCISE daily digest for a HK/US swing trader who runs a SuperTrend (ST) + Trend-Template (TT) system. Take a stance, quantify risk, look forward — but ruthlessly edited.

Write EXACTLY this structure:
A) BOTTOM LINE — 2-3 sentences: the decisive positioning call (risk-on/neutral/off) and the single most important thing to watch.
B) WHAT MATTERS TODAY — 3 to 5 bullets MAX. Each bullet = one actionable name/setup with only the SINGLE most decisive number; fold forecast + risk + reliability into that one bullet.
C) WATCH — one line: the trigger that decides the day.

RULES: State any number once. Do not enumerate every name — only those with an actionable read. ~180 words, must stay scannable. Lead on TimesFM 20d + flip_risk; Kronos is noisy/mean-reverting (values shown as "noise" are artifacts — ignore them). Quality-vs-trend (TT 6+ but ST-down) = pullbacks in elite names, watchlist for flip-up NOT shorts. Discount serial whipsaws (high #ev with provisional flips that reverse).
PRIORITY — NEVER DROP: any ticker with a fresh EOD-confirmed flip is mandatory in section B, even over the word budget.`;
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/digest/metrics.ts src/lib/digest/metrics.test.ts src/lib/digest/editorialSpec.ts
git commit -m "feat(digest): metric helpers + editorial-spec constant"
```

---

### Task 2: Assemble the prompt from data (pure, testable)

**Files:**
- Create: `src/lib/digest/assemble.ts`
- Test: `src/lib/digest/assemble.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { assembleDigestPrompt, type DigestInputs } from "./assemble";

const inputs: DigestInputs = {
  state: {
    version: 39,
    updatedAt: "2026-06-12T02:01Z",
    regionLastRun: { us: "2026-06-11", hk: "2026-06-12" },
    tickers: {
      "TSM": { region: "us", price: 421.07, barDate: "2026-06-11", dir: "up", flipPx: 365.9, stop: 395.9, atrPeriod: 10, mult: 3.0, score: 7, smaStack: "P>50>150>200", funds: { f: 8, z: 2.07 } },
      "3033.HK": { region: "hk", price: 4.56, barDate: "2026-06-12", dir: "down", flipPx: 4.56, stop: 4.94, atrPeriod: 10, mult: 3.0, score: 0, smaStack: "150>50>P", funds: {} },
    } as any,
    lastAlert: {} as any,
    events: [{ ticker: "3033.HK", type: "flip_buy", confirmed: false, barDate: "2026-06-12", session: "intraday" }] as any,
  },
  kronos: { "TSM": { last_price: 421, forward: { p50: [374.45] } }, "AMD": { last_price: 488, forward: { p50: [240] } } },
  timesfm: { "TSM": { last_price: 421, price_targets: { p50: [418.5] }, st_persistence: { flip_risk: "low" } } },
};

describe("assembleDigestPrompt", () => {
  it("includes the editorial spec, data header, and a row per ticker", () => {
    const p = assembleDigestPrompt(inputs);
    expect(p).toContain("BOTTOM LINE");
    expect(p).toContain("v39");
    expect(p).toContain("TSM");
    expect(p).toContain("3033"); // ticker present
    expect(p).toContain("+6.0"); // TSM downside-to-stop
  });
  it("flags a noisy Kronos value as 'noise', not the raw number", () => {
    const p = assembleDigestPrompt(inputs);
    expect(p).toContain("noise");      // AMD -50.8% flagged
    expect(p).not.toContain("-50.8");
  });
  it("renders an em dash where a metric is unavailable", () => {
    const p = assembleDigestPrompt(inputs);
    expect(p).toContain("—");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/digest/assemble.test.ts`
Expected: FAIL — cannot find module `./assemble`.

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { WorkerState } from "@/types/worker-state";
import { DIGEST_EDITORIAL_SPEC } from "./editorialSpec";
import { pct20d, downsideToStopPct, distanceToFlipPct, eventCount, isDefaultParams, fmtPct, fmtKronos } from "./metrics";

export interface KronosRawEntry { last_price: number; forward: { p50: number[] } }
export interface TimesfmRawEntry { last_price: number; price_targets: { p50: number[] }; st_persistence?: { flip_risk?: string } }
export interface DigestInputs {
  state: WorkerState;
  kronos: Record<string, KronosRawEntry | { _metadata?: unknown }>;
  timesfm: Record<string, TimesfmRawEntry | { _metadata?: unknown }>;
}

function pad(s: string, n: number): string { return (s + " ".repeat(n)).slice(0, n); }

export function assembleDigestPrompt({ state, kronos, timesfm }: DigestInputs): string {
  const header = "TICK       dir  TT   px       stop     risk%  flip%  K20d   TF20d  fRisk  #ev";
  const rows: string[] = [];
  for (const [sym, t] of Object.entries(state.tickers)) {
    const kr = kronos[sym] as KronosRawEntry | undefined;
    const tf = timesfm[sym] as TimesfmRawEntry | undefined;
    const k = kr && "forward" in kr ? pct20d(kr.forward.p50, kr.last_price) : null;
    const tfv = tf && "price_targets" in tf ? pct20d(tf.price_targets.p50, tf.last_price) : null;
    const frisk = tf && "st_persistence" in tf ? (tf.st_persistence?.flip_risk ?? "—") : "—";
    rows.push(
      pad(sym, 10) + " " +
      pad(t.dir, 4) + " " +
      pad(`${t.score}/7`, 4) + " " +
      pad(t.price.toFixed(2), 8) + " " +
      pad(t.stop.toFixed(2), 8) + " " +
      pad(fmtPct(downsideToStopPct(t)), 6) + " " +
      pad(fmtPct(distanceToFlipPct(t)), 6) + " " +
      pad(fmtKronos(k), 6) + " " +
      pad(fmtPct(tfv), 6) + " " +
      pad(frisk, 6) + " " +
      String(eventCount(state.events, sym)) +
      (isDefaultParams(t) ? "" : " *opt"),
    );
  }
  const recentEvents = state.events.slice(-10)
    .map((e) => `${(e as { ticker?: string }).ticker} ${e.type} ${e.confirmed ? "EOD" : "prov"} ${e.barDate}`)
    .join(" · ");
  return [
    DIGEST_EDITORIAL_SPEC,
    "",
    `DATA (KV state v${state.version}, as of ${state.updatedAt}; "*opt" = optimized params, else default ATR10 x3.0):`,
    header,
    ...rows,
    "",
    `Recent events: ${recentEvents}`,
  ].join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/digest/assemble.test.ts`
Expected: PASS (3 tests). (TSM downside-to-stop = (421.07-395.9)/421.07 = +6.0; AMD Kronos = 240/488-1 = -50.8 → "noise".)

- [ ] **Step 5: Commit**

```bash
git add src/lib/digest/assemble.ts src/lib/digest/assemble.test.ts
git commit -m "feat(digest): assemble prompt string from state + forecasts"
```

---

### Task 3: Orchestrator — fetch live data + assemble

**Files:**
- Create: `src/lib/digest/generateDigestPrompt.ts`

- [ ] **Step 1: Write the implementation** (thin network orchestrator; logic is covered by Task 1-2 tests)

```typescript
import type { WorkerState } from "@/types/worker-state";
import { assembleDigestPrompt } from "./assemble";

const KRONOS_URL = "https://raw.githubusercontent.com/sc4stock-pixel/stock-analysis-technical-and-fundamental/main/kronos_forecasts.json";
const TIMESFM_URL = "https://raw.githubusercontent.com/sc4stock-pixel/stock-analysis-technical-and-fundamental/main/timesfm_forecasts.json";

export interface DigestPromptResult { prompt: string; fetchedAt: string; dataAsOf: string | null; }

async function fetchJson(url: string, init?: RequestInit): Promise<any | null> {
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000), ...init });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchWorkerState(): Promise<WorkerState> {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error("KV not configured");
  const data = await fetchJson(`${url}/get/state`, { headers: { Authorization: `Bearer ${token}` } });
  if (!data?.result) throw new Error("KV state empty");
  return JSON.parse(data.result) as WorkerState;
}

export async function generateDigestPrompt(): Promise<DigestPromptResult> {
  const [state, kronos, timesfm] = await Promise.all([
    fetchWorkerState(),
    fetchJson(KRONOS_URL),
    fetchJson(TIMESFM_URL),
  ]);
  return {
    prompt: assembleDigestPrompt({ state, kronos: kronos ?? {}, timesfm: timesfm ?? {} }),
    fetchedAt: new Date().toISOString(),
    dataAsOf: state.updatedAt,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `src/lib/digest/`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/digest/generateDigestPrompt.ts
git commit -m "feat(digest): orchestrator fetches KV state + forecasts"
```

---

### Task 4: API route

**Files:**
- Create: `src/app/api/digest-prompt/route.ts`

- [ ] **Step 1: Write the route** (mirrors `src/app/api/fundamental/route.ts`; Clerk-protected by default middleware — browser/signed-in only)

```typescript
import { NextResponse } from "next/server";
import { generateDigestPrompt } from "@/lib/digest/generateDigestPrompt";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await generateDigestPrompt();
    return NextResponse.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[/api/digest-prompt]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify it is NOT in the machine-public allowlist** (must stay Clerk-protected — no secret needed, it's browser-only)

Run: `grep -nE "digest-prompt|cron|health|freshness|reconcile" src/middleware.ts`
Expected: `digest-prompt` does NOT appear (so it inherits Clerk protection). If `middleware.ts` uses an explicit public matcher, confirm `digest-prompt` is absent from it.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/digest-prompt/route.ts
git commit -m "feat(digest): Clerk-protected GET /api/digest-prompt"
```

---

### Task 5: Client panel component

**Files:**
- Create: `src/components/DigestPrompt.tsx`

- [ ] **Step 1: Write the component** (clone of `src/components/fundamental/FundamentalPrompts.tsx`; always-expanded, auto-fetch on mount)

```tsx
"use client";
import { useState, useEffect, useCallback } from "react";

interface DigestData { prompt: string; fetchedAt: string; dataAsOf: string | null; }

export default function DigestPrompt() {
  const [data, setData] = useState<DigestData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/digest-prompt", { cache: "no-store" });
      const json = await res.json();
      if (json.error) setError(json.error);
      else setData(json);
    } catch {
      setError("Failed to load digest prompt");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = data.prompt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="mb-4 rounded-lg border border-[#00d4ff]/35 bg-[#0f172a] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#00d4ff]/15 bg-[#00d4ff]/[0.04]">
        <div className="flex items-center gap-2">
          <span className="text-[#00d4ff] text-sm font-bold">📋 Daily Digest</span>
          <span className="text-[#4a6080] text-xs">— copy into DeepSeek / Gemini</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[#4a6080] text-[11px] font-mono">
            {data?.dataAsOf ? `Data as of ${data.dataAsOf}` : loading ? "Loading…" : ""}
          </span>
          <button onClick={load} disabled={loading}
            className="text-[#00d4ff] text-[11px] border border-[#00d4ff]/40 bg-[#00d4ff]/10 px-2 py-1 rounded disabled:opacity-40">
            {loading ? "⏳" : "↻ Refresh"}
          </button>
        </div>
      </div>
      <div className="p-3">
        {error && <p className="text-[#ff4757] text-xs mb-2">{error}</p>}
        {data && (
          <div className="relative">
            <pre className="max-h-[230px] overflow-auto bg-[#0a0e1a] border border-[#4a6080]/30 rounded-md p-3 text-[#8aa0bd] font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap">
              {data.prompt}
            </pre>
            <button onClick={copy}
              className="absolute top-2 right-2 bg-[#00d4ff] text-[#06202b] text-xs font-bold px-3 py-1.5 rounded">
              {copied ? "✓ Copied" : "📋 Copy prompt"}
            </button>
          </div>
        )}
        <div className="flex items-center gap-4 mt-3 pl-1">
          <span className="text-[#4a6080] text-[11px]">Paste into:</span>
          <a href="https://chat.deepseek.com" target="_blank" rel="noopener noreferrer"
            className="text-[#00d4ff] text-xs underline">chat.deepseek.com</a>
          <a href="https://gemini.google.com" target="_blank" rel="noopener noreferrer"
            className="text-[#00d4ff] text-xs underline">gemini.google.com</a>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/DigestPrompt.tsx
git commit -m "feat(digest): always-expanded DigestPrompt panel component"
```

---

### Task 6: Render the panel at the top of the dashboard

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Add the import** near the other component imports (top of file, alongside `AlertsPanel` import)

```tsx
import DigestPrompt from "@/components/DigestPrompt";
```

- [ ] **Step 2: Render it at the top of the dashboard JSX**

Locate the top of the main returned dashboard container (the first child rendered after the header/`UserButton` row — directly above `PortfolioSummaryBar` / `AlertsPanel`). Insert:

```tsx
<DigestPrompt />
```

(Find the anchor with: `grep -n "PortfolioSummaryBar\|AlertsPanel\|<main" src/app/page.tsx` and place `<DigestPrompt />` immediately before the first top-level panel.)

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: build succeeds (needs a dummy Clerk publishable key in env — see `.env.local`; build = type/compile verification only, not visual).

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(digest): render Daily Digest panel atop the dashboard"
```

---

### Task 7: Full verification + consistency note

**Files:**
- Modify: `LIVE_STATE.md` (root of this repo's parent stock project — or note for Steven if outside repo)

- [ ] **Step 1: Run the full suite**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: all tests PASS, no type errors, build succeeds.

- [ ] **Step 2: Confirm no LLM API call in the new path** (acceptance criterion 4)

Run: `grep -rniE "deepseek|openai|anthropic|chat/completions" src/lib/digest src/app/api/digest-prompt src/components/DigestPrompt.tsx`
Expected: NO matches (the only DeepSeek references are the plain `chat.deepseek.com` link in the component — verify it is an `<a href>`, not an API call).

- [ ] **Step 3: Record the web↔task consistency coupling**

Add a line to the "Daily Morning Digest" section of `LIVE_STATE.md`: the web `DIGEST_EDITORIAL_SPEC` (`src/lib/digest/editorialSpec.ts`) MIRRORS the `stock-morning-digest` task prompt — edit both together.

- [ ] **Step 4: STOP — hand off for visual verification**

Do NOT push or open a PR. Report to Steven: branch name, files changed, test/build results. Steven pushes (or authorizes push) → reviews the panel on the per-branch **Vercel Preview URL** (signed in; local clones cannot render the Clerk-gated UI). Spot-check acceptance criterion 2: TSM downside-to-stop ≈ +6.0%, any Kronos artifact shows "noise" not a raw number.

---

## Self-Review

**Spec coverage:** route (Task 4) · lib + pre-computed metrics + editorial constant (Tasks 1-3) · component always-expanded/auto-fetch/copy/links (Task 5) · placement (Task 6) · $0 / no-API (Task 7 Step 2) · consistency comment + LIVE_STATE (Task 1 Step 5, Task 7 Step 3) · verification + Vercel-preview handoff (Task 7). All acceptance criteria mapped.

**Placeholder scan:** no TBDs; all code blocks complete; test bodies concrete.

**Type consistency:** `WorkerState`/`WorkerTickerState`/`WorkerEvent` from `@/types/worker-state`; `DigestInputs`/`KronosRawEntry`/`TimesfmRawEntry` defined in Task 2 and reused in Task 3; metric fn names (`pct20d`, `downsideToStopPct`, `distanceToFlipPct`, `eventCount`, `isDefaultParams`, `fmtPct`, `fmtKronos`) consistent across Tasks 1-2. `generateDigestPrompt`/`DigestPromptResult` consistent across Tasks 3-4. `DigestData` shape in Task 5 matches `DigestPromptResult`.
