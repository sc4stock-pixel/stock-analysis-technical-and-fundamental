// ============================================================
// SIGNAL GENERATOR — exact port of Python V14 generate_signals()
//
// V14 FIX: Velocity Entry filter applied to Raw_Signal BEFORE
// confirm bars loop — matches Python's exact order:
//   1. Score → Raw_Signal (BUY/SELL/HOLD)
//   2. RSI divergence blocks BUY
//   3. Velocity Entry blocks BUY in Raw_Signal  ← BEFORE confirm bars
//   4. Volume surge = Force Entry
//   5. Confirm bars applied to (velocity-filtered) Raw_Signal
//   6. Entry_Signal = Signal_Confirmed.shift(1)
//
// Previously Step 3 was applied AFTER confirm bars (to Signal_Confirmed),
// which caused the confirm window to check unfiltered Raw_Signal,
// allowing entries that Python would have blocked.
// ============================================================
import { AppConfig, OHLCVBar } from "@/types";
import { EXCHANGE_CONFIRM_BARS } from "./regime";

export function generateSignals(
  bars: OHLCVBar[],
  config: AppConfig,
  exchange = "DEFAULT"
): void {
  const entryThreshold    = config.signal.entryThreshold;
  const exitThreshold     = config.signal.exitThreshold;
  const trendGateEnabled  = config.signal.trendGateEnabled;
  const defaultConfirmBars = config.signal.signalConfirmationBars;
  const VELOCITY_SLOPE_BARS = 3;

  // ── Step 1: Volume Surge + Score adjustment ───────────────────
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const isBullishCandle   = bar.close > bar.open;
    const isUptrendRegime   = /UPTREND|STRENGTHENING|STRONG/i.test(bar.regime ?? "");
    bar.volumeSurge         = bar.volRatio > 2.0 && isBullishCandle && isUptrendRegime ? 1 : 0;
    bar.scoreAdjusted       = bar.volumeSurge ? bar.score + 2.0 : bar.score;
  }

  // ── Step 2: Raw signal from adjusted score ────────────────────
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

  // ── Step 3: Trend Gate (if enabled) ──────────────────────────
  // Python V14 has this disabled (trendGateEnabled=false) but keeping
  // the logic intact for configurability.
  if (trendGateEnabled) {
    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      if (bar.rawSignal !== "BUY") continue;
      const isStrongTrend = /STRONG_UPTREND|STRENGTHENING_UPTREND/i.test(bar.regime ?? "");
      const allowBuy = isStrongTrend ? bar.close > bar.sma20 : bar.trendGate === 1;
      if (!allowBuy) bar.rawSignal = "HOLD";
    }
  }

  // ── Step 4: VELOCITY ENTRY FILTER — applied to Raw_Signal ─────
  // Python: df['Raw_Signal'] = np.where(
  //   (df['Raw_Signal'] == 'BUY') & ~velocity_entry_pass, 'HOLD', df['Raw_Signal'])
  // This runs BEFORE the confirm bars loop so the confirm window
  // only ever sees velocity-validated BUY signals.
  // Requirements:
  //   1. Price > EMA20 (trend confirmed)
  //   2. EMA20 slope > 0 over last 3 bars (EMA rising = acceleration)
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    if (bar.rawSignal !== "BUY") continue;
    if (bar.volumeSurge === 1) continue; // force entry bypasses velocity

    const ema20      = bar.ema20 ?? 0;
    const ema20Prev  = i >= VELOCITY_SLOPE_BARS ? (bars[i - VELOCITY_SLOPE_BARS].ema20 ?? 0) : 0;
    // Python uses relative slope: (ema_current - ema_prev) / ema_prev
    const emaSlope   = ema20Prev > 0 ? (ema20 - ema20Prev) / ema20Prev : 0;
    const velocityPass = bar.close > ema20 && emaSlope > 0;

    if (!velocityPass) bar.rawSignal = "HOLD";
  }

  // ── Step 5: Force Entry (volume surge overrides everything) ───
  for (let i = 0; i < bars.length; i++) {
    bars[i].forceEntry = bars[i].volumeSurge === 1 && bars[i].rawSignal === "BUY" ? 1 : 0;
  }

  // ── Step 6: Regime-adaptive confirm bars → Signal_Confirmed ───
  // Confirm bars window is now checked against velocity-filtered Raw_Signal.
  // This matches Python exactly.
  for (let i = 0; i < bars.length; i++) {
    const bar          = bars[i];
    const currentRegime = bar.regime ?? "NEUTRAL";
    const exchangeTable = EXCHANGE_CONFIRM_BARS[exchange] ?? EXCHANGE_CONFIRM_BARS.DEFAULT;
    const confirmBars   = exchangeTable[currentRegime] ?? defaultConfirmBars;

    // Force Entry overrides all confirmation
    if (bar.forceEntry === 1) {
      bar.signalConfirmed = "BUY";
      continue;
    }

    const actualConfirmBars = Math.min(confirmBars, i);

    if (actualConfirmBars === 0) {
      bar.signalConfirmed = bar.rawSignal;
    } else {
      const window = bars.slice(i - actualConfirmBars, i + 1).map(b => b.rawSignal);
      if (window.every(s => s === "BUY"))  bar.signalConfirmed = "BUY";
      else if (window.every(s => s === "SELL")) bar.signalConfirmed = "SELL";
      else bar.signalConfirmed = "HOLD";
    }
  }

  // ── Step 7: Entry_Signal = Signal_Confirmed.shift(1) ─────────
  // Python: df['Entry_Signal'] = df['Signal_Confirmed'].shift(1)
  // Bar 0 gets 'HOLD' (shift fills with NaN → HOLD)
  for (let i = 0; i < bars.length; i++) {
    bars[i].entrySignal = i === 0 ? "HOLD" : bars[i - 1].signalConfirmed;
  }
}
