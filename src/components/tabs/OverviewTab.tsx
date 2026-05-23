"use client";
import { StockAnalysisResult } from "@/types";
import { LineChart, Line, ResponsiveContainer, Tooltip, ReferenceLine } from "recharts";

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

  const isSTMode = bt.signal_bars === 0 && (result.comparison?.supertrend.num_trades ?? 0) > 0;
  const sparkData = bt.equity_curve.map((v) => ({ v }));
  const firstV = sparkData[0]?.v ?? 1;
  const lastV  = sparkData[sparkData.length - 1]?.v ?? 1;
  const equityStroke = isSTMode ? "#ffa502" : (lastV >= firstV ? "#00ff88" : "#ff4757");
  const scoreHistory = bt.score_history ?? [];
  const chartBars    = result.chart_bars ?? [];
  const stHistory    = chartBars.slice(-20);

  const rsi    = bt.rsi ?? 0;
  const rsiColor = rsi < 30 ? "text-[#00ff88]" : rsi > 70 ? "text-[#ff4757]" : "text-[#c8d8f0]";
  const adxColor = (bt.adx ?? 0) > 30 ? "text-[#00ff88]" : (bt.adx ?? 0) > 20 ? "text-[#ffa502]" : "text-[#ff4757]";

  const stDir     = result.st_direction ?? -1;
  const stDist    = result.st_stop_distance_pct ?? 0;
  const stOpenRet = result.st_open_return_pct;
  const optParams = result.st_opt_params;

  // Formatted label for optimal params
  const optLabel = optParams
    ? `ATR${optParams.atrPeriod} × ${optParams.multiplier}` : null;

  return (
    <div className="p-3 space-y-3">

      {/* TOP: heatmaps left, equity right */}
      <div className="grid grid-cols-2 gap-3">

        {/* LEFT: Score history + ST heatmap */}
        <div className="space-y-2">
          {!isSTMode && scoreHistory.length > 0 && (
            <div>
              <div className="text-[#4a6080] text-xs mb-1">SCORE HISTORY</div>
              <div className="flex gap-0.5 h-8">
                {scoreHistory.map((s, i) => {
                  const bg = s >= 6.5 ? "bg-[#00ff88]" : s >= 5.5 ? "bg-[#ffa502]" : s >= 4.5 ? "bg-[#ffa502]/50" : "bg-[#ff4757]";
                  return <div key={i} title={`Bar ${i + 1}: ${s.toFixed(1)}`} className={`flex-1 rounded-sm ${bg} opacity-80`} style={{ minWidth: 3 }} />;
                })}
              </div>
              <div className="flex justify-between text-[#4a6080] text-[0.6rem] mt-0.5"><span>20d ago</span><span>now</span></div>
            </div>
          )}

          {/* ST heatmap */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[#4a6080] text-xs">SUPERTREND</div>
              <div className={`text-[0.6rem] font-mono px-1 py-0.5 rounded border ${stDir === 1 ? "border-[#00ff88]/40 text-[#00ff88]" : "border-[#ff4757]/40 text-[#ff4757]"}`}>
                {stDir === 1 ? "🟢 BULL" : "🔴 BEAR"}
              </div>
            </div>
            {stHistory.length > 0 ? (
              <>
                <div className="flex gap-0.5 h-8">
                  {stHistory.map((b, i) => {
                    const dir = b.supertrendDir ?? -1;
                    const distPct = b.supertrend > 0 ? Math.abs((b.close - b.supertrend) / b.close) * 100 : 0;
                    const intensity = Math.min(1, 0.4 + distPct / 20);
                    return (
                      <div key={i}
                        title={`${b.date?.slice(5)}: ${dir === 1 ? "🟢" : "🔴"} Close:${b.close?.toFixed(2)} ST:${b.supertrend?.toFixed(2)}`}
                        className="flex-1 rounded-sm"
                        style={{ minWidth: 3, backgroundColor: dir === 1 ? `rgba(0,255,136,${intensity})` : `rgba(255,71,87,${intensity})` }}
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between text-[#4a6080] text-[0.6rem] mt-0.5"><span>20d ago</span><span>now</span></div>

                {/* ST status row */}
                <div className="mt-1 flex flex-wrap gap-x-2 text-[0.6rem] font-mono">
                  <span className="text-[#4a6080]">Stop: <span className="text-[#c8d8f0]">{result.st_value > 0 ? result.st_value.toFixed(2) : "—"}</span></span>
                  {stDir === 1 && <span className="text-[#4a6080]">Dist: <span className="text-[#c8d8f0]">{stDist.toFixed(1)}%</span></span>}
                  {stDir === 1 && stOpenRet !== null && stOpenRet !== undefined && (
                    <span className="text-[#4a6080]">P&L: <span className={stOpenRet >= 0 ? "text-[#00ff88]" : "text-[#ffa502]"}>{stOpenRet >= 0 ? "+" : ""}{stOpenRet.toFixed(1)}%</span></span>
                  )}
                  {stDir !== 1 && <span className="text-[#ff4757]/70">wait for flip</span>}
                </div>

                {/* ── ST Status strip with optimized params ── */}
                <div className={`mt-1.5 flex items-center gap-2 px-2 py-1 rounded border text-[0.6rem] font-mono ${stDir === 1 ? "border-[#00ff88]/30 bg-[#00ff88]/5" : "border-[#ff4757]/30 bg-[#ff4757]/5"}`}>
                  <span className={stDir === 1 ? "text-[#00ff88] font-bold" : "text-[#ff4757] font-bold"}>
                    {stDir === 1 ? "🟢 ST BULLISH" : "🔴 ST BEARISH"}
                  </span>
                  {result.st_value > 0 && (
                    <span className="text-[#4a6080]">line: <span className="text-[#c8d8f0]">{result.st_value.toFixed(2)}</span></span>
                  )}
                  {stDir === 1 && (
                    <span className="text-[#4a6080]">dist: <span className="text-[#c8d8f0]">{stDist.toFixed(1)}%</span></span>
                  )}
                  {stDir === 1 && stOpenRet !== null && stOpenRet !== undefined && (
                    <span className="text-[#4a6080]">open: <span className={stOpenRet >= 0 ? "text-[#00ff88]" : "text-[#ffa502]"}>{stOpenRet >= 0 ? "+" : ""}{stOpenRet.toFixed(1)}%</span></span>
                  )}
                  {/* Optimized params badge */}
                  {optLabel && (
                    <span className="ml-auto text-[#ffa502]/70 border border-[#ffa502]/30 rounded px-1 py-0.5 text-[0.55rem]">
                      {optLabel}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div className={`h-8 rounded-sm ${stDir === 1 ? "bg-[#00ff88]/30" : "bg-[#ff4757]/25"}`} />
            )}
          </div>
        </div>

        {/* RIGHT: Dual equity curve */}
        {(() => {
          const scoreCurve = result.backtest?.equity_curve ?? [];
          const stCurve = result.comparison?.supertrend?.trades
            ? (() => {
                const initial = scoreCurve[0] ?? 10000;
                const curve: number[] = [initial];
                let eq = initial;
                const stTrades = [...(result.comparison?.supertrend?.trades ?? [])].sort((a, b) => a.entry_idx - b.entry_idx);
                for (const t of stTrades) {
                  const barsBefore = Math.max(0, t.entry_idx - curve.length + 1);
                  for (let b = 0; b < barsBefore; b++) curve.push(eq);
                  const barsHeld = Math.max(1, t.bars_held);
                  for (let b = 0; b < barsHeld; b++) curve.push(eq + (t.pnl * (b + 1)) / barsHeld);
                  eq += t.pnl;
                }
                while (curve.length < scoreCurve.length) curve.push(eq);
                return curve;
              })()
            : [];

          const len = Math.max(scoreCurve.length, stCurve.length);
          if (len < 3) return null;

          const dualData = Array.from({ length: len }, (_, i) => ({
            i,
            sc: scoreCurve[i] ?? scoreCurve[scoreCurve.length - 1] ?? 0,
            st: stCurve.length > 0 ? (stCurve[i] ?? stCurve[stCurve.length - 1] ?? 0) : null,
          }));

          const scLast  = scoreCurve[scoreCurve.length - 1] ?? 10000;
          const stLast  = stCurve.length > 0 ? stCurve[stCurve.length - 1] : null;
          const initial = scoreCurve[0] ?? 10000;

          return (
            <div className="flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[#4a6080] text-xs">EQUITY CURVES</div>
                <div className="flex items-center gap-2 text-[0.6rem] font-mono">
                  <span className="text-[#00d4ff]">— SCR</span>
                  {stCurve.length > 0 && <span className="text-[#ffa502]">— ST</span>}
                </div>
              </div>
              <div className="flex-1" style={{ minHeight: "110px" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dualData}>
                    <ReferenceLine y={initial} stroke="#1e2d4a" strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="sc" stroke="#00d4ff" strokeWidth={1.5} dot={false} legendType="none" strokeOpacity={0.9} />
                    {stCurve.length > 0 && (
                      <Line type="monotone" dataKey="st" stroke="#ffa502" strokeWidth={1.5} dot={false} legendType="none" strokeOpacity={0.85} strokeDasharray="4 2" connectNulls={false} />
                    )}
                    <Tooltip
                      contentStyle={{ background: "#0f1629", border: "1px solid #1e2d4a", fontSize: 10 }}
                      formatter={(v: number, name: string) => [`$${v.toFixed(0)}`, name === "sc" ? "Score" : "ST"]}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-between text-[0.6rem] mt-0.5 font-mono">
                <span className="text-[#4a6080]">${initial.toFixed(0)}</span>
                <div className="flex gap-3">
                  <span className={scLast >= initial ? "text-[#00d4ff]" : "text-[#ff4757]"}>SCR ${scLast.toFixed(0)}</span>
                  {stLast !== null && (
                    <span className={stLast >= initial ? "text-[#ffa502]" : "text-[#ff4757]"}>ST ${stLast.toFixed(0)}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* SEPA status strip */}
      {result.sepa_metadata && (() => {
        const s = result.sepa_metadata;
        const pip = (active: boolean | null, label: string) => {
          if (active === null) return (
            <span key={label} title={`${label}: not evaluated (HK)`}
              className="px-1.5 py-0.5 rounded border text-[0.6rem] text-[#2a3d5a] border-[#2a3d5a]/20 opacity-30">
              —
            </span>
          );
          return (
            <span key={label}
              className={`px-1.5 py-0.5 rounded border text-[0.6rem] font-bold
                ${active
                  ? "text-[#00ff88] border-[#00ff88]/40 bg-[#00ff88]/8"
                  : "text-[#2a3d5a] border-[#2a3d5a]/40 opacity-50"}`}>
              {label}
            </span>
          );
        };
        return (
          <>
          <div className="flex items-center gap-2 px-2 py-1.5 rounded border border-[#1e2d4a] bg-[#0a0e1a] text-[0.6rem] font-mono">
            <span className="text-[#4a6080] font-bold tracking-wider">SEPA</span>
            <span className="flex gap-1">
              {pip(s.trend_template, "T")}
              {pip(s.code_33, "33")}
              {pip(s.vcp_detected, "VCP")}
            </span>
            <span className="text-[#4a6080] mx-1">·</span>
            {s.vcp_detected ? (
              <span className="text-[#00ff88]">
                VCP Coiled ({s.current_contraction_pct.toFixed(1)}% Contraction)
                {s.wave_sequence && (
                  <span className="text-[#00ff88]/60 ml-1">· {s.wave_sequence}</span>
                )}
              </span>
            ) : (
              <span className="text-[#2a3d5a]">No active consolidation setup</span>
            )}
            <span className="ml-auto text-[#4a6080]">
              Score <span className={s.sepa_score >= 2 ? "text-[#00ff88]" : s.sepa_score === 1 ? "text-[#ffa502]" : "text-[#2a3d5a]"}>
                {s.sepa_score}/3
              </span>
            </span>
          </div>
          {s.trend_template_criteria && (() => {
            const tt = s.trend_template_criteria;
            const criteria: Array<{ key: keyof typeof tt; label: string }> = [
              { key: "c1_price_above_sma150",    label: "P>150" },
              { key: "c2_price_above_sma200",    label: "P>200" },
              { key: "c3_sma150_above_sma200",   label: "150>200" },
              { key: "c4_sma200_trending_up",    label: "200↑" },
              { key: "c5_price_above_sma50",     label: "P>50" },
              { key: "c6_above_25pct_of_low52",  label: "52L+25" },
              { key: "c7_within_25pct_of_high52", label: "52H-25" },
            ];
            return (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded border border-[#1e2d4a] bg-[#0a0e1a] mt-1">
                <span className="text-[#4a6080] font-bold tracking-wider text-[0.6rem] font-mono shrink-0">TT</span>
                <span className={`text-[0.6rem] font-mono font-bold shrink-0 ${tt.passes ? "text-[#00ff88]" : "text-[#ffa502]"}`}>
                  {tt.criteria_met}/7
                </span>
                <span className="text-[#2a3d5a] text-[0.6rem]">·</span>
                <span className="flex gap-1 flex-wrap">
                  {criteria.map(({ key, label }) => {
                    const pass = tt[key] as boolean;
                    return (
                      <span key={key}
                        className={`text-[0.6rem] font-mono px-1 py-0.5 rounded border
                          ${pass
                            ? "text-[#00ff88] border-[#00ff88]/30 bg-[#00ff88]/5"
                            : "text-[#ff4757] border-[#ff4757]/30 bg-[#ff4757]/5"}`}>
                        {label}
                      </span>
                    );
                  })}
                </span>
              </div>
            );
          })()}
          </>
        );
      })()}

      {/* Earnings trend — 4 individual quarterly bars, oldest→newest */}
      {result.sepa_metadata?.eps_quarters && result.sepa_metadata.eps_quarters.length > 0 && (() => {
        const quarters = [...result.sepa_metadata.eps_quarters].reverse(); // display oldest left
        const maxEps   = Math.max(...quarters.map(q => q.eps), 0.001);

        const barColor = (yoy: number | null): string => {
          if (yoy === null)    return "#2a3d5a";
          if (yoy >=  0.20)   return "#00ff88";
          if (yoy >=  0.05)   return "#00d4ff";
          if (yoy >=  0)      return "#ffa502";
          return "#ff4757";
        };
        const barOpacity = (yoy: number | null): number => {
          if (yoy === null) return 0.35;
          return Math.min(1, 0.55 + Math.abs(yoy) * 1.5);
        };

        return (
          <div className="px-2 py-1.5 rounded border border-[#1e2d4a] bg-[#0a0e1a]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[#4a6080] text-[0.6rem] font-mono font-bold tracking-wider">
                EARNINGS TREND
              </span>
              <span className="text-[#2a3d5a] text-[0.55rem] font-mono">
                individual qtr · YoY vs same period last yr
              </span>
            </div>
            <div className="flex gap-2 items-end" style={{ height: 60 }}>
              {quarters.map((q, i) => {
                const barH   = Math.max(6, (q.eps / maxEps) * 42);
                const color  = barColor(q.yoy);
                const opac   = barOpacity(q.yoy);
                const yoyStr = q.yoy !== null
                  ? `${q.yoy >= 0 ? "+" : ""}${(q.yoy * 100).toFixed(1)}%`
                  : "--";
                const tipText = `${q.period}: EPS ${q.eps.toFixed(2)}  YoY ${yoyStr}`;
                return (
                  <div key={i}
                    title={tipText}
                    className="flex flex-col items-center justify-end flex-1 gap-0.5 h-full cursor-default">
                    {/* YoY % above bar */}
                    <span className="text-[0.55rem] font-mono font-bold"
                      style={{ color, opacity: q.yoy !== null ? 1 : 0.4 }}>
                      {yoyStr}
                    </span>
                    {/* Bar */}
                    <div className="w-full rounded-sm transition-all"
                      style={{ height: `${barH}px`, backgroundColor: color, opacity: opac }} />
                    {/* Period label */}
                    <span className="text-[#4a6080] text-[0.55rem] font-mono whitespace-nowrap">
                      {q.period}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Indicator grid */}
      <div className="grid grid-cols-2 gap-x-4">
        <div>
          <div className="text-[#4a6080] text-xs font-bold mb-1">INDICATORS</div>
          <Metric label="RSI(14)"    value={bt.rsi?.toFixed(1) ?? "—"}    color={rsiColor} />
          <Metric label="MACD Hist"  value={bt.macd_hist?.toFixed(3) ?? "—"} color={(bt.macd_hist ?? 0) > 0 ? "text-[#00ff88]" : "text-[#ff4757]"} />
          <Metric label="ADX(14)"    value={bt.adx?.toFixed(1) ?? "—"}    color={adxColor} />
          <Metric label="ATR%"       value={`${bt.atr_pct?.toFixed(2) ?? "—"}%`} />
          <Metric label="BB Position" value={bt.bb_position?.toFixed(2) ?? "—"}
            color={(bt.bb_position ?? 0.5) < 0.3 ? "text-[#00ff88]" : (bt.bb_position ?? 0.5) > 0.7 ? "text-[#ff4757]" : "text-[#c8d8f0]"} />
          <Metric label="Vol Ratio"  value={bt.vol_ratio?.toFixed(2) ?? "—"}
            color={(bt.vol_ratio ?? 1) > 1.5 ? "text-[#00ff88]" : "text-[#c8d8f0]"} />
          {bt.rsi_divergence_type !== "None" && (
            <Metric label="RSI Div" value={bt.rsi_divergence_type ?? "—"}
              color={bt.rsi_divergence_type === "Bullish" ? "text-[#00ff88]" : "text-[#ff4757]"} />
          )}
          {/* ── Optimized ST params under Indicators ── */}
          {optParams && (
            <div className="mt-1 pt-1 border-t border-[#1e2d4a]/40">
              <div className="flex items-center justify-between py-1">
                <span className="text-[#6b85a0] text-xs">ST Opt Params</span>
                <span className="text-[0.65rem] font-mono text-[#ffa502] border border-[#ffa502]/30 rounded px-1.5 py-0.5">
                  ATR {optParams.atrPeriod} × {optParams.multiplier}
                </span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-[#1e2d4a]/40">
                <span className="text-[#6b85a0] text-xs">ST Opt Sharpe</span>
                <span className={`text-xs font-mono ${optParams.sharpe >= 0.5 ? "text-[#00ff88]" : optParams.sharpe >= 0 ? "text-[#ffa502]" : "text-[#ff4757]"}`}>
                  {optParams.sharpe.toFixed(2)} ({optParams.numTrades}T)
                </span>
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="text-[#4a6080] text-xs font-bold mb-1">LEVELS</div>
          <Metric label="SMA(20)"    value={bt.sma_20?.toFixed(2) ?? "—"} />
          <Metric label="EMA(20)"    value={bt.ema_20?.toFixed(2) ?? "—"} color="text-[#a78bfa]" />
          <Metric label="SMA(50)"    value={bt.sma_50?.toFixed(2) ?? "—"} />
          <Metric label="Support"    value={bt.support_level?.toFixed(2)    ?? "—"} color="text-[#00ff88]" />
          <Metric label="Resistance" value={bt.resistance_level?.toFixed(2) ?? "—"} color="text-[#ff4757]" />
          <Metric label="Stop Loss"  value={bt.stop_loss_price?.toFixed(2)  ?? "—"} color="text-[#ff4757]" />
          <Metric label="52W High"   value={bt.week_52_high?.toFixed(2) ?? "—"} />
          <Metric label="52W Low"    value={bt.week_52_low?.toFixed(2)  ?? "—"} />
        </div>
      </div>

      {/* Regime info */}
      <div>
        <div className="text-[#4a6080] text-xs font-bold mb-1">REGIME METADATA</div>
        <div className="grid grid-cols-2 gap-x-4">
          <Metric label="ATR Ratio"     value={result.regime_info?.atr_ratio?.toFixed(2) ?? "—"} />
          <Metric label="ADX Slope"     value={result.regime_info?.adx_slope?.toFixed(2) ?? "—"}
            color={(result.regime_info?.adx_slope ?? 0) > 1 ? "text-[#00ff88]" : (result.regime_info?.adx_slope ?? 0) < -1 ? "text-[#ff4757]" : "text-[#c8d8f0]"} />
          <Metric label="Bullish Count" value={`${result.regime_info?.bullish_count}/5`} />
          <Metric label="High Vol"      value={result.regime_info?.is_high_volatility ? "YES" : "NO"}
            color={result.regime_info?.is_high_volatility ? "text-[#ffa502]" : "text-[#4a6080]"} />
        </div>
      </div>
    </div>
  );
}
