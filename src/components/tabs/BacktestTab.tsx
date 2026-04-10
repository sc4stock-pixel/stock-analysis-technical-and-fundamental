"use client";
import { StockAnalysisResult } from "@/types";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell, LineChart, Line, ReferenceLine,
} from "recharts";

interface Props { result: StockAnalysisResult; }

function Row({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex justify-between py-1 border-b border-[#1e2d4a]/40">
      <span className="text-[#6b85a0] text-xs">{label}</span>
      <span className={`text-xs font-mono ${color ?? "text-[#c8d8f0]"}`}>{value}</span>
    </div>
  );
}

function MetricCol({ label, score, st, higherIsBetter = true }: {
  label: string; score: number | string; st: number | string; higherIsBetter?: boolean;
}) {
  const sVal = typeof score === "number" ? score : 0;
  const stVal = typeof st === "number" ? st : 0;
  const scoreWins = higherIsBetter ? sVal >= stVal : sVal <= stVal;
  const tied = Math.abs(sVal - stVal) < 0.01;
  return (
    <div className="flex justify-between py-1 border-b border-[#1e2d4a]/30 text-xs">
      <span className="text-[#4a6080] w-28 flex-shrink-0">{label}</span>
      <span className={`font-mono w-16 text-right ${!tied && scoreWins ? "text-[#00ff88]" : "text-[#c8d8f0]"}`}>
        {typeof score === "number" ? score.toFixed(1) : score}
      </span>
      <span className={`font-mono w-16 text-right ${!tied && !scoreWins ? "text-[#00ff88]" : "text-[#c8d8f0]"}`}>
        {typeof st === "number" ? st.toFixed(1) : st}
      </span>
    </div>
  );
}

export default function BacktestTab({ result }: Props) {
  const bt = result.backtest;
  const wf = result.walk_forward;
  const kelly = result.kelly;
  const cmp = result.comparison;
  if (!bt) return <div className="p-4 text-[#4a6080] text-xs">No backtest data</div>;

  // Equity curve chart
  const eqData = bt.equity_curve.map((v, i) => ({ i, v }));

  // Waterfall (last 15 trades)
  const lastTrades = (bt.trades ?? []).slice(-15);
  const waterfallData = lastTrades.map((t) => ({
    n: `T${t.trade_num}`,
    r: Math.round(t.return * 1000) / 10,
    fill: t.return > 0 ? "#00ff88" : "#ff4757",
  }));

  const alphaColor = (bt.alpha ?? 0) >= 0 ? "text-[#00ff88]" : "text-[#ff4757]";
  const sharpeColor = (bt.sharpe ?? 0) >= 1 ? "text-[#00ff88]" : (bt.sharpe ?? 0) >= 0.5 ? "text-[#ffa502]" : "text-[#ff4757]";

  return (
    <div className="p-3 space-y-3">

      {/* ── STRATEGY COMPARISON BOX ─────────────────────────── */}
      {cmp && (
        <div className="border border-[#1e2d4a] rounded bg-[#080d1a] p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[#00d4ff] text-xs font-bold tracking-wider">STRATEGY COMPARISON</div>
            <div className={`text-xs px-2 py-0.5 rounded border font-mono ${
              cmp.winner === "score"
                ? "border-[#00ff88] text-[#00ff88] bg-[#00ff88]/10"
                : cmp.winner === "supertrend"
                ? "border-[#ffa502] text-[#ffa502] bg-[#ffa502]/10"
                : "border-[#4a6080] text-[#4a6080]"
            }`}>
              {cmp.winner === "tie" ? "TIE" : `${cmp.winner === "score" ? "SCORE" : "ST"} WINS +${cmp.winner_margin.toFixed(1)}%α`}
            </div>
          </div>

          {/* Column headers */}
          <div className="flex justify-between text-xs mb-1 pb-1 border-b border-[#1e2d4a]">
            <span className="text-[#4a6080] w-28">METRIC</span>
            <span className="text-[#00d4ff] w-16 text-right font-mono">SCORE</span>
            <span className="text-[#ffa502] w-16 text-right font-mono">ST</span>
          </div>

          <MetricCol label="Return %" score={cmp.score.total_return} st={cmp.supertrend.total_return} />
          <MetricCol label="Alpha %" score={cmp.score.alpha} st={cmp.supertrend.alpha} />
          <MetricCol label="Sharpe" score={cmp.score.sharpe} st={cmp.supertrend.sharpe} />
          <MetricCol label="Sortino" score={cmp.score.sortino} st={cmp.supertrend.sortino} />
          <MetricCol label="Win %" score={cmp.score.win_rate} st={cmp.supertrend.win_rate} />
          <MetricCol label="Prft Factor" score={cmp.score.profit_factor} st={cmp.supertrend.profit_factor} />
          <MetricCol label="Expectancy%" score={cmp.score.expectancy} st={cmp.supertrend.expectancy} />
          <MetricCol label="Avg Win %" score={cmp.score.avg_win} st={cmp.supertrend.avg_win} />
          <MetricCol label="Avg Loss %" score={cmp.score.avg_loss} st={cmp.supertrend.avg_loss} higherIsBetter={false} />
          <MetricCol label="Max DD %" score={cmp.score.max_drawdown} st={cmp.supertrend.max_drawdown} higherIsBetter={false} />
          <div className="flex justify-between py-1 border-b border-[#1e2d4a]/30 text-xs">
            <span className="text-[#4a6080] w-28">Trades</span>
            <span className="text-[#c8d8f0] font-mono w-16 text-right">{cmp.score.num_trades}</span>
            <span className="text-[#c8d8f0] font-mono w-16 text-right">{cmp.supertrend.num_trades}</span>
          </div>

          {/* Recent trades — last 4 per strategy */}
          <div className="mt-2 pt-2 border-t border-[#1e2d4a]/50 grid grid-cols-2 gap-2">
            <div>
              <div className="text-[#00d4ff] text-[0.6rem] font-bold mb-1">SCORE RECENT</div>
              {[...cmp.score.trades].reverse().slice(0, 4).map(t => (
                <div key={t.trade_num} className="flex justify-between text-[0.6rem] font-mono mb-0.5">
                  <span className="text-[#4a6080]">{t.entry_date?.slice(5)}</span>
                  <span className={t.return > 0 ? "text-[#00ff88]" : "text-[#ff4757]"}>
                    {t.return >= 0 ? "+" : ""}{(t.return * 100).toFixed(1)}%
                    <span className="text-[#4a6080] ml-1">({t.r_multiple >= 0 ? "+" : ""}{t.r_multiple.toFixed(1)}R)</span>
                  </span>
                </div>
              ))}
              {cmp.score.trades.length === 0 && <div className="text-[#4a6080] text-[0.6rem]">No trades</div>}
            </div>
            <div>
              <div className="text-[#ffa502] text-[0.6rem] font-bold mb-1">ST RECENT</div>
              {[...cmp.supertrend.trades].reverse().slice(0, 4).map(t => (
                <div key={t.trade_num} className="flex justify-between text-[0.6rem] font-mono mb-0.5">
                  <span className="text-[#4a6080]">{t.entry_date?.slice(5)}</span>
                  <span className={t.return > 0 ? "text-[#00ff88]" : "text-[#ff4757]"}>
                    {t.return >= 0 ? "+" : ""}{(t.return * 100).toFixed(1)}%
                    <span className="text-[#4a6080] ml-1">({t.r_multiple >= 0 ? "+" : ""}{t.r_multiple.toFixed(1)}R)</span>
                  </span>
                </div>
              ))}
              {cmp.supertrend.trades.length === 0 && <div className="text-[#4a6080] text-[0.6rem]">No trades</div>}
            </div>
          </div>

          {/* ST Status footer */}
          {(() => {
            const dir = result.st_direction ?? -1;
            const dist = result.st_stop_distance_pct ?? 0;
            const openRet = result.st_open_return_pct;
            return (
              <div className="mt-2 pt-2 border-t border-[#1e2d4a]/50 flex items-center gap-2 text-xs font-mono">
                <span className="text-[#4a6080]">ST Status:</span>
                {dir === 1 ? (
                  <>
                    <span className="text-[#00ff88]">🟢</span>
                    {openRet !== null && openRet !== undefined && (
                      <span className={openRet >= 0 ? "text-[#00ff88]" : "text-[#ffa502]"}>
                        {openRet >= 0 ? "+" : ""}{openRet.toFixed(1)}%
                      </span>
                    )}
                    {openRet !== null && openRet !== undefined && (
                      <span className="text-[#4a6080]">·</span>
                    )}
                    <span className="text-[#c8d8f0]">{dist.toFixed(1)}% to stop</span>
                  </>
                ) : (
                  <span className="text-[#ff4757]">🔴 Bearish — wait for flip</span>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Equity curve */}
      {eqData.length > 2 && (
        <div>
          <div className="text-[#4a6080] text-xs mb-1">
            EQUITY CURVE
            {cmp && (
              <span className={`ml-2 px-1.5 py-0.5 rounded text-[0.6rem] font-mono border ${
                result.comparison?.winner === "supertrend" && bt.signal_bars === 0
                  ? "border-[#ffa502]/40 text-[#ffa502]"
                  : "border-[#00d4ff]/40 text-[#00d4ff]"
              }`}>
                {bt.signal_bars === 0 ? "ST STRATEGY" : "SCORE"}
              </span>
            )}
          </div>
          <div className="h-28">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={eqData}>
                <XAxis dataKey="i" hide />
                <YAxis domain={["auto", "auto"]} hide />
                <ReferenceLine y={result.backtest?.equity_curve?.[0] ?? 10000} stroke="#1e2d4a" strokeDasharray="4 2" />
                <Line type="monotone" dataKey="v"
                  stroke={bt.signal_bars === 0 ? "#ffa502" : "#00d4ff"}
                  strokeWidth={1.5} dot={false} />
                <Tooltip contentStyle={{ background: "#0f1629", border: "1px solid #1e2d4a", fontSize: 10 }}
                  formatter={(v: number) => [`$${v.toFixed(0)}`, "Equity"]} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Trade waterfall */}
      {waterfallData.length > 0 && (
        <div>
          <div className="text-[#4a6080] text-xs mb-1">
            {bt.signal_bars === 0 ? "ST" : "SCORE"} TRADE RETURNS (last {waterfallData.length})
          </div>
          <div className="h-20">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={waterfallData} barSize={12}>
                <XAxis dataKey="n" tick={{ fontSize: 8, fill: "#4a6080" }} />
                <YAxis hide />
                <ReferenceLine y={0} stroke="#1e2d4a" />
                <Tooltip contentStyle={{ background: "#0f1629", border: "1px solid #1e2d4a", fontSize: 10 }}
                  formatter={(v: number) => [`${v.toFixed(1)}%`, "Return"]} />
                <Bar dataKey="r">
                  {waterfallData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-x-4">
        <div>
          <div className="text-[#4a6080] text-xs font-bold mb-1">PERFORMANCE</div>
          <Row label="Total Return" value={`${bt.total_return?.toFixed(1)}%`}
            color={(bt.total_return ?? 0) >= 0 ? "text-[#00ff88]" : "text-[#ff4757]"} />
          <Row label="vs Buy & Hold" value={`${bt.buy_hold_return?.toFixed(1)}%`} />
          <Row label="Alpha" value={`${(bt.alpha ?? 0) >= 0 ? "+" : ""}${bt.alpha?.toFixed(1)}%`} color={alphaColor} />
          <Row label="Sharpe" value={bt.sharpe?.toFixed(2) ?? "—"} color={sharpeColor} />
          <Row label="Sortino" value={bt.sortino?.toFixed(2) ?? "—"} />
          <Row label="Calmar" value={bt.calmar_ratio?.toFixed(2) ?? "—"} />
          <Row label="Omega" value={bt.omega_ratio?.toFixed(2) ?? "—"} />
          <Row label="Ulcer Index" value={`${bt.ulcer_index?.toFixed(2)}%`} />
        </div>
        <div>
          <div className="text-[#4a6080] text-xs font-bold mb-1">TRADE STATS</div>
          <Row label="Trades" value={bt.num_trades ?? 0} />
          <Row label="Win Rate" value={`${bt.win_rate?.toFixed(1)}%`}
            color={(bt.win_rate ?? 0) >= 55 ? "text-[#00ff88]" : "text-[#ff4757]"} />
          <Row label="Expectancy" value={`${bt.expectancy?.toFixed(2)}%`}
            color={(bt.expectancy ?? 0) >= 0 ? "text-[#00ff88]" : "text-[#ff4757]"} />
          <Row label="Profit Factor" value={bt.profit_factor?.toFixed(2) ?? "—"}
            color={(bt.profit_factor ?? 0) >= 1.5 ? "text-[#00ff88]" : "text-[#ffa502]"} />
          <Row label="Avg Win" value={`${bt.avg_win?.toFixed(2)}%`} color="text-[#00ff88]" />
          <Row label="Avg Loss" value={`${bt.avg_loss?.toFixed(2)}%`} color="text-[#ff4757]" />
          <Row label="Max DD" value={`${bt.max_drawdown?.toFixed(1)}%`} color="text-[#ff4757]" />
          {bt.kill_switch_triggered && <Row label="Kill Switch" value="TRIGGERED" color="text-[#ff4757]" />}
        </div>
      </div>

      {/* Duration stats */}
      <div>
        <div className="text-[#4a6080] text-xs font-bold mb-1">DURATION (bars)</div>
        <div className="grid grid-cols-4 gap-2 text-xs">
          {[
            { label: "AVG", val: bt.avg_duration?.toFixed(1) },
            { label: "MED", val: bt.median_duration?.toFixed(0) },
            { label: "WIN AVG", val: bt.avg_winner_duration?.toFixed(1) },
            { label: "LOSE AVG", val: bt.avg_loser_duration?.toFixed(1) },
          ].map((m) => (
            <div key={m.label} className="bg-[#0a0e1a] border border-[#1e2d4a] p-1.5 rounded text-center">
              <div className="text-[#4a6080]">{m.label}</div>
              <div className="text-[#c8d8f0]">{m.val ?? "—"}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Exit reasons */}
      {Object.keys(bt.exit_reasons ?? {}).length > 0 && (
        <div>
          <div className="text-[#4a6080] text-xs font-bold mb-1">EXIT REASONS</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(bt.exit_reasons).map(([r, c]) => (
              <span key={r} className="text-xs border border-[#1e2d4a] px-2 py-0.5 rounded text-[#6b85a0]">
                {r}: <span className="text-[#c8d8f0]">{c}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* MAE/MFE */}
      <div>
        <div className="text-[#4a6080] text-xs font-bold mb-1">MAE / MFE</div>
        <div className="grid grid-cols-2 gap-x-4">
          <Row label="Avg MAE" value={`${bt.avg_mae?.toFixed(2)}%`} color="text-[#ff4757]" />
          <Row label="Avg MFE" value={`${bt.avg_mfe?.toFixed(2)}%`} color="text-[#00ff88]" />
          <Row label="Winner MAE" value={`${bt.winner_mae?.toFixed(2)}%`} />
          <Row label="Winner MFE" value={`${bt.winner_mfe?.toFixed(2)}%`} />
        </div>
      </div>

      {/* Walk-Forward */}
      {wf && (
        <div>
          <div className="text-[#4a6080] text-xs font-bold mb-1">WALK-FORWARD</div>
          <Row label="Best Entry" value={wf.best_params?.entryThreshold} />
          <Row label="Best Max Hold" value={`${wf.best_params?.maxHoldingDays}d`} />
          <Row label="Train Sharpe" value={wf.train_sharpe} />
          <Row label="Test Sharpe" value={wf.test_sharpe}
            color={(wf.test_sharpe ?? 0) > 0 ? "text-[#00ff88]" : "text-[#ff4757]"} />
          <Row label="Efficiency" value={`${wf.efficiency_ratio} (${wf.efficiency_quality})`}
            color={wf.efficiency_quality === "GOOD" ? "text-[#00ff88]" : wf.efficiency_quality === "ACCEPTABLE" ? "text-[#ffa502]" : "text-[#ff4757]"} />
          <Row label="Passed" value={wf.passed ? "YES" : "NO"} color={wf.passed ? "text-[#00ff88]" : "text-[#ff4757]"} />
        </div>
      )}

      {/* Kelly */}
      {kelly && (
        <div>
          <div className="text-[#4a6080] text-xs font-bold mb-1">KELLY POSITION SIZING</div>
          <Row label="Full Kelly" value={`${(kelly.full_kelly * 100).toFixed(1)}%`} />
          <Row label="Kelly (¼×0.8)" value={`${(kelly.kelly_fraction * 100).toFixed(1)}%`} />
          <Row label="Recommended" value={`${(kelly.recommended_fraction * 100).toFixed(1)}%`} color="text-[#00d4ff]" />
          <Row label="Method" value={kelly.sizing_method} />
          {kelly.atr_shares > 0 && <Row label="ATR Shares" value={kelly.atr_shares} />}
        </div>
      )}
    </div>
  );
}

