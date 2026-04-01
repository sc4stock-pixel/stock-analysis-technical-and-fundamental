// ============================================================
// SIGNAL GENERATOR — exact port of Python V12.5.5 "Aggressive Entry"
// Fixes applied:
//   - Force_Entry computed AFTER trend gate (matches Python ordering exactly)
//   - forceEntry = volumeSurge & (rawSignal === 'BUY') post-gate
// ============================================================
import { AppConfig, OHLCVBar } from "@/types";
import { EXCHANGE_CONFIRM_BARS } from "./regime";

export function generateSignals(
  bars: OHLCVBar[],
  config: AppConfig,
  exchange = "DEFAULT"
): void {
  const entryThreshold = config.signal.entryThreshold;
  const exitThreshold = config.signal.exitThreshold;
  const trendGateEnabled = config.signal.trendGateEnabled;
  const defaultConfirmBars = config.signal.signalConfirmationBars;

  // ── Step 1: Volume Surge detection + Score adjustment ──────────────────
  // Volume Surge = vol > 2x avg + green candle + bullish regime
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const isBullishCandle = bar.close > bar.open;
    const isUptrendRegime = /UPTREND|STRENGTHENING|STRONG/i.test(bar.regime ?? "");
    bar.volumeSurge = bar.volRatio > 2.0 && isBullishCandle && isUptrendRegime ? 1 : 0;
    // BUG FIX E: store original score, adjust separately
    bar.scoreAdjusted = bar.volumeSurge ? bar.score + 2.0 : bar.score;
  }

  // ── Step 2: Raw signal from adjusted score ─────────────────────────────
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

  // ── Step 3: Relaxed Trend Gate (V12.5.5) ──────────────────────────────
  // STRONG_UPTREND / STRENGTHENING_UPTREND: price > SMA20 only
  // All other regimes: full golden cross (trendGate === 1)
  if (trendGateEnabled) {
    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      if (bar.rawSignal !== "BUY") continue;

      const isStrongTrend = /STRONG_UPTREND|STRENGTHENING_UPTREND/i.test(bar.regime ?? "");
      const simpleGate = bar.close > bar.sma20;   // Relaxed gate
      const fullGate = bar.trendGate === 1;         // Full golden cross

      const allowBuy = isStrongTrend ? simpleGate : fullGate;
      if (!allowBuy) bar.rawSignal = "HOLD";
    }
  }

  // ── Step 4: Force Entry (AFTER trend gate — matches Python ordering) ───
  // Force_Entry = volume_surge & (Raw_Signal == 'BUY')  ← post-gate Raw_Signal
  for (let i = 0; i < bars.length; i++) {
    bars[i].forceEntry = bars[i].volumeSurge === 1 && bars[i].rawSignal === "BUY" ? 1 : 0;
  }

  // ── Step 5: Regime-adaptive confirmation + Signal_Confirmed ───────────
  // BUG FIX D: start from i=0, guard against underflow with actualConfirmBars
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const currentRegime = bar.regime ?? "NEUTRAL";
    const exchangeTable = EXCHANGE_CONFIRM_BARS[exchange] ?? EXCHANGE_CONFIRM_BARS.DEFAULT;
    const confirmBars = exchangeTable[currentRegime] ?? defaultConfirmBars;

    // FORCE ENTRY overrides confirmation bars entirely
    if (bar.forceEntry === 1) {
      bar.signalConfirmed = "BUY";
      continue;
    }

    // Guard against index underflow (BUG FIX D)
    const actualConfirmBars = Math.min(confirmBars, i);

    if (actualConfirmBars === 0) {
      // 0 confirm bars = instant entry (STRONG_UPTREND, STRENGTHENING_UPTREND on US)
      bar.signalConfirmed = bar.rawSignal;
    } else {
      // All bars in window must agree
      const window = bars.slice(i - actualConfirmBars, i + 1).map((b) => b.rawSignal);
      if (window.every((s) => s === "BUY")) bar.signalConfirmed = "BUY";
      else if (window.every((s) => s === "SELL")) bar.signalConfirmed = "SELL";
      else bar.signalConfirmed = "HOLD";
    }
  }

  // ── Step 6: Entry_Signal = Signal_Confirmed shifted by 1 bar ──────────
  // Python: df['Entry_Signal'] = df['Signal_Confirmed'].shift(1)
  // shift(1) → row 0 gets NaN → we use "HOLD"
  for (let i = 0; i < bars.length; i++) {
    bars[i].entrySignal = i === 0 ? "HOLD" : bars[i - 1].signalConfirmed;
  }
}
