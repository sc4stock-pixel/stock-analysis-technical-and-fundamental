import { describe, it, expect } from "vitest";
import { PANEL_META, FRESHNESS, getPanelMeta } from "./panelMeta";

const EXPECTED_IDS = [
  "alerts", "macro-us", "macro-hk", "portfolio",
  "positions", "stock", "chart", "nav", "trades", "config",
];

describe("panelMeta", () => {
  it("has exactly the 10 expected panel ids", () => {
    expect(PANEL_META.map((p) => p.id)).toEqual(EXPECTED_IDS);
  });

  it("every entry has a non-empty label, meaning and cadence", () => {
    for (const p of PANEL_META) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.meaning.length).toBeGreaterThan(0);
      expect(p.cadence.length).toBeGreaterThan(0);
    }
  });

  it("getPanelMeta returns the entry by id and undefined for unknown", () => {
    expect(getPanelMeta("alerts")?.label).toBe("Execution Alerts");
    expect(getPanelMeta("portfolio")?.detail?.length).toBeGreaterThan(0);
    expect(getPanelMeta("nope")).toBeUndefined();
  });

  it("FRESHNESS is a non-empty list of [label, value] pairs", () => {
    expect(FRESHNESS.length).toBeGreaterThan(0);
    for (const row of FRESHNESS) {
      expect(row).toHaveLength(2);
    }
  });
});
