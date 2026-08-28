import { describe, it, expect } from "vitest";
import {
  targetWeight, targetWeightOfWorker, targetWeightOfResult,
  exitActionLabel, weightTag, WEIGHT_FULL, WEIGHT_FLOOR,
} from "@/lib/targetWeight";

describe("targetWeight core mapping", () => {
  it("in position -> 100 regardless of SMA200", () => {
    expect(targetWeight({ inPosition: true, aboveSma200: false }).weight).toBe(WEIGHT_FULL);
    expect(targetWeight({ inPosition: true, aboveSma200: true }).weight).toBe(WEIGHT_FULL);
    expect(targetWeight({ inPosition: true, aboveSma200: undefined }).reason).toBe("in_position");
  });
  it("out + above SMA200 -> 100 (hold leg)", () => {
    const tw = targetWeight({ inPosition: false, aboveSma200: true });
    expect(tw.weight).toBe(WEIGHT_FULL);
    expect(tw.reason).toBe("above_sma200");
  });
  it("out + below SMA200 -> 40 floor", () => {
    const tw = targetWeight({ inPosition: false, aboveSma200: false });
    expect(tw.weight).toBe(WEIGHT_FLOOR);
    expect(tw.reason).toBe("floor");
  });
  it("unknown SMA200 fails toward the floor, never full size", () => {
    const tw = targetWeight({ inPosition: false, aboveSma200: undefined });
    expect(tw.weight).toBe(WEIGHT_FLOOR);
    expect(tw.reason).toBe("unknown_sma200");
  });
});

describe("targetWeightOfWorker (KV state)", () => {
  const base = { dir: "up" as const, criteria: [true, true, true, true, true, true, true] };
  it("inLong -> 100", () => {
    expect(targetWeightOfWorker({ ...base, inLong: true })!.weight).toBe(WEIGHT_FULL);
  });
  it("entryPending -> 100 (fill queued next open)", () => {
    expect(targetWeightOfWorker({ ...base, inLong: false, entryPending: true })!.weight).toBe(WEIGHT_FULL);
  });
  it("out, criteria[1]=c2 false -> 40", () => {
    const ts = { ...base, inLong: false, criteria: [true, false, true, true, true, true, true] };
    expect(targetWeightOfWorker(ts)!.weight).toBe(WEIGHT_FLOOR);
  });
  it("out, c2 true -> 100 via SMA200 even when dir is down", () => {
    const ts = { dir: "down" as const, inLong: false, criteria: [true, true, true, true, false, true, true] };
    const tw = targetWeightOfWorker(ts)!;
    expect(tw.weight).toBe(WEIGHT_FULL);
    expect(tw.reason).toBe("above_sma200");
  });
  it("undefined state -> undefined (caller renders nothing, not a guess)", () => {
    expect(targetWeightOfWorker(undefined)).toBeUndefined();
  });
});

describe("targetWeightOfResult (client pipeline)", () => {
  it("open ST position -> 100", () => {
    expect(targetWeightOfResult({ st_open_return_pct: 3.2 }).weight).toBe(WEIGHT_FULL);
  });
  it("no position + c2 true -> 100, c2 false -> 40", () => {
    const meta = (c2: boolean) =>
      ({ trend_template_criteria: { c2_price_above_sma200: c2 } }) as never;
    expect(targetWeightOfResult({ st_open_return_pct: null, sepa_metadata: meta(true) }).weight).toBe(WEIGHT_FULL);
    expect(targetWeightOfResult({ st_open_return_pct: null, sepa_metadata: meta(false) }).weight).toBe(WEIGHT_FLOOR);
  });
});

// STRATEGY.md rule 3: any new surface needs a below-SMA50-flip-is-not-LONG test.
// Target weight is EXPOSURE, not entry state: a 100% weight produced by the
// SMA200 leg must never be the basis for LONG/entry wording.
describe("vocabulary contract", () => {
  it("below-SMA50 flip (no entry) above SMA200: weight=100 but reason is NOT in_position", () => {
    // dir up, gate never passed (c5 false), still above SMA200 (c2 true)
    const ts = { dir: "up" as const, inLong: false, entryPending: false,
                 criteria: [true, true, true, true, false, true, true] };
    const tw = targetWeightOfWorker(ts)!;
    expect(tw.weight).toBe(WEIGHT_FULL);
    expect(tw.reason).toBe("above_sma200");   // exposure leg, not entry
  });
  it("exit action copy never says SELL/EXIT-all", () => {
    expect(exitActionLabel(targetWeight({ inPosition: false, aboveSma200: false })))
      .toBe("TRIM to 40%");
    expect(exitActionLabel(targetWeight({ inPosition: false, aboveSma200: true })))
      .toBe("HOLD 100% (above 200D)");
  });
  it("weightTag renders percent or empty", () => {
    expect(weightTag(targetWeight({ inPosition: true, aboveSma200: true }))).toBe("100%");
    expect(weightTag(undefined)).toBe("");
  });
});
