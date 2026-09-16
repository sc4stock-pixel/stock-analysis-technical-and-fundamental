# Klaro Port Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. Work top to bottom; each
> phase ends with a verification command whose output must be quoted before proceeding.

**Goal:** Port three Klaro-derived capabilities into the stack: (1) a realized-NAV summary
line on the push surface, (2) a beneficiary/pressured/verify triplet on morning news with a
falsification test, (3) a persistent focus ledger with falsifiers and closure.

**Architecture:** All three are **local tools plus debrief-prompt edits**. No web-repo
application code changes this pass. The web repo receives only docs (this plan and the
approved spec). The deferred web panel for the focus ledger is a separate future effort.

**Tech Stack:** Python 3.13 (`~/Claude/tools/`, same pattern as `trigger_card.py` and
`lint_debrief.py`), Vercel KV (Upstash REST), the WorkBuddy debrief automation prompt.

**Approved spec:** `docs/superpowers/specs/2026-09-14-klaro-port-design.md`

---

## Hard constraints (do not violate)

1. **Never write the `state` KV key.** The focus ledger writes a *new* key `focus_log`
   only. `state` is owned by the autopilot worker; a bad write there breaks production.
   Every KV write is read-modify-write with a schema check and an abort on mismatch.
2. **`navStats.ts` is the source of truth** for NAV math. `nav_line.py` mirrors it and
   carries a header saying so. Drift is caught by a frozen-fixture test.
3. **The debrief prompt is a MIRROR.** The inline automation prompt and
   `~/.claude/scheduled-tasks/daily-morning-debrief-v1/SKILL.md.disabled` must stay
   byte-identical. Re-sync, stage, `diff` FIRST, then run `check_spec_drift.py` and confirm
   no NEW findings.
4. **The focus ledger emits a diff, never a re-render.** ≤5 lines.
5. **Do not touch** `apps-script/morning-portfolio-news.gs` — it carries 198 uncommitted
   lines of live v19 work (see below).
6. **Do not rotate the prod Clerk key.** No `git add -A` in `~/Claude/GitHub`.

## Prerequisite: the MPN v19 working-tree change

`apps-script/morning-portfolio-news.gs` is modified but uncommitted: **+198 / −17**, the
v19 news-identity fix. The repo copy has exactly **one** commit ever (`f396005`, 2026-06-15
— the v18 snapshot), so this file is a *snapshot copy*, not a deployment mechanism.

**Verified 2026-09-14 from delivered email:** v19 is **already LIVE**. Pre-fix MPN emails
(Aug 18/20/22) carried impostor headlines under two tickers; from Aug 26 onward they are
clean and show the real companies.

- `0939.HK` "CCB" ← *Coastal Financial Corporation (NASDAQ:CCB)* securities-fraud notices
  (Aug 18, 20, 22) → gone Aug 26, replaced by China Construction Bank items.
- `1211.HK` "BYD" ← *"COHEN & STEERS, INC. Expands Boyd Gaming Corp (BYD) Stake"* (Aug 22)
  → gone by Sep 05.

So this is a **repo-sync gap, not undeployed work**. Committing it is Steven's call and is
independent of this plan; build #2 reads MPN output and is safe to build either way.

---

## File structure

| File | Repo | Responsibility |
|---|---|---|
| `~/Claude/tools/nav_line.py` | local | NEW — read KV `nav_history`, print the 3-line NAV block |
| `~/Claude/tools/tests/test_nav_line.py` | local | NEW — frozen-fixture parity test |
| `~/Claude/tools/triplet_log.py` | local | NEW — append/validate triplet rows |
| `~/Claude/tools/triplet_audit.py` | local | NEW — falsification: beneficiary vs pressured at T+5 |
| `~/Claude/tools/focus_ledger.py` | local | NEW — `read` / `diff` / `apply` / `health` |
| `~/Claude/state/triplet_log.csv` | local | NEW — the triplet ledger |
| `~/.claude/scheduled-tasks/daily-morning-debrief-v1/SKILL.md.disabled` | local | Prompt edits |
| WorkBuddy automation `automation-1788343266011` prompt | — | Mirror edits |
| `docs/superpowers/specs/2026-09-14-klaro-port-design.md` | web | Approved spec (done) |
| `docs/superpowers/plans/2026-09-14-klaro-port.md` | web | This plan |

---

## Phase 1 — Realized-NAV line

### Task 1.1: `nav_line.py`

**Files:** Create `~/Claude/tools/nav_line.py`, `~/Claude/tools/tests/test_nav_line.py`

- [ ] **Step 1: Freeze a fixture.** Dump today's KV `nav_history` to
  `~/Claude/tools/tests/fixtures/nav_history_frozen.json`. Compute the expected values with
  `node` against the real `src/lib/navStats.ts` logic, and hard-code those numbers into the
  test. The fixture is the contract between the two implementations.
- [ ] **Step 2: Implement.** Mirror `computeRegionStats` exactly: `nav`, `benchNav`, `bhNav`,
  `asymNav`, `totalReturnPct`, `asymTotalReturnPct`, `asymObservations`, `bhTotalReturnPct`,
  `maxDrawdownPct`, `annSharpe`. Replicate the null semantics: `bench_ret ?? 0`,
  `bh_ret ?? 0`, and `asym_ret` **absent means "line not started", never 0%**.
- [ ] **Step 3: Emit** exactly three lines plus a caveat line:

```
📈 REALIZED NAV — signal portfolio, not your book
US  NAV {±X.X%} vs SPY {±Y.Y%} │ Asym(100/70/40) {±Z.Z%} ({N}d) │ MaxDD {-A.A%}
HK  NAV {±X.X%} vs HSI {±Y.Y%} │ Asym(100/70/40) {±Z.Z%} ({N}d) │ MaxDD {-A.A%}
⚠️ NAV keys on RAW SuperTrend dir, not the SMA50 gate — looser than the traded strategy.
```

Buy & hold appended only when `bhTotalReturnPct is not None`. α/β omitted below 60 obs.

- [ ] **Step 4: Verify.** Run the test; then run the tool live and diff its numbers against
  the panel's own values for the same KV version. **Quote both.**
- [ ] **Step 5: Failure mode.** If KV is unreachable or `nav_history` is empty, print
  `⚠️ REALIZED NAV UNAVAILABLE — <reason>` and **omit the block**. Never print zeros, and
  never let a silent omission read as "flat".

### Task 1.2: Wire into the debrief prompt

- [ ] Insert the block **immediately after Phase 1.0 and before Phase 1**. It must NOT go
  inside Phase 1.0 — that block is hard-capped at 15 lines and this is performance, not
  action. Add an explicit sentence saying so, or a future edit will fold it in.
- [ ] Re-sync both prompt mirrors; `diff` first; run `check_spec_drift.py` and confirm no
  NEW findings.
- [ ] **Verify:** next morning's debrief contains the block with the panel's numbers.

---

## Phase 2 — Beneficiary / pressured / verify triplet

### Task 2.1: Ledger tool

**Files:** Create `~/Claude/tools/triplet_log.py`

- [ ] Schema: `date,region,role,ticker,in_universe,source_headline` where
  `role ∈ {beneficiary,pressured,verify}` and `in_universe` is `1`/`0` against
  `portfolio.json`.
- [ ] `--append` reads rows from stdin as JSON, validates the schema and that `ticker`
  matches `^[A-Z0-9.]{1,10}$`, and appends. Reject the whole batch on any bad row rather
  than writing a partial one.
- [ ] `--stats` prints counts by role and the share of rows with `in_universe=0`.
- [ ] **Verify:** append a fixture batch, confirm row count, then confirm a deliberately
  malformed row is rejected and **nothing** is written.

### Task 2.2: Prompt change

- [ ] Replace the `LEADS` / `RISK TO WATCH` prose in Phase 1 §3 with the triplet, **maximum
  3 items per day total**, so email length stays flat. Keep the `⚡ / 🔄 / ⚠️` prefix and
  stop-distance badge rules untouched.
- [ ] Hard constraint in the prompt: **at least one of {beneficiary, pressured} must be
  outside `portfolio.json`**, marked `◦`. If the model cannot find one, it must say so in
  one line rather than inventing a name.
- [ ] The prompt must call `triplet_log.py --append` with the emitted rows.
- [ ] **Verify:** one morning's run produces rows in the CSV matching the email verbatim.

### Task 2.3: Falsification harness

**Files:** Create `~/Claude/tools/triplet_audit.py`

- [x] Fetch forward closes (T+1/T+3/T+5) for every logged ticker via yfinance, including
  outside-universe names. *Built 2026-09-16: `forward_return()` with a disk price cache so
  `--offline` re-runs are reproducible. A fetch failure yields `None` (unmeasurable), never
  0.0 — the `worker/nav.py` L2 bug must not reappear in the scorer.*
- [x] Paired test: mean forward return of `helps` rows vs `hurts` rows, using the
  `max(c,−c)` bar from `forecast_probation_audit.py::_verdict()`. *Roles are `helps`/`hurts`
  after the 2026-09-15 rename. `wilson`/`binom_p`/`_stat` are copied from that file and
  pinned by a parity test that runs against the original — verified identical, not assumed.*
- [x] Gate at **≥30 paired observations**. Below that, print `INSUFFICIENT DATA (n/N)` —
  never a verdict.
- [x] **Pass condition:** helps mean > hurts mean at T+5 with a positive effective lower
  bound. **If it fails, kill the triplet** and say so plainly.
- [x] Extra guards beyond the plan: entry is the close BEFORE the publication date (the
  08:50 HKT publish precedes the session it predicts); `n_eff = n / horizon` overlap
  correction; a `MIXED — do not act` verdict when the hit rate passes but the mean spread's
  lower bound is not positive; `verify` rows reported but never scored.
- [x] **Verify:** `pytest tests/test_triplet_audit.py` — 26 passed. Live ledger run prints
  `INSUFFICIENT DATA (0/30)` with 2026-09-16 correctly classified `pending`, not a miss.
- [ ] **Not wired into the debrief prompt, deliberately.** A daily `INSUFFICIENT DATA (1/30)`
  line is always-firing noise; the gate needs ~30 sessions. Revisit when `n` approaches 30,
  or run it monthly.

---

## Phase 3 — Focus ledger

### Task 3.1: `focus_ledger.py`

**Files:** Create `~/Claude/tools/focus_ledger.py`

- [x] KV key `focus_log` (JSON array, cap 60) + `focus_meta` (`{version, updatedAt}`).
  **Never touch `state`.** Use the write token `KV_REST_API_TOKEN`.
  ✅ Built 2026-09-16. `KvStore.set_many()` writes both keys in ONE pipeline call and then
  **reads them back** — a silent write failure would otherwise have the email reporting a
  change the store never received. Verified live: `state.version` 304 before and after.
- [x] Subcommands:
  - `read` — print open records (`--json` for the raw array).
  - `diff` — compare against the last rendered snapshot and print ≤5 lines:
    `opened / advanced / falsified / closed`. The `🎯 FOCUS` header is a label, not a
    change line, so it sits outside the cap. `--commit` writes the new baseline and must
    be called ONLY after the email is confirmed sent, or the diff is consumed by a render
    that never reached Steven.
  - `apply <patch.json>` — validate, then read-modify-write. Abort if the existing
    `focus_log` fails to parse rather than overwriting it. `--dry-run` validates only.
  - `health` — median days-to-resolution and the share closed by their own falsifier.
- [x] Record fields per the spec: `id, opened, title, category, evidence[], direction,
  beneficiaries[], pressured[], state, falsifier, resolved, outcome`, with
  `state ∈ {opening, intensifying, stable, fading, resolved}`.
- [x] **Verify:** `apply` a fixture patch, `read` it back, confirm `state` is untouched and
  the other keys still resolve. Then run `diff` twice with no change and confirm it prints
  nothing — a diff that always fires is noise.
  ✅ 64 tests, all passing; 233 across `~/Claude/tools`. Live KV round-trip proven with a
  non-empty ledger (em-dash, `│`, `±`, curly quotes, `é` all survived), then cleared to `[]`.

**Two decisions made while building, both recorded in the tool's docstring:**

1. ⛔ **The falsifier is IMMUTABLE.** `update` cannot touch it — changing the claim means
   closing the record and opening a new one. Moving the goalpost is the exact failure mode
   the ledger exists to prevent.
2. ⛔ **The falsifier states the REFUTING condition**, so MEETING it means the theme is
   *refuted* and surviving it means *confirmed*. The first implementation had this inverted
   (`confirmed` required the level to be unmet) and a test encoded the same inversion, so
   the suite passed. Both are fixed. Worth remembering: **a test can encode the bug.**
   The tool now checks a `level` resolve against the falsifier itself, so a resolve cannot
   simply assert the flattering outcome.
3. Evidence churn is deliberately NOT a diff trigger — evidence accrues most days, so
   diffing on it would fire every morning.

⚠️ **Known limitation (v1):** the `observed` value on a resolve is supplied by the model and
is NOT independently verified against a price source, so `health`'s falsifier share is
self-reported. Wiring it to `triplet_audit.py`'s price source is the obvious follow-up.

### Task 3.2: Wire into the debrief prompt

- [x] Add the ≤5-line diff block. Prompt must state explicitly: **diff only, never a
  re-render**, and must list the `state` enum so the model cannot invent values.
  ✅ Applied 2026-09-16 as a new item `2b. FOCUS LEDGER` (no renumbering — sections
  cross-reference by number). The block states: paste the tool's stdout VERBATIM; never
  re-render the records as a list; never add a line the tool did not print; never write your
  own header; **silence is the correct output** and the section is omitted when nothing moved.
  It also carries the maintenance rules (one open/day, falsifier IMMUTABLE, resolve needs
  `observed` quoted and checked, never close via `update`, the five `state` values, cap 5,
  `apply` is the only writer).
- [x] Re-sync mirrors; `check_spec_drift.py`.
  ✅ Drift re-run == baseline **5/5**. No mirror to re-sync: the dispatcher is hash-FREE by
  design (it instructs the run to *compute* the spec's sha256), so a spec edit leaves nothing
  stale in the prompt.
- [x] **Verify:** two consecutive mornings. Day 2 with no real change must print nothing.
  ⏳ **PENDING — this is the only unverified claim.** The ledger is empty, so the first live
  run will print nothing at all and the audit block should read
  `Focus ledger: silent (nothing moved)`. The real test is the first morning with a genuine
  opening, then the morning after it.
- [x] Delivery: `diff --commit` added as step 3 of the send, **only if curl exited 0** —
  committing after a failed send would consume the diff and tomorrow would report a change
  Steven never received. Audit block gained a `Focus ledger:` line (D3 parity).

### Task 3.3: Health review (deferred gate)

- [ ] After 30 days, run `health`. If median days-to-resolution > 30 **or** the falsifier
  share is near zero, the object model is wrong — revise or kill it.

---

## Verification summary

| Phase | Command | Pass condition |
|---|---|---|
| 1 | `pytest ~/Claude/tools/tests/test_nav_line.py` | parity fixture matches |
| 1 | live run vs panel | identical numbers for the same KV version |
| 2 | `triplet_log.py --stats` | rows match the email; ≥1 outside-universe per day |
| 2 | `triplet_audit.py` after 30 pairs | beneficiary > pressured at T+5, else kill |
| 3 | `focus_ledger.py diff` twice | second run silent |
| 3 | `focus_ledger.py health` after 30d | median resolution < 30d |

## Open items for Steven

- [ ] Commit the MPN v19 working-tree change? Independent of this plan.
- [ ] `scripts/__pycache__/` and `scripts/test_forecast_verdict.py` are untracked — decide.
- [ ] Checkout is 64 commits behind `origin/main`; refresh before any repo work.
