# Lessons

Patterns captured after corrections, to prevent recurrence.

## 2026-06-20 — Branch from a freshly-fetched `origin/main`, and inspect `origin/main`, not the local working tree

**What went wrong:** Built the `feat/trade-log-viewer-and-fill` branch on a local `main`
that was **98 commits behind `origin/main`**. The Vercel preview was then missing real prod
features (Alerts panel redesign / "Act on this", Autopilot Realized NAV panel). I also
wrongly declared "`NavPanel` / `/api/nav` don't exist, so the deferral note is stale" —
because I grepped the **stale local working tree**, not `origin/main`.

**Root cause:** I ran `git fetch` and read `origin/main`'s HEAD *SHA* at session start, but
then did all code inspection (greps, file reads) against the local checkout, and branched
from local `main` without confirming it equalled `origin/main`. This is exactly the failure
the Session Start Protocol warns about ("THE LOCAL CHECKOUT MAY BE STALE").

**Rule for next time:**
1. Before creating a feature branch: `git fetch origin && git checkout main && git pull`
   (or `git branch <feat> origin/main`). Confirm `git rev-list --count HEAD..origin/main` == 0.
2. Any "does X exist / how is X built" claim must be checked against `origin/main`
   (`git show origin/main:<path>`, `git ls-tree origin/main`), never the working tree alone.
3. If a deferral/handoff note references a file or pattern, verify it on `origin/main`
   before declaring it "stale" — the note is likely right and the local copy is behind.

**Recovery that worked:** `git merge origin/main` into the feature branch, resolved the one
`page.tsx` conflict (keep both NavPanel + TradeLogPanel), re-ran tsc/tests/build, re-pushed.
Then realigned `TradeLogPanel`/`/api/trades` to mirror the real `NavPanel`/`/api/nav`
pattern (self-fetching panel, no props).
