"use client";
import { StockAnalysisResult } from "@/types";

interface Props { result: StockAnalysisResult; }

function Row({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex justify-between py-1 border-b border-[#1e2d4a]/40">
      <span className="text-[#6b85a0] text-xs">{label}</span>
      <span className={`text-xs font-mono ${color ?? "text-[#c8d8f0]"}`}>{value}</span>
    </div>
  );
}

// ─── TRADES TAB ───────────────────────────────────────────────
export function TradesTab({ result }: Props) {
  const trades = result.backtest?.trades ?? [];

  if (trades.length === 0) {
    return <div className="p-4 text-[#4a6080] text-xs">No trades in backtest period</div>;
  }

  const recent = [...trades].reverse().slice(0, 30);

  return (
    <div className="p-3">
      <div className="text-[#4a6080] text-xs mb-2">RECENT TRADES (last {recent.length} of {trades.length})</div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[#4a6080] border-b border-[#1e2d4a]">
              <th className="text-left py-1 pr-2">#</th>
              <th className="text-left py-1 pr-2">ENTRY</th>
              <th className="text-left py-1 pr-2">EXIT</th>
              <th className="text-right py-1 pr-2">RET%</th>
              <th className="text-right py-1 pr-2">R</th>
              <th className="text-left py-1 pr-2">BARS</th>
              <th className="text-left py-1 pr-2">REASON</th>
              <th className="text-left py-1">REGIME</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((t) => (
              <tr key={t.trade_num} className="border-b border-[#1e2d4a]/30 hover:bg-[#1e2d4a]/10">
                <td className="py-1 pr-2 text-[#4a6080]">{t.trade_num}</td>
                <td className="py-1 pr-2 text-[#6b85a0]">{t.entry_date?.slice(5)}</td>
                <td className="py-1 pr-2 text-[#6b85a0]">{t.exit_date?.slice(5)}</td>
                <td className={`py-1 pr-2 text-right font-mono ${t.return > 0 ? "text-[#00ff88]" : "text-[#ff4757]"}`}>
                  {(t.return * 100).toFixed(1)}%
                </td>
                <td className={`py-1 pr-2 text-right font-mono ${t.r_multiple > 0 ? "text-[#00ff88]" : "text-[#ff4757]"}`}>
                  {t.r_multiple.toFixed(2)}R
                </td>
                <td className="py-1 pr-2 text-[#c8d8f0]">{t.bars_held}</td>
                <td className="py-1 pr-2 text-[#6b85a0] truncate max-w-20">{t.exit_reason}</td>
                <td className="py-1 text-[#4a6080] text-xs truncate max-w-24">{t.entry_regime?.replace(/_/g, " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── TRADING PLAN TAB ─────────────────────────────────────────
export function TradingPlanTab({ result }: Props) {
  const bt = result.backtest;
  if (!bt) return <div className="p-4 text-[#4a6080] text-xs">No data</div>;

  const price = result.current_price;
  const stop = bt.stop_loss_price;
  const fib = bt.fib_targets;
  const risk = stop && price > 0 ? price - stop : null;

  function rr(target: number | null) {
    if (!target || !risk || risk <= 0) return null;
    return ((target - price) / risk).toFixed(2);
  }

  function rrColor(ratio: string | null) {
    if (!ratio) return "text-[#4a6080]";
    const v = parseFloat(ratio);
    return v >= 3 ? "text-[#00ff88]" : v >= 2 ? "text-[#ffa502]" : "text-[#ff4757]";
  }

  return (
    <div className="p-3 space-y-4">
      {/* Entry zone */}
      <div>
        <div className="text-[#00d4ff] text-xs font-bold mb-2 tracking-widest">◈ TRADING PLAN</div>

        <div className="bg-[#0a0e1a] border border-[#1e2d4a] rounded p-3 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[#6b85a0] text-xs">Signal</span>
            <span className={`text-xs font-bold px-2 py-0.5 rounded border ${
              result.signal === "BUY" ? "badge-buy" : result.signal === "SELL" ? "badge-sell" : "badge-hold"
            }`}>{result.signal}</span>
          </div>

          <div className="flex justify-between">
            <span className="text-[#6b85a0] text-xs">Current Price</span>
            <span className="text-[#c8d8f0] text-xs font-mono">{price > 0 ? price.toFixed(2) : "—"}</span>
          </div>

          <div className="border-t border-[#1e2d4a] my-1" />

          <div className="flex justify-between">
            <span className="text-[#ff4757] text-xs">Stop Loss</span>
            <span className="text-[#ff4757] text-xs font-mono">
              {stop ? stop.toFixed(2) : "—"}
              {risk && price > 0 ? ` (${((risk / price) * 100).toFixed(1)}%)` : ""}
            </span>
          </div>
        </div>
      </div>

      {/* Fibonacci targets */}
      {fib && (
        <div>
          <div className="text-[#4a6080] text-xs font-bold mb-2">FIBONACCI TARGETS</div>
          <div className="space-y-2">
            {[
              { label: "T1 (1.272×)", val: fib.t1, ext: "27.2%" },
              { label: "T2 (1.618×)", val: fib.t2, ext: "61.8% — Golden Ratio" },
              { label: "T3 (2.000×)", val: fib.t3, ext: "100%" },
            ].map((t) => {
              const ratio = rr(t.val);
              return (
                <div key={t.label} className="bg-[#0a0e1a] border border-[#1e2d4a] rounded p-2">
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="text-[#c8d8f0] text-xs">{t.label}</div>
                      <div className="text-[#4a6080] text-xs">{t.ext}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[#00ff88] text-sm font-bold">{t.val?.toFixed(2) ?? "—"}</div>
                      {ratio && (
                        <div className={`text-xs ${rrColor(ratio)}`}>R:R {ratio}:1</div>
                      )}
                    </div>
                  </div>
                  {/* Gain from current price */}
                  {t.val && price > 0 && (
                    <div className="mt-1 text-[#4a6080] text-xs">
                      +{(((t.val - price) / price) * 100).toFixed(1)}% from current
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Support / Resistance */}
      <div>
        <div className="text-[#4a6080] text-xs font-bold mb-1">KEY LEVELS</div>
        <Row label="Resistance" value={bt.resistance_level?.toFixed(2) ?? "—"} color="text-[#ff4757]" />
        <Row label="Current" value={price > 0 ? price.toFixed(2) : "—"} color="text-[#00d4ff]" />
        <Row label="Support" value={bt.support_level?.toFixed(2) ?? "—"} color="text-[#00ff88]" />
        <Row label="Stop Loss" value={bt.stop_loss_price?.toFixed(2) ?? "—"} color="text-[#ff4757]" />
        <Row label="52W High" value={bt.week_52_high?.toFixed(2) ?? "—"} />
        <Row label="52W Low" value={bt.week_52_low?.toFixed(2) ?? "—"} />
        {fib?.swing_low && <Row label="Swing Low (base)" value={fib.swing_low.toFixed(2)} />}
      </div>

      {/* Regime context */}
      <div>
        <div className="text-[#4a6080] text-xs font-bold mb-1">REGIME CONTEXT</div>
        <div className="bg-[#0a0e1a] border border-[#1e2d4a] rounded p-2 text-xs text-[#6b85a0]">
          {result.regime?.replace(/_/g, " ")} — Score {result.score?.toFixed(1)} / 10
          {result.regime_info?.is_high_volatility && " · ⚠ HIGH VOLATILITY"}
          {result.regime_info?.is_extreme_dislocation && " · ⚠⚠ EXTREME DISLOCATION"}
        </div>
      </div>
    </div>
  );
}
