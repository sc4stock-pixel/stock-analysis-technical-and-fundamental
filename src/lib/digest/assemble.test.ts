import { describe, it, expect } from "vitest";
import { assembleDigestPrompt, type DigestInputs } from "./assemble";

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
