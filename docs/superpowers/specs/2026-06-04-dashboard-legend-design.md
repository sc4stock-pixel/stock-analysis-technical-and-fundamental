# Design Spec — In-app Dashboard Legend + Tooltips

_Created 2026-06-04. Source handoff: `/Users/Steven/Claude/HANDOFF_dashboard_legend.md`._

## Goal
Let the user understand **what each dashboard panel means** and **when it updates**, on demand,
without permanently crowding the default view, and without the explanation ever drifting from the
code. Achieved by driving every help surface from a single config module.

## Non-goals (YAGNI)
- Not a tutorial, not analytics, not user-editable.
- No per-metric icons (per-panel only — decided in brainstorming).
- No always-on freshness banner (freshness lives in the drawer).
- No new runtime dependency (hand-rolled components — approach B).

## Decisions (locked in brainstorming)
1. **Granularity:** per-panel `ℹ️` only (~8). Detailed sub-definitions live in the drawer, not inline.
2. **Drawer entry point:** a single "How to read this" button in the existing top app header
   (`src/app/page.tsx:395`). Opens the full legend drawer.
3. **Freshness:** a section *inside* the drawer (no persistent on-dashboard line).
4. **Rendering (approach B):** hand-rolled `InfoTooltip` (tap/click toggle, not hover-only) +
   `LegendDrawer` (fixed panel + backdrop). No library.
5. **Single source of truth:** `src/lib/panelMeta.ts`. Tooltips and drawer both render from it.

## Data model — `src/lib/panelMeta.ts`

```ts
export interface PanelMeta {
  id: string;        // stable key, e.g. "alerts"
  label: string;     // human title, e.g. "Execution Alerts"
  meaning: string;   // one-line: what this panel shows
  cadence: string;   // one-line: when it refreshes
  detail?: string[]; // drawer-only expanded definitions (tiers, criteria, codes)
}

export const PANEL_META: PanelMeta[];           // ordered, drives the drawer
export function getPanelMeta(id: string): PanelMeta | undefined;  // drives tooltips
```

- Tooltip renders `meaning` + `cadence` (the one-line affordance).
- Drawer renders every entry: `label`, `meaning`, `cadence`, and `detail[]` bullets.
- A definition is written **once** here; both surfaces read it → cannot disagree.

### Panel entries (8) — content sourced from CLAUDE.md + LIVE_STATE.md

| id | label | meaning (1 line) | cadence (1 line) |
|---|---|---|---|
| `alerts` | Execution Alerts | Per-ticker signals grouped into action tiers (exits, buys, holds, watchlist). | Autopilot worker: HK 10:00 / 14:00 / 16:30 · US 08:55 (HKT). |
| `macro-us` | US Macro | US market regime + breadth context for the US book. | With US analysis run (08:55 HKT). |
| `macro-hk` | HK Macro | HK market regime + breadth/southbound context for the HK book. | With HK analysis runs (10:00 / 14:00 / 16:30 HKT). |
| `portfolio` | Portfolio Summary | Sortable table of all holdings: per-stock score/signal/ST/SEPA/TFM metrics + dual-strategy backtest stats. | Recomputed each analysis run / on reload. |
| `positions` | Open Positions | Currently held positions with live ST state. | Each analysis run. |
| `stock` | Stock Card | Per-stock: SuperTrend signal, regime, 7-criterion Trend Template, score. | Each analysis run for that ticker's region. |
| `chart` | Forecast Chart | Price chart + display-only Kronos/TimesFM forecast overlay & track-record scorecard. | Kronos & TimesFM regenerate daily (staggered). |
| `config` | Settings | Analysis/display configuration controls. | N/A — user-controlled. |

### Drawer `detail[]` content (expanded definitions — verbatim from CLAUDE.md)

- **`alerts.detail`** — the tier taxonomy:
  - 🚨 Actionable Exits — bearish ST flip ≤2 bars
  - 🟢 Confluence Buys — ST↑ + BUY + TT 7/7
  - 🟢 Tactical Buys — ST↑ + BUY + TT 5–6/7
  - 🔵 Confluence Holds — ST↑ + HOLD + TT 7/7
  - 🚀 Emerging Uptrends — ST↑ + TT<5 with a fresh bullish flip (≤2 bars)
  - ⚠️ Stripped from Buys — ST↑ + TT<5, no fresh flip (deterioration)
  - ⚪ Watchlist — ST↓
  - Regime abbreviations: STR↑, HV-STR↑, WK→STR, STR'ng, EXH↑
- **`stock.detail`** — Trend Template (7-criterion Minervini), `passes = ≥5 of 7`:
  `P>150 · P>200 · 150>200 · 200↑ · P>50 · 52L+25 · 52H-25`
- **`chart.detail`** — Kronos/TimesFM are **display-only** overlays with a track record
  (direction-hit rate + MAE scorecard); they never feed signals, scoring, or execution.
- **`portfolio.detail`** — column glossary for the holdings table:
  - **Grd / Score** — multi-factor score 0–10 → grade (A+ ≥8 · A ≥7 · B ≥6 · C ≥5 · D ≥4 · F <4)
  - **Signal** — BUY / SELL / HOLD (score + confirmation logic)
  - **ST** — current SuperTrend direction (↑ long / ↓ short)
  - **SEPA** — Minervini SEPA conditions met, 0–3 (passive display overlay; HK shows —)
  - **TFM 10d** — TimesFM 10-day forecast vs current price, % (display-only)
  - **RSI · MACD H** — momentum indicators
  - Dual-strategy backtest, header-colored: **SC** (cyan) = Score strategy · **ST** (amber) =
    SuperTrend strategy · **TFM** (purple) = TimesFM. Each: 2Y%/1Y% return, Sharpe, Alpha.

### Freshness section (drawer footer) — from LIVE_STATE.md
A small table: Execution alerts (HK 10:00/14:00/16:30 · US 08:55 HKT) · EOD breadth report
(HK 16:30 · US 08:55 HKT) · Kronos (daily) · TimesFM (daily). Static copy in `panelMeta.ts`
(`FRESHNESS` const) so it's edited in the same single source.

## Components

### `src/components/InfoTooltip.tsx`
- Renders a small `ℹ️` button (`<button>`, `aria-label={`About ${label}`}`).
- Click/tap toggles a positioned popover (controlled `open` state); Esc and click-outside close it.
- Popover content: `meaning` line + muted `cadence` line.
- Positioned `fixed`/portal-style or absolute within a `relative` wrapper, with viewport-edge
  clamping, so it **never widens its parent card** (overflow guard).
- Theme: dark card surface consistent with existing panels; min font `0.72rem`.
- Props: `{ id: string }` → looks up `getPanelMeta(id)`.

### `src/components/LegendDrawer.tsx`
- Fixed right-side (or bottom-sheet on narrow) panel + dimmed backdrop; closed by default.
- Header "How to read this dashboard" + close button; Esc / backdrop click closes.
- Body maps `PANEL_META` → section per panel (`label`, `meaning`, `cadence`, `detail[]` bullets),
  then the freshness table.
- Controlled by `open` state lifted into `page.tsx`.

### `src/app/page.tsx` (header, ~line 395)
- Add a compact "How to read this" / `?` button in the existing header flex row.
- Hold `legendOpen` state; render `<LegendDrawer open={legendOpen} onClose=… />`.

### Wiring the 8 `ℹ️`
- Add `<InfoTooltip id="…" />` next to each panel's header/title in:
  `AlertsPanel.tsx`, `MacroPanel.tsx`, `MacroPanelHK.tsx`, `PortfolioSummaryBar.tsx`,
  `OpenPositionsPanel.tsx`, `StockCard.tsx`, `ConfigPanel.tsx`, and the ChartTab.
  (Confirm exact header node per component during implementation.)

## Accessibility / mobile
- Toggle on **click/tap**, not hover-only (works on touch).
- Keyboard: button focusable, Enter/Space toggles, Esc closes; focus-visible ring.
- Narrow viewport: drawer becomes a bottom sheet; tooltip popover clamps within viewport.
- **Overflow guard:** popover/drawer render in a fixed layer — verify no horizontal scroll at
  ~375px width (the dashboard's prior overflow fix must not regress).

## Done = verified
- Each of the 8 panels shows an `ℹ️` with meaning + cadence from `panelMeta`.
- Header button opens/closes the drawer; drawer renders the full legend + freshness from the
  same config.
- Editing one `panelMeta` entry changes **both** tooltip and drawer (no duplicated copy).
- Default view visually unchanged; no horizontal overflow at 375px.
- Build green: keep any `*.test.ts`/`vitest.config.ts` in `tsconfig.exclude` (Vercel build gotcha).
