import { describe, it, expect } from "vitest";
import { buildTelegramMessage } from "./telegram";
import type { StockAnalysisResult } from "@/types";

// Minimal result that (a) passes the `valid` filter, (b) has a FRESH bearish ST flip
// in chart_bars so the model emits an "exited uptrend" client row, and (c) is an HK
// ticker so we can assert ".HK" is stripped in the Act-on-this block.
//
// Strategy: 30 bars of a clear uptrend (close far above upperBand → bullish),
// then bar 31 crashes hard below lowerBand → BEARISH flip at barsSince=0.
function bearishHKResult(): StockAnalysisResult {
  // Build uptrend bars: steadily rising prices with small ATR
  const uptrendBars = Array.from({ length: 30 }, (_, i) => ({
    high:  100 + i * 2 + 1,
    low:   100 + i * 2 - 1,
    close: 100 + i * 2,
  }));
  // Crash bar: price plummets far below any reasonable lowerBand
  const crashBar = { high: 160, low: 50, close: 52 };
  const bars = [...uptrendBars, crashBar];

  return {
    symbol: "3033.HK", exchange: "HK", signal: "HOLD", score: 5,
    current_price: 52, change_pct: -3.2, regime: "DOWNTREND",
    chart_bars: bars, st_opt_params: { atrPeriod: 10, multiplier: 3.0 },
    st_direction: -1,
  } as unknown as StockAnalysisResult;
}

// Mirror image: fresh BULLISH flip (crash-up bar) with TT c5 false → the row must
// tag [WAIT], never [LONG] — the strategy entry is ST flip + Close>SMA50.
function bullishBelowSma50Result(): StockAnalysisResult {
  const downtrendBars = Array.from({ length: 30 }, (_, i) => ({
    high:  160 - i * 2 + 1,
    low:   160 - i * 2 - 1,
    close: 160 - i * 2,
  }));
  const spikeBar = { high: 210, low: 100, close: 205 };
  const bars = [...downtrendBars, spikeBar];
  return {
    symbol: "1211.HK", exchange: "HK", signal: "HOLD", score: 5,
    current_price: 205, change_pct: 7.4, regime: "DOWNTREND",
    chart_bars: bars, st_opt_params: { atrPeriod: 10, multiplier: 3.0 },
    st_direction: 1,
    sepa_metadata: { trend_template_criteria: { c5_price_above_sma50: false } },
  } as unknown as StockAnalysisResult;
}

describe("buildTelegramMessage — SMA50 entry gate tag", () => {
  const msg = buildTelegramMessage([bullishBelowSma50Result()], "manual");
  it("tags a below-SMA50 flip as [WAIT], not [LONG]", () => {
    const block = msg.slice(msg.indexOf("ACT ON THIS"));
    expect(block).toContain("awaiting SMA50");
    expect(block).toContain("[WAIT]");
    expect(block).not.toContain("[LONG]");
  });
});

describe("buildTelegramMessage — Act on this block", () => {
  const msg = buildTelegramMessage([bearishHKResult()], "manual");
  it("includes an ACT ON THIS section", () => {
    expect(msg).toContain("ACT ON THIS");
  });
  it("renders the client-stance exit copy", () => {
    expect(msg).toContain("exited uptrend");
  });
  it("strips .HK from the ticker in the block", () => {
    // the Act-on-this <pre> row should show 3033, never 3033.HK
    const block = msg.slice(msg.indexOf("ACT ON THIS"));
    expect(block).toContain("3033");
    expect(block).not.toContain("3033.HK");
  });
});
