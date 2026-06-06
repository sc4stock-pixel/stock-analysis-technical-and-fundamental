import { describe, it, expect } from "vitest";
import { evaluate, CHECKS } from "@/lib/freshness";
import { isTradingDay, tradingDaysBetween } from "@/lib/marketCalendar";

const check = (artifact: string) => CHECKS.find(c => c.artifact === artifact)!;

describe("marketCalendar", () => {
  it("weekends are not trading days", () => {
    expect(isTradingDay("us", new Date("2026-06-06"))).toBe(false); // Sat
    expect(isTradingDay("us", new Date("2026-06-07"))).toBe(false); // Sun
    expect(isTradingDay("us", new Date("2026-06-05"))).toBe(true);  // Fri
  });
  it("region holidays are skipped", () => {
    expect(isTradingDay("us", new Date("2026-06-19"))).toBe(false); // Juneteenth (NYSE)
    expect(isTradingDay("hk", new Date("2026-07-01"))).toBe(false); // HK SAR Day
    expect(isTradingDay("hk", new Date("2026-06-19"))).toBe(true);  // not an HK holiday
  });
  it("does not count weekend gap as trading days", () => {
    // Fri -> Mon is 1 trading day, not 3
    expect(tradingDaysBetween(new Date("2026-06-05"), new Date("2026-06-08"), "us")).toBe(1);
  });
});

describe("freshness evaluate", () => {
  const now = new Date("2026-06-08T12:00:00Z"); // Monday

  it("missing timestamp -> stale + missing", () => {
    const r = evaluate(check("st_params.json"), null, now);
    expect(r.missing).toBe(true);
    expect(r.stale).toBe(true);
  });

  it("calendar threshold: fresh within maxAgeHours", () => {
    const r = evaluate(check("st_params.json"), new Date("2026-06-05"), now); // ~3.5d < 40d
    expect(r.stale).toBe(false);
  });

  it("calendar threshold: stale beyond maxAgeHours", () => {
    const r = evaluate(check("st_params.json"), new Date("2026-04-01"), now); // >40d
    expect(r.stale).toBe(true);
  });

  it("trading-day threshold: Friday update is fresh on Monday (weekend doesn't count)", () => {
    const r = evaluate(check("timesfm_forecasts.json"), new Date("2026-06-05T20:00:00Z"), now);
    expect(r.stale).toBe(false); // 1 trading day <= 2
  });

  it("trading-day threshold: stale after >2 trading days", () => {
    const r = evaluate(check("timesfm_forecasts.json"), new Date("2026-06-02T20:00:00Z"), now);
    expect(r.stale).toBe(true); // Tue->Mon = 3 trading days > 2
  });
});
