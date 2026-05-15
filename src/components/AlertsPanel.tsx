"use client";
import { useState, useMemo } from "react";
import { StockAnalysisResult } from "@/types";
import { supertrend, ema, sma } from "@/lib/indicators";

interface Props {
  results: StockAnalysisResult[];
}

interface Alert {
  icon: string;
  text: string;
  priority: number; // lower = higher priority
  // Automation metadata — exposed as data-* attributes for external tooling
  alertType: "reentry" | "flip" | "score_buy" | "rsi_div" | "candlestick" | "correlation";
  symbol?: string;
  flipType?: "BULLISH" | "BEARISH";
  barsSince?: number;
}

const FLIP_ALERT_DAYS = 3;

function computeOptimizedFlip(
  result: StockAnalysisResult
): { flipType: "BULLISH" | "BEARISH" | null; barsSince: number } {
  const bars = result.chart_bars;
  if (!bars || bars.length < 2) return { flipType: null, barsSince: 999 };

  const optAtr = result.st_opt_params?.atrPeriod ?? 10;
  const optMul = result.st_opt_params?.multiplier ?? 3.0;

  const highs  = bars.map(b => b.high);
  const lows   = bars.map(b => b.low);
  const closes = bars.map(b => b.close);

  const [, dir] = supertrend(highs, lows, closes, optAtr, optMul);
  if (dir.length < 2) return { flipType: null, barsSince: 999 };

  for (let i = dir.length - 1; i >= 1; i--) {
    if (dir[i] !== dir[i - 1]) {
      const barsSince = dir.length - 1 - i;
      if (dir[i] === 1) return { flipType: "BULLISH", barsSince };
      if (dir[i] === -1) return { flipType: "BEARISH", barsSince };
    }
  }
  return { flipType: null, barsSince: 999 };
}

function computeSMA50Reentry(
  result: StockAnalysisResult
): { reentry: boolean; barsSince: number } {
  const bars = result.chart_bars;
  if (!bars || bars.length < 52) return { reentry: false, barsSince: 999 };

  const optAtr = result.st_opt_params?.atrPeriod ?? 10;
  const optMul = result.st_opt_params?.multiplier ?? 3.0;

  const highs  = bars.map(b => b.high);
  const lows   = bars.map(b => b.low);
  const closes = bars.map(b => b.close);

  const [, dir] = supertrend(highs, lows, closes, optAtr, optMul);

  const currentDir = dir[dir.length - 1] ?? -1;
  if (currentDir !== 1) return { reentry: false, barsSince: 999 };

  const sma50arr = sma(closes, 50);

  const n = closes.length;
  for (let lookback = 1; lookback <= 2; lookback++) {
    const i = n - 1 - (lookback - 1);
    if (i < 1) continue;
    const curClose  = closes[i];
    const prevClose = closes[i - 1];
    const curSMA50  = sma50arr[i];
    const prevSMA50 = sma50arr[i - 1];
    if (
      curClose  != null && prevClose != null &&
      curSMA50  != null && prevSMA50 != null &&
      !isNaN(curSMA50) && !isNaN(prevSMA50) &&
      curClose > curSMA50 && prevClose <= prevSMA50
    ) {
      return { reentry: true, barsSince: lookback - 1 };
    }
  }

  return { reentry: false, barsSince: 999 };
}

function generateAlerts(results: StockAnalysisResult[]): Alert[] {
  const alerts: Alert[] = [];

  for (const r of results) {
    const bt = r.backtest;
    const comparison = r.comparison;

    // 1. RSI divergence
    if (bt?.rsi_divergence_type && bt.rsi_divergence_type !== "None") {
      alerts.push({
        icon: "⚠️",
        text: `<strong>${r.symbol}</strong>: RSI ${bt.rsi_divergence_type} Divergence`,
        priority: 5,
        alertType: "rsi_div",
        symbol: r.symbol,
      });
    }

    // 2. Correlation
    if (r.kelly?.correlated_with) {
      alerts.push({
        icon: "🔗",
        text: `<strong>${r.symbol}</strong>: Correlated with ${r.kelly.correlated_with}`,
        priority: 8,
        alertType: "correlation",
        symbol: r.symbol,
      });
    }

    const stReturn500    = comparison?.supertrend?.total_return ?? 0;
    const stReturn250    = comparison?.supertrend?.total_return_250d ?? 0;
    const scoreReturn500 = comparison?.score?.total_return ?? bt?.total_return ?? 0;
    const scoreReturn250 = comparison?.score?.total_return_250d ?? 0;
    const scoreSignal    = r.signal;

    // 3. SMA50 crossover re-entry (HIGHEST PRIORITY — actionable BUY signal)
    const { reentry, barsSince: reentryBars } = computeSMA50Reentry(r);
    if (reentry) {
      const daysText = reentryBars === 0 ? "TODAY" : `${reentryBars}d ago`;
      const stOut500 = stReturn500 > scoreReturn500;
      const stOut250 = stReturn250 > scoreReturn250;
      if (stOut500 || stOut250) {
        const period = stOut500 ? "500d" : "250d";
        const stRet  = stOut500 ? stReturn500 : stReturn250;
        const scRet  = stOut500 ? scoreReturn500 : scoreReturn250;
        alerts.push({
          icon: "🚀",
          text: `<strong>${r.symbol}</strong>: ST RE-ENTRY ✅ Price crossed above SMA50 (${daysText}) — ST ${period}: ${stRet >= 0 ? "+" : ""}${stRet.toFixed(1)}% vs Sc: ${scRet >= 0 ? "+" : ""}${scRet.toFixed(1)}%`,
          priority: 1,
          alertType: "reentry",
          symbol: r.symbol,
          flipType: "BULLISH",
          barsSince: reentryBars,
        });
      } else {
        alerts.push({
          icon: "🚀",
          text: `<strong>${r.symbol}</strong>: ST RE-ENTRY ✅ Price crossed above SMA50 (${daysText}) — ST bullish re-entry triggered`,
          priority: 1,
          alertType: "reentry",
          symbol: r.symbol,
          flipType: "BULLISH",
          barsSince: reentryBars,
        });
      }
    }

    // 4. SuperTrend flip alerts (optimized)
    const { flipType, barsSince } = computeOptimizedFlip(r);

    if (flipType === "BULLISH" && barsSince <= FLIP_ALERT_DAYS) {
      const daysText = barsSince === 0 ? "TODAY" : `${barsSince}d ago`;
      const stOut500 = stReturn500 > scoreReturn500;
      const stOut250 = stReturn250 > scoreReturn250;

      if (!reentry) {
        if (stOut500 || stOut250) {
          const period = stOut500 ? "500d" : "250d";
          const stRet  = stOut500 ? stReturn500 : stReturn250;
          const scRet  = stOut500 ? scoreReturn500 : scoreReturn250;
          alerts.push({
            icon: "🟢",
            text: `<strong>${r.symbol}</strong>: ST FLIPPED BULLISH 📈 (${daysText}) - ST ${period}: ${stRet >= 0 ? "+" : ""}${stRet.toFixed(1)}% vs Sc: ${scRet >= 0 ? "+" : ""}${scRet.toFixed(1)}%`,
            priority: 2,
            alertType: "flip",
            symbol: r.symbol,
            flipType: "BULLISH",
            barsSince,
          });
        } else if (scoreSignal !== "BUY") {
          alerts.push({
            icon: "🟢",
            text: `<strong>${r.symbol}</strong>: SuperTrend FLIPPED BULLISH 📈 (${daysText})`,
            priority: 2,
            alertType: "flip",
            symbol: r.symbol,
            flipType: "BULLISH",
            barsSince,
          });
        }
      }
    } else if (flipType === "BEARISH" && barsSince <= FLIP_ALERT_DAYS) {
      const daysText = barsSince === 0 ? "TODAY" : `${barsSince}d ago`;
      const stOut500 = stReturn500 > scoreReturn500;
      const stOut250 = stReturn250 > scoreReturn250;

      if (stOut500 || stOut250) {
        const period = stOut500 ? "500d" : "250d";
        const stRet  = stOut500 ? stReturn500 : stReturn250;
        alerts.push({
          icon: "🔴",
          text: `<strong>${r.symbol}</strong>: ST FLIPPED BEARISH 📉 (${daysText}) - ST ${period}: ${stRet >= 0 ? "+" : ""}${stRet.toFixed(1)}% outperforms`,
          priority: 2,
          alertType: "flip",
          symbol: r.symbol,
          flipType: "BEARISH",
          barsSince,
        });
      } else {
        alerts.push({
          icon: "🔴",
          text: `<strong>${r.symbol}</strong>: SuperTrend FLIPPED BEARISH 📉 (${daysText})`,
          priority: 2,
          alertType: "flip",
          symbol: r.symbol,
          flipType: "BEARISH",
          barsSince,
        });
      }
    }

    // 5. Score BUY signal
    const recentBullishFlip = flipType === "BULLISH" && barsSince <= FLIP_ALERT_DAYS;
    if (scoreSignal === "BUY" && !recentBullishFlip) {
      const scOut500 = scoreReturn500 > stReturn500;
      const scOut250 = scoreReturn250 > stReturn250;

      if (scOut500 || scOut250) {
        const period = scOut500 ? "500d" : "250d";
        const scRet  = scOut500 ? scoreReturn500 : scoreReturn250;
        const stRet  = scOut500 ? stReturn500 : stReturn250;
        alerts.push({
          icon: "✅",
          text: `<strong>${r.symbol}</strong>: Score BUY Signal (Sc ${period}: ${scRet >= 0 ? "+" : ""}${scRet.toFixed(1)}% vs ST: ${stRet >= 0 ? "+" : ""}${stRet.toFixed(1)}%)`,
          priority: 3,
          alertType: "score_buy",
          symbol: r.symbol,
        });
      }
    }

    // 6. Candlestick patterns
    const patterns = bt?.candlestick_patterns || [];
    const signal = r.signal;
    const recentPatterns = patterns.filter(p => {
      if (p.bar_index !== undefined && p.bar_index <= 3) return true;
      if (p.label && (p.label === "Latest" || /^[1-3]d ago/.test(p.label))) return true;
      return false;
    });

    const confirmBay: Record<string, string[]> = {
      BUY:  ["Hammer", "Inverted Hammer", "Bull Engulfing", "Bull Marubozu"],
      SELL: ["Shooting Star", "Bear Engulfing", "Bear Marubozu", "Hanging Man"],
    };
    const cautionBay: Record<string, string[]> = {
      BUY:  ["Shooting Star", "Bear Engulfing", "Bear Marubozu", "Hanging Man"],
      SELL: ["Hammer", "Inverted Hammer", "Bull Engulfing", "Bull Marubozu"],
    };

    for (const p of recentPatterns) {
      const label = p.label === "Latest" ? "Today" : p.label || "";
      const curConfirm = confirmBay[signal] || [];
      const curCaution = cautionBay[signal] || [];
      if (curConfirm.includes(p.pattern)) {
        alerts.push({
          icon: "✅",
          text: `<strong>${r.symbol}</strong>: ${p.pattern} (${label}) - Confirms ${signal}`,
          priority: 4,
          alertType: "candlestick",
          symbol: r.symbol,
        });
      } else if (curCaution.includes(p.pattern)) {
        alerts.push({
          icon: "⚠️",
          text: `<strong>${r.symbol}</strong>: ${p.pattern} (${label}) - Caution on ${signal}`,
          priority: 5,
          alertType: "candlestick",
          symbol: r.symbol,
        });
      }
    }
  }

  alerts.sort((a, b) => a.priority - b.priority);
  return alerts;
}

// Flip and reentry alerts get visually distinct rows; all others use the standard row.
function alertRowStyle(alert: Alert): string {
  if (alert.alertType === "reentry") {
    return "flex items-start gap-2 text-[0.7rem] rounded px-2 py-1.5 mb-1 border border-[#00ff88]/30 bg-[#00ff88]/5";
  }
  if (alert.alertType === "flip" && alert.flipType === "BULLISH") {
    return "flex items-start gap-2 text-[0.7rem] rounded px-2 py-1.5 mb-1 border border-[#00d4ff]/25 bg-[#00d4ff]/5";
  }
  if (alert.alertType === "flip" && alert.flipType === "BEARISH") {
    return "flex items-start gap-2 text-[0.7rem] rounded px-2 py-1.5 mb-1 border border-[#ff4757]/25 bg-[#ff4757]/5";
  }
  return "flex items-start gap-2 text-[0.7rem] border-b border-[#1e2d4a]/30 pb-1 last:border-0";
}

function renderText(text: string) {
  return text.split(/(<strong>.*?<\/strong>)/g).map((part, i) =>
    part.startsWith("<strong>") ? (
      <strong key={i}>{part.replace(/<\/?strong>/g, "")}</strong>
    ) : part
  );
}

export default function AlertsPanel({ results }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const alerts = useMemo(() => generateAlerts(results), [results]);

  // Split into action alerts (flip/reentry) and informational
  const actionAlerts = alerts.filter(a => a.alertType === "flip" || a.alertType === "reentry");
  const infoAlerts   = alerts.filter(a => a.alertType !== "flip" && a.alertType !== "reentry");

  if (alerts.length === 0) return null;

  return (
    <div className="bg-[#0f1629] border border-[#1e2d4a] rounded p-3 my-3">
      <div
        className="flex items-center justify-between cursor-pointer select-none"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-2">
          <span className="text-[#f59e0b] text-sm font-bold">⚡ ALERTS</span>
          <span className="text-[#4a6080] text-xs">({alerts.length})</span>
          {actionAlerts.length > 0 && (
            <span className="text-[0.6rem] font-mono font-bold px-1.5 py-0.5 rounded bg-[#f59e0b]/15 border border-[#f59e0b]/30 text-[#f59e0b]">
              {actionAlerts.length} SIGNAL{actionAlerts.length > 1 ? "S" : ""}
            </span>
          )}
        </div>
        <span className="text-[#4a6080] text-xs">{collapsed ? "▼" : "▲"}</span>
      </div>

      {!collapsed && (
        <div className="mt-2">
          {/* ── Action alerts: flip + reentry — prominent section ── */}
          {actionAlerts.length > 0 && (
            <div className="mb-3">
              <div className="text-[0.6rem] font-mono text-[#4a6080] tracking-widest mb-1.5">
                SIGNAL ALERTS
              </div>
              {actionAlerts.map((alert, idx) => (
                <div
                  key={`action-${idx}`}
                  className={alertRowStyle(alert)}
                  data-alert-type={alert.alertType}
                  data-symbol={alert.symbol ?? ""}
                  data-flip-type={alert.flipType ?? ""}
                  data-bars-since={alert.barsSince ?? ""}
                >
                  <span className="shrink-0 mt-0.5">{alert.icon}</span>
                  <span className="flex-1">{renderText(alert.text)}</span>
                  {alert.barsSince === 0 && (
                    <span className="shrink-0 text-[0.55rem] font-mono font-bold px-1 py-0.5 rounded bg-[#f59e0b]/20 border border-[#f59e0b]/40 text-[#f59e0b] self-center">
                      TODAY
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Informational alerts ── */}
          {infoAlerts.length > 0 && (
            <div>
              {actionAlerts.length > 0 && (
                <div className="text-[0.6rem] font-mono text-[#4a6080] tracking-widest mb-1.5">
                  OTHER ALERTS
                </div>
              )}
              <div className="space-y-1.5">
                {infoAlerts.map((alert, idx) => (
                  <div
                    key={`info-${idx}`}
                    className={alertRowStyle(alert)}
                    data-alert-type={alert.alertType}
                    data-symbol={alert.symbol ?? ""}
                  >
                    <span className="shrink-0 mt-0.5">{alert.icon}</span>
                    <span>{renderText(alert.text)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
