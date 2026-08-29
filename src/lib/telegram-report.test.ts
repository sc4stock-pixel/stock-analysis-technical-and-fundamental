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

  it("header names Kronos and marks the table display-only", () => {
    const lines = buildForecastSection(ordered, kronosData as any, null);
    const joined = lines.join("\n");
    expect(joined).toContain("KRONOS FORECASTS");
    expect(joined).toContain("display-only");
  });

  it("shows both the 5d and 20d columns", () => {
    const lines = buildForecastSection(ordered, kronosData as any, null);
    const joined = lines.join("\n");
    const head = joined.split("\n").find(l => l.includes("5d") && l.includes("20d"));
    expect(head).toBeDefined();
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

  it("benchmarks against the contrarian rule, not naive", () => {
    const lines = buildForecastSection(ordered, kronosData as any, stubSkill);
    const joined = lines.join("\n");
    expect(joined).toContain("Kronos vs a one-line contrarian rule");
    expect(joined).toContain("contrarian");
    expect(joined).toContain("15d");
    // naive 15d = 55% → contrarian baseline shown as 45%, NOT 55%
    const line15 = joined.split("\n").find(l => l.trim().startsWith("15d"));
    expect(line15).toContain("45%");
    expect(line15).not.toContain("55%");
  });

  it("does not claim an edge when Kronos fails to clear the contrarian baseline", () => {
    // naive 5d 50% → contrarian 50%; Kronos 52% but ci_lo 0.47 < 0.50 → no ✅
    const lines = buildForecastSection(ordered, kronosData as any, stubSkill);
    // Kronos 5d = 52% is unique to that row (first row carries the <pre> prefix)
    const line5 = lines.join("\n").split("\n").find(l => l.includes("52%"));
    expect(line5).toBeDefined();
    expect(line5).not.toContain("✅");
  });

  it("reports the regime from the trend-following hit rate", () => {
    const lines = buildForecastSection(ordered, kronosData as any, stubSkill);
    const joined = lines.join("\n");
    // naive 20d = 57% → trending
    expect(joined).toContain("Currently <b>trending</b>");
    expect(joined).toContain("57%");
  });

  // Copy trimmed 2026-08-15 at Steven's request: the "diff is the only column about
  // Kronos" preamble and the "% columns describe the market" explainer were noise.
  // The data-driven verdict stays — it is the only line that fires on new information.
  it("keeps the contrarian-rule verdict but drops the two explainers", () => {
    const joined = buildForecastSection(ordered, kronosData as any, stubSkill).join("\n");
    expect(joined).toMatch(/no horizon has cleared it|clears? the contrarian rule/);
    expect(joined).not.toContain("is the only column about Kronos");
    expect(joined).not.toContain("describe the <b>market</b>");
    expect(joined).not.toContain("behaving as");
    expect(joined).not.toContain("fade the 60-day drift");
  });

  it("states no edge when nothing clears, and names the horizon when one does", () => {
    // No-edge case: every Kronos ci_lo sits BELOW its contrarian baseline (1 − naive).
    const flat = JSON.parse(JSON.stringify(stubSkill));
    flat.KRONOS.horizons = {
      "5d":  { hits: 250, n: 500, rate: 0.50, ci_lo: 0.46, ci_hi: 0.54, p: 0.9 },  // vs 50%
      "15d": { hits: 213, n: 484, rate: 0.44, ci_lo: 0.40, ci_hi: 0.48, p: 0.9 },  // vs 45%
      "20d": { hits: 190, n: 452, rate: 0.42, ci_lo: 0.38, ci_hi: 0.46, p: 0.9 },  // vs 43%
    };
    const noEdge = buildForecastSection(ordered, kronosData as any, flat).join("\n");
    expect(noEdge).toContain("no horizon has cleared it");

    // Edge case: lift 15d well clear of its 45% contrarian baseline → must be named.
    const edgy = JSON.parse(JSON.stringify(flat));
    edgy.KRONOS.horizons["15d"] = { hits: 340, n: 484, rate: 0.70, ci_lo: 0.66, ci_hi: 0.74, p: 0.0001 };
    const joined = buildForecastSection(ordered, kronosData as any, edgy).join("\n");
    expect(joined).toContain("15d now clears");
    expect(joined).not.toContain("no horizon has cleared it");
  });

  it("omits footer when skill is null", () => {
    const lines = buildForecastSection(ordered, kronosData as any, null);
    const joined = lines.join("\n");
    expect(joined).not.toContain("provisional");
    expect(joined).not.toContain("Kronos vs a one-line contrarian rule");
  });
});

// 2026-08-28: under asymmetric sizing "Near Stop" is three different events.
// The EOD report must say what an imminent flip does to POSITION SIZE.
describe("buildEodReport — WEIGHT MOVES NEARBY", () => {
  const nearStop = (symbol: string, aboveSma200: boolean, dist: number): unknown => ({
    symbol, exchange: "US", signal: "HOLD", score: 5, current_price: 100,
    change_pct: 0.4, st_direction: 1, st_stop_distance_pct: dist,
    st_open_return_pct: 3.0,                       // in an ST long -> 100% now
    sepa_metadata: { sepa_score: 1, trend_template: aboveSma200,
      trend_template_criteria: { criteria_met: 5, c2_price_above_sma200: aboveSma200 } },
  });
  const nearBullFlip = (symbol: string, dist: number): unknown => ({
    symbol, exchange: "US", signal: "HOLD", score: 5, current_price: 100,
    change_pct: 0.4, st_direction: -1, st_stop_distance_pct: dist,
    st_open_return_pct: null,
    sepa_metadata: { sepa_score: 1, trend_template: true,
      trend_template_criteria: { criteria_met: 6, c2_price_above_sma200: true } },
  });

  it("a 100% name BELOW its 200-day shows the floor drop and is flagged severe", () => {
    const msg = buildEodReport([nearStop("HSTECH", false, 1.1)] as never, "hk");
    expect(msg).toContain("WEIGHT MOVES NEARBY");
    expect(msg).toMatch(/↓ HSTECH\s+100% →\s+40%/);
    expect(msg).toContain("skips trim tier");
  });

  it("a 100% name ABOVE its 200-day steps down to the trim tier, not the floor", () => {
    const msg = buildEodReport([nearStop("SPY", true, 1.7)] as never, "us");
    expect(msg).toMatch(/↓ SPY\s+100% →\s+70%/);
    expect(msg).not.toContain("skips trim tier");
  });

  it("a near bullish flip is an ADD (up arrow), never a warning to trim", () => {
    const msg = buildEodReport([nearBullFlip("TSM", -1.6)] as never, "us");
    expect(msg).toMatch(/↑ TSM\s+70% →\s+100%/);
  });
});

// 2026-08-29: the ST BULLISH weight was hoisted to a per-tier subheader. It must
// NOT be hardcoded to 100% — "ST bullish" is st_direction===1, which is NOT the
// same as being in an ST long: a name that flipped up BELOW its SMA50 never
// entered and belongs at 70%/40% while still appearing in this block.
describe("buildEodReport — ST BULLISH weight subheaders", () => {
  const bull = (symbol: string, inLong: boolean, aboveSma200: boolean): unknown => ({
    symbol, exchange: "US", signal: "HOLD", score: 5, current_price: 100,
    change_pct: 1.0, st_direction: 1,
    st_open_return_pct: inLong ? 3.0 : null,
    sepa_metadata: { sepa_score: 1, trend_template: aboveSma200,
      trend_template_criteria: { criteria_met: 6, c2_price_above_sma200: aboveSma200 } },
  });

  it("hoists the weight to a subheader and drops it from each row", () => {
    const msg = buildEodReport([bull("NVDA", true, true), bull("MSFT", true, true)] as never, "us");
    expect(msg).toContain("ST BULLISH (2)");
    expect(msg).toContain("@100%");
    expect(msg).not.toMatch(/NVDA\s+100%/);   // no per-row repetition
  });

  it("does NOT assume every ST-bullish name is 100% — a below-SMA50 flip sits at 70%", () => {
    const msg = buildEodReport([bull("NVDA", true, true), bull("GOOGL", false, true)] as never, "us");
    expect(msg).toContain("@100%");
    expect(msg).toContain("@70%");            // the un-entered name is NOT lumped in at 100%
  });

  it("still marks a 100% name below its own 200-day", () => {
    const msg = buildEodReport([bull("HSTECH", true, false)] as never, "hk");
    expect(msg).toContain("↓40");
  });
});
