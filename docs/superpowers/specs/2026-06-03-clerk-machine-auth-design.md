# Design — Auth boundary for machine vs. browser callers (+ fan-out removal + regression guard)

_Date: 2026-06-03 · Repo: `stock-analysis-technical-and-fundamental` (web) + coordinated change in `autopilot`_

## Problem

Clerk auth (deployed 2026-06-03 PM) `auth.protect()`s **every** route. Only `/sign-in`
and `/sign-up` are public. This silently broke every non-browser caller:

- cron-job.org / GHA → `/api/cron/*` returned `404 protect-rewrite` before the handler ran
  (no EOD report, no US morning brief, no web execution alerts).
- the Telegram webhook → `/api/telegram-bot` blocked (`/check`, `/portfolio` dead).
- the report route's **internal** `fetch(${baseUrl}/api/stocks)` (a same-deployment self-call)
  was Clerk-blocked → all 15 tickers "failed" → a silently-degraded `0/0 breadth` report.

Root causes (three, all the same shape — verified the happy path, not the side effects):
1. Auth applied with no classification of callers (browser vs machine vs internal).
2. Cron routes HTTP-fetch a sibling route instead of calling shared logic → an auth hop
   inside the deployment.
3. No end-to-end check, so the break surfaced only as a missing Telegram message.

## Goals

1. **Auth boundary, done right** — every route classified; one consistent rule per class;
   no route silently unprotected or silently blocked.
2. **Kill the HTTP fan-out** — cron routes call shared analysis functions directly.
3. **Regression guard** — proactively catch "pipeline silently broken" before the report window,
   and make any degraded report scream instead of emitting `0/0`.

Non-goals: migrating to Clerk M2M tokens; touching the autopilot worker's analysis logic;
unrelated refactors.

## Section 1 — Auth boundary (route classification)

Three classes, one enforcement rule each:

| Class | Routes | Enforcement |
|---|---|---|
| **Browser** | `/api/stocks`, `/api/state`, `/api/macro`, `/api/macro-hk`, `/api/fundamentals`, `/api/fundamental`, `/api/st-params`, `/api/save-portfolio`, `/api/earnings`, `/api/telegram` | Clerk session (`auth.protect()`). No secret, **no public exposure.** |
| **Machine** | `/api/cron/*`, `/api/telegram-bot`, `/api/reconcile`, `/api/health` (new) | Clerk-public **+ own secret enforced in-handler** (`x-cron-secret`, or Telegram webhook secret). |
| **Auth (Clerk)** | `/sign-in`, `/sign-up` | Public. |

- `src/middleware.ts`: `isPublicRoute` matcher lists **only** Machine + Auth routes; everything
  else is `auth.protect()`ed. (Replaces tonight's partial whitelist.)
- **Defense-in-depth:** each Machine route validates its own secret in-handler, so a middleware
  misconfig cannot expose it. `/api/telegram` (UI test-ping, no secret of its own) stays Browser
  (Clerk) — it is NOT made public.
- **`/api/reconcile` gains an `x-cron-secret` check** (currently has none). The **autopilot**
  worker's `reconcile_run` must forward `x-cron-secret` on its call to the web `/api/reconcile`
  → coordinated 2-repo change (web adds the check; autopilot adds the header from a secret env).

## Section 2 — Remove the HTTP fan-out

`analyzeStock()` (+ helpers `fetchFundamentals`, `getAvCache`, `fetchCode33`, `buildEpsQuarters`)
currently lives **inline** in `src/app/api/stocks/route.ts` (≈line 208) — which is why cron routes
HTTP-fetch the route instead of importing a function.

- **Extract** these into a new shared module `src/lib/analyze-stock.ts` (single source of truth).
- `/api/stocks/route.ts` → thin wrapper importing `analyzeStock` (browser path identical, delegates).
- `/api/cron/{analyze,report,daily}` → import `analyzeStock`, `Promise.all`-map over the portfolio
  **in-process**; delete the `fetch(${baseUrl}/api/stocks)` blocks.

Result: no same-deployment self-HTTP, no internal auth hop, no per-call partial failure. After this,
`/api/stocks` is browser-only and needs no exposure.

## Section 3 — Regression guard (both layers)

**Layer 1 — Active probe `GET /api/health`** (Machine route, `x-cron-secret`):
- Exercises the real chain cheaply: analyze ONE sample symbol via shared `analyzeStock`, check KV
  connectivity, check `st_params` reachable.
- Returns `{ ok: boolean, checks: { data, kv, params }, sampleValid: boolean }`.
- A scheduled probe (cron-job.org job + GHA fallback) hits it ~30 min **before** the report window;
  on `ok:false` it POSTs `🚑 HEALTH FAIL: <failing checks>` to the alerts channel.

**Layer 2 — Self-validating reports:**
- In `/api/cron/report` (and `/api/cron/analyze`), after building the payload compute
  `validCount / total`. If `validCount === 0` OR `validCount < total * 0.5`, **suppress the
  misleading breadth report** and instead send `⚠️ PIPELINE DEGRADED — <failed>/<total> failed`
  to the alerts channel. A broken pipeline screams; it never emits a silent `0/0`.

## Section 4 — Report correctness

- **Header bug:** `🌅 Morning Brief` is hardcoded for all reports (incl. HK Close). Make it
  type-aware in `src/lib/telegram-report.ts`: `🌅 Morning Brief` for the US morning slot;
  `🌇 HK Close` / `🌆 US Close` for EOD slots. Derive from report type, not one constant.

## Section 5 — Testing & rollout

**TDD (project discipline — test before/with each change):**
- Characterization test: `analyzeStock` returns identical output for a fixed symbol fixture
  before vs. after extraction.
- Unit: degraded-detection threshold (0/15 → degraded; 15/15 → ok; 7/15 → degraded).
- Unit: per-route secret check (missing/wrong → 401; correct → proceeds).
- Unit/integration: `/api/health` → `ok:true` on good fixture; `ok:false` when data layer throws.

**End-to-end verification gates (must pass against live before "done" — the lesson from tonight,
verify output not just status):**
1. Browser route, unauthenticated → 307 → `/sign-in`.
2. Machine route, no secret → 401; with secret → 200.
3. `POST /api/cron/report?market=hk` (with secret) → report with **validCount == 15**, real breadth
   (not 0/0), correct header.
4. Forced failure (e.g. bad data env) → `⚠️ PIPELINE DEGRADED` alert fires (not a 0/0 report).
5. `GET /api/health` (with secret) → `ok:true`.

**Rollout:**
- One web PR (auth + extraction + guard + header are interdependent) → merge to `main` → Vercel deploy.
- Then the coordinated `autopilot` change: forward `x-cron-secret` to `/api/reconcile`.
- Run gates 1–5 against live; re-trigger the HK report and confirm the real one lands.
- Update `LIVE_STATE.md`: the two-system distinction (autopilot worker = execution alerts;
  web `/api/cron/*` = breadth report + web alerts) and that legacy cron-job.org jobs drive the
  breadth report (NOT redundant).

## Risks / open items

- **Secret rotation:** `CRON_SECRET` and `TELEGRAM_WEBHOOK_SECRET` already exist in Vercel env;
  `/api/reconcile` + autopilot must share `CRON_SECRET`.
- **Edge runtime:** middleware stays path-based only (no secret comparison at the edge) — secret
  checks remain in Node route handlers. Avoids edge env/runtime pitfalls.
- **Two-repo coordination:** the `/api/reconcile` secret is a breaking change for the autopilot
  reconcile call — ship the autopilot header change in the same window.
