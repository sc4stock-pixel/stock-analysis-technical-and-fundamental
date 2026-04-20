// ============================================================
// SIGNAL GENERATOR — exact port of Python V14 generate_signals()
//
// V14 KEY FIX: Velocity Entry filter applied to Raw_Signal BEFORE
// the confirm bars loop. This matches Python's exact order:
//
//   Python generate_signals():
//     1. Volume surge + score adjustment
//     2. Raw_Signal from adjusted score
//     3. RSI divergence blocks BUY in Raw_Signal
//     4. Velocity Entry filter → modifies Raw_Signal to HOLD if fails  ← BEFORE confirm
//     5. Force_Entry = volume_surge & Raw_Signal=='BUY'
//     6. Confirm bars loop checks velocity-filtered Raw_Signal window
//     7. Entry_Signal = Signal_Confirmed.shift(1)
//
// Previously Step 4 was applied to Signal_Confirmed (after confirm bars).
// That caused the confirm window to check unfiltered raw scores, allowing
// the window to confirm on bars where Python would have blocked velocity,
// producing wrong early entries that blocked legitimate later re-entries.
//
// Also fixed: EMA slope uses RELATIVE computation matching Python:
//   Python: ema_slope = (ema_current - ema_prev) / ema_prev
//   Previously TS used absolute difference; now uses relative %.
// ============================================================
import { AppConfig, OHLCVBar } from "@/types";
import { EXCHANGE_CONFIRM_BARS } from "./regime";

export function generateSignals(
  bars: OHLCVBar[],
  config: AppConfig,
  exchange = "DEFAULT"
): void {
  const entryThreshold     = config.signal.entryThreshold;
  const exitThreshold      = config.signal.exitThreshold;
  const trendGateEnabled   = config.signal.trendGateEnabled;
  const defaultConfirmBars = config.signal.signalConfirmationBars;
  // Matches Python velocity_slope_bars=3
  const VELOCITY_SLOPE_BARS = 3;

  // ── Step 1: Volume Surge + Score adjustment ────────────────────
  // Python: volume_surge = (vol_ratio > 2.0) & bullish_candle & is_bullish_regime
  //         Score_Adjusted = Score + 2.0 if volume_surge else Score
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const isBullishCandle = bar.close > bar.open;
    const isUptrendRegime = /UPTREND|STRENGTHENING|STRONG/i.test(bar.regime ?? "");
    bar.volumeSurge   = bar.volRatio > 2.0 && isBullishCandle && isUptrendRegime ? 1 : 0;
    bar.scoreAdjusted = bar.volumeSurge ? bar.score + 2.0 : bar.score;
  }

  // ── Step 2: Raw_Signal from adjusted score ─────────────────────
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    if      (bar.scoreAdjusted >= entryThreshold) bar.rawSignal = "BUY";
    else if (bar.scoreAdjusted <= exitThreshold)  bar.rawSignal = "SELL";
    else                                           bar.rawSignal = "HOLD";

    // Block BUY on bearish RSI divergence
    if (bar.rawSignal === "BUY" && bar.rsiDivergence === -1) {
      bar.rawSignal = "HOLD";
    }
  }

  // ── Step 3: Trend Gate (Python V14 has this disabled) ─────────
  // Kept for backward compatibility with config.signal.trendGateEnabled
  if (trendGateEnabled) {
    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      if (bar.rawSignal !== "BUY") continue;
      const isStrongTrend = /STRONG_UPTREND|STRENGTHENING_UPTREND/i.test(bar.regime ?? "");
      const allowBuy = isStrongTrend ? bar.close > bar.sma20 : bar.trendGate === 1;
      if (!allowBuy) bar.rawSignal = "HOLD";
    }
  }

  // ── Step 4: VELOCITY ENTRY FILTER → applied to Raw_Signal ──────
  // Python (V14 generate_signals, lines ~1208-1216):
  //   df['Raw_Signal'] = np.where(
  //     (df['Raw_Signal'] == 'BUY') & ~velocity_entry_pass,
  //     'HOLD', df['Raw_Signal'])
  //
  // This MUST run before confirm bars so the window only sees velocity-valid BUYs.
  // Volume surge (Force_Entry) bypasses this filter, same as Python.
  //
  // Slope calculation: RELATIVE, matching Python:
  //   ema_slope = (ema_current - ema_prev) / ema_prev
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    if (bar.rawSignal !== "BUY") continue;
    if (bar.volumeSurge === 1) continue;   // force entry bypasses velocity

    const ema20     = bar.ema20 ?? 0;
    const ema20Prev = i >= VELOCITY_SLOPE_BARS ? (bars[i - VELOCITY_SLOPE_BARS].ema20 ?? 0) : 0;
    // Relative slope — matches Python: (ema_current - ema_prev) / ema_prev
    const relSlope  = ema20Prev > 0 ? (ema20 - ema20Prev) / ema20Prev : 0;
    const velocityPass = bar.close > ema20 && relSlope > 0;

    if (!velocityPass) bar.rawSignal = "HOLD";
  }

  // ── Step 5: Force Entry (volume surge overrides confirm bars) ──
  for (let i = 0; i < bars.length; i++) {
    bars[i].forceEntry = bars[i].volumeSurge === 1 && bars[i].rawSignal === "BUY" ? 1 : 0;
  }

  // ── Step 6: Regime-adaptive confirm bars → Signal_Confirmed ────
  // Confirm window now checks velocity-filtered Raw_Signal — matches Python exactly.
  for (let i = 0; i < bars.length; i++) {
    const bar           = bars[i];
    const currentRegime = bar.regime ?? "NEUTRAL";
    const exchangeTable = EXCHANGE_CONFIRM_BARS[exchange] ?? EXCHANGE_CONFIRM_BARS.DEFAULT;
    const confirmBars   = exchangeTable[currentRegime] ?? defaultConfirmBars;

    // Force Entry overrides all confirmation requirements
    if (bar.forceEntry === 1) {
      bar.signalConfirmed = "BUY";
      continue;
    }

    const actualConfirmBars = Math.min(confirmBars, i);

    if (actualConfirmBars === 0) {
      bar.signalConfirmed = bar.rawSignal;
    } else {
      const window = bars.slice(i - actualConfirmBars, i + 1).map(b => b.rawSignal);
      if      (window.every(s => s === "BUY"))  bar.signalConfirmed = "BUY";
      else if (window.every(s => s === "SELL")) bar.signalConfirmed = "SELL";
      else                                       bar.signalConfirmed = "HOLD";
    }
  }

  // ── Step 7: Entry_Signal = Signal_Confirmed.shift(1) ──────────
  // Python: df['Entry_Signal'] = df['Signal_Confirmed'].shift(1)
  for (let i = 0; i < bars.length; i++) {
    bars[i].entrySignal = i === 0 ? "HOLD" : bars[i - 1].signalConfirmed;
  }
}
