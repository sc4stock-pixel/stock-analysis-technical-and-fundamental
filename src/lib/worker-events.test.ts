import { describe, it, expect } from "vitest";
import { reconcileWorkerEvents } from "./worker-events";
import type { WorkerEvent, WorkerTickerState } from "@/types/worker-state";

// Fixture mirrors the real KV `state.events` (newest-first) + `state.tickers` read
// on 2026-06-05: 3033/0700 flipped up 06-02 and HELD (dir=up); the 06-03 3033
// provisional exit never confirmed and was reverted by the close.
const events: WorkerEvent[] = [
  { type: "flip_exit",   ticker: "MSFT",    region: "us", session: "eod",      barDate: "2026-06-03", confirmed: true },
  { type: "tt_stripped", ticker: "MSFT",    region: "us", session: "eod",      barDate: "2026-06-03", confirmed: true },
  { type: "flip_exit",   ticker: "GOOGL",   region: "us", session: "eod",      barDate: "2026-06-03", confirmed: true },
  { type: "flip_exit",   ticker: "3033.HK", region: "hk", session: "intraday", barDate: "2026-06-03", confirmed: false },
  { type: "flip_buy",    ticker: "0700.HK", region: "hk", session: "eod",      barDate: "2026-06-02", confirmed: true },
  { type: "flip_buy",    ticker: "3033.HK", region: "hk", session: "eod",      barDate: "2026-06-02", confirmed: true },
  { type: "flip_buy",    ticker: "0700.HK", region: "hk", session: "intraday", barDate: "2026-06-02", confirmed: false },
  { type: "flip_buy",    ticker: "3033.HK", region: "hk", session: "intraday", barDate: "2026-06-02", confirmed: false },
  { type: "tt_regained", ticker: "MSFT",    region: "us", session: "eod",      barDate: "2026-06-01", confirmed: true },
];

const tickers = {
  "3033.HK": { dir: "up" },
  "0700.HK": { dir: "up" },
} as unknown as Record<string, WorkerTickerState>;

const find = (rs: ReturnType<typeof reconcileWorkerEvents>, ticker: string, type: string, barDate: string) =>
  rs.find(r => r.ticker === ticker && r.type === type && r.barDate === barDate);

describe("reconcileWorkerEvents", () => {
  const rs = reconcileWorkerEvents(events, tickers);

  it("collapses provisional+confirmed duplicates for the same ticker+type+bar (confirmed wins)", () => {
    const buys3033 = rs.filter(r => r.ticker === "3033.HK" && r.type === "flip_buy");
    expect(buys3033).toHaveLength(1);
    expect(buys3033[0].confirmed).toBe(true);
    // overall: 9 events − 2 deduped provisionals = 7
    expect(rs).toHaveLength(7);
  });

  it("marks the flip that matches current dir as current (3033 held up since 06-02)", () => {
    const buy = find(rs, "3033.HK", "flip_buy", "2026-06-02")!;
    expect(buy.current).toBe(true);
    expect(buy.superseded).toBe(false);
    expect(buy.currentDir).toBe("up");
  });

  it("marks a reverted provisional flip (06-03 exit) as superseded + reverted, NOT current", () => {
    const exit = find(rs, "3033.HK", "flip_exit", "2026-06-03")!;
    expect(exit.current).toBe(false);
    expect(exit.superseded).toBe(true);
    expect(exit.reverted).toBe(true); // implied down, but worker dir is up
  });

  it("0700 single held flip is current", () => {
    const buy = find(rs, "0700.HK", "flip_buy", "2026-06-02")!;
    expect(buy.current).toBe(true);
    expect(buy.reverted).toBe(false);
  });

  it("falls back to newest-flip-wins when ticker has no dir (MSFT not in tickers)", () => {
    const exit = find(rs, "MSFT", "flip_exit", "2026-06-03")!;
    expect(exit.current).toBe(true);
    expect(exit.superseded).toBe(false);
  });

  it("leaves tt events neutral (not flips)", () => {
    const tt = find(rs, "MSFT", "tt_stripped", "2026-06-03")!;
    expect(tt.current).toBe(false);
    expect(tt.superseded).toBe(false);
    expect(tt.reverted).toBe(false);
  });
});
