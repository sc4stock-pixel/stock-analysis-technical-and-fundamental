import { describe, it, expect } from "vitest";
import { analyzeStock } from "@/lib/analyze-stock";
describe("analyze-stock module", () => {
  it("exports a callable analyzeStock", () => { expect(typeof analyzeStock).toBe("function"); });
});
