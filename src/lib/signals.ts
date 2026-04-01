// ============================================================
// SIGNAL GENERATOR — exact port of Python V12.5.5 "Aggressive Entry"
// Volume Surge + Relaxed Trend Gate + Regime-Adaptive Confirmation
// ============================================================
import { AppConfig, OHLCVBar } from "@/types";
import { EXCHANGE_CONFIRM_BARS } from "./regime";

/**
 * Applies V12.5.5 signal generation logic to a bar array.
 * Mutates bars in-place, setting: rawSignal, volumeSurge, forceEntry,
 * signalConfirmed, entrySignal.
 */
export function generateSignals(
  bars: OHLCVBar[],
  config: AppConfig,
  exchange = "DEFAULT"
): void {
  const entryThreshold = config.signal.entryThreshold;
  const exitThreshold = config.signal.exitThreshold;
  const trendGateEnabled = config.signal.trendGateEnabled;
  const defaultConfirmBars = config.signal.signalConfirmationBars;

  // Step 1: Volume surge detection + score adjustment
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const isBullishCandle = bar.close > bar.open;
    const isUptrendRegime = /UPTREND|STRENGTHENING|STRONG/i.test(bar.regime ?? "");
    const volumeSurge = bar.volRatio > 2.0 && isBullishCandle && isUptrendRegime ? 1 : 0;

    bar.volumeSurge = volumeSurge;
    bar.scoreAdjusted = volumeSurge ? bar.score + 2.0 : bar.score;
  }

  // Step 2: Raw signal from adjusted score
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    if (bar.scoreAdjusted >= entryThreshold) bar.rawSignal = "BUY";
    else if (bar.scoreAdjusted <= exitThreshold) bar.rawSignal = "SELL";
    else bar.rawSignal = "HOLD";

    // Block BUY on bearish RSI divergence
    if (bar.rawSignal === "BUY" && bar.rsiDivergence === -1) {
      bar.rawSignal = "HOLD";
    }
  }

  // Step 3: Trend gate filter (V12.5.5 relaxed gate for strong trends)
  if (trendGateEnabled) {
    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      if (bar.rawSignal !== "BUY") continue;

      const isStrongTrend = /STRONG_UPTREND|STRENGTHENING_UPTREND/i.test(bar.regime ?? "");
      const simpleGate = bar.close > bar.sma20; // Relaxed: only price > SMA20
      const fullGate = bar.trendGate === 1;    // Full golden cross

      const allowBuy = isStrongTrend ? simpleGate : fullGate;
      if (!allowBuy) bar.rawSignal = "HOLD";
    }
  }

  // Step 4: Force entry on volume surge
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    bar.forceEntry = bar.volumeSurge === 1 && bar.rawSignal === "BUY" ? 1 : 0;
  }

  // Step 5: Regime-adaptive confirmation bars (BUG FIX D: start from 0)
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const currentRegime = bar.regime ?? "NEUTRAL";
    const exchangeTable = EXCHANGE_CONFIRM_BARS[exchange] ?? EXCHANGE_CONFIRM_BARS.DEFAULT;
    const confirmBars = exchangeTable[currentRegime] ?? defaultConfirmBars;

    // Force entry overrides confirmation
    if (bar.forceEntry === 1) {
      bar.signalConfirmed = "BUY";
      continue;
    }

    const actualConfirmBars = Math.min(confirmBars, i);

    if (actualConfirmBars === 0) {
      bar.signalConfirmed = bar.rawSignal;
    } else {
      const window = bars.slice(i - actualConfirmBars, i + 1).map((b) => b.rawSignal);
      if (window.every((s) => s === "BUY")) bar.signalConfirmed = "BUY";
      else if (window.every((s) => s === "SELL")) bar.signalConfirmed = "SELL";
      else bar.signalConfirmed = "HOLD";
    }
  }

  // Step 6: Entry signal is previous bar's confirmed signal (shift by 1)
  for (let i = 0; i < bars.length; i++) {
    bars[i].entrySignal = i === 0 ? "HOLD" : bars[i - 1].signalConfirmed;
  }
}
