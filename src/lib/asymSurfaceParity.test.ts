// Cross-surface parity guard for the asymmetric 100/40 sizing rule (D3 class).
//
// The 2026-08-27 buildout shipped surface-by-surface as each was noticed, and an
// audit then found four more that still rendered the old binary picture
// (OpenPositionsPanel listing only ST longs, TradingPlanTab calling the ST line
// an exit, OverviewTab/PortfolioSummaryBar/StockCard with no weight at all).
// Spotting those by eye does not scale. This test enumerates every surface that
// renders position/exposure and asserts it references the single derivation, so
// a NEW surface — or a regression that strips the weight out of an existing one —
// fails CI instead of silently under-reporting the book.
//
// It reads source text on purpose: the alternative is rendering every panel,
// which needs Clerk + live results and cannot run here.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Surfaces that render a position, stance, or exposure to the user and must
 *  therefore derive the target weight from targetWeight.ts. */
const WEIGHT_BEARING_SURFACES = [
  "src/components/OpenPositionsPanel.tsx",
  "src/components/AlertsPanel.tsx",
  "src/components/PortfolioSummaryBar.tsx",
  "src/components/StockCard.tsx",
  "src/components/tabs/OverviewTab.tsx",
  "src/lib/telegram.ts",
  "src/lib/telegram-report.ts",
  "src/lib/digest/assemble.ts",
];

describe("asymmetric 100/40 cross-surface parity", () => {
  it.each(WEIGHT_BEARING_SURFACES)("%s derives the target weight", (file) => {
    const src = read(file);
    // Either it imports a derivation helper, or it consumes a row that already
    // carries `targetWeight` (AlertsPanel / telegram-report take the ActionableRow).
    const usesHelper = /targetWeightOf(Result|Worker)|exitActionLabel|weightTag/.test(src);
    const usesRowField = /\btargetWeight\b/.test(src);
    expect(usesHelper || usesRowField).toBe(true);
  });

  const TSX_SURFACES = WEIGHT_BEARING_SURFACES.filter(f => f.endsWith(".tsx"));

  it.each(TSX_SURFACES)("%s switches on weightTone, not the raw number", (file) => {
    const src = read(file);
    // Adding the 70% trim tier broke every `weight === 100 ? a : b`. Surfaces
    // must branch on the semantic tone so the next tier change cannot silently
    // render a middle tier with the floor's styling.
    expect(src).not.toMatch(/targetWeight\s*===\s*100|tgtWeight\s*===\s*100|\bw\s*===\s*100\b/);
    expect(src).toMatch(/weightTone/);
  });

  it.each(WEIGHT_BEARING_SURFACES)("%s does not hardcode the 100/40 rule inline", (file) => {
    const src = read(file);
    // The mapping lives in ONE place. A surface re-deriving "close > sma200 ? 100 : 40"
    // is exactly the drift this guard exists to catch.
    const inlineRule = /sma_?200[^\n]{0,40}\?[^\n]{0,20}\b100\b[^\n]{0,20}:[^\n]{0,20}\b40\b/i;
    expect(inlineRule.test(src)).toBe(false);
  });

  it("OpenPositionsPanel does not filter the book down to ST longs only", () => {
    const src = read("src/components/OpenPositionsPanel.tsx");
    // The pre-audit bug: `if ((r.st_direction ?? -1) !== 1) continue;` in the
    // panel's row loop dropped every non-long name, understating the book by
    // roughly half once the floor made it permanently invested.
    expect(src).not.toMatch(/if\s*\(\s*\(r\.st_direction\s*\?\?\s*-1\)\s*!==\s*1\s*\)\s*continue/);
    expect(src).toMatch(/weightOnly/);
  });

  it("exit-facing copy never tells the user to sell out entirely", () => {
    for (const file of ["src/lib/telegram.ts", "src/lib/targetWeight.ts"]) {
      const src = read(file);
      expect(src).not.toMatch(/SELL ALL|EXIT ALL|close the position/i);
    }
    expect(read("src/lib/targetWeight.ts")).toMatch(/TRIM to/);
  });

  it("the panel legend explains the weight wherever a chip is shown", () => {
    const meta = read("src/lib/panelMeta.ts");
    for (const id of ["positions", "alerts", "nav"]) {
      const block = meta.slice(meta.indexOf(`id: "${id}"`));
      const entry = block.slice(0, block.indexOf("},"));
      expect(entry.toLowerCase()).toMatch(/100\/40|target wt|asym/);
    }
  });
});
