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
    id: "nav",
    label: "Autopilot Realized NAV",
    meaning: "Realized NAV of the published Autopilot signals (equal-weight, prev-EOD SuperTrend longs, others cash) vs benchmark (SPY / HSI).",
    cadence: "Accrues one entry per region per EOD Autopilot run.",
    detail: [
      "NAV — compounded daily returns of the published signal portfolio, normalized to 1.0 at inception",
      "Benchmark — SPY (US) / ^HSI (HK), same compounding; line absent while benchmark data is missing",
      "Return % — total compounded return · Ann. Sharpe — daily mean/sd × √252 · Max DD — worst peak-to-trough",
      "Alpha / Beta — OLS regression vs benchmark, annualized; appear after 60 paired observations",
      "Buy & Hold — always-long equal-weight of the same ticker universe, same compounding; the strategy-vs-B&H gap isolates the timing contribution (line/chip absent until all entries carry B&H data)",
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
