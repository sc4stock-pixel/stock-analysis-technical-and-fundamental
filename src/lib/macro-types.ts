// ============================================================
// MACRO TYPES + PURE CLIENT-SAFE FUNCTIONS — V15.2
// Shared by both US and HK macro engines.
// NO fetch, NO Node APIs — pure TypeScript only.
// ============================================================

export interface MacroFactor {
  label: string;
  value: number | string;
  score: number;      // 0–10
  signal: "bullish" | "bearish" | "neutral";
  detail: string;
}

export interface MacroHeadline {
  title: string;
  sentiment: "bullish" | "bearish" | "neutral";
  source: string;
}

// ── US MacroData ─────────────────────────────────────────────
export interface MacroData {
  mbs: number;
  mbsLabel: string;
  factors: {
    fearGreed:     MacroFactor;
    vixStructure:  MacroFactor;
    indexTrends:   MacroFactor;
    adRatio:       MacroFactor;
    newsSentiment: MacroFactor;
    breadth:       MacroFactor;
  };
  headlines: MacroHeadline[];
  fetchedAt: string;
  error?: string;
}

// ── HK MacroData ─────────────────────────────────────────────
export interface HKMacroData {
  mbs: number;
  mbsLabel: string;
  factors: {
    vhsi:        MacroFactor;   // 25% — volatility (VHSI)
    usdHkd:      MacroFactor;   // 25% — peg stability
    hsiTrends:   MacroFactor;   // 20% — HSI + HSTECH trend
    southbound:  MacroFactor;   // 15% — southbound flow
    hibor:       MacroFactor;   // 7.5% — HIBOR 1M
    breadth:     MacroFactor;   // 7.5% — HK breadth proxy
  };
  headlines: MacroHeadline[];
  fetchedAt: string;
  error?: string;
}

// ── Shared label/adjustment logic (same tiers for both) ──────
export function mbsLabel(mbs: number): string {
  if (mbs >= 7.0) return "BULLISH";
  if (mbs >= 5.5) return "NEUTRAL";
  if (mbs >= 4.0) return "CAUTION";
  if (mbs >= 2.5) return "RISK-OFF";
  return "AVOID";
}

export function mbsScoreAdjustment(mbs: number): number {
  if (mbs >= 7.0) return  0.5;
  if (mbs >= 5.5) return  0.0;
  if (mbs >= 4.0) return -0.3;
  if (mbs >= 2.5) return -0.5;
  return -1.0;
}

// Alias — HK uses identical tier table
export const hkMbsScoreAdjustment = mbsScoreAdjustment;
export const hkMbsLabel = mbsLabel;
