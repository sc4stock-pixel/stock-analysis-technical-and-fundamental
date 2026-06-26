import { describe, it, expect } from "vitest";
import { reportHeaderLabel, buildEodReport, buildForecastSection } from "@/lib/telegram-report";
import type { ForecastSkill } from "@/types";
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

// ---------- Forecast section (5d rewrite) ----------
describe("buildForecastSection — 5d + skill footer", () => {
  const kronosData = {
    AAPL: {
      last_price: 100,
      last_date: "2026-06-25",
      forward: { p50: [101, 102, 103, 104, 108] }, // 5 bars, [4]=108 → +8%
      historical: { dir_hits: 15, total: 20 },
    },
    "0700.HK": {
      last_price: 500,
      last_date: "2026-06-25",
      forward: { p50: [501, 502, 503, 504, 510] }, // [4]=510 → +2%
      historical: { dir_hits: 12, total: 20 },
    },
  };
  const ordered = [{ symbol: "AAPL" }, { symbol: "0700.HK" }];

  const stubSkill: ForecastSkill = {
    _metadata: { conviction_pct: 5, drift_window: 5, generated_at_hk: "2026-06-25", history_days: 90, match_tol_days: 2 },
    KRONOS: {
      horizons: {},
      conviction_5d: { lt2: null, "2to5": null, gt5: { hits: 47, n: 58, rate: 0.81, ci_lo: 0.69, ci_hi: 0.90, p: 0.001 } },
      verdict: "EDGE_HIGH_CONVICTION",
    },
    NAIVE: {
      horizons: {},
      conviction_5d: { lt2: null, "2to5": null, gt5: { hits: 30, n: 58, rate: 0.517, ci_lo: 0.38, ci_hi: 0.65, p: 0.5 } },
      verdict: "BASELINE",
    },
    TIMESFM: {
      horizons: {},
      conviction_5d: { lt2: null, "2to5": null, gt5: null },
      verdict: "NO_EDGE",
    },
  };

  it("header says FORECASTS 5d", () => {
    const lines = buildForecastSection(ordered, kronosData as any, null);
    const joined = lines.join("\n");
    expect(joined).toContain("FORECASTS 5d");
  });

  it("does not contain /20 or TimesFM", () => {
    const lines = buildForecastSection(ordered, kronosData as any, null);
    const joined = lines.join("\n");
    expect(joined).not.toContain("/20");
    expect(joined).not.toContain("TimesFM");
    expect(joined).not.toContain(" T ");
  });

  it("marks high-conviction rows with ✦", () => {
    const lines = buildForecastSection(ordered, kronosData as any, null);
    const joined = lines.join("\n");
    // AAPL is +8% (>5%), should have ✦
    expect(joined).toContain("✦");
    // 0700 is +2% (<5%), should NOT have ✦ on that row
    const hkLine = joined.split("\n").find(l => l.includes("0700"));
    expect(hkLine).not.toContain("✦");
  });

  it("strips .HK from ticker labels", () => {
    const lines = buildForecastSection(ordered, kronosData as any, null);
    const joined = lines.join("\n");
    expect(joined).toContain("0700");
    expect(joined).not.toContain("0700.HK");
  });

  it("renders skill footer with EDGE verdict and percentages", () => {
    const lines = buildForecastSection(ordered, kronosData as any, stubSkill);
    const joined = lines.join("\n");
    expect(joined).toContain("provisional");
    expect(joined).toContain("81%");
    expect(joined).toContain("52%");
  });

  it("renders no-edge footer when verdict is not EDGE", () => {
    const noEdgeSkill = { ...stubSkill, KRONOS: { ...stubSkill.KRONOS, verdict: "NO_EDGE" as const } };
    const lines = buildForecastSection(ordered, kronosData as any, noEdgeSkill);
    const joined = lines.join("\n");
    expect(joined).toContain("no measured edge");
  });

  it("omits footer when skill is null", () => {
    const lines = buildForecastSection(ordered, kronosData as any, null);
    const joined = lines.join("\n");
    expect(joined).not.toContain("provisional");
    expect(joined).not.toContain("no measured edge");
  });
});
