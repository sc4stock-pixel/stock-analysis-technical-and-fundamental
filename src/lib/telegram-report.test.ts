import { describe, it, expect } from "vitest";
import { reportHeaderLabel, buildEodReport } from "@/lib/telegram-report";
describe("reportHeaderLabel", () => {
  it("US → Morning Brief", () => expect(reportHeaderLabel("us", false)).toBe("🌅 Morning Brief"));
  it("HK → HK Close", () => expect(reportHeaderLabel("hk", false)).toBe("🌇 HK Close"));
  it("both closed → Holiday Status", () => expect(reportHeaderLabel("hk", true)).toBe("🏖️ Holiday Status"));
});

// SlimResult-shaped fixture: NO chart_bars, precomputed _flip (as cron/report produces).
function bearishHKSlim() {
  return {
    symbol: "3033.HK", exchange: "HK", signal: "HOLD", score: 5,
    current_price: 31, change_pct: -3.2, regime: "DOWNTREND", st_direction: -1,
    _flip: { flipType: "BEARISH", barsSince: 0 },
  } as unknown as Parameters<typeof buildEodReport>[0][number];
}

describe("buildEodReport — Act on this section", () => {
  const msg = buildEodReport([bearishHKSlim()], "hk");
  it("includes an ACT ON THIS section", () => {
    expect(msg).toContain("ACT ON THIS");
  });
  it("renders the exit copy from the precomputed _flip", () => {
    expect(msg).toContain("exited uptrend");
  });
  it("strips .HK from the ticker", () => {
    const block = msg.slice(msg.indexOf("ACT ON THIS"));
    expect(block).toContain("3033");
    expect(block).not.toContain("3033.HK");
  });
  it("no longer renders the old RECENT FLIPS header", () => {
    expect(msg).not.toContain("RECENT FLIPS");
  });
});
