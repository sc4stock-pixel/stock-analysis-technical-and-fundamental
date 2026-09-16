# 2026-09-14 — Klaro-derived capability port (design)

Status: **DRAFT — awaiting Steven's approval. No implementation code written.**

Origin: competitive read of Klaro (iOS, HK/US retail research app) on 2026-09-14.
Steven's scope instruction: "proceed with your pick of 1+2 then 3."

## 1. Problem

Klaro carries four market primitives plus a holdings layer. Mapped against this stack:

| Klaro primitive | What exists here | Gap |
|---|---|---|
| Market focus (persistent event objects) | `research_ideas_log` — a template-fire log, not curated objects | no evidence trail, no falsifier, no closure |
| Beneficiary / pressured / verify triplet | nothing | universe is `portfolio.json`; structurally blind to the value chain |
| Sector lifecycle (breadth, turnover) | per-ticker SuperTrend + TT score only | no sector aggregation |
| Expectation odds over time | quoted in Morning Note prose, then lost | not retained as a series |
| Holdings vs index | `nav_history` → `/api/nav` → `NavPanel` (web only) | never reaches the push surface |

**Correction to the 2026-09-14 morning analysis.** That analysis read `nav_history` as the
book's P&L and reported "your book is −4.28pp behind SPY". It is not the book.
`src/lib/panelMeta.ts` defines it as *"Realized NAV of the published Autopilot signals
(equal-weight, prev-EOD SuperTrend longs, others cash) vs benchmark"*. The −4.28pp figure
is the **signal portfolio**, not Steven's holdings. The two null US rows are a handled
condition (`/api/nav` NaN-sanitises and drops poisoned entries), not a bug.

## 2. Deliverable 1 — realized-NAV line in the debrief

**This is a port, not a build.** `computeRegionStats()` already computes everything
needed. Only the push surface is missing it: the sole consumers of `navStats` are
`/api/nav` and `NavPanel`.

### Approaches considered

- **(a) Fetch `/api/nav` from the debrief.** Rejected. The route is Clerk-gated and the
  only KV credential available to the automation is read-only; it cannot authenticate to a
  machine endpoint. It would also make the debrief depend on prod being up.
- **(b) Reimplement the stats subset in Python at `~/Claude/tools/nav_line.py`.** RECOMMENDED.
  Reads KV `nav_history` directly with the read-only token. Same pattern as
  `trigger_card.py` and `lint_debrief.py`.
- **(c) Add machine auth to `/api/nav`.** Rejected as more work for the same result — the
  endpoint would still just be reading KV.

### Output (3 lines, placed immediately after Phase 1.0, NOT inside it)

```
📈 REALIZED NAV — signal portfolio, not your book
US  NAV +X.X% vs SPY +Y.Y% │ Asym(100/70/40) +Z.Z% (Nd) │ MaxDD -A.A%
HK  NAV +X.X% vs HSI +Y.Y% │ Asym(100/70/40) +Z.Z% (Nd) │ MaxDD -A.A%
⚠️ NAV keys on RAW SuperTrend dir, not the SMA50 gate — a looser strategy than the one
   traded. The Asym line uses the correct gate but only started 2026-08-28.
```

Buy & hold is included only when `bhTotalReturnPct !== null`, mirroring the panel.
α/β only at ≥60 paired observations (`MIN_OBS_FOR_REGRESSION`).

**Must sit outside Phase 1.0.** Phase 1.0 is hard-capped at 15 lines and this is
performance, not "actionable now".

### Parity risk

Two implementations of the same math (`navStats.ts` and `nav_line.py`) will drift.
Mitigation: `nav_line.py` carries a header naming `src/lib/navStats.ts` as source of truth,
and a fixture test asserts byte-identical output on a frozen `nav_history` sample.

## 3. Deliverable 2 — beneficiary / pressured / verify triplet

Generated in the **debrief pass**, not in the MPN Apps Script — that script is a pure RSS
fetcher (`apps-script/morning-portfolio-news.gs`) with no LLM call in it.

Replaces the current `LEADS` / `RISK TO WATCH` prose in Phase 1 §3, so net email length is
flat. Maximum **3 items per day total** (not per region).

```
🟢 BENEFICIARY — <TICKER> · <mechanism> · <the number>
🔴 PRESSURED   — <TICKER> · <mechanism>
👁 VERIFY      — <specific, checkable condition>
```

Hard constraint: at least one of {beneficiary, pressured} must be **outside
`portfolio.json`**, marked `◦` so it is visibly not a holding. This is the whole point —
it is what surfaces the second-order name.

### Falsification

Append every emitted triplet row to `~/Claude/state/triplet_log.csv`
(`date, region, role, ticker, in_universe, source_headline`). After ≥30 paired
observations, test whether beneficiary names outperform pressured names at T+5 using the
`max(c,−c)` bar already used by `forecast_probation_audit.py::_verdict()`.

**If the spread is not positive and significant, kill the triplet.** It is the one Klaro
primitive that is testable against data that already exists, so it gets tested rather than
assumed.

### Risk

Outside-universe names are LLM inference, not data — the MPN email only carries the 16
tickers. Every such name must be logged so the inference can be audited. This is also why
the triplet must land **after** the uncommitted MPN v19 news-identity fix is committed: if
MPN was pulling the wrong company's headlines for ambiguous names, any triplet built on it
was built on wrong inputs.

## 4. Deliverable 3 — focus ledger

KV key `focus_log` (JSON array, cap 60 entries), plus `focus_meta` for the version and
last-updated stamp. **Writable**: `KV_REST_API_TOKEN` is populated in `.env.local`
(len 62) — verified 2026-09-14. (Prior memory claiming only the read-only token was
populated is wrong.)

Object fields:

| Group | Fields |
|---|---|
| Identity | `id`, `opened`, `title`, `category` |
| Evidence | `evidence[]` — each `{date, source, fact}` |
| Verdict | `direction`, `beneficiaries[]`, `pressured[]`, `state` |
| Closure | `falsifier`, `resolved`, `outcome` |

`state` ∈ `opening | intensifying | stable | fading | resolved`.

### The hard constraint

The debrief emits a **diff, never a re-render** — `opened / advanced / falsified / closed`,
≤5 lines. A second, prettier rendering of what the equity notes already say is the exact
failure the 2026-09-10 digest merge existed to stop.

### Health metric

Track median days-to-resolution and the share closed by their own falsifier versus by
drift. A ledger where nothing ever closes is a diary, not a tracker — if the median
exceeds ~30 days or the falsifier share stays near zero, the object model is wrong.

### Deliberately deferred

The full-record web panel (pull surface) is a **follow-up pass**, not this one. Depth
belongs in the pull surface, but proving the object model comes first.

## 5. Non-goals (YAGNI)

- No web panel in this pass.
- No sector lifecycle / breadth / turnover — needs data that does not exist.
- No change to the NAV writer's gate in `autopilot/worker/nav.py` — it would break the
  continuous series α/β need.
- No Telegram. No new channel.
- No touching the uncommitted `apps-script/morning-portfolio-news.gs` change.

## 6. Risks and traps

1. **`navStats` duplication** — see §2 mitigation.
2. **Dirty tree** — `apps-script/morning-portfolio-news.gs` carries 198 uncommitted lines
   (v19 news-identity fix). Untracked: `scripts/__pycache__/`, `scripts/test_forecast_verdict.py`.
   Do not commit over it; do not `git add -A`.
3. **Checkout is 64 commits behind `origin/main`** — read via `git show origin/main:<path>`.
4. **Phase 1.0 line cap** — the NAV block must not be folded into it.
5. **The triplet's outside-universe names are inferences** — log and audit.
6. **The focus ledger must not become a diary** — see §4 health metric.
7. **Do not rotate the prod Clerk key.**

## 7. Approval gates

- [ ] Steven approves this spec
- [ ] Then, and only then, an implementation plan (writing-plans)
- [ ] Then implementation, one deliverable per PR
