# Trade-log viewer + Telegram `/fill` — design

**Date:** 2026-06-20
**Branch:** `feat/trade-log-viewer-and-fill`
**Status:** approved (design)

## Context

The autopilot worker writes a per-trade attribution log to Vercel KV key `trade_log`
(`worker/trade_log.py`, live on autopilot `origin/main`). One record per `flip_buy`
(`entry`) / `flip_exit` (`exit`) alert, carrying signal-time technical + fundamental
context plus `params_source` (so the A1 gate's live performance is auditable).

As of 2026-06-20 the live key holds **4 records** (2 entry, 2 exit), 0 filled:
`SPY|2026-06-10|exit`, `3033.HK|2026-06-11|exit`, `0939.HK|2026-06-12|entry`,
`3033.HK|2026-06-12|entry`.

Each record already reserves `actual_fill_price` / `actual_fill_date` (both `null`) for
"a future Telegram /fill command", and exit records carry pairing fields
`entry_id` / `signal_return_pct` / `hold_days` computed at append time by `pair_exit`.

Two deferred builds, now in scope:
1. **Web viewer** — `/api/trades` route + panel to read and analyze `trade_log`.
2. **Telegram `/fill`** — record `actual_fill_price`/`actual_fill_date` against a record
   id (`ticker|date|type`) → signal-vs-execution **slippage**.

### Verified-state notes (carried from inspection)
- "Mirror the NAV panel pattern" (original deferral note) is **stale**: there is no
  `NavPanel` and no `/api/nav` route in the web app. The patterns actually mirrored here
  are `src/app/api/state/route.ts` (KV read) and the read-only panels
  `OpenPositionsPanel` / `AlertsPanel`.
- `/fill` is the **first write-capable bot command**. The webhook is gated only by
  `TELEGRAM_WEBHOOK_SECRET` (covers all commands). `/fill` adds a per-message admin
  check on top.

## Approach

**Approach C — surgical split (chosen).** Python remains the sole author of record
creation and entry/exit pairing. The TS `/fill` handler only **patches the two reserved
fields** (`actual_fill_price`, `actual_fill_date`) on an existing record found by id; it
never creates or pairs records. Slippage is **derived on read**, not stored, via one
shared helper used by both the web panel and the `/fill` echo.

Rejected:
- **A (web fully co-owns the record schema in TS):** drift risk between the Python
  author and a second full TS writer.
- **B (`/fill` enqueues; worker applies next GHA run):** fills not immediate; extra
  moving parts; worse UX.

Why C: honors the worker's literal "reserved for /fill" contract, keeps Python as schema
authority, gives immediate UX. Minor accepted risk: two processes touch the key
(manual fills vs scheduled worker runs) — race is negligible and each does a full
read-modify-write of the array.

## Slippage definition (Q1 = "both raw % + adverse flag")

- `slippagePct = (actual_fill_price / signal_price - 1) * 100` — signed raw, rounded 4dp.
- `adverse` (direction-aware, `true` = worse execution than signal):
  - `entry`: `actual_fill_price > signal_price` → adverse (paid up).
  - `exit`:  `actual_fill_price < signal_price` → adverse (sold lower).
- Returns `null` when the record is unfilled or either price is falsy / non-finite.

## Components

### 1. `src/lib/slippage.ts` (new — single source of truth)
- `computeSlippage(rec): { slippagePct: number; adverse: boolean } | null`
- `summarize(recs): { filled, unfilled, avgPct, medianPct, pctAdverse, byParamsSource }`
  where `byParamsSource = { optimized: {...}, default_fallback: {...} }` (same shape,
  per `params_source`).
- Non-finite tolerant: skip records whose `signal_price` or `actual_fill_price` is
  falsy / `NaN` / `Infinity`. No throw on bad data.
- Mirrors the `forecastBox` single-helper pattern so the panel and `/fill` echo can't
  diverge.

### 2. `src/app/api/trades/route.ts` (new)
- Mirrors `src/app/api/state/route.ts`: `export const dynamic = "force-dynamic"`,
  `GET`, `KV_REST_API_URL` + `KV_REST_API_TOKEN` (same vars `/api/state` uses — proven
  present in Vercel; the read-only token's presence in Vercel is unverified, so reuse the
  proven var to avoid a 503), `cache: "no-store"`, 503 when unconfigured, 502 on KV error.
- **Reader NaN guardrail (CLAUDE.md):** strip `\bNaN\b` → `null` on the raw string
  before `JSON.parse`; drop any record that is still non-finite where it matters.
- Returns the `trade_log` array (or `[]` when key empty).

### 3. `src/components/TradeLogPanel.tsx` (new)
- **Summary block:** filled vs unfilled count; avg + median slippage %; % adverse;
  **split by `params_source`** (optimized vs default_fallback) — directly audits whether
  optimized params execute better than the default fallback.
- **Table** (sortable): date · ticker · type · signal_price · fill price · slippage %
  (color: adverse = red, favorable = green, unfilled = muted "—") · params_source ·
  tt_score.
- Reuses the read-only-panel idiom of `OpenPositionsPanel` / `AlertsPanel`
  (`InfoTooltip` for the slippage column header is in-keeping but optional).
- Visual sign-off is **signed-in, on the per-branch Vercel Preview** (Clerk-gated;
  local clone can't render the authed UI).

### 4. `src/app/api/telegram-bot/route.ts` (edit — add `/fill`)
- **Auth:** new env `TELEGRAM_ADMIN_CHAT_ID`. In the command dispatcher, when
  `cmd === "/fill"`, act only if `String(chatId) === process.env.TELEGRAM_ADMIN_CHAT_ID`;
  otherwise reply "⛔ Not authorized." Read commands (`/check`, `/portfolio`) unchanged.
- **Syntax (Q2 = hybrid):**
  - `/fill` (bare) → list unfilled records, numbered, each showing id + signal_price.
  - `/fill <TICKER> <price> [date]` → infer the most-recent **unfilled** record for that
    ticker. If >1 unfilled candidate, reply listing them and ask for the explicit id.
  - `/fill <id> <price> [date]` → explicit (detected by `|` in the first arg).
  - `date` optional → defaults to **today (HKT)** trading date; validate `YYYY-MM-DD`.
  - `price` must parse to a finite positive number, else usage error.
- **Write (patch-only):** read `trade_log` (apply the same NaN-strip as the reader),
  find record by id, set `actual_fill_price` + `actual_fill_date` only, write back via
  KV `set/trade_log` with the read-write token. Reject non-finite before write
  (Python uses `allow_nan=False`; TS must refuse to write `NaN`/`Infinity`). Preserve the
  worker's `MAX_ENTRIES = 500` trailing-slice semantics (slice last 500 before write).
  Re-fill of an already-filled record overwrites in place (no audit field).
- **Echo:** reply with the patched record's ticker/type, signal vs fill price, and the
  computed `slippagePct` + adverse/favorable label (via `slippage.ts` logic).
- **Telegram formatting guardrails:** strip `.HK` from tickers in message text
  (auto-linkify); `htmlEscape` any `<`/`>`; numbers inside `<pre>` are fine.

## Scope guards (YAGNI)
- **No** EOD-report / digest / pending-fills-nudge changes this session (Q5 = web + echo
  only). EOD-report slippage line is the flagged natural follow-up.
- **No** worker / Python changes — `trade_log.py` already reserves the fields.
- **No** record creation or pairing in TS — patch-only.
- **No** `filled_at` / audit field (Q3 = allowlist only, no audit variant).

## Verification plan
- `slippage.ts`: unit tests (vitest) — entry/exit adverse logic, unfilled→null,
  non-finite→skip, summary math incl. `byParamsSource` split.
- `/api/trades`: build + type check; NaN-strip unit coverage if a test harness exists for
  routes; manual curl against KV in preview.
- `TradeLogPanel`: frontend-design prototype first; visual sign-off on Vercel Preview
  signed in.
- `/fill`: `npm run build` + vitest; live smoke test against the bot in a controlled
  chat (admin chat-id), verifying KV record patched and echo correct. Confirm a
  non-admin chat is rejected.

## New env vars
- `TELEGRAM_ADMIN_CHAT_ID` — set in Vercel (and `.env.local` for reference). Steven's
  chat id; pasted manually (Vercel marks secrets Sensitive → `vercel env pull` redacts).
