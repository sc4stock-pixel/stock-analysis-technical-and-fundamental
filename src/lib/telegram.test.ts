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
    const block = msg.slice(msg.indexOf("WEIGHT CHANGES"));
    expect(block).toContain("awaiting SMA50");
    // The tag may carry the asymmetric target weight (e.g. "[WAIT 40%]") —
    // assert on the state word, not the exact bracket contents.
    // Weight-first report: a below-SMA50 flip is NOT in the 100% ST LONG bucket,
    // and the change line marks it as awaiting the gate.
    expect(block).toContain("awaiting SMA50");
    expect(block).not.toMatch(/100% · ST LONG[\s\S]*BYD/);
  });
});

describe("buildTelegramMessage — Act on this block", () => {
  const msg = buildTelegramMessage([bearishHKResult()], "manual");
  it("includes an ACT ON THIS section", () => {
    expect(msg).toContain("WEIGHT CHANGES");
  });
  it("renders the client-stance exit copy", () => {
    expect(msg).toContain("100% →");   // a bearish flip lowers exposure from full
  });
  it("strips .HK from the ticker in the block", () => {
    // the Act-on-this <pre> row should show 3033, never 3033.HK
    const block = msg.slice(msg.indexOf("WEIGHT CHANGES"));
    expect(block).toContain("3033");
    expect(block).not.toContain("3033.HK");
  });
});

// ---------------------------------------------------------------------------
// Tier coverage — the invariant that GOOGL + 0939.HK violated on 2026-08-14.
// The tier predicates used to be independent filters with no residual net, so
// ST↑ + TT≥5/7 + signal≠BUY matched NOTHING and vanished from the message while
// still being counted in the "N assets" footer.
// ---------------------------------------------------------------------------
const TT_KEYS = [
  "c1_price_above_sma150", "c2_price_above_sma200", "c3_sma150_above_sma200",
  "c4_sma200_trending_up", "c5_price_above_sma50", "c6_above_25pct_of_low52",
  "c7_within_25pct_of_high52",
] as const;

/** Synthetic result: no chart_bars → no ST flip → lands in exactly one tier. */
function stub(
  symbol: string,
  signal: string,
  st_direction: number,
  met: number | undefined,
): StockAnalysisResult {
  const sepa = met === undefined ? undefined : {
    trend_template_criteria: {
      criteria_met: met,
      ...Object.fromEntries(TT_KEYS.map((k, i) => [k, i < met])),
    },
  };
  return {
    symbol, exchange: "US", signal, score: 5,
    current_price: 100, change_pct: 1.0, regime: "UPTREND",
    st_direction, sepa_metadata: sepa,
  } as unknown as StockAnalysisResult;
}

describe("buildTelegramMessage — every valid asset is rendered", () => {
  const signals = ["BUY", "HOLD", "SELL"];
  const dirs = [1, -1];
  const mets: Array<number | undefined> = [0, 4, 5, 6, 7, undefined];

  const cases: StockAnalysisResult[] = [];
  let n = 0;
  for (const s of signals) for (const d of dirs) for (const m of mets) {
    cases.push(stub(`ZZ${String(n++).padStart(2, "0")}`, s, d, m));
  }

  const msg = buildTelegramMessage(cases, "manual");

  it("covers the full signal x st_direction x criteria_met matrix", () => {
    expect(cases).toHaveLength(36);
  });

  it("renders every symbol exactly once — no silent drops, no double-counting", () => {
    const missing: string[] = [];
    const duplicated: string[] = [];
    for (const c of cases) {
      const hits = msg.split(c.symbol).length - 1;
      if (hits === 0) missing.push(c.symbol);
      if (hits > 1) duplicated.push(c.symbol);
    }
    expect({ missing, duplicated }).toEqual({ missing: [], duplicated: [] });
  });

  it("footer asset count matches the number of rendered assets", () => {
    expect(msg).toContain(`${cases.length} assets`);
  });

  it("leaves the UNCLASSIFIED net empty for every ST↑ case that has a TT score", () => {
    // Only the missing-TT rows and SELL-while-ST↑ rows may fall through.
    const unclassified = cases.filter(c =>
      msg.includes("UNCLASSIFIED") &&
      msg.slice(msg.indexOf("UNCLASSIFIED")).includes(c.symbol));
    for (const c of unclassified) {
      const sepa = (c as unknown as { sepa_metadata?: { trend_template_criteria?: { criteria_met?: number } } }).sepa_metadata;
      const met = sepa?.trend_template_criteria?.criteria_met;
      expect(met === undefined || (c.signal === "SELL" && c.st_direction === 1 && met >= 5)).toBe(true);
    }
  });
});

describe("buildTelegramMessage — ST↑ HOLD with confirmed structure (regression)", () => {
  // The exact live shapes that went missing: GOOGL 6/7 (✗Price>50SMA) and 0939.HK 6/7.
  // The invariant is EXHAUSTIVENESS — every valid name must be rendered in some
  // bucket. It is deliberately not asserted per-bucket: which bucket a name lands
  // in is the sizing rule's job (targetWeight.test.ts), and pinning it here would
  // make this regression test fail every time the rule is retuned.
  const msg = buildTelegramMessage(
    [stub("GOOGL", "HOLD", 1, 6), stub("SPY", "BUY", 1, 6), stub("MSFT", "HOLD", 1, 7)],
    "manual",
  );

  it("renders every name — none silently dropped", () => {
    for (const sym of ["GOOGL", "SPY", "MSFT"]) expect(msg).toContain(sym);
  });

  it("reconciles all three in the receipt", () => {
    expect(msg).toMatch(/3 in →/);
    expect(msg).toContain("= 3 ✓");
  });

  it("never lands a name in UNCLASSIFIED", () => {
    expect(msg).not.toContain("UNCLASSIFIED");
  });

  it("keeps the BUY/HOLD signal visible as a row field", () => {
    expect(msg).toMatch(/\bBUY\b/);
    expect(msg).toMatch(/\bHOLD\b/);
  });

  it("shows the TT score so the structure gap is still visible", () => {
    expect(msg).toContain("6/7");
  });
});
