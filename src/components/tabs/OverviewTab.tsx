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

  // Detect active strategy: signal_bars===0 is the ST marker set in buildSTView
  const isSTMode = bt.signal_bars === 0 && (result.comparison?.supertrend.num_trades ?? 0) > 0;

  // Equity sparkline — uses whichever bt was passed (Score or ST view)
  const sparkData = bt.equity_curve.map((v) => ({ v }));
  const firstV = sparkData[0]?.v ?? 1;
  const lastV = sparkData[sparkData.length - 1]?.v ?? 1;
  const sparkColor = lastV >= firstV ? "#00ff88" : "#ff4757";
  const equityLabel = isSTMode ? "ST EQUITY (full)" : "EQUITY (full backtest)";
  const equityStroke = isSTMode ? "#ffa502" : sparkColor;

  // Score heatmap — only meaningful in Score mode
  const scoreHistory = bt.score_history ?? [];

  // SuperTrend heatmap — always from chart_bars (raw result, not view)
  const chartBars = result.chart_bars ?? [];
  const stHistory = chartBars.slice(-20);

  const rsi = bt.rsi ?? 0;
  const rsiColor = rsi < 30 ? "text-[#00ff88]" : rsi > 70 ? "text-[#ff4757]" : "text-[#c8d8f0]";
  const adxColor = (bt.adx ?? 0) > 30 ? "text-[#00ff88]" : (bt.adx ?? 0) > 20 ? "text-[#ffa502]" : "text-[#ff4757]";

  // ST Status summary
  const stDir = result.st_direction ?? -1;
  const stDist = result.st_stop_distance_pct ?? 0;
  const stOpenRet = result.st_open_return_pct;

  return (
    <div className="p-3 space-y-3">

      {/* ── TOP: Left = heatmaps stacked, Right = equity curve (taller) ── */}
      <div className="grid grid-cols-2 gap-3">

        {/* LEFT column: Score history + ST heatmap stacked */}
        <div className="space-y-2">

          {/* Score history — Score mode only */}
          {!isSTMode && scoreHistory.length > 0 && (
            <div>
              <div className="text-[#4a6080] text-xs mb-1">SCORE HISTORY</div>
              <div className="flex gap-0.5 h-8">
                {scoreHistory.map((s, i) => {
                  const bg = s >= 6.5 ? "bg-[#00ff88]" : s >= 5.5 ? "bg-[#ffa502]" : s >= 4.5 ? "bg-[#ffa502]/50" : "bg-[#ff4757]";
                  return (
                    <div key={i} title={`Bar ${i + 1}: ${s.toFixed(1)}`}
                      className={`flex-1 rounded-sm ${bg} opacity-80`}
                      style={{ minWidth: 3 }}
                    />
                  );
                })}
              </div>
              <div className="flex justify-between text-[#4a6080] text-[0.6rem] mt-0.5">
                <span>20d ago</span><span>now</span>
              </div>
            </div>
          )}

          {/* ST heatmap — always shown, same width as score history */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[#4a6080] text-xs">SUPERTREND</div>
              <div className={`text-[0.6rem] font-mono px-1 py-0.5 rounded border ${
                stDir === 1
                  ? "border-[#00ff88]/40 text-[#00ff88]"
                  : "border-[#ff4757]/40 text-[#ff4757]"
              }`}>
                {stDir === 1 ? "🟢 BULL" : "🔴 BEAR"}
              </div>
            </div>

            {stHistory.length > 0 ? (
              <>
                <div className="flex gap-0.5 h-8">
                  {stHistory.map((b, i) => {
                    const dir = b.supertrendDir ?? -1;
                    const distPct = b.supertrend > 0
                      ? Math.abs((b.close - b.supertrend) / b.close) * 100
                      : 0;
                    const intensity = Math.min(1, 0.4 + distPct / 20);
                    return (
                      <div
                        key={i}
                        title={`${b.date?.slice(5)}: ${dir === 1 ? "🟢" : "🔴"} Close:${b.close?.toFixed(2)} ST:${b.supertrend?.toFixed(2)}`}
                        className="flex-1 rounded-sm"
                        style={{
                          minWidth: 3,
                          backgroundColor: dir === 1
                            ? `rgba(0, 255, 136, ${intensity})`
                            : `rgba(255, 71, 87, ${intensity})`,
                        }}
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between text-[#4a6080] text-[0.6rem] mt-0.5">
                  <span>20d ago</span><span>now</span>
                </div>
                {/* ST status row */}
                <div className="mt-1 flex flex-wrap gap-x-2 text-[0.6rem] font-mono">
                  <span className="text-[#4a6080]">Stop: <span className="text-[#c8d8f0]">{result.st_value > 0 ? result.st_value.toFixed(2) : "—"}</span></span>
                  {stDir === 1 && <span className="text-[#4a6080]">Dist: <span className="text-[#c8d8f0]">{stDist.toFixed(1)}%</span></span>}
                  {stDir === 1 && stOpenRet !== null && stOpenRet !== undefined && (
                    <span className="text-[#4a6080]">P&L: <span className={stOpenRet >= 0 ? "text-[#00ff88]" : "text-[#ffa502]"}>
                      {stOpenRet >= 0 ? "+" : ""}{stOpenRet.toFixed(1)}%
                    </span></span>
                  )}
                  {stDir !== 1 && <span className="text-[#ff4757]/70">wait for flip</span>}
                </div>
              </>
            ) : (
              <div className={`h-8 rounded-sm ${stDir === 1 ? "bg-[#00ff88]/30" : "bg-[#ff4757]/25"}`} />
            )}
          </div>
        </div>

        {/* RIGHT column: equity curve — taller to use the full left height */}
        {sparkData.length > 2 && (
          <div className="flex flex-col">
            <div className="flex justify-between items-center mb-1">
              <div className="text-[#4a6080] text-xs truncate">{equityLabel}</div>
            </div>
            <div className="flex-1" style={{ minHeight: "110px" }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sparkData}>
                  <Line type="monotone" dataKey="v" stroke={equityStroke} strokeWidth={1.5} dot={false} />
                  <Tooltip
                    contentStyle={{ background: "#0f1629", border: "1px solid #1e2d4a", fontSize: 10 }}
                    formatter={(v: number) => [`$${v.toFixed(0)}`, "Equity"]}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-between text-[#4a6080] text-[0.6rem] mt-0.5">
              <span>${(sparkData[0]?.v ?? 0).toFixed(0)}</span>
              <span className={lastV >= firstV ? "text-[#00ff88]" : "text-[#ff4757]"}>
                ${lastV.toFixed(0)}
              </span>
            </div>
          </div>
        )}
      </div>

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
