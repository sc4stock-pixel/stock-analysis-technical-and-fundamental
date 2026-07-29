import { describe, it, expect } from "vitest";
import { assembleDigestPrompt, type DigestInputs } from "./assemble";
import type { WorkerState } from "@/types/worker-state";

function baseState(): WorkerState {
  return {
    version: 1,
    updatedAt: "2026-07-29T00:00Z",
    regionLastRun: {},
    tickers: {},
    lastAlert: {},
    events: [],
  };
}

const inputs: DigestInputs = {
  state: {
    version: 39,
    updatedAt: "2026-06-12T02:01Z",
    regionLastRun: { us: "2026-06-11", hk: "2026-06-12" },
    tickers: {
      "TSM": { region: "us", price: 421.07, barDate: "2026-06-11", dir: "up", flipPx: 365.9, stop: 395.9, atrPeriod: 10, mult: 3.0, score: 7, smaStack: "P>50>150>200", funds: { f: 8, z: 2.07 } },
      "3033.HK": { region: "hk", price: 4.56, barDate: "2026-06-12", dir: "down", flipPx: 4.56, stop: 4.94, atrPeriod: 10, mult: 3.0, score: 0, smaStack: "150>50>P", funds: {} },
    } as any,
    lastAlert: {} as any,
    events: [{ ticker: "3033.HK", type: "flip_buy", confirmed: false, barDate: "2026-06-12", session: "intraday" }] as any,
  },
  kronos: { "TSM": { last_price: 421, forward: { p50: [374.45] } }, "AMD": { last_price: 488, forward: { p50: [240] } } },
  timesfm: { "TSM": { last_price: 421, price_targets: { p50: [418.5] }, st_persistence: { flip_risk: "low" } } },
};

describe("assembleDigestPrompt", () => {
  it("includes the editorial spec, data header, and a row per ticker", () => {
    const p = assembleDigestPrompt(inputs);
    expect(p).toContain("BOTTOM LINE");
    expect(p).toContain("v39");
    expect(p).toContain("TSM");
    expect(p).toContain("3033");
    expect(p).toContain("+6.0");
  });
  it("flags a noisy Kronos value as 'noise', not the raw number", () => {
    const p = assembleDigestPrompt(inputs);
    expect(p).toContain("noise");
    expect(p).not.toContain("-50.8");
  });
  it("renders an em dash where a metric is unavailable", () => {
    const p = assembleDigestPrompt(inputs);
    expect(p).toContain("—");
  });
  it("includes a column legend disambiguating stop/flip and Kronos horizons", () => {
    const p = assembleDigestPrompt(inputs);
    expect(p).toContain("COLUMN LEGEND");
    expect(p).toContain("the BUY / flip-up trigger");
    expect(p).toContain("flip line (stop)");
    expect(p).toContain("K5d");
    expect(p).toContain("high-conviction");
    expect(p).not.toContain("TimesFM");
  });
});

describe("research ideas block", () => {
  it("renders a fired idea with bucket table", () => {
    const state = baseState();
    state.researchIdeas = {
      GOOGL: {
        ticker: "GOOGL", template_id: "drawdown_recovery",
        trigger_reason: "-12.4% off high (2026-06-30)", raw_severity: 0.25,
        date: "2026-07-29",
        metrics: { current_dd_pct: -12.4, trailing_high: 210.55,
          trailing_high_date: "2026-06-30", n_completed: 10, n_open: 1,
          buckets: [{ band: "10-20%", count: 4,
            avg_prior_high_to_reclaim_mo: 3.1, avg_trough_to_reclaim_mo: 1.1 }] },
      },
    };
    const prompt = assembleDigestPrompt({ state, kronos: {} });
    // Assert the DATA block header specifically (the editorial spec also mentions
    // "RESEARCH IDEAS" in its section-D/rules text, so match the block's unique header).
    expect(prompt).toContain("RESEARCH IDEAS (template-generated");
    expect(prompt).toContain("GOOGL");
    expect(prompt).toContain("-12.4%");
    expect(prompt).toContain("10-20%");
  });

  it("omits the block entirely when there are no ideas", () => {
    const state = baseState();
    const prompt = assembleDigestPrompt({ state, kronos: {} });
    // The editorial spec always references "RESEARCH IDEAS"; assert the DATA block
    // (its unique header) is what's absent when there are no ideas.
    expect(prompt).not.toContain("RESEARCH IDEAS (template-generated");
  });
});
