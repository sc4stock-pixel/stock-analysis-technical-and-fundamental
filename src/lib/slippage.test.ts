import { describe, it, expect } from "vitest";
import { computeSlippage, slippageLabel, summarize } from "./slippage";
import type { TradeLogRecord } from "@/types/trade-log";

function rec(p: Partial<TradeLogRecord>): TradeLogRecord {
  return {
    id: "X|2026-01-01|entry", date: "2026-01-01", logged_at: "2026-01-01",
    session: "eod", confirmed: true, ticker: "X", region: "US", type: "entry",
    direction: "long", signal_price: 100, stop: null, atr_period: null,
    multiplier: null, params_source: "optimized", tt_score: null, criteria: null,
    sma_stack: null, piotroski_f: null, altman_z: null, z_variant: null,
    op_margin: [], actual_fill_price: null, actual_fill_date: null, ...p,
  };
}

describe("computeSlippage", () => {
  it("returns null when unfilled", () => {
    expect(computeSlippage(rec({}))).toBeNull();
  });
  it("entry filled above signal is adverse", () => {
    const s = computeSlippage(rec({ type: "entry", signal_price: 100, actual_fill_price: 102 }))!;
    expect(s.slippagePct).toBeCloseTo(2, 6);
    expect(s.adverse).toBe(true);
  });
  it("entry filled below signal is favorable", () => {
    const s = computeSlippage(rec({ type: "entry", signal_price: 100, actual_fill_price: 99 }))!;
    expect(s.adverse).toBe(false);
  });
  it("exit filled below signal is adverse", () => {
    const s = computeSlippage(rec({ type: "exit", signal_price: 100, actual_fill_price: 98 }))!;
    expect(s.slippagePct).toBeCloseTo(-2, 6);
    expect(s.adverse).toBe(true);
  });
  it("exit filled above signal is favorable", () => {
    const s = computeSlippage(rec({ type: "exit", signal_price: 100, actual_fill_price: 101 }))!;
    expect(s.adverse).toBe(false);
  });
  it("returns null on non-finite or zero signal", () => {
    expect(computeSlippage(rec({ signal_price: 0, actual_fill_price: 5 }))).toBeNull();
    expect(computeSlippage(rec({ signal_price: NaN, actual_fill_price: 5 }))).toBeNull();
    expect(computeSlippage(rec({ signal_price: 100, actual_fill_price: Infinity }))).toBeNull();
  });
});

describe("slippageLabel", () => {
  it("labels adverse and favorable", () => {
    expect(slippageLabel(rec({ type: "entry", signal_price: 100, actual_fill_price: 102 }))).toContain("adverse");
    expect(slippageLabel(rec({ type: "entry", signal_price: 100, actual_fill_price: 98 }))).toContain("favorable");
  });
  it("dash when unfilled", () => {
    expect(slippageLabel(rec({}))).toBe("—");
  });
});

describe("summarize", () => {
  it("counts, averages, and splits by params_source", () => {
    const recs = [
      rec({ type: "entry", signal_price: 100, actual_fill_price: 102, params_source: "default_fallback" }), // +2, adverse
      rec({ type: "entry", signal_price: 100, actual_fill_price: 99, params_source: "optimized" }),          // -1, favorable
      rec({ type: "exit", signal_price: 50, actual_fill_price: null, params_source: "optimized" }),          // unfilled
    ];
    const s = summarize(recs);
    expect(s.filled).toBe(2);
    expect(s.unfilled).toBe(1);
    expect(s.avgPct).toBeCloseTo(0.5, 6);
    expect(s.medianPct).toBeCloseTo(0.5, 6);
    expect(s.pctAdverse).toBeCloseTo(50, 6);
    expect(s.byParamsSource.default_fallback.filled).toBe(1);
    expect(s.byParamsSource.default_fallback.pctAdverse).toBeCloseTo(100, 6);
    expect(s.byParamsSource.optimized.filled).toBe(1);
    expect(s.byParamsSource.optimized.pctAdverse).toBeCloseTo(0, 6);
  });
  it("handles an all-unfilled log without NaN", () => {
    const s = summarize([rec({})]);
    expect(s.filled).toBe(0);
    expect(s.avgPct).toBeNull();
    expect(s.medianPct).toBeNull();
    expect(s.pctAdverse).toBeNull();
  });
});
