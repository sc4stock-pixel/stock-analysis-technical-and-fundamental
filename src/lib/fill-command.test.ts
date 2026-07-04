import { describe, it, expect } from "vitest";
import { parseFillCommand, selectFillTarget, applyFill, stripNaN, isFillable } from "./fill-command";
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

describe("SMA50 entry gate (entry_ready)", () => {
  it("entry_ready false is not fillable (phantom entry)", () => {
    expect(isFillable(rec({ entry_ready: false }))).toBe(false);
  });
  it("legacy record derives gate from criteria[4] (c5 Close>SMA50)", () => {
    const below = rec({ criteria: [true, true, true, true, false, true, false] });
    const above = rec({ criteria: [true, true, true, true, true, true, false] });
    expect(isFillable(below)).toBe(false);   // the 1211.HK/META phantom case
    expect(isFillable(above)).toBe(true);
  });
  it("selectFillTarget by id refuses a non-ready entry", () => {
    const log = [rec({ entry_ready: false })];
    expect(selectFillTarget(log, { kind: "id", id: "X|2026-01-01|entry" }))
      .toEqual({ kind: "not_entry_ready", id: "X|2026-01-01|entry" });
  });
  it("selectFillTarget by ticker skips non-ready entries entirely", () => {
    const log = [rec({ entry_ready: false })];
    expect(selectFillTarget(log, { kind: "ticker", ticker: "X" }))
      .toEqual({ kind: "none" });
  });
  it("exit records are unaffected by the gate", () => {
    expect(isFillable(rec({ type: "exit", id: "X|2026-01-01|exit" }))).toBe(true);
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
  it("ticker with only a provisional (unconfirmed) unfilled record → none", () => {
    const prov = [rec({ id: "P|2026-06-12|entry", ticker: "P", confirmed: false })];
    expect(selectFillTarget(prov, { kind: "ticker", ticker: "P" })).toEqual({ kind: "none" });
  });
  it("ticker ignores provisional, infers the confirmed unfilled one", () => {
    const mix = [
      rec({ id: "Q|2026-06-12|entry", ticker: "Q", date: "2026-06-12", confirmed: false }),
      rec({ id: "Q|2026-06-10|entry", ticker: "Q", date: "2026-06-10", confirmed: true }),
    ];
    expect(selectFillTarget(mix, { kind: "ticker", ticker: "Q" })).toEqual({ kind: "one", id: "Q|2026-06-10|entry" });
  });
  it("explicit id on a provisional record → provisional", () => {
    const prov = [rec({ id: "P|2026-06-12|entry", ticker: "P", confirmed: false })];
    expect(selectFillTarget(prov, { kind: "id", id: "P|2026-06-12|entry" })).toEqual({ kind: "provisional", id: "P|2026-06-12|entry" });
  });
});

describe("isFillable", () => {
  it("true only for confirmed + unfilled", () => {
    expect(isFillable(rec({ confirmed: true, actual_fill_price: null }))).toBe(true);
    expect(isFillable(rec({ confirmed: false, actual_fill_price: null }))).toBe(false);
    expect(isFillable(rec({ confirmed: true, actual_fill_price: 5 }))).toBe(false);
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
