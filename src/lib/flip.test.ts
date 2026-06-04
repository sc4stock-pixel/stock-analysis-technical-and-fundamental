import { describe, it, expect } from "vitest";
import { detectFlip } from "@/lib/flip";

const bars = [
  { high: 10, low: 9, close: 9.5 }, { high: 10, low: 9, close: 9.4 },
  { high: 10, low: 9, close: 9.3 }, { high: 10, low: 9, close: 9.2 },
  { high: 10, low: 9, close: 9.1 }, { high: 13, low: 12, close: 12.8 },
];

describe("detectFlip", () => {
  it("returns null flipType when fewer than 2 bars", () => {
    expect(detectFlip([{ high: 1, low: 1, close: 1 }], 3, 3).flipType).toBeNull();
  });
  it("detects a bullish flip and reports stop/close", () => {
    const f = detectFlip(bars, 3, 3);
    expect(f.flipType).toBe("BULLISH");
    expect(f.closeAtFlip).toBe(12.8);
    expect(typeof f.barsSince).toBe("number");
  });
});
