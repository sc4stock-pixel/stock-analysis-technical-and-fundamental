"use client";
import { useState, useMemo } from "react";
import { StockAnalysisResult } from "@/types";
import { supertrend } from "@/lib/indicators";

interface Props {
  results: StockAnalysisResult[];
}

interface Alert {
  icon: string;
  text: string;
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

  // find most recent direction change
  for (let i = dir.length - 1; i >= 1; i--) {
    if (dir[i] !== dir[i - 1]) {
      const barsSince = dir.length - 1 - i;
      if (dir[i] === 1) return { flipType: "BULLISH", barsSince };
      if (dir[i] === -1) return { flipType: "BEARISH", barsSince };
    }
  }
  return { flipType: null, barsSince: 999 };
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
      });
    }

    // 2. Correlation
    if (r.kelly?.correlated_with) {
      alerts.push({
        icon: "🔗",
        text: `<strong>${r.symbol}</strong>: Correlated with ${r.kelly.correlated_with}`,
      });
    }

    // 3. SuperTrend flip alerts (optimized)
    const { flipType, barsSince } = computeOptimizedFlip(r);

    const stReturn500 = comparison?.supertrend?.total_return ?? 0;
    const stReturn250 = comparison?.supertrend?.total_return_250d ?? 0;
    const scoreReturn500 = comparison?.score?.total_return ?? bt?.total_return ?? 0;
    const scoreReturn250 = comparison?.score?.total_return_250d ?? 0;
    const scoreSignal = r.signal;

    if (flipType === "BULLISH" && barsSince <= FLIP_ALERT_DAYS) {
      const daysText = barsSince === 0 ? "TODAY" : `${barsSince}d ago`;
      const stOut500 = stReturn500 > scoreReturn500;
      const stOut250 = stReturn250 > scoreReturn250;

      if (stOut500 || stOut250) {
        const period = stOut500 ? "500d" : "250d";
        const stRet = stOut500 ? stReturn500 : stReturn250;
        const scRet = stOut500 ? scoreReturn500 : scoreReturn250;
        alerts.push({
          icon: "🟢",
          text: `<strong>${r.symbol}</strong>: ST FLIPPED BULLISH 📈 (${daysText}) - ST ${period}: ${stRet >= 0 ? "+" : ""}${stRet.toFixed(1)}% vs Sc: ${scRet >= 0 ? "+" : ""}${scRet.toFixed(1)}%`,
        });
      } else if (scoreSignal !== "BUY") {
        alerts.push({
          icon: "🟢",
          text: `<strong>${r.symbol}</strong>: SuperTrend FLIPPED BULLISH 📈 (${daysText})`,
        });
      }
    } else if (flipType === "BEARISH" && barsSince <= FLIP_ALERT_DAYS) {
      const daysText = barsSince === 0 ? "TODAY" : `${barsSince}d ago`;
      const stOut500 = stReturn500 > scoreReturn500;
      const stOut250 = stReturn250 > scoreReturn250;

      if (stOut500 || stOut250) {
        const period = stOut500 ? "500d" : "250d";
        const stRet = stOut500 ? stReturn500 : stReturn250;
        alerts.push({
          icon: "🔴",
          text: `<strong>${r.symbol}</strong>: ST FLIPPED BEARISH 📉 (${daysText}) - ST ${period}: ${stRet >= 0 ? "+" : ""}${stRet.toFixed(1)}% outperforms`,
        });
      } else {
        alerts.push({
          icon: "🔴",
          text: `<strong>${r.symbol}</strong>: SuperTrend FLIPPED BEARISH 📉 (${daysText})`,
        });
      }
    }

    // 4. Score BUY signal (avoid duplicate if recent bullish flip)
    const recentBullishFlip = flipType === "BULLISH" && barsSince <= FLIP_ALERT_DAYS;
    if (scoreSignal === "BUY" && !recentBullishFlip) {
      const scOut500 = scoreReturn500 > stReturn500;
      const scOut250 = scoreReturn250 > stReturn250;

      if (scOut500 || scOut250) {
        const period = scOut500 ? "500d" : "250d";
        const scRet = scOut500 ? scoreReturn500 : scoreReturn250;
        const stRet = scOut500 ? stReturn500 : stReturn250;
        alerts.push({
          icon: "✅",
          text: `<strong>${r.symbol}</strong>: Score BUY Signal (Sc ${period}: ${scRet >= 0 ? "+" : ""}${scRet.toFixed(1)}% vs ST: ${stRet >= 0 ? "+" : ""}${stRet.toFixed(1)}%)`,
        });
      }
    }

    // 5. Candlestick pattern alerts (unchanged)
    const patterns = bt?.candlestick_patterns || [];
    const signal = r.signal;
    const recentPatterns = patterns.filter(p => {
      if (p.bar_index !== undefined && p.bar_index <= 3) return true;
      if (p.label && (p.label === "Latest" || /^[1-3]d ago/.test(p.label))) return true;
      return false;
    });

    const confirmBay: Record<string, string[]> = {
      BUY: ["Hammer", "Inverted Hammer", "Bull Engulfing", "Bull Marubozu"],
      SELL: ["Shooting Star", "Bear Engulfing", "Bear Marubozu", "Hanging Man"],
    };
    const cautionBay: Record<string, string[]> = {
      BUY: ["Shooting Star", "Bear Engulfing", "Bear Marubozu", "Hanging Man"],
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
        });
      } else if (curCaution.includes(p.pattern)) {
        alerts.push({
          icon: "⚠️",
          text: `<strong>${r.symbol}</strong>: ${p.pattern} (${label}) - Caution on ${signal}`,
        });
      }
    }
  }

  return alerts;
}

export default function AlertsPanel({ results }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const alerts = useMemo(() => generateAlerts(results), [results]);

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
        </div>
        <span className="text-[#4a6080] text-xs">{collapsed ? "▼" : "▲"}</span>
      </div>
      {!collapsed && (
        <div className="mt-2 space-y-1.5">
          {alerts.map((alert, idx) => {
            const parts = alert.text.split(/(<strong>.*?<\/strong>)/g);
            return (
              <div
                key={idx}
                className="flex items-start gap-2 text-[0.7rem] border-b border-[#1e2d4a]/30 pb-1 last:border-0"
              >
                <span className="shrink-0 mt-0.5">{alert.icon}</span>
                <span>
                  {parts.map((part, i) =>
                    part.startsWith("<strong>") ? (
                      <strong key={i}>{part.replace(/<\/?strong>/g, "")}</strong>
                    ) : (
                      part
                    )
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
