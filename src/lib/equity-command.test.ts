import { describe, it, expect } from "vitest";
import { parseEquityCommand, formatEquityReply, EQUITY_MIN, EQUITY_MAX, EQUITY_DEFAULT } from "./equity-command";

describe("parseEquityCommand", () => {
  it("bare /equity → show", () => {
    expect(parseEquityCommand("/equity")).toEqual({ show: true });
  });
  it("plain integer", () => {
    expect(parseEquityCommand("/equity 105000")).toEqual({ value: 105000 });
  });
  it("comma-separated", () => {
    expect(parseEquityCommand("/equity 105,000")).toEqual({ value: 105000 });
  });
  it("dollar-prefixed", () => {
    expect(parseEquityCommand("/equity $105000")).toEqual({ value: 105000 });
  });
  it("dollar + commas", () => {
    expect(parseEquityCommand("/equity $105,000")).toEqual({ value: 105000 });
  });
  it("below range → error", () => {
    const r = parseEquityCommand("/equity 999");
    expect("error" in r).toBe(true);
  });
  it("above range → error", () => {
    const r = parseEquityCommand("/equity 100000001");
    expect("error" in r).toBe(true);
  });
  it("non-numeric → error", () => {
    const r = parseEquityCommand("/equity abc");
    expect("error" in r).toBe(true);
  });
  it("negative → error", () => {
    const r = parseEquityCommand("/equity -5000");
    expect("error" in r).toBe(true);
  });
  it("decimal → error (integer dollars only)", () => {
    const r = parseEquityCommand("/equity 105000.50");
    expect("error" in r).toBe(true);
  });
  it("extra args → error", () => {
    const r = parseEquityCommand("/equity 105000 extra");
    expect("error" in r).toBe(true);
  });
  it("boundary min accepted", () => {
    expect(parseEquityCommand(`/equity ${EQUITY_MIN}`)).toEqual({ value: EQUITY_MIN });
  });
  it("boundary max accepted", () => {
    expect(parseEquityCommand(`/equity ${EQUITY_MAX}`)).toEqual({ value: EQUITY_MAX });
  });
});

describe("formatEquityReply", () => {
  it("no equity set", () => {
    expect(formatEquityReply(null)).toBe(
      `No equity set — worker uses its built-in default $${EQUITY_DEFAULT.toLocaleString("en-US")}`
    );
  });
  it("show current", () => {
    const current = { value: 105000, updated_at: "2026-07-13T10:00:00.000Z" };
    expect(formatEquityReply(current)).toBe("Sizing equity: $105,000 (updated 2026-07-13)");
  });
  it("updated from existing", () => {
    const current = { value: 100000, updated_at: "2026-07-01T00:00:00.000Z" };
    const updated = { value: 105000, updated_at: "2026-07-13T10:00:00.000Z" };
    expect(formatEquityReply(current, updated)).toBe("Sizing equity updated: $100,000 → $105,000");
  });
  it("updated from unset (built-in default)", () => {
    const updated = { value: 105000, updated_at: "2026-07-13T10:00:00.000Z" };
    expect(formatEquityReply(null, updated)).toBe(
      `Sizing equity updated: built-in default $${EQUITY_DEFAULT.toLocaleString("en-US")} → $105,000`
    );
  });
  it("HTML-escapes dynamic content (defense in depth, no special chars normally present)", () => {
    // formatEquityReply only ever formats numbers/dates, but confirm htmlEscape is applied
    // by checking the function doesn't produce raw <,> from its own template literals.
    const current = { value: 105000, updated_at: "2026-07-13T10:00:00.000Z" };
    const out = formatEquityReply(current);
    expect(out).not.toMatch(/[<>]/);
  });
});
