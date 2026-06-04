import { supertrend } from "@/lib/indicators";

export type ChartBar = { high: number; low: number; close: number };
export interface FlipInfo {
  flipType: "BULLISH" | "BEARISH" | null;
  barsSince: number;
  stopAtFlip: number | null;
  closeAtFlip: number | null;
}

export function detectFlip(bars: ChartBar[], atrPeriod: number, multiplier: number): FlipInfo {
  if (!bars || bars.length < 2) {
    return { flipType: null, barsSince: 999, stopAtFlip: null, closeAtFlip: null };
  }
  const [stArr, dir] = supertrend(
    bars.map(b => b.high), bars.map(b => b.low), bars.map(b => b.close), atrPeriod, multiplier,
  );
  for (let i = dir.length - 1; i >= 1; i--) {
    if (dir[i] !== dir[i - 1]) {
      return {
        flipType: dir[i] === 1 ? "BULLISH" : "BEARISH",
        barsSince: dir.length - 1 - i,
        stopAtFlip: stArr[i - 1] ?? null,
        closeAtFlip: bars[i].close,
      };
    }
  }
  return { flipType: null, barsSince: 999, stopAtFlip: null, closeAtFlip: null };
}
