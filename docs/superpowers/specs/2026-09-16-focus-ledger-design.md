# Focus ledger — design

**Status:** APPROVED and BUILT 2026-09-16 — Steven: *"Focus ledger, approved. Use your
recommendation."* Task 3.1 (`focus_ledger.py`) and Task 3.2 (wired into the 08:50 spec as
item `2b. FOCUS LEDGER`) are both done and verified mechanically. ⏳ The ONE unverified claim
is behavioural: the plan requires two consecutive mornings, with day 2 printing nothing.
**Date:** 2026-09-16 · **Phase:** Klaro port, Phase 3 (Tasks 3.1–3.3 in
`plans/2026-09-14-klaro-port.md`)

---

## The problem this solves

Every morning the debrief re-derives the macro frame from scratch. It reads KV, reads the
news email, and writes a fresh "Broader Context" section. Nothing carries over.

The cost is visible in the delivered emails. On 09-15 the frame was *"FOMC week, watch the
5% band."* On 09-16 the same story was rebuilt from zero and reached the same conclusion —
six names inside 5%, all trim-side — without either morning knowing the other had said it.
Three consequences:

1. **Repetition reads as news.** A theme that has not changed is re-argued every day at the
   same length, so a genuinely new development has to compete with four old ones for
   attention.
2. **Nothing is ever wrong.** The debrief's framing cannot be falsified because it is never
   held long enough to be tested. This is the same defect the triplet was built to fix,
   one level up: prose about the world, rather than prose about a ticker.
3. **You cannot see what moved.** Answering "what actually changed since yesterday?" means
   diffing two emails by eye.

## What it is

A small set of **focus records**. Each is one theme currently in play, held across days,
with an explicit falsifier. The debrief reads them, updates them, and prints **only what
changed** — about five lines. A quiet morning prints nothing.

This is deliberately the *smallest* thing that fixes the problem. It is not a research
database, not a thesis tracker, and not a news archive.

## Data model

One record:

| field | type | notes |
|---|---|---|
| `id` | string | stable, e.g. `f2026-09-16-fed-path`; never reused |
| `opened` | `YYYY-MM-DD` | HKT session date the theme entered the ledger |
| `title` | string | one clause, ≤ 80 chars — it has to fit one email line |
| `category` | enum | `macro` · `rates` · `commodity` · `sector` · `idiosyncratic` |
| `direction` | enum | `intensifying` · `stable` · `fading` |
| `state` | enum | `opening` · `intensifying` · `stable` · `fading` · `resolved` |
| `evidence` | string[] | ≤ 5 short citations, newest first |
| `beneficiaries` | string[] | tickers the theme should HELP |
| `pressured` | string[] | tickers it should HURT |
| `falsifier` | object | see below — **mandatory** |
| `resolved` | object? | `{date, outcome: confirmed|refuted|expired, note}` |

`falsifier` is either:

- `{"kind": "level", "ticker": "SPY", "op": "<"|">", "value": 755.67, "by": "2026-09-20"}` —
  machine-checkable, and the preferred form; or
- `{"kind": "review", "by": "2026-09-23", "note": "…"}` — an explicit review date, used only
  when no clean level exists.

⛔ **A record with no falsifier is invalid.** That is the whole design: an unfalsifiable
theme is exactly the free prose this replaces.

## Storage — decision

**Recommended: KV, keys `focus_log` (JSON array, cap 60) + `focus_meta`
`{version, updatedAt}`.** Never touch `state`.

| option | for | against |
|---|---|---|
| **KV `focus_log`** *(recommended)* | shared with the web app, so a future panel can show it; survives a machine change; the write token is confirmed working (2026-09-14) | needs a local snapshot for the diff; a write failure is silent unless checked |
| local CSV, like `triplet_log.csv` | simple, testable, offline, append-only history for free | invisible to the web app; a second stateful store with different rules |
| JSON file in the repo | versioned | a daily commit for ephemeral state; conflicts with the data-branch flow |

The triplet went to CSV because it is an **append-only log of independent claims**. The
focus ledger is a **mutable set of live objects** — the same shape as `state`, which lives
in KV. Different shape, different store.

## The email block — decision

**Recommended: diff-only, ≤ 5 lines, silence when nothing moved.**

```
🎯 FOCUS
+ OPENED   Fed path — hike ~93% priced into tonight's decision │ refuted if SPY closes > 762 by 09-18
→ MOVED    AI capex repricing — now at the edges, not the centre │ was: centre
- CLOSED   Brent supply shock — refuted: Brent closed below $100 on 09-15
```

| option | for | against |
|---|---|---|
| **diff only, ≤5 lines** *(recommended)* | a quiet day is genuinely quiet; the block earns its space | a new reader cannot see the full picture |
| full re-render each day | self-contained | that is the current problem, restated |
| diff in the email, full list in the web app | both | needs the web panel (not built) |

Full state is always available on demand via `focus_ledger.py read` — the email is a
notification, not a report. This is the 09-10 merge lesson: depth goes to the pull surface.

⛔ **A diff that always fires is noise.** If nothing changed, print nothing — not
"no change today". Same rule as the removed `[calendar gap]` tag and the empty-section rule.

## Lifecycle

- **Open** — the debrief may open at most **one** focus per day. A theme that needs more
  than a day to qualify is not yet a focus.
- **Update** — `direction` and `evidence` may change daily; `evidence` is newest-first, ≤5.
- **Resolve** — only when the record's own falsifier is met, or on its `by` date. The
  closing note must quote the falsifier and the observed value.
- **Cap** — max **5 open** at once. Opening a sixth requires closing or dropping one. The
  cap is the forcing function that keeps this from becoming a second news feed.

⛔ **The model may not close a record because it "feels resolved."** Closure is decided by
the falsifier, and the note must show the number. A self-graded ledger is the failure mode
this is meant to prevent.

## Health gate (Task 3.3)

After **30 days**, `focus_ledger.py health` reports median days-to-resolution and the share
closed by their own falsifier. **If median > 30 days, or the falsifier share is near zero,
the object model is wrong — revise or kill it.** Same discipline as the triplet's audit: a
mechanism that cannot fail is not measuring anything.

## Files

| file | change |
|---|---|
| `~/Claude/tools/focus_ledger.py` | NEW — `read` / `diff` / `apply <patch.json>` / `health` |
| `~/.claude/scheduled-tasks/.../SKILL.md.disabled` | add the diff block + the state enum |
| `~/Claude/tools/tests/test_focus_ledger.py` | NEW |

## Failure modes to design against

1. **The ledger becomes a second news feed.** Mitigated by the 5-open cap and by requiring
   a falsifier to open. If `health` shows themes living forever, the cap is too loose.
2. **Silent write failure.** A KV write that 500s while the email reports success. Mitigate:
   read back after `apply` and report the outcome in the audit block, exactly as the triplet
   ledger does.
3. **The diff drifts from the store.** Mitigate with a local snapshot (`.focus_snapshot.json`)
   as the diff contract, mirroring `.digest_snapshot.json`. A missing snapshot must be
   reported as "baseline missing", never rendered as a wall of changes.
4. **Parse failure clobbering state.** `apply` must abort if the existing `focus_log` fails
   to parse, rather than overwriting it. Same rule as the KV race guard.
5. **Stale falsifiers.** A `by` date in the past with no resolution is a bug, not a state —
   `read` must flag it loudly.

## Verification plan

| step | pass condition |
|---|---|
| `apply` a fixture patch, then `read` | the patch round-trips; `state` untouched |
| `diff` twice with no change | the second run prints **nothing** |
| `diff` after a one-field change | exactly one line, naming that field |
| `apply` a record with no falsifier | rejected, ledger byte-identical |
| `apply` a sixth open record | rejected with the cap named |
| a `by` date in the past, unresolved | flagged by `read` |
| `health` on a synthetic 30-day fixture | median and falsifier share computed correctly |

## Open questions — RESOLVED 2026-09-16

Steven approved the recommendation on all three, so these are now decisions, not options:

1. **KV, not CSV.** `focus_log` + `focus_meta`. The triplet is an append-only log of
   independent claims; this is a mutable set of live objects — the same shape as `state`.
   ✅ Verified live: `state.version` 304 before and after the first write.
2. **Cap stays at 5 open.** Tight enough to force a choice, loose enough not to strangle
   a genuinely busy week.
3. **No triplet linkage in v1.** Coupling two systems that currently fail independently
   would mean one bug takes out both.

Two further decisions made while building (both enforced in code, see Task 3.1 notes):
the **falsifier is immutable**, and **evidence churn is not a diff trigger** — otherwise the
block fires every morning, and a diff that always fires is noise.
