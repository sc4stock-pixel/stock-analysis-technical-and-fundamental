import { describe, it, expect } from "vitest";
import { classifyValidity } from "@/lib/pipeline-health";

const ok = { current_price: 5, error: undefined };
const bad = { current_price: 0, error: "boom" };

describe("classifyValidity", () => {
  it("all valid → not degraded", () => {
    expect(classifyValidity([ok, ok, ok])).toEqual({ total: 3, validCount: 3, degraded: false });
  });
  it("all failed → degraded", () => {
    expect(classifyValidity([bad, bad, bad]).degraded).toBe(true);
  });
  it("below 50% valid → degraded", () => {
    expect(classifyValidity([ok, bad, bad, bad]).degraded).toBe(true);
  });
  it("at/above 50% valid → not degraded", () => {
    expect(classifyValidity([ok, ok, bad]).degraded).toBe(false);
  });
});
