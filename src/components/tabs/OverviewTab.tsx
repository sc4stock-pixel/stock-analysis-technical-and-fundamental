"use client";
import { StockAnalysisResult } from "@/types";
import { LineChart, Line, ResponsiveContainer, Tooltip } from "recharts";

interface Props { result: StockAnalysisResult; }

function Metric({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-[#1e2d4a]/40">
      <span className="text-[#6b85a0] text-xs">{label}</span>
      <span className={`text-xs font-mono ${color ?? "text-[#c8d8f0]"}`}>{value}</span>
    </div>
  );
}

function GaugeBar({ value, min, max, label, colorFn }: {
  value: number; min: number; max: number; label: string;
  colorFn: (v: number) => string;
}) {
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-[#6b85a0]">{label}</span>
        <span className={colorFn(value)}>{value?.toFixed(1)}</span>
      </div>
      <div className="h-1 bg-[#1e2d4a] rounded">
        <div className="h-1 rounded transition-all" style={{ width: `${pct}%`, background: colorFn(value).includes("00ff") ? "#00ff88" : colorFn(value).includes("ffa5") ? "#ffa502" : "#ff4757" }} />
      </div>
    </div>
  );
}

export default function OverviewTab({ result }: Props) {
  const bt = result.backtest;
  if (!bt) return <div className="p-4 text-[#4a6080] text-xs">No data</div>;

  // Equity sparkline
  const sparkData = bt.equity_curve.slice(-50).map((v, i) => ({ v }));
  const firstV = sparkData[0]?.v ?? 1;
  const lastV = sparkData[sparkData.length - 1]?.v ?? 1;
  const sparkColor = lastV >= firstV ? "#00ff88" : "#ff4757";

  // Score heatmap
  const scoreHistory = bt.score_history ?? [];

  const rsi = bt.rsi ?? 0;
  const rsiColor = rsi < 30 ? "text-[#00ff88]" : rsi > 70 ? "text-[#ff4757]" : "text-[#c8d8f0]";
  const adxColor = (bt.adx ?? 0) > 30 ? "text-[#00ff88]" : (bt.adx ?? 0) > 20 ? "text-[#ffa502]" : "text-[#ff4757]";

  return (
    <div className="p-3 space-y-3">
      {/* Equity sparkline */}
      {sparkData.length > 2 && (
        <div>
          <div className="text-[#4a6080] text-xs mb-1">EQUITY CURVE (last 50 bars)</div>
          <div className="h-16">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkData}>
                <Line type="monotone" dataKey="v" stroke={sparkColor} strokeWidth={1.5} dot={false} />
                <Tooltip
                  contentStyle={{ background: "#0f1629", border: "1px solid #1e2d4a", fontSize: 10 }}
                  formatter={(v: number) => [`$${v.toFixed(0)}`, "Equity"]}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Score heatmap */}
      {scoreHistory.length > 0 && (
        <div>
          <div className="text-[#4a6080] text-xs mb-1">SCORE HISTORY (last {scoreHistory.length} bars)</div>
          <div className="flex gap-0.5">
            {scoreHistory.map((s, i) => {
              const bg = s >= 6.5 ? "bg-[#00ff88]" : s >= 5.5 ? "bg-[#ffa502]" : s >= 4.5 ? "bg-[#ffa502]/50" : "bg-[#ff4757]";
              return (
                <div key={i} title={`Bar ${i + 1}: ${s.toFixed(1)}`}
                  className={`flex-1 h-5 rounded-sm ${bg} opacity-80`}
                  style={{ minWidth: 4 }}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-[#4a6080] text-xs mt-0.5">
            <span>20d ago</span>
            <span>now</span>
          </div>
        </div>
      )}

      {/* Indicator grid */}
      <div className="grid grid-cols-2 gap-x-4">
        <div>
          <div className="text-[#4a6080] text-xs font-bold mb-1">INDICATORS</div>
          <Metric label="RSI(14)" value={bt.rsi?.toFixed(1) ?? "—"} color={rsiColor} />
          <Metric label="MACD Hist" value={bt.macd_hist?.toFixed(3) ?? "—"}
            color={(bt.macd_hist ?? 0) > 0 ? "text-[#00ff88]" : "text-[#ff4757]"} />
          <Metric label="ADX(14)" value={bt.adx?.toFixed(1) ?? "—"} color={adxColor} />
          <Metric label="ATR%" value={`${bt.atr_pct?.toFixed(2) ?? "—"}%`} />
          <Metric label="BB Position" value={bt.bb_position?.toFixed(2) ?? "—"}
            color={(bt.bb_position ?? 0.5) < 0.3 ? "text-[#00ff88]" : (bt.bb_position ?? 0.5) > 0.7 ? "text-[#ff4757]" : "text-[#c8d8f0]"} />
          <Metric label="Vol Ratio" value={bt.vol_ratio?.toFixed(2) ?? "—"}
            color={(bt.vol_ratio ?? 1) > 1.5 ? "text-[#00ff88]" : "text-[#c8d8f0]"} />
          {bt.rsi_divergence_type !== "None" && (
            <Metric label="RSI Div" value={bt.rsi_divergence_type ?? "—"}
              color={bt.rsi_divergence_type === "Bullish" ? "text-[#00ff88]" : "text-[#ff4757]"} />
          )}
        </div>

        <div>
          <div className="text-[#4a6080] text-xs font-bold mb-1">LEVELS</div>
          <Metric label="SMA(20)" value={bt.sma_20?.toFixed(2) ?? "—"} />
          <Metric label="SMA(50)" value={bt.sma_50?.toFixed(2) ?? "—"} />
          <Metric label="Support" value={bt.support_level?.toFixed(2) ?? "—"} color="text-[#00ff88]" />
          <Metric label="Resistance" value={bt.resistance_level?.toFixed(2) ?? "—"} color="text-[#ff4757]" />
          <Metric label="Stop Loss" value={bt.stop_loss_price?.toFixed(2) ?? "—"} color="text-[#ff4757]" />
          <Metric label="52W High" value={bt.week_52_high?.toFixed(2) ?? "—"} />
          <Metric label="52W Low" value={bt.week_52_low?.toFixed(2) ?? "—"} />
        </div>
      </div>

      {/* Regime info */}
      <div>
        <div className="text-[#4a6080] text-xs font-bold mb-1">REGIME METADATA</div>
        <div className="grid grid-cols-2 gap-x-4">
          <Metric label="ATR Ratio" value={result.regime_info?.atr_ratio?.toFixed(2) ?? "—"} />
          <Metric label="ADX Slope" value={result.regime_info?.adx_slope?.toFixed(2) ?? "—"}
            color={(result.regime_info?.adx_slope ?? 0) > 1 ? "text-[#00ff88]" : (result.regime_info?.adx_slope ?? 0) < -1 ? "text-[#ff4757]" : "text-[#c8d8f0]"} />
          <Metric label="Bullish Count" value={`${result.regime_info?.bullish_count}/5`} />
          <Metric label="High Vol" value={result.regime_info?.is_high_volatility ? "YES" : "NO"}
            color={result.regime_info?.is_high_volatility ? "text-[#ffa502]" : "text-[#4a6080]"} />
        </div>
      </div>
    </div>
  );
}
