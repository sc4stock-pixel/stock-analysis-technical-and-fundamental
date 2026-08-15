import { describe, it, expect } from "vitest";
import { buildReceipt } from "./reportReceipt";

const U = ["AAPL", "MSFT", "GOOGL", "0939.HK"];

describe("buildReceipt — healthy report", () => {
  const r = buildReceipt(U, [
    { label: "buy",   symbols: ["AAPL", "MSFT"] },
    { label: "watch", symbols: ["GOOGL", "0939.HK"] },
  ]);

  it("reports ok", () => {
    expect(r.ok).toBe(true);
    expect(r).toMatchObject({ unaccounted: [], duplicated: [], unexpected: [] });
  });

  it("shows the arithmetic and that it ties out", () => {
    expect(r.text).toBe("4 in → 2 buy · 2 watch = 4 ✓");
  });

  it("omits empty buckets from the line", () => {
    const q = buildReceipt(U, [
      { label: "buy",   symbols: U },
      { label: "watch", symbols: [] },
    ]);
    expect(q.text).not.toContain("watch");
  });
});

describe("buildReceipt — the 2026-08-14 failure", () => {
  // GOOGL and 0939.HK matched no tier and vanished from the message.
  const r = buildReceipt(U, [
    { label: "buy",   symbols: ["AAPL"] },
    { label: "watch", symbols: ["MSFT"] },
  ], { display: s => s.replace(".HK", "") });

  it("names the dropped symbols", () => {
    expect(r.ok).toBe(false);
    expect(r.unaccounted.sort()).toEqual(["0939.HK", "GOOGL"]);
  });

  it("shows the sum failing to reach the input count", () => {
    expect(r.text).toContain("4 in →");
    expect(r.text).toContain("= 2");
    expect(r.text).not.toContain("✓");
    expect(r.text).toContain("2 UNACCOUNTED");
  });

  it("applies the display transform so .HK is stripped", () => {
    expect(r.text).toContain("0939");
    expect(r.text).not.toContain("0939.HK");
  });
});

describe("buildReceipt — other ways a report loses its input", () => {
  it("catches a symbol counted in two buckets", () => {
    const r = buildReceipt(U, [
      { label: "buy",   symbols: ["AAPL", "MSFT", "GOOGL"] },
      { label: "watch", symbols: ["GOOGL", "0939.HK"] },
    ]);
    expect(r.ok).toBe(false);
    expect(r.duplicated).toEqual(["GOOGL"]);
    expect(r.text).toContain("DOUBLE-COUNTED");
  });

  it("catches a bucket inventing a symbol that was never in the input", () => {
    const r = buildReceipt(U, [
      { label: "buy",   symbols: ["AAPL", "MSFT"] },
      { label: "watch", symbols: ["GOOGL", "0939.HK", "TSLA"] },
    ]);
    expect(r.ok).toBe(false);
    expect(r.unexpected).toEqual(["TSLA"]);
    expect(r.text).toContain("UNEXPECTED");
  });

  it("catches a bucket that was computed but never rendered", () => {
    // Every symbol is bucketed correctly, but the watch section was never pushed.
    const body = "BUYS\nAAPL 1.0\nMSFT 2.0";
    const r = buildReceipt(U, [
      { label: "buy",   symbols: ["AAPL", "MSFT"] },
      { label: "watch", symbols: ["GOOGL", "0939.HK"] },
    ], { renderedText: body });
    expect(r.ok).toBe(false);
    expect(r.unaccounted.sort()).toEqual(["0939.HK", "GOOGL"]);
  });

  it("passes when every symbol does appear in the body", () => {
    const body = "BUYS\nAAPL MSFT\nWATCH\nGOOGL 0939";
    const r = buildReceipt(U, [
      { label: "buy",   symbols: ["AAPL", "MSFT"] },
      { label: "watch", symbols: ["GOOGL", "0939.HK"] },
    ], { renderedText: body, display: s => s.replace(".HK", "") });
    expect(r.ok).toBe(true);
  });
});

describe("buildReceipt — scale", () => {
  const big = Array.from({ length: 400 }, (_, i) => `SYM${i}`);

  it("stays one short line at 400 names", () => {
    const r = buildReceipt(big, [
      { label: "buy",   symbols: big.slice(0, 7) },
      { label: "watch", symbols: big.slice(7) },
    ]);
    expect(r.ok).toBe(true);
    expect(r.text).toBe("400 in → 7 buy · 393 watch = 400 ✓");
    expect(r.text.length).toBeLessThan(80);
  });

  it("elides a long list of dropped names instead of printing all of them", () => {
    const r = buildReceipt(big, [{ label: "buy", symbols: big.slice(0, 10) }]);
    expect(r.unaccounted).toHaveLength(390);
    expect(r.text).toContain("+385 more");
    expect(r.text.length).toBeLessThan(150);
  });
});

describe("buildReceipt — upstream loss (the 2026-08-15 Morning Brief)", () => {
  // The report was handed 15 results and accounted for all 15. The portfolio held 16:
  // 0939.HK was never fetched, so reconciling against the report's own input said "✓".
  const handed = ["AAPL", "MSFT", "GOOGL"];
  const portfolio = ["AAPL", "MSFT", "GOOGL", "0939.HK"];

  it("says ✓ without the portfolio of record — the old, useless answer", () => {
    const r = buildReceipt(handed, [{ label: "bullish", symbols: handed }]);
    expect(r.ok).toBe(true);
    expect(r.text).toBe("3 in → 3 bullish = 3 ✓");
  });

  it("names the never-analysed symbol once anchored to the portfolio", () => {
    const r = buildReceipt(handed, [{ label: "bullish", symbols: handed }], {
      expected: portfolio, display: s => s.replace(".HK", ""),
    });
    expect(r.ok).toBe(false);
    expect(r.neverAnalysed).toEqual(["0939.HK"]);
    expect(r.text).toBe("4 in → 3 bullish = 3 ⚠️ 1 NEVER ANALYSED: 0939");
  });

  it("counts the portfolio, not the short input, in the 'in' figure", () => {
    const r = buildReceipt(handed, [{ label: "bullish", symbols: handed }], {
      expected: portfolio,
    });
    expect(r.text.startsWith("4 in →")).toBe(true);
  });

  it("stays ok when the report received the whole portfolio", () => {
    const all = [...portfolio];
    const r = buildReceipt(all, [{ label: "bullish", symbols: all }], { expected: portfolio });
    expect(r.ok).toBe(true);
    expect(r.neverAnalysed).toEqual([]);
    expect(r.text).toContain("= 4 ✓");
  });

  it("reports an upstream loss and an in-report loss together", () => {
    const r = buildReceipt(handed, [{ label: "bullish", symbols: ["AAPL"] }], {
      expected: portfolio, display: s => s.replace(".HK", ""),
    });
    expect(r.neverAnalysed).toEqual(["0939.HK"]);
    expect(r.unaccounted.sort()).toEqual(["GOOGL", "MSFT"]);
    expect(r.text).toContain("NEVER ANALYSED");
    expect(r.text).toContain("UNACCOUNTED");
  });
});
