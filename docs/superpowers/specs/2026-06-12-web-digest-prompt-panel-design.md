# Web Daily-Digest Prompt Panel — Design Spec

**Date:** 2026-06-12
**Status:** Approved (design)
**Author:** Claude + Steven

## Goal

Surface the same AI **Daily Digest** analysis (today produced by the `stock-morning-digest`
scheduled task → Telegram) at the **top of the web app dashboard**, as a **prompt-builder** — no LLM
API call, $0. Mirrors the existing Fundamental-tab pattern (`/api/fundamental` +
`FundamentalPrompts.tsx`): a server route embeds live data into a ready-to-paste prompt; the user
copies it into DeepSeek/Gemini web chat.

## Non-goals (YAGNI)

- No automated LLM call / no rendered narrative in-app (that's the rejected "Option C" — a Vercel
  cron + DeepSeek call; revisit later if wanted).
- No new Telegram behavior. The scheduled task is unchanged.
- No persistence/history of generated prompts.

## Approach

Direct clone of the Fundamental-tab prompt-builder, scoped portfolio-wide (not per-ticker).

### 1. Data + prompt assembly — `src/lib/digest/generateDigestPrompt.ts`

Server-side. Fetches the three live sources the scheduled task uses:
- KV `state` — `${KV_REST_API_URL}/get/state` with `KV_REST_API_TOKEN` (server env), same as `/api/state`.
- Kronos — reuse `fetchKronosForecasts()` (`src/lib/kronos.ts`).
- TimesFM — reuse `fetchTimesfmForecasts()` (`src/lib/timesfm.ts`).

**Pre-computes** per ticker (single source of truth = same formulas as the task; so the chat model
narrates, not computes): Kronos 20d % (`forward.p50[-1]/last_price-1`), TimesFM 20d %
(`price_targets.p50[-1]/last_price-1`) + `st_persistence.flip_risk`, downside-to-stop %
(`(price-stop)/price` for `dir=up`), distance-to-flip %, event/whipsaw tally from `events[]`,
optimized-vs-default params (default = ATR10 ×3.0).

Returns `{ prompt: string, fetchedAt: ISO, dataAsOf: state.updatedAt }`.

**Prompt template** = the morning-digest editorial spec, output target = a chat model (DeepSeek/
Gemini), so it OMITS the Telegram-only guardrails (no `<b>` HTML, no `.HK` stripping). Keeps:
stance-led bottom line · 3-block structure (Bottom line / What matters today = 3–5 bullets folding
forecast+risk+reliability into each / Watch) · state-each-number-once · ~180-word budget · Kronos-
noise caveat (lead on TimesFM + flip_risk; ignore Kronos beyond ~±25%) · **NEVER drop a fresh
EOD-confirmed flip** (overrides word cap). Followed by the pre-computed data snapshot (compact
per-ticker table + recent `events[]` + `lastAlert`).

The editorial-spec text lives in ONE exported constant (`DIGEST_EDITORIAL_SPEC`) with a header
comment: "MIRROR of the `stock-morning-digest` scheduled task prompt — edit both together
(Cross-Platform Consistency Rule)."

### 2. Route — `GET /api/digest-prompt`

Clerk-protected (browser-only, like `/api/fundamental`). Calls `generateDigestPrompt()`, returns the
JSON. `export const dynamic = "force-dynamic"`. On error → `{ error }`, 500.

### 3. Component — `src/components/DigestPrompt.tsx`

Clone of `FundamentalPrompts.tsx`. Always-visible panel. **Auto-fetches on mount**; shows a spinner
while loading, "Data as of {dataAsOf}", a **Refresh** button, the prompt in a `<pre>`/textarea block
with a **Copy** button, and links to chat.deepseek.com + gemini.google.com. One combined prompt →
one Copy button (digest is a single prompt, unlike Fundamental's five). Error state shows the message.

### 4. Placement — `src/app/page.tsx`

Render `<DigestPrompt />` at the top of the dashboard JSX, above the main results / `AlertsPanel`,
below the header bar. Styling matches the app's existing dark theme (reuse Fundamental-panel classes).

## Acceptance criteria

1. Panel renders at the top of the dashboard, auto-loads a prompt on mount.
2. Generated prompt embeds live KV `state` + both forecasts with the pre-computed numbers correct
   (spot-check: TSM downside-to-stop ≈ 6.0%, a Kronos artifact > ±25% is flagged/omitted, not shown raw).
3. Copy button copies the full prompt; DeepSeek/Gemini links open in new tabs.
4. No LLM API call anywhere in the path (grep: route/lib contain no `deepseek`/`fetch` to any chat API).
5. `npm run build` (dummy Clerk key) + vitest + `tsc` pass.
6. Editorial spec constant carries the "edit both together" comment.

## Verification

- Local: `npm run build` + vitest + typecheck only (Clerk-gated → local cannot render authed UI).
- Visual: **Steven, signed in, on the per-branch Vercel Preview URL** (per `[[web-preview-verification]]`).
- Delivery: PR to the web repo; **do not push / open PR without Steven's go-ahead.** Fresh-clone via
  `gh` before implementing (local checkout may be stale).

## Files touched

- NEW `src/lib/digest/generateDigestPrompt.ts`
- NEW `src/app/api/digest-prompt/route.ts`
- NEW `src/components/DigestPrompt.tsx`
- EDIT `src/app/page.tsx` (render the panel)
- EDIT `LIVE_STATE.md` / digest memory note (record the web↔task consistency coupling)
