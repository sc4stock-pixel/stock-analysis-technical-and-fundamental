// Strategy position state machine (STRATEGY.md) — the web-side twin of the
// worker's signals._position_state(). Entry rules are the four-way-synced ones
// (pipeline.ts / backtests): (ST flip BUY AND Close>SMA50) OR (ST bullish AND
// Close crosses above SMA50); fill at the NEXT bar's open; exit on ST flip down.
// Used by /api/reconcile so the Tier-2 daily drift check can cross-verify the
// worker's inLong against an independent recompute.

export interface PositionState {
  inLong: boolean;        // entered via the gate, no ST exit since
  entryPending: boolean;  // entry signal on the latest bar — fills next open
}

export function simulatePositionState(
  closes: number[],
  stDirArr: number[],
  stSigArr: string[],
  sma50Arr: number[],
): PositionState {
  const n = closes.length;
  const OUT = { inLong: false, entryPending: false };
  if (n < 2 || stDirArr[n - 1] !== 1) return OUT;

  // Last flip-up bar: a position can only have opened at/after it.
  let flipIdx = 0;
  for (let i = n - 1; i > 0; i--) {
    if (stDirArr[i] !== stDirArr[i - 1]) { flipIdx = i; break; }
  }

  for (let j = Math.max(flipIdx, 1); j < n; j++) {
    const s50 = sma50Arr[j];
    const c5 = !isNaN(s50) && s50 > 0 && closes[j] > s50;
    const flipEntry = stSigArr[j] === "BUY" && c5;
    const prevS50 = sma50Arr[j - 1];
    const crossEntry = stDirArr[j] === 1 && c5
      && !isNaN(prevS50) && prevS50 > 0 && closes[j - 1] <= prevS50;
    if (!flipEntry && !crossEntry) continue;
    // Signal on the latest bar: the fill is next session's open.
    return j === n - 1 ? { inLong: false, entryPending: true }
                       : { inLong: true, entryPending: false };
  }
  return OUT;
}
