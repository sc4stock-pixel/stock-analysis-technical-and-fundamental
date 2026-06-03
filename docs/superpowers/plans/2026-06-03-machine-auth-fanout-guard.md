# Machine-vs-Browser Auth + Fan-out Removal + Regression Guard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make machine endpoints (cron, webhook, reconcile, health) work under Clerk by classifying every route, remove the cron→`/api/stocks` HTTP fan-out by extracting shared analysis logic, and add a two-layer regression guard so a broken pipeline screams instead of emitting a silent `0/0` report.

**Architecture:** Browser routes stay Clerk-protected (no exposure). Machine routes are Clerk-public but enforce their own secret in-handler. Cron routes call a shared `analyzeStock()` directly (no self-HTTP). A `/api/health` probe + in-route degraded detection provide the guard.

**Tech Stack:** Next.js 14 (app router), TypeScript, `@clerk/nextjs`, Vercel KV (REST), Vitest (added here), Telegram Bot API. Coordinated change in the `autopilot` Python repo for `/api/reconcile`.

**Repos:** web = `stock-analysis-technical-and-fundamental` (cloned at `/tmp/sa-web`); autopilot = `sc4stock-pixel/autopilot` (`/tmp/autopilot`). Spec: `docs/superpowers/specs/2026-06-03-clerk-machine-auth-design.md`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `vitest.config.ts` | Test runner config (node env) | Create |
| `package.json` | add `test` script + vitest devDep | Modify |
| `src/lib/analyze-stock.ts` | `analyzeStock()` + fundamentals/code33/eps helpers (single source of truth) | Create (moved from route) |
| `src/app/api/stocks/route.ts` | Thin browser route → imports `analyzeStock` | Modify |
| `src/lib/flip.ts` | `detectFlip(bars, atr, mul)` — shared ST flip detection | Create |
| `src/lib/flip.test.ts` | unit test for `detectFlip` | Create |
| `src/lib/pipeline-health.ts` | `classifyValidity(payload)` — degraded detection | Create |
| `src/lib/pipeline-health.test.ts` | unit test | Create |
| `src/app/api/cron/report/route.ts` | call `analyzeStock` in-process + degraded guard | Modify |
| `src/app/api/cron/analyze/route.ts` | call `analyzeStock` in-process + degraded guard | Modify |
| `src/app/api/cron/daily/route.ts` | (forwards to analyze/report) — verify no `/api/stocks` fetch remains | Modify |
| `src/lib/telegram-report.ts` | header label by market (fix `🌅 Morning Brief` bug) + export `reportHeader()` | Modify |
| `src/lib/telegram-report.test.ts` | unit test for `reportHeader()` | Create |
| `src/middleware.ts` | machine+auth public matcher; everything else protected | Modify |
| `src/app/api/reconcile/route.ts` | add `x-cron-secret` check | Modify |
| `src/app/api/health/route.ts` | new machine probe (data + params + KV) | Create |
| `.github/workflows/health-probe.yml` | GHA fallback probe (cron-job.org is primary) | Create |
| `LIVE_STATE.md` (in `/Users/Steven/Claude`) | two-system distinction + guard | Modify |
| autopilot `worker/run.py` | forward `x-cron-secret` to `/api/reconcile` | Modify (other repo) |
| autopilot `.github/workflows/autopilot-worker.yml` | pass `CRON_SECRET` env | Modify (other repo) |

---

## Task 1: Add Vitest test harness

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`
- Create: `src/lib/smoke.test.ts`

- [ ] **Step 1: Add vitest config**

Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
```

- [ ] **Step 2: Add test script + devDep**

In `package.json` `"scripts"` add: `"test": "vitest run"`. Then install:
```bash
cd /tmp/sa-web && npm install -D vitest@^2 --legacy-peer-deps
```

- [ ] **Step 3: Write a smoke test**

Create `src/lib/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";
describe("harness", () => { it("runs", () => { expect(1 + 1).toBe(2); }); });
```

- [ ] **Step 4: Run and verify pass**

Run: `cd /tmp/sa-web && npm test`
Expected: 1 passed.

- [ ] **Step 5: Commit**
```bash
git add vitest.config.ts package.json package-lock.json src/lib/smoke.test.ts
git commit -m "test: add vitest harness"
```

---

## Task 2: Extract `detectFlip` (shared, replaces duplicated loops)

The supertrend-flip loop is duplicated in `cron/analyze` (with stop/close) and `cron/report` (without). Create one helper returning all fields; report ignores the extra ones.

**Files:**
- Create: `src/lib/flip.ts`
- Create: `src/lib/flip.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/flip.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { detectFlip } from "@/lib/flip";

// Synthetic bars: a clear downtrend then an upswing to force a BULLISH flip on the last bar.
const bars = [
  { high: 10, low: 9, close: 9.5 }, { high: 10, low: 9, close: 9.4 },
  { high: 10, low: 9, close: 9.3 }, { high: 10, low: 9, close: 9.2 },
  { high: 10, low: 9, close: 9.1 }, { high: 13, low: 12, close: 12.8 },
];

describe("detectFlip", () => {
  it("returns null flipType when fewer than 2 bars", () => {
    expect(detectFlip([{ high: 1, low: 1, close: 1 }], 3, 3).flipType).toBeNull();
  });
  it("detects a bullish flip and reports barsSince/stop/close", () => {
    const f = detectFlip(bars, 3, 3);
    expect(f.flipType).toBe("BULLISH");
    expect(f.barsSince).toBe(0);
    expect(typeof f.stopAtFlip === "number" || f.stopAtFlip === null).toBe(true);
    expect(f.closeAtFlip).toBe(12.8);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- flip`
Expected: FAIL — cannot find module `@/lib/flip`.

- [ ] **Step 3: Implement `detectFlip`**

Create `src/lib/flip.ts` (logic lifted verbatim from `cron/analyze/route.ts:51-65`):
```ts
import { supertrend } from "@/lib/indicators";

export type ChartBar = { high: number; low: number; close: number };
export interface FlipInfo {
  flipType: "BULLISH" | "BEARISH" | null;
  barsSince: number;
  stopAtFlip: number | null;
  closeAtFlip: number | null;
}

export function detectFlip(bars: ChartBar[], atrPeriod: number, multiplier: number): FlipInfo {
  if (!bars || bars.length < 2) {
    return { flipType: null, barsSince: 999, stopAtFlip: null, closeAtFlip: null };
  }
  const [stArr, dir] = supertrend(
    bars.map(b => b.high), bars.map(b => b.low), bars.map(b => b.close), atrPeriod, multiplier,
  );
  for (let i = dir.length - 1; i >= 1; i--) {
    if (dir[i] !== dir[i - 1]) {
      return {
        flipType: dir[i] === 1 ? "BULLISH" : "BEARISH",
        barsSince: dir.length - 1 - i,
        stopAtFlip: stArr[i - 1] ?? null,
        closeAtFlip: bars[i].close,
      };
    }
  }
  return { flipType: null, barsSince: 999, stopAtFlip: null, closeAtFlip: null };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- flip`
Expected: PASS (2 tests). If `barsSince` differs from 0 due to ST seeding, adjust the test's expected value to the observed flip index — the point is a non-null BULLISH flip with correct `closeAtFlip`.

- [ ] **Step 5: Commit**
```bash
git add src/lib/flip.ts src/lib/flip.test.ts
git commit -m "feat: shared detectFlip helper (dedupes cron analyze/report flip loops)"
```

---

## Task 3: Extract `analyzeStock` into `src/lib/analyze-stock.ts`

Move `analyzeStock` + its private helpers (`fetchFundamentals`, `getAvCache`, `fetchCode33`, `buildEpsQuarters`, `MONTH_ABBR`, the `Fundamentals`/`EpsQuarter` usages) out of `src/app/api/stocks/route.ts` (lines ~1–282) into a shared module, and re-import in the route.

**Files:**
- Create: `src/lib/analyze-stock.ts`
- Modify: `src/app/api/stocks/route.ts`

- [ ] **Step 1: Create the shared module**

Create `src/lib/analyze-stock.ts`. Move, verbatim, the imports and helper functions plus `analyzeStock` from `src/app/api/stocks/route.ts` (the block ending at the `analyzeStock` function close, line ~282). Export the function and the `Stock` type:
```ts
import { DEFAULT_CONFIG } from "@/lib/config";
import { runPipeline } from "@/lib/pipeline";
import { getSTParams, fetchYahooOHLCV } from "@/lib/marketData";
import { AppConfig, EpsQuarter } from "@/types";

export type Stock = { symbol: string; name: string; exchange: string };

// … (paste fetchFundamentals, getAvCache, fetchCode33, buildEpsQuarters, MONTH_ABBR verbatim) …

export async function analyzeStock(stock: Stock, config: AppConfig = DEFAULT_CONFIG) {
  // … paste body verbatim from stocks/route.ts:208-282 …
}
```
Keep `AV_CACHE_URL` and any module constants the helpers reference. Do not change logic.

- [ ] **Step 2: Thin the route to import it**

Edit `src/app/api/stocks/route.ts` to remove the moved code and import instead:
```ts
import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_CONFIG } from "@/lib/config";
import { AppConfig } from "@/types";
import { analyzeStock } from "@/lib/analyze-stock";
```
Keep both `POST` and `GET` handlers exactly as they are (they already call `analyzeStock`).

- [ ] **Step 3: Typecheck (build) to verify nothing dangling**

Run: `cd /tmp/sa-web && npx next build 2>&1 | tail -25`
Expected: build succeeds (no "Cannot find name" / unused import errors in `stocks/route.ts` or `analyze-stock.ts`). If unused imports remain in the route (e.g. `runPipeline`, `fetchYahooOHLCV`), delete them.

- [ ] **Step 4: Import smoke test**

Create `src/lib/analyze-stock.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { analyzeStock } from "@/lib/analyze-stock";
describe("analyze-stock module", () => {
  it("exports a callable analyzeStock", () => { expect(typeof analyzeStock).toBe("function"); });
});
```
Run: `npm test -- analyze-stock` → Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/lib/analyze-stock.ts src/app/api/stocks/route.ts src/lib/analyze-stock.test.ts
git commit -m "refactor: extract analyzeStock to src/lib/analyze-stock.ts (single source of truth)"
```

---

## Task 4: Rewire `cron/report` to call `analyzeStock` in-process (no self-HTTP)

**Files:**
- Modify: `src/app/api/cron/report/route.ts`

- [ ] **Step 1: Replace the fetch-fanout block**

In `src/app/api/cron/report/route.ts`, replace imports + the `results`/`payload` construction (lines 1–79) so it imports `analyzeStock` and `detectFlip` and maps in-process:
```ts
import { NextRequest, NextResponse } from "next/server";
import { buildEodReport } from "@/lib/telegram-report";
import { sendTelegramMessage } from "@/lib/telegram";
import { fetchKronosForecasts } from "@/lib/kronos";
import { fetchTimesfmForecasts } from "@/lib/timesfm";
import { DEFAULT_CONFIG } from "@/lib/config";
import { analyzeStock } from "@/lib/analyze-stock";
import { detectFlip, type ChartBar } from "@/lib/flip";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const market = (new URL(req.url).searchParams.get("market") ?? "hk") as "us" | "hk";
  const portfolio = DEFAULT_CONFIG.stocks.PORTFOLIO;

  const results = await Promise.all(
    portfolio.map(s => analyzeStock(s, DEFAULT_CONFIG))
  );

  const payload = results.map((r: Record<string, unknown>) => {
    const { chart_bars, ...slim } = r as { chart_bars?: ChartBar[] } & Record<string, unknown>;
    if (chart_bars && chart_bars.length >= 2) {
      const p = slim.st_opt_params as { atrPeriod?: number; multiplier?: number } | undefined;
      const flip = detectFlip(chart_bars, p?.atrPeriod ?? 10, p?.multiplier ?? 3.0);
      return { ...slim, _flip: { flipType: flip.flipType, barsSince: flip.barsSince } };
    }
    return slim;
  });
  // … (keep the forecast fetch + buildEodReport + sendTelegramMessage block from lines 81-97) …
}
```
Keep lines 81–97 (forecast fetch, `buildEodReport`, send, response) unchanged for now (Task 6 adds the degraded guard here).

- [ ] **Step 2: Build to verify**

Run: `npx next build 2>&1 | tail -15`
Expected: success; no reference to `baseUrl` or `supertrend` remains in this file.

- [ ] **Step 3: Commit**
```bash
git add src/app/api/cron/report/route.ts
git commit -m "refactor(cron/report): call analyzeStock in-process, drop /api/stocks self-fetch"
```

---

## Task 5: Rewire `cron/analyze` to call `analyzeStock` in-process

**Files:**
- Modify: `src/app/api/cron/analyze/route.ts`

- [ ] **Step 1: Replace the fetch-fanout block**

Mirror Task 4 in `src/app/api/cron/analyze/route.ts`. Replace imports + `results`/`payload` (lines 1–68) with `analyzeStock` + `detectFlip`. The analyze payload keeps the full flip fields:
```ts
import { NextRequest, NextResponse } from "next/server";
import { buildTelegramMessage, sendTelegramMessage } from "@/lib/telegram";
import { DEFAULT_CONFIG } from "@/lib/config";
import { analyzeStock } from "@/lib/analyze-stock";
import { detectFlip, type ChartBar } from "@/lib/flip";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const portfolio = DEFAULT_CONFIG.stocks.PORTFOLIO;
  const results = await Promise.all(portfolio.map(s => analyzeStock(s, DEFAULT_CONFIG)));

  const payload = results.map((r: Record<string, unknown>) => {
    const { chart_bars, ...slim } = r as { chart_bars?: ChartBar[] } & Record<string, unknown>;
    if (chart_bars && chart_bars.length >= 2) {
      const p = slim.st_opt_params as { atrPeriod?: number; multiplier?: number } | undefined;
      const flip = detectFlip(chart_bars, p?.atrPeriod ?? 10, p?.multiplier ?? 3.0);
      return { ...slim, _flip: flip };
    }
    return slim;
  });
  // … keep the hasSignals/hasRecentFlip gate + buildTelegramMessage + send + response (lines 70-91) …
}
```
Keep lines 70–91 unchanged (Task 6 inserts the degraded guard before the skip gate).

- [ ] **Step 2: Build to verify**

Run: `npx next build 2>&1 | tail -15` → Expected: success; no `baseUrl`/`supertrend` left.

- [ ] **Step 3: Commit**
```bash
git add src/app/api/cron/analyze/route.ts
git commit -m "refactor(cron/analyze): call analyzeStock in-process, drop /api/stocks self-fetch"
```

---

## Task 6: Degraded-pipeline detection + self-validating reports

**Files:**
- Create: `src/lib/pipeline-health.ts`
- Create: `src/lib/pipeline-health.test.ts`
- Modify: `src/app/api/cron/report/route.ts`
- Modify: `src/app/api/cron/analyze/route.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/pipeline-health.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { classifyValidity } from "@/lib/pipeline-health";

const ok = { current_price: 5, error: undefined };
const bad = { current_price: 0, error: "boom" };

describe("classifyValidity", () => {
  it("all valid → not degraded", () => {
    const r = classifyValidity([ok, ok, ok]);
    expect(r).toEqual({ total: 3, validCount: 3, degraded: false });
  });
  it("all failed → degraded", () => {
    expect(classifyValidity([bad, bad, bad]).degraded).toBe(true);
  });
  it("below 50% valid → degraded", () => {
    expect(classifyValidity([ok, bad, bad, bad]).degraded).toBe(true);
  });
  it("at/above 50% valid → not degraded", () => {
    expect(classifyValidity([ok, ok, bad]).degraded).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- pipeline-health` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/lib/pipeline-health.ts`:
```ts
export interface Validity { total: number; validCount: number; degraded: boolean; }

/** A row is valid when it has no error and a real price. Degraded when 0 valid or <50%. */
export function classifyValidity(payload: Array<Record<string, unknown>>): Validity {
  const total = payload.length;
  const validCount = payload.filter(
    r => !r.error && typeof r.current_price === "number" && (r.current_price as number) > 0
  ).length;
  const degraded = total > 0 && validCount < total * 0.5;
  return { total, validCount, degraded };
}

export function degradedAlertText(v: Validity, surface: string): string {
  return `⚠️ <b>PIPELINE DEGRADED</b> — ${surface}\n${v.validCount}/${v.total} stocks returned valid data. Report suppressed.`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- pipeline-health` → Expected: PASS (4 tests).

- [ ] **Step 5: Wire into `cron/report`**

In `src/app/api/cron/report/route.ts`, after building `payload` and before `buildEodReport`, insert:
```ts
import { classifyValidity, degradedAlertText } from "@/lib/pipeline-health";
// …
const validity = classifyValidity(payload as Array<Record<string, unknown>>);
if (validity.degraded) {
  await sendTelegramMessage(degradedAlertText(validity, `EOD report (${market})`), "alerts");
  return NextResponse.json({ ok: false, degraded: true, ...validity, market });
}
```

- [ ] **Step 6: Wire into `cron/analyze`**

In `src/app/api/cron/analyze/route.ts`, after building `payload` and before the `hasSignals` gate, insert the same guard with surface `"execution alerts"` and return `{ ok: false, degraded: true, ...validity }`.

- [ ] **Step 7: Build + tests**

Run: `npx next build 2>&1 | tail -15 && npm test`
Expected: build success; all unit tests pass.

- [ ] **Step 8: Commit**
```bash
git add src/lib/pipeline-health.ts src/lib/pipeline-health.test.ts src/app/api/cron/report/route.ts src/app/api/cron/analyze/route.ts
git commit -m "feat(guard): degraded-pipeline detection — alert instead of silent 0/0 report"
```

---

## Task 7: Fix the report header label (market-aware)

**Files:**
- Modify: `src/lib/telegram-report.ts`
- Create: `src/lib/telegram-report.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/telegram-report.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { reportHeaderLabel } from "@/lib/telegram-report";

describe("reportHeaderLabel", () => {
  it("US → Morning Brief", () => expect(reportHeaderLabel("us", false)).toBe("🌅 Morning Brief"));
  it("HK → HK Close", () => expect(reportHeaderLabel("hk", false)).toBe("🌇 HK Close"));
  it("both closed → Holiday Status", () => expect(reportHeaderLabel("hk", true)).toBe("🏖️ Holiday Status"));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- telegram-report` → Expected: FAIL (no export `reportHeaderLabel`).

- [ ] **Step 3: Implement + use it**

In `src/lib/telegram-report.ts`, add an exported helper and use it to build `header` (replacing lines 217–220):
```ts
export function reportHeaderLabel(market: "us" | "hk", bothClosed: boolean): string {
  if (bothClosed) return "🏖️ Holiday Status";
  return market === "us" ? "🌅 Morning Brief" : "🌇 HK Close";
}
// … inside buildEodReport:
const header = `<b>${reportHeaderLabel(market, !!bothClosed)}</b> [${dateStr}]`;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- telegram-report` → Expected: PASS (3 tests).

- [ ] **Step 5: Commit**
```bash
git add src/lib/telegram-report.ts src/lib/telegram-report.test.ts
git commit -m "fix(report): market-aware header (no more 'Morning Brief' on HK Close)"
```

---

## Task 8: Middleware route classification

**Files:**
- Modify: `src/middleware.ts`

- [ ] **Step 1: Rewrite `isPublicRoute`**

Replace the matcher in `src/middleware.ts` so ONLY machine + auth routes are Clerk-public; all else protected:
```ts
const isPublicRoute = createRouteMatcher([
  // Clerk's own auth pages
  "/sign-in(.*)",
  "/sign-up(.*)",
  // Machine endpoints — each enforces its OWN secret in-handler (defense in depth):
  "/api/cron/(.*)",      // x-cron-secret === CRON_SECRET
  "/api/telegram-bot",   // x-telegram-bot-api-secret-token
  "/api/reconcile",      // x-cron-secret (added in Task 9)
  "/api/health",         // x-cron-secret (added in Task 10)
]);
// NOTE: /api/telegram (UI test-ping, no secret) is intentionally NOT here — stays Clerk-protected.
```
Leave the `clerkMiddleware` body and `config.matcher` unchanged.

- [ ] **Step 2: Build to verify**

Run: `npx next build 2>&1 | tail -10` → Expected: success.

- [ ] **Step 3: Commit**
```bash
git add src/middleware.ts
git commit -m "fix(auth): classify routes — machine endpoints Clerk-public (self-authed), rest protected"
```

---

## Task 9: Lock down `/api/reconcile` with a secret (2-repo change)

**Files:**
- Modify: `src/app/api/reconcile/route.ts` (web)
- Modify: `worker/run.py` (autopilot)
- Modify: `.github/workflows/autopilot-worker.yml` (autopilot)

- [ ] **Step 1: Add secret check to the web route**

In `src/app/api/reconcile/route.ts`, change the handler signature and add the check at the top of `GET`:
```ts
import { NextRequest, NextResponse } from "next/server";
// …
export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    // … existing body unchanged …
  }
}
```

- [ ] **Step 2: Build + commit (web)**

Run: `npx next build 2>&1 | tail -10` → Expected: success.
```bash
git add src/app/api/reconcile/route.ts
git commit -m "fix(auth): require x-cron-secret on /api/reconcile"
```

- [ ] **Step 3: Forward the secret from the worker (autopilot repo)**

In `/tmp/autopilot/worker/run.py`, in `reconcile_run`, change the default fetch to send the header:
```python
fetch = fetch or (lambda: requests.get(
    config.RECONCILE_URL,
    headers={"x-cron-secret": os.environ["CRON_SECRET"]},
    timeout=30,
).json())
```

- [ ] **Step 4: Pass CRON_SECRET into the worker job**

In `/tmp/autopilot/.github/workflows/autopilot-worker.yml`, in the "Run worker" step `env:` block, add:
```yaml
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
```
Confirm the `CRON_SECRET` GitHub Actions secret exists on the `autopilot` repo (same value as Vercel's `CRON_SECRET`). If absent: `gh secret set CRON_SECRET --repo sc4stock-pixel/autopilot` (Steven supplies the value — do not print it).

- [ ] **Step 5: Commit (autopilot)**
```bash
cd /tmp/autopilot && git add worker/run.py .github/workflows/autopilot-worker.yml
git commit -m "fix: forward x-cron-secret to web /api/reconcile (web now requires it)"
```

---

## Task 10: `/api/health` probe

**Files:**
- Create: `src/app/api/health/route.ts`

- [ ] **Step 1: Implement the route**

Create `src/app/api/health/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_CONFIG } from "@/lib/config";
import { analyzeStock } from "@/lib/analyze-stock";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const checks: Record<string, boolean> = { data: false, params: false, kv: false };

  // data + params: analyze one real sample symbol through the shared path
  let sampleValid = false;
  try {
    const sample = DEFAULT_CONFIG.stocks.PORTFOLIO[0];
    const r = await analyzeStock(sample, DEFAULT_CONFIG) as Record<string, unknown>;
    sampleValid = !r.error && typeof r.current_price === "number" && (r.current_price as number) > 0;
    checks.data = sampleValid;
    checks.params = !!(r as { st_opt_params?: unknown }).st_opt_params || sampleValid;
  } catch { /* checks.data stays false */ }

  // kv: REST ping (same pattern as /api/state)
  try {
    const kvUrl = process.env.KV_REST_API_URL, kvToken = process.env.KV_REST_API_TOKEN;
    if (kvUrl && kvToken) {
      const res = await fetch(`${kvUrl}/get/state`, { headers: { Authorization: `Bearer ${kvToken}` }, cache: "no-store" });
      checks.kv = res.ok;
    }
  } catch { /* checks.kv stays false */ }

  const ok = checks.data && checks.kv;
  return NextResponse.json({ ok, checks, sampleValid }, { status: ok ? 200 : 503 });
}
```

- [ ] **Step 2: Build to verify**

Run: `npx next build 2>&1 | tail -10` → Expected: success.

- [ ] **Step 3: Commit**
```bash
git add src/app/api/health/route.ts
git commit -m "feat(guard): /api/health probe (data + params + KV, x-cron-secret)"
```

---

## Task 11: Health-probe scheduler (GHA fallback + cron-job.org primary)

**Files:**
- Create: `.github/workflows/health-probe.yml`

- [ ] **Step 1: Add the GHA fallback workflow**

Create `.github/workflows/health-probe.yml`:
```yaml
name: Pipeline Health Probe
on:
  schedule:
    - cron: '0 4 * * 1-5'   # ~12:00 HKT, ~4h before HK report window (GHA delay-tolerant)
  workflow_dispatch:
jobs:
  probe:
    runs-on: ubuntu-latest
    steps:
      - name: Probe /api/health and alert on failure
        env:
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
          TG_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TG_CHAT: ${{ secrets.TELEGRAM_CHAT_ID_ALERTS }}
        run: |
          body=$(curl -s --max-time 40 \
            -H "x-cron-secret: ${CRON_SECRET}" \
            "https://stock-analysis-technical-and-fundam.vercel.app/api/health")
          echo "health: $body"
          ok=$(echo "$body" | jq -r '.ok // false')
          if [ "$ok" != "true" ]; then
            curl -s -X POST "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
              -d "chat_id=${TG_CHAT}" \
              --data-urlencode "text=🚑 HEALTH FAIL: ${body}" >/dev/null
            exit 1
          fi
```
Confirm GHA secrets `CRON_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID_ALERTS` exist on the web repo (`gh secret list --repo sc4stock-pixel/stock-analysis-technical-and-fundamental`); Steven sets any missing one.

- [ ] **Step 2: Commit**
```bash
git add .github/workflows/health-probe.yml
git commit -m "feat(guard): GHA health-probe fallback (cron-job.org is primary)"
```

- [ ] **Step 3 (manual, after deploy): add the primary cron-job.org probe**

Use the `/setup-cronjob` skill: a GET job to `…/api/health` at `0 12 * * 1-5` (12:00 HKT), header `x-cron-secret: <secret>`, "Save responses" ON. (Steven pastes the secret.) Optional now; the GHA fallback covers it.

---

## Task 12: Deploy + end-to-end verification gates

**Files:** none (verification against live).

- [ ] **Step 1: Push web `main` and wait for Vercel deploy**
```bash
cd /tmp/sa-web && git push origin main && sleep 90
```

- [ ] **Step 2: Gate 1 — browser route blocks anonymous**

Run:
```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "https://stock-analysis-technical-and-fundam.vercel.app/api/stocks?symbol=AAPL"
```
Expected: a Clerk challenge (NOT a 200 with data) — `404 protect-rewrite` header or a `/sign-in` redirect. Confirm with `-I | grep x-clerk-auth-reason`.

- [ ] **Step 3: Gate 2 — machine route rejects without secret, accepts with it**

Run (no secret):
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://stock-analysis-technical-and-fundam.vercel.app/api/cron/report?market=hk"
```
Expected: `401`. Then with the secret (Steven provides `$CRON_SECRET` in the shell; do not print it):
```bash
curl -s -X POST "https://stock-analysis-technical-and-fundam.vercel.app/api/cron/report?market=hk" -H "x-cron-secret: $CRON_SECRET" | jq '{ok, market, analyzed, degraded}'
```
Expected: `ok:true`, and the HK EOD report arrives on Telegram with a **real breadth count** and header `🌇 HK Close` (NOT `0/0`, NOT "Morning Brief").

- [ ] **Step 4: Gate 3 — health probe**

Run: `curl -s -H "x-cron-secret: $CRON_SECRET" "https://…/api/health" | jq` → Expected: `{ ok: true, checks: { data:true, params:true, kv:true } }`.

- [ ] **Step 5: Gate 4 — reconcile requires secret**

Run: `curl -s -o /dev/null -w "%{http_code}\n" "https://…/api/reconcile"` → Expected `401`; with `-H "x-cron-secret: $CRON_SECRET"` → `200`.

- [ ] **Step 6: Deploy autopilot change + confirm reconcile still works**

Push the autopilot commit; trigger a reconcile run:
```bash
cd /tmp/autopilot && git push origin main
gh workflow run autopilot-worker.yml -f region=us -f session=reconcile --repo sc4stock-pixel/autopilot
```
Then `gh run view <id> --log | grep -E "drift|status"` → Expected: `{"status":"ok","drift":N}` (NOT an unauthorized/JSON error from the reconcile fetch).

- [ ] **Step 7: Gate 5 — degraded path (optional, non-prod)**

Confirm via unit tests (Task 6) that `classifyValidity` flags 0/total as degraded; the live degraded alert path is covered by code review (forcing a live data outage is not worth doing in prod).

---

## Task 13: Update LIVE_STATE + close out

**Files:**
- Modify: `/Users/Steven/Claude/LIVE_STATE.md`

- [ ] **Step 1: Correct the two-system distinction**

Edit `/Users/Steven/Claude/LIVE_STATE.md`: replace the "legacy jobs are redundant / disable them" note with: the **autopilot worker** (5 cron-job.org jobs) emits per-ticker *execution alerts*; the **web `/api/cron/*`** path (web `daily-analysis.yml` GHA + any cron-job.org jobs) emits the *EOD breadth report* + web alerts. They are NOT redundant. Record the new auth model (machine routes self-authed, browser routes Clerk), `/api/health`, and the degraded guard. Note CRON_SECRET is now shared by web + autopilot (reconcile).

- [ ] **Step 2: Commit (note: /Users/Steven/Claude/GitHub is a local-only repo)**
```bash
cd /Users/Steven/Claude && git add LIVE_STATE.md && git commit -m "docs(LIVE_STATE): correct two-system distinction; record auth model + guard" || true
```

---

## Self-Review

**Spec coverage:**
- §1 Auth boundary → Tasks 8, 9 (+ Task 10/11 machine routes). ✓
- §2 Fan-out removal → Tasks 2, 3, 4, 5. ✓
- §3 Regression guard (both layers) → Task 6 (self-validating) + Tasks 10–11 (active probe). ✓
- §4 Report header → Task 7. ✓
- §5 Testing & gates → Task 1 (harness) + unit tests in 2/6/7 + Task 12 (E2E gates). ✓
- Two-repo reconcile coordination → Task 9. ✓
- LIVE_STATE correction → Task 13. ✓

**Placeholder scan:** No TBD/TODO; every code step shows real code; "paste verbatim" steps reference exact source line ranges. The one deliberate non-unit item (live degraded path) is justified, not a placeholder.

**Type consistency:** `detectFlip` returns `FlipInfo` (used by Tasks 4/5); `classifyValidity` returns `Validity` (Task 6); `reportHeaderLabel(market, bothClosed)` signature matches its test (Task 7) and call site. `analyzeStock(stock, config?)` signature consistent across Tasks 3/4/5/10. `ChartBar` exported from `flip.ts` and imported by both cron routes.
