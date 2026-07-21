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
      horizons: {
        "5d": { hits: 260, n: 500, rate: 0.52, ci_lo: 0.47, ci_hi: 0.56, p: 0.4 },
        "15d": { hits: 300, n: 484, rate: 0.62, ci_lo: 0.58, ci_hi: 0.66, p: 0.0004 },
        "20d": { hits: 280, n: 452, rate: 0.62, ci_lo: 0.57, ci_hi: 0.66, p: 0.0004 },
      },
      conviction_5d: { lt2: null, "2to5": null, gt5: { hits: 47, n: 58, rate: 0.81, ci_lo: 0.69, ci_hi: 0.90, p: 0.001 } },
      verdict: "EDGE_HIGH_CONVICTION",
    },
    NAIVE: {
      horizons: {
        "5d": { hits: 250, n: 500, rate: 0.50, ci_lo: 0.46, ci_hi: 0.54, p: 0.9 },
        "15d": { hits: 266, n: 484, rate: 0.55, ci_lo: 0.50, ci_hi: 0.59, p: 0.03 },
        "20d": { hits: 258, n: 452, rate: 0.57, ci_lo: 0.52, ci_hi: 0.62, p: 0.003 },
      },
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

  it("renders the OOS hit-rate scoreboard (Kronos vs naive per horizon)", () => {
    const lines = buildForecastSection(ordered, kronosData as any, stubSkill);
    const joined = lines.join("\n");
    expect(joined).toContain("OOS dir-accuracy");
    expect(joined).toContain("provisional");
    // per-horizon rows present
    expect(joined).toContain("5d");
    expect(joined).toContain("15d");
    expect(joined).toContain("20d");
    // Kronos 5d 52% shown vs naive 50%
    expect(joined).toContain("52%");
    expect(joined).toContain("50%");
  });

  it("marks a clearing horizon with ✅ and leaves 5d unmarked", () => {
    const lines = buildForecastSection(ordered, kronosData as any, stubSkill);
    const joined = lines.join("\n");
    const line15 = joined.split("\n").find(l => l.includes("55%")); // 15d (naive 55% is unique)
    const line5 = joined.split("\n").find(l => l.includes("52%"));  // 5d (kronos 52% is unique)
    expect(line15).toContain("✅");   // 62% vs naive 55%, p<0.05 → clears
    expect(line5).not.toContain("✅"); // 52% vs naive 50%, p=0.4 → no edge
  });

  it("omits footer when skill is null", () => {
    const lines = buildForecastSection(ordered, kronosData as any, null);
    const joined = lines.join("\n");
    expect(joined).not.toContain("provisional");
    expect(joined).not.toContain("OOS dir-accuracy");
  });
});
