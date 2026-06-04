# Dashboard Legend + Tooltips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app `ℹ️` tooltip to each dashboard panel plus one "How to read this dashboard" drawer, both driven by a single `panelMeta` config so the help text can never drift from the code.

**Architecture:** One source-of-truth module `src/lib/panelMeta.ts` exports the panel definitions + a freshness table. A small client component `InfoTooltip` renders the per-panel `ℹ️` popover from that config; `LegendDrawer` renders the full legend from the same config. The drawer is opened by a button added to the existing header in `src/app/page.tsx`.

**Tech Stack:** Next.js 14 (App Router), React 18 client components, Tailwind (arbitrary-value classes matching the existing dark theme), vitest for the one unit test.

**Workspace & deploy:** Implement in `/tmp/stock-analysis-push` (the canonical workspace per the repo CLAUDE.md). `git pull` to `origin/main` first, branch, implement, `npm run build` to verify, push for Vercel. Do NOT edit the stale `~/Claude/GitHub/...` clone.

**Theme tokens (from `globals.css`):** `--bg #0a0e1a · --card #0f1629 · --border #1e2d4a · --accent #00d4ff · --green #00ff88 · --red #ff4757 · --amber #ffa502 · --text #c8d8f0 · --dim #6b85a0 · --muted #4a6080`. Font: JetBrains Mono. Min font size 0.72rem.

---

## File Structure

- **Create** `src/lib/panelMeta.ts` — the single source of truth: `PanelMeta` interface, `PANEL_META` array (8 entries), `FRESHNESS` table, `getPanelMeta(id)`.
- **Create** `src/lib/panelMeta.test.ts` — vitest unit test (excluded from prod build via existing `tsconfig.exclude`).
- **Create** `src/components/InfoTooltip.tsx` — client component; the per-panel `ℹ️` button + popover.
- **Create** `src/components/LegendDrawer.tsx` — client component; the slide-in/bottom-sheet legend.
- **Modify** `src/app/page.tsx` — add `legendOpen` state, the header button (~line 395 header block), render `<LegendDrawer>`, add the Stock Card `ℹ️` to the "ALL:" tab strip (~line 458).
- **Modify** `src/components/AlertsPanel.tsx` (~line 367), `MacroPanel.tsx` (~line 146), `MacroPanelHK.tsx` (~line 145), `PortfolioSummaryBar.tsx` (~line 179), `OpenPositionsPanel.tsx` (~line 195), `ConfigPanel.tsx` (tab-bar row) — add `<InfoTooltip>` next to each existing panel title.

---

## Task 1: `panelMeta.ts` — single source of truth (TDD)

**Files:**
- Create: `src/lib/panelMeta.ts`
- Test: `src/lib/panelMeta.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/panelMeta.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PANEL_META, FRESHNESS, getPanelMeta } from "./panelMeta";

const EXPECTED_IDS = [
  "alerts", "macro-us", "macro-hk", "portfolio",
  "positions", "stock", "chart", "config",
];

describe("panelMeta", () => {
  it("has exactly the 8 expected panel ids", () => {
    expect(PANEL_META.map((p) => p.id)).toEqual(EXPECTED_IDS);
  });

  it("every entry has a non-empty label, meaning and cadence", () => {
    for (const p of PANEL_META) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.meaning.length).toBeGreaterThan(0);
      expect(p.cadence.length).toBeGreaterThan(0);
    }
  });

  it("getPanelMeta returns the entry by id and undefined for unknown", () => {
    expect(getPanelMeta("alerts")?.label).toBe("Execution Alerts");
    expect(getPanelMeta("portfolio")?.detail?.length).toBeGreaterThan(0);
    expect(getPanelMeta("nope")).toBeUndefined();
  });

  it("FRESHNESS is a non-empty list of [label, value] pairs", () => {
    expect(FRESHNESS.length).toBeGreaterThan(0);
    for (const row of FRESHNESS) {
      expect(row).toHaveLength(2);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/panelMeta.test.ts`
Expected: FAIL — cannot resolve `./panelMeta` (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/lib/panelMeta.ts`:

```ts
// Single source of truth for the in-app dashboard legend.
// Both InfoTooltip (per-panel ℹ️) and LegendDrawer render from this — edit once, both update.

export interface PanelMeta {
  /** stable key, also used as the InfoTooltip `id` prop */
  id: string;
  /** human title shown in tooltip + drawer */
  label: string;
  /** one line: what this panel shows */
  meaning: string;
  /** one line: when it refreshes (HTML allowed for <b> emphasis) */
  cadence: string;
  /** drawer-only expanded definitions (tier taxonomy, column glossary, etc.) */
  detail?: string[];
}

export const PANEL_META: PanelMeta[] = [
  {
    id: "alerts",
    label: "Execution Alerts",
    meaning: "Per-ticker signals grouped into action tiers (exits, buys, holds, watchlist).",
    cadence: "Autopilot worker: HK 10:00 / 14:00 / 16:30 · US 08:55 (HKT).",
    detail: [
      "🚨 Actionable Exits — bearish ST flip ≤2 bars",
      "🟢 Confluence Buys — ST↑ + BUY + TT 7/7",
      "🟢 Tactical Buys — ST↑ + BUY + TT 5–6/7",
      "🔵 Confluence Holds — ST↑ + HOLD + TT 7/7",
      "🚀 Emerging Uptrends — ST↑ + TT<5 with a fresh bullish flip (≤2 bars)",
      "⚠️ Stripped from Buys — ST↑ + TT<5, no fresh flip (deterioration)",
      "⚪ Watchlist — ST↓",
      "Regime codes: STR↑ · HV-STR↑ · WK→STR · STR'ng · EXH↑",
    ],
  },
  {
    id: "macro-us",
    label: "US Macro",
    meaning: "US market regime + breadth context applied to the US book.",
    cadence: "With the US analysis run (08:55 HKT).",
  },
  {
    id: "macro-hk",
    label: "HK Macro",
    meaning: "HK market regime + breadth / southbound context for the HK book.",
    cadence: "With HK analysis runs (10:00 / 14:00 / 16:30 HKT).",
  },
  {
    id: "portfolio",
    label: "Portfolio Summary",
    meaning: "Sortable holdings table: per-stock metrics + dual-strategy backtest stats.",
    cadence: "Recomputed each analysis run / on reload.",
    detail: [
      "Grd / Score — multi-factor score 0–10 → grade (A+ ≥8 · A ≥7 · B ≥6 · C ≥5 · D ≥4 · F <4)",
      "Signal — BUY / SELL / HOLD (score + confirmation logic)",
      "ST — current SuperTrend direction (↑ long / ↓ short)",
      "SEPA — Minervini SEPA conditions met, 0–3 (display-only overlay; HK shows —)",
      "TFM 10d — TimesFM 10-day forecast vs current price, % (display-only)",
      "RSI · MACD H — momentum indicators",
      "Backtest, header-colored: SC (cyan)=Score · ST (amber)=SuperTrend · TFM (purple)=TimesFM — each 2Y%/1Y% return, Sharpe, Alpha",
    ],
  },
  {
    id: "positions",
    label: "Open Positions",
    meaning: "Currently held positions with live SuperTrend state.",
    cadence: "Each analysis run.",
  },
  {
    id: "stock",
    label: "Stock Card",
    meaning: "Per-stock: SuperTrend signal, regime, 7-criterion Trend Template, and score.",
    cadence: "Each analysis run for that ticker's region.",
    detail: [
      "Trend Template (Minervini) — passes = ≥5 of 7:",
      "P>150 · P>200 · 150>200 · 200↑ · P>50 · 52L+25 · 52H-25",
    ],
  },
  {
    id: "chart",
    label: "Forecast Chart",
    meaning: "Price chart + display-only Kronos / TimesFM forecast overlay & track-record scorecard.",
    cadence: "Kronos & TimesFM regenerate daily (staggered).",
    detail: [
      "Kronos / TimesFM are display-only overlays with a track record (direction-hit rate + MAE). They never feed signals, scoring, or execution.",
    ],
  },
  {
    id: "config",
    label: "Settings",
    meaning: "Analysis & display configuration controls.",
    cadence: "N/A — user-controlled.",
  },
];

/** Data-freshness table shown at the foot of the drawer. [label, schedule]. */
export const FRESHNESS: ReadonlyArray<readonly [string, string]> = [
  ["Execution alerts", "HK 10:00·14:00·16:30 / US 08:55"],
  ["EOD breadth report", "HK 16:30 / US 08:55"],
  ["Kronos forecast", "daily (staggered)"],
  ["TimesFM forecast", "daily (staggered)"],
];

export function getPanelMeta(id: string): PanelMeta | undefined {
  return PANEL_META.find((p) => p.id === id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/panelMeta.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/panelMeta.ts src/lib/panelMeta.test.ts
git commit -m "feat(legend): add panelMeta single-source config + test"
```

---

## Task 2: `InfoTooltip` component

**Files:**
- Create: `src/components/InfoTooltip.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/InfoTooltip.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { getPanelMeta } from "@/lib/panelMeta";

/**
 * Small ℹ️ affordance shown next to a panel title.
 * Click/tap toggles a popover with the panel's meaning + cadence.
 * Closes on Esc, outside-click, or a second click. Tap-friendly (not hover-only).
 */
export default function InfoTooltip({ id }: { id: string }) {
  const meta = getPanelMeta(id);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!meta) return null;

  return (
    <span ref={wrapRef} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={`About ${meta.label}`}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`inline-flex h-[15px] w-[15px] items-center justify-center rounded-full border text-[9px] font-bold leading-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00d4ff] ${
          open
            ? "border-[#00d4ff] text-[#00d4ff]"
            : "border-[#4a6080] text-[#6b85a0] hover:border-[#00d4ff] hover:text-[#00d4ff]"
        }`}
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-[-8px] top-[22px] z-[60] w-[248px] rounded-[7px] border border-[#00d4ff] bg-[#0c1424] p-[10px_11px] shadow-[0_10px_30px_rgba(0,0,0,0.55)]"
        >
          <span className="mb-[5px] block text-[0.62rem] uppercase tracking-[0.1em] text-[#00d4ff]">
            {meta.label}
          </span>
          <span className="mb-[7px] block text-[0.72rem] leading-[1.45] text-[#c8d8f0]">
            {meta.meaning}
          </span>
          <span className="block border-t border-dashed border-[#1e2d4a] pt-[6px] text-[0.66rem] leading-[1.4] text-[#6b85a0]">
            ⏱ {meta.cadence}
          </span>
        </span>
      )}
    </span>
  );
}
```

Note: the popover is anchored to a `relative` wrapper inside the panel header. Because the panel headers sit inside the page's normal flow (not a clipped/overflow-hidden container), `absolute` positioning will not widen the card. The `max-w-full`/`overflow-x-auto` on the portfolio table is the only clipped container and we do NOT place the tooltip inside it (the portfolio `ℹ️` goes on the `◈ SCORE` title above the table — see Task 5).

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors referencing `InfoTooltip.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/InfoTooltip.tsx
git commit -m "feat(legend): add InfoTooltip popover component"
```

---

## Task 3: `LegendDrawer` component

**Files:**
- Create: `src/components/LegendDrawer.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/LegendDrawer.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { PANEL_META, FRESHNESS } from "@/lib/panelMeta";

/**
 * "How to read this dashboard" drawer. Closed by default; opened from the header button.
 * Renders the full legend (all panels + detail bullets) and the freshness table from panelMeta.
 * Side panel on desktop, bottom sheet under 680px (Tailwind `max-[680px]:` variants).
 */
export default function LegendDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      {/* backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-[90] bg-[rgba(3,7,16,0.62)] backdrop-blur-[2px] transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      {/* drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="How to read this dashboard"
        className={`fixed right-0 top-0 z-[100] flex h-full w-[420px] max-w-[92vw] flex-col border-l border-[#00d4ff] bg-[#0f1629] shadow-[-18px_0_50px_rgba(0,0,0,0.5)] transition-transform duration-[260ms] ease-[cubic-bezier(0.4,0,0.2,1)] max-[680px]:bottom-0 max-[680px]:top-auto max-[680px]:h-[82vh] max-[680px]:w-full max-[680px]:max-w-full max-[680px]:rounded-t-[14px] max-[680px]:border-l-0 max-[680px]:border-t ${
          open
            ? "translate-x-0 max-[680px]:translate-y-0"
            : "translate-x-full max-[680px]:translate-x-0 max-[680px]:translate-y-full"
        }`}
      >
        <div className="flex flex-shrink-0 items-center justify-between border-b border-[#1e2d4a] px-4 py-3.5">
          <h3 className="m-0 text-[0.82rem] font-semibold tracking-[0.06em] text-[#00d4ff]">
            How to read this dashboard
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-[26px] w-[26px] rounded-[5px] border border-[#1e2d4a] bg-transparent text-[#6b85a0] hover:border-[#ff4757] hover:text-[#ff4757]"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3.5">
          {PANEL_META.map((m) => (
            <div key={m.id} className="mb-4">
              <h4 className="m-0 mb-[3px] text-[0.72rem] uppercase tracking-[0.07em] text-[#c8d8f0]">
                {m.label}
              </h4>
              <div className="text-[0.72rem] leading-[1.45] text-[#6b85a0]">{m.meaning}</div>
              <div className="mt-[3px] text-[0.66rem] text-[#4a6080]">⏱ {m.cadence}</div>
              {m.detail && m.detail.length > 0 && (
                <ul className="mt-[7px] list-none p-0">
                  {m.detail.map((d, i) => (
                    <li key={i} className="pl-[2px] text-[0.69rem] leading-[1.6] text-[#6b85a0]">
                      {d}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          <div className="mt-1.5 border-t border-[#1e2d4a] pt-3">
            <h4 className="m-0 mb-[3px] text-[0.72rem] uppercase tracking-[0.07em] text-[#00d4ff]">
              Data freshness
            </h4>
            {FRESHNESS.map(([k, v]) => (
              <div
                key={k}
                className="flex justify-between border-b border-dashed border-[rgba(30,45,74,0.5)] py-[3px] text-[0.69rem]"
              >
                <span className="text-[#6b85a0]">{k}</span>
                <span className="text-[#c8d8f0]">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors referencing `LegendDrawer.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/LegendDrawer.tsx
git commit -m "feat(legend): add LegendDrawer component"
```

---

## Task 4: Wire the header button + drawer into `page.tsx`

**Files:**
- Modify: `src/app/page.tsx` (imports; `legendOpen` state near line 63; header block ~395; mount drawer)

- [ ] **Step 1: Add the imports**

At the top of `src/app/page.tsx`, with the other component imports (near line 8), add:

```tsx
import LegendDrawer from "@/components/LegendDrawer";
import InfoTooltip from "@/components/InfoTooltip";
```

- [ ] **Step 2: Add the open-state**

Next to the existing `const [globalTab, setGlobalTab] = useState<Tab | null>(null);` (line 63), add:

```tsx
const [legendOpen, setLegendOpen] = useState(false);
```

- [ ] **Step 3: Add the header button**

In the header `<header …>` block (opens at line 395), the right-hand side currently closes the flex row before `</header>` (line 486). Immediately before `</header>`, add the button:

```tsx
<button
  type="button"
  onClick={() => setLegendOpen(true)}
  aria-haspopup="dialog"
  className="ml-2 inline-flex items-center gap-1.5 rounded-[5px] border border-[#1e2d4a] px-2.5 py-1 text-[0.7rem] tracking-[0.04em] text-[#6b85a0] transition-colors hover:border-[#00d4ff] hover:bg-[rgba(0,212,255,0.06)] hover:text-[#00d4ff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00d4ff]"
>
  <span className="text-[11px]">❔</span> How to read this
</button>
```

If the header's right side is its own flex group, place the button inside that group; otherwise placing it just before `</header>` is fine (the header is `flex items-center justify-between`).

- [ ] **Step 4: Mount the drawer**

Just before the final closing tag of the page's root element (end of the returned JSX), add:

```tsx
<LegendDrawer open={legendOpen} onClose={() => setLegendOpen(false)} />
```

- [ ] **Step 5: Verify build + manual check**

Run: `npm run build`
Expected: build succeeds.
Then `npm run dev`, open http://localhost:3000, click "How to read this" → drawer slides in, shows all 8 panels + freshness; Esc / backdrop / ✕ all close it.

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(legend): wire header button + LegendDrawer into dashboard"
```

---

## Task 5: Add `<InfoTooltip>` to each panel header

Each sub-step adds one `ℹ️` next to an existing title element. After editing, the title node becomes a flex row containing the original title + `<InfoTooltip>`. Where the title's parent is already a flex row (most are), just insert `<InfoTooltip id="…" />` as the next sibling of the title `<span>`.

- [ ] **Step 1: Alerts** — `src/components/AlertsPanel.tsx`, after the `⚡ ALERTS` span (line ~367):

```tsx
<span className="text-[#f59e0b] text-sm font-bold">⚡ ALERTS</span>
<InfoTooltip id="alerts" />
```
Add `import InfoTooltip from "@/components/InfoTooltip";` at the top of the file. Ensure the two spans share a flex parent (the existing header row is flex; if not, wrap them in `<span className="inline-flex items-center gap-1.5">`).

- [ ] **Step 2: US Macro** — `src/components/MacroPanel.tsx`, after the `🌐 MARKET INTELLIGENCE` span (line ~146):

```tsx
<span className="text-[#00d4ff] text-xs font-bold tracking-widest">🌐 MARKET INTELLIGENCE</span>
<InfoTooltip id="macro-us" />
```
Add the import.

- [ ] **Step 3: HK Macro** — `src/components/MacroPanelHK.tsx`, after the `🇭🇰 HK MARKET INTELLIGENCE` span (line ~145):

```tsx
<span className="text-[#ff7f50] text-xs font-bold tracking-widest">🇭🇰 HK MARKET INTELLIGENCE</span>
<InfoTooltip id="macro-hk" />
```
Add the import.

- [ ] **Step 4: Portfolio** — `src/components/PortfolioSummaryBar.tsx`, after the `◈ SCORE` span (line ~179):

```tsx
<span className="text-[#00d4ff] font-bold tracking-widest">◈ SCORE</span>
<InfoTooltip id="portfolio" />
```
Add the import. (This title sits in the `flex items-center gap-3` row above the table — NOT inside the `overflow-x-auto` table container, so the popover won't be clipped.)

- [ ] **Step 5: Open Positions** — `src/components/OpenPositionsPanel.tsx`, after the title span (line ~195, the `text-[#00ff88] … tracking-widest` heading):

```tsx
{/* existing positions title span here */}
<InfoTooltip id="positions" />
```
Add the import. Insert `<InfoTooltip id="positions" />` immediately after the closing `</span>` of that heading, inside its flex parent.

- [ ] **Step 6: Settings** — `src/components/ConfigPanel.tsx`. The panel has no single title text; add the `ℹ️` into the tab-bar row (the `flex border-b border-[#1e2d4a] overflow-x-auto` div near the top of the return). Append, as the last child of that flex row:

```tsx
<span className="ml-auto flex items-center pr-2">
  <InfoTooltip id="config" />
</span>
```
Add the import. The `ml-auto` pushes it to the right of the tab row.

- [ ] **Step 7: Stock Card** — `src/app/page.tsx`, in the `results.length > 0` "ALL:" tab-strip block (line ~458), after the `ALL:` label span:

```tsx
<span className="text-[#4a6080] text-[0.6rem] font-mono pr-1 select-none">ALL:</span>
<InfoTooltip id="stock" />
```
(`InfoTooltip` is already imported in page.tsx from Task 4.) This places one Stock Card `ℹ️` in the per-results header rather than on every card.

- [ ] **Step 8: Verify build + visual**

Run: `npm run build`
Expected: succeeds.
Then `npm run dev`: each of the 8 panels shows an `ℹ️`; clicking each opens a popover with the right meaning + cadence; the portfolio popover is not clipped by the table.

- [ ] **Step 9: Commit**

```bash
git add src/components/AlertsPanel.tsx src/components/MacroPanel.tsx src/components/MacroPanelHK.tsx src/components/PortfolioSummaryBar.tsx src/components/OpenPositionsPanel.tsx src/components/ConfigPanel.tsx src/app/page.tsx
git commit -m "feat(legend): add per-panel InfoTooltip affordances"
```

---

## Task 6: Final verification (build, mobile, overflow, drift)

**Files:** none (verification only)

- [ ] **Step 1: Unit test + full build**

Run: `npm test && npm run build`
Expected: panelMeta tests pass; production build succeeds with no type errors. Confirm `*.test.ts` is excluded (it is, via existing `tsconfig.exclude`) so the build doesn't try to type-check vitest.

- [ ] **Step 2: Mobile / overflow check**

In `npm run dev`, open DevTools at 375px width:
- No horizontal scrollbar appears on the dashboard (the pre-existing overflow fix must not regress).
- The drawer renders as a bottom sheet (≤680px) and is fully scrollable.
- A tooltip popover near the right edge stays within the viewport (does not cause horizontal scroll).

- [ ] **Step 3: Drift check (single source)**

Temporarily change one `meaning` string in `src/lib/panelMeta.ts`, reload: confirm BOTH that panel's `ℹ️` popover AND the drawer entry show the new text. Revert the change.

- [ ] **Step 4: Push for Vercel deploy**

```bash
git push origin <branch>
```
Open a PR (or push to the configured deploy branch per the repo's flow). Confirm the Vercel build is green before merging. Do not mark "deployed" until verified on the live URL.

---

## Notes / known follow-ups (out of scope here)

- `portfolio.detail` mirrors the current `COLS` in `PortfolioSummaryBar.tsx`. If columns are later added/removed, update the `portfolio` entry in `panelMeta.ts` to match. A future refactor could derive the glossary from a shared column-definition map to remove even this manual link, but that is YAGNI for now.
- Cross-platform consistency rule (CLAUDE.md): this feature is web-only "what does this mean" help; it does not change any alert/report surface, so no Telegram/Python parity work is required.
