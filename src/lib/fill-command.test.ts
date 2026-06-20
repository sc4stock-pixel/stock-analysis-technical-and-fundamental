import { describe, it, expect } from "vitest";
import { parseFillCommand, selectFillTarget, applyFill, stripNaN } from "./fill-command";
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

describe("parseFillCommand", () => {
  it("bare /fill → list mode", () => {
    expect(parseFillCommand("/fill")).toEqual({ mode: "list" });
  });
  it("ticker + price", () => {
    expect(parseFillCommand("/fill 3033.HK 4.58")).toEqual({
      mode: "fill", selector: { kind: "ticker", ticker: "3033.HK" }, price: 4.58, date: null });
  });
  it("ticker + price + date", () => {
    expect(parseFillCommand("/fill 3033.HK 4.58 2026-06-12")).toEqual({
      mode: "fill", selector: { kind: "ticker", ticker: "3033.HK" }, price: 4.58, date: "2026-06-12" });
  });
  it("explicit id (has |) + price", () => {
    expect(parseFillCommand("/fill 3033.HK|2026-06-12|entry 4.58")).toEqual({
      mode: "fill", selector: { kind: "id", id: "3033.HK|2026-06-12|entry" }, price: 4.58, date: null });
  });
  it("invalid price → error", () => {
    expect(parseFillCommand("/fill 3033.HK abc")).toEqual({ mode: "error", reason: "price" });
  });
  it("invalid date → error", () => {
    expect(parseFillCommand("/fill 3033.HK 4.5 6/12")).toEqual({ mode: "error", reason: "date" });
  });
  it("non-positive price → error", () => {
    expect(parseFillCommand("/fill 3033.HK 0")).toEqual({ mode: "error", reason: "price" });
  });
});

describe("selectFillTarget", () => {
  const log = [
    rec({ id: "A|2026-06-10|entry", ticker: "A", date: "2026-06-10" }),
    rec({ id: "A|2026-06-12|exit", ticker: "A", date: "2026-06-12", type: "exit" }),
    rec({ id: "B|2026-06-11|entry", ticker: "B", date: "2026-06-11", actual_fill_price: 5 }), // filled
  ];
  it("by id", () => {
    expect(selectFillTarget(log, { kind: "id", id: "A|2026-06-10|entry" })).toEqual({ kind: "one", id: "A|2026-06-10|entry" });
  });
  it("by id not found", () => {
    expect(selectFillTarget(log, { kind: "id", id: "Z|x|entry" })).toEqual({ kind: "none" });
  });
  it("ticker with multiple unfilled → ambiguous", () => {
    const r = selectFillTarget(log, { kind: "ticker", ticker: "A" });
    expect(r.kind).toBe("ambiguous");
  });
  it("ticker with one unfilled → one", () => {
    const single = [rec({ id: "C|2026-06-10|entry", ticker: "C" })];
    expect(selectFillTarget(single, { kind: "ticker", ticker: "C" })).toEqual({ kind: "one", id: "C|2026-06-10|entry" });
  });
  it("ticker all filled → none", () => {
    expect(selectFillTarget(log, { kind: "ticker", ticker: "B" })).toEqual({ kind: "none" });
  });
});

describe("applyFill", () => {
  it("patches only fill fields by id, preserves others, trailing-slices", () => {
    const log = [rec({ id: "A|2026-06-10|entry", ticker: "A", signal_price: 100 })];
    const out = applyFill(log, "A|2026-06-10|entry", 102, "2026-06-12");
    expect(out[0].actual_fill_price).toBe(102);
    expect(out[0].actual_fill_date).toBe("2026-06-12");
    expect(out[0].signal_price).toBe(100); // untouched
  });
  it("throws on non-finite price", () => {
    const log = [rec({ id: "A|2026-06-10|entry" })];
    expect(() => applyFill(log, "A|2026-06-10|entry", NaN, "2026-06-12")).toThrow();
  });
});

describe("stripNaN", () => {
  it("replaces bare NaN/Infinity with null", () => {
    expect(stripNaN('[{"a":NaN,"b":-Infinity,"c":1}]')).toBe('[{"a":null,"b":null,"c":1}]');
  });
});
