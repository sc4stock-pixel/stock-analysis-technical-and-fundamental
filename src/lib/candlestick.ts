// ============================================================
// CANDLESTICK PATTERN DETECTION — exact port of Python V12 CandlestickPatterns
// ============================================================
import { CandlestickPattern, OHLCVBar } from "@/types";

export function detectCandlestickPatterns(
  bars: OHLCVBar[],
  lookback = 5
): CandlestickPattern[] {
  if (bars.length < lookback + 1) return [];
  const n = bars.length;
  const allPatterns: CandlestickPattern[] = [];

  for (let i = 0; i < lookback; i++) {
    const idx = n - 1 - i;
    const bar = bars[idx];
    const { open: o, high: h, low: l, close: c } = bar;

    const body = Math.abs(c - o);
    const totalRange = h - l;
    if (totalRange === 0) continue;

    const upperWick = h - Math.max(o, c);
    const lowerWick = Math.min(o, c) - l;
    const bodyPct = body / totalRange;

    let prevO: number | null = null;
    let prevC: number | null = null;
    let prevBody: number | null = null;
    if (idx > 0) {
      prevO = bars[idx - 1].open;
      prevC = bars[idx - 1].close;
      prevBody = Math.abs(prevC - prevO);
    }

    const label = i === 0 ? "Latest" : `${i}d ago`;
    let detected: Omit<CandlestickPattern, "label"> | null = null;

    // 1. DOJI
    if (bodyPct < 0.1) {
      detected = { pattern: "Doji", sentiment: "neutral", bar_index: i };
    }
    // 2. HAMMER — small body top, long lower wick ≥ 2× body, little upper wick, green
    else if (lowerWick >= 2 * body && upperWick < body * 0.5 && c > o && bodyPct < 0.35) {
      detected = { pattern: "Hammer", sentiment: "bullish", bar_index: i };
    }
    // 3. INVERTED HAMMER / SHOOTING STAR
    else if (upperWick >= 2 * body && lowerWick < body * 0.5 && bodyPct < 0.35) {
      if (prevC !== null && prevO !== null && prevC > prevO) {
        detected = { pattern: "Shooting Star", sentiment: "bearish", bar_index: i };
      } else {
        detected = { pattern: "Inverted Hammer", sentiment: "bullish", bar_index: i };
      }
    }
    // 4. BULLISH ENGULFING
    else if (
      prevO !== null && prevC !== null &&
      c > o && prevC < prevO &&
      c > prevO && o < prevC
    ) {
      detected = { pattern: "Bull Engulfing", sentiment: "bullish", bar_index: i };
    }
    // 5. BEARISH ENGULFING
    else if (
      prevO !== null && prevC !== null &&
      c < o && prevC > prevO &&
      c < prevO && o > prevC
    ) {
      detected = { pattern: "Bear Engulfing", sentiment: "bearish", bar_index: i };
    }
    // 6. MARUBOZU
    else if (bodyPct > 0.9) {
      if (c > o) detected = { pattern: "Bull Marubozu", sentiment: "bullish", bar_index: i };
      else detected = { pattern: "Bear Marubozu", sentiment: "bearish", bar_index: i };
    }
    // 7. HANGING MAN
    else if (lowerWick >= 2 * body && upperWick < body * 0.5 && c < o && bodyPct < 0.35) {
      if (prevC !== null && prevO !== null && prevC > prevO) {
        detected = { pattern: "Hanging Man", sentiment: "bearish", bar_index: i };
      } else {
        detected = { pattern: "Hammer", sentiment: "bullish", bar_index: i };
      }
    }

    if (detected) {
      allPatterns.push({ ...detected, label });
    }
  }

  // Deduplicate: keep only most recent bullish + most recent bearish
  allPatterns.sort((a, b) => a.bar_index - b.bar_index);
  const deduped: CandlestickPattern[] = [];
  let bullishFound = false;
  let bearishFound = false;

  for (const p of allPatterns) {
    if (p.sentiment === "bullish" && !bullishFound) {
      deduped.push(p); bullishFound = true;
    } else if (p.sentiment === "bearish" && !bearishFound) {
      deduped.push(p); bearishFound = true;
    } else if (p.sentiment === "neutral" && deduped.length < 3) {
      deduped.push(p);
    }
    if (bullishFound && bearishFound) break;
  }

  return deduped;
}
