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
