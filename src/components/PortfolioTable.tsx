"use client";
import { StockAnalysisResult } from "@/types";
import { regimeColor } from "@/lib/regime";

interface Props { results: StockAnalysisResult[]; }

// ── Grade from score ──────────────────────────────────────────
function grade(score: number): { label: string; color: string } {
  if (score >= 7.0) return { label: "A+", color: "text-[#00ff88]" };
  if (score >= 6.5) return { label: "A",  color: "text-[#00ff88]" };
  if (score >= 6.0) return { label: "B+", color: "text-[#4ade80]" };
  if (score >= 5.5) return { label: "B",  color: "text-[#fbbf24]" };
  if (score >= 5.0) return { label: "C+", color: "text-[#ffa502]" };
  if (score >= 4.5) return { label: "C",  color: "text-[#fb923c]" };
  return                     { label: "D",  color: "text-[#ff4757]" };
}

// ── Regime short label + icon ─────────────────────────────────
function regimeShort(regime: string): { icon: string; label: string } {
  if (regime.includes("EXTREME_VOL"))        return { icon: "⚡⚡", label: regime.replace(/_/g," ") };
  if (regime.includes("HIGH_VOL") && regime.includes("UPTREND"))   return { icon: "🚀⚡", label: "HV Strong UP" };
  if (regime.includes("HIGH_VOL"))           return { icon: "⚡", label: "High Vol" };
  if (regime.includes("STRONG_UPTREND"))     return { icon: "🚀", label: "Strong UP" };
  if (regime.includes("STRENGTHENING_UPTREND")) return { icon: "↗↗", label: "Stren UP" };
  if (regime.includes("STRENGTHENING_DOWN")) return { icon: "↓↓", label: "Stren DN" };
  if (regime.includes("STRENGTHENING"))      return { icon: "↗", label: "Stren" };
  if (regime.includes("STRONG_DOWN"))        return { icon: "📉", label: "Strong DN" };
  if (regime.includes("WEAKENING_UP"))       return { icon: "↘", label: "Weak UP↓" };
  if (regime.includes("WEAKENING_DOWN"))     return { icon: "↘↓", label: "Weak DN↓" };
  if (regime.includes("EXHAUSTING_UP"))      return { icon: "🔥", label: "Exhaust UP" };
  if (regime.includes("EXHAUSTING_DOWN"))    return { icon: "🔥↓", label: "Exhaust DN" };
  if (regime.includes("UPTREND"))            return { icon: "↗", label: "Uptrend" };
  if (regime.includes("DOWNTREND"))          return { icon: "↓", label: "Downtrend" };
  if (regime.includes("BEAR_RALLY"))         return { icon: "↙", label: "Bear Rally" };
  if (regime.includes("WEAK_UP"))            return { icon: "↘↑", label: "Wk UP↑" };
  if (regime.includes("WEAK_DOWN"))          return { icon: "↘↓", label: "Wk DN↓" };  // fixed: was confusing
  if (regime.includes("RANGING"))            return { icon: "↔", label: "Ranging" };
  if (regime.includes("OVERBOUGHT"))         return { icon: "⬆", label: "Overbought" };
  if (regime.includes("OVERSOLD"))           return { icon: "⬇", label: "Oversold" };
  return                                       { icon: "—", label: "Neutral" };
}

function SignalBadge({ signal }: { signal: string }) {
  const cls =
    signal === "BUY"  ? "badge-buy" :
    signal === "SELL" ? "badge-sell" : "badge-hold";
  return (
    <span className={`px-1.5 py-0.5 rounded border text-xs font-bold ${cls}`}>
      {signal}
    </span>
  );
}

function Num({ v, pct, dec = 1, positive = false }: {
  v: number | null | undefined; pct?: boolean; dec?: number; positive?: boolean;
}) {
  if (v == null || isNaN(v)) return <span className="text-[#4a6080]">N/A</span>;
  const val = pct ? v : v;
  const str = `${val >= 0 && positive ? "+" : ""}${val.toFixed(dec)}${pct ? "%" : ""}`;
  const color = positive
    ? val > 0 ? "text-[#00ff88]" : val < 0 ? "text-[#ff4757]" : "text-[#6b85a0]"
    : "text-[#c8d8f0]";
  return <span className={color}>{str}</span>;
}

export default function PortfolioTable({ results }: Props) {
  if (results.length === 0) return null;

  return (
    <div className="px-4 pb-4">
      <div className="text-[#00d4ff]/60 text-xs font-bold tracking-widest mb-2">
        PORTFOLIO SUMMARY
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-[#4a6080] border-b border-[#1e2d4a]">
              <th className="text-left py-1.5 pr-3 font-normal sticky left-0 bg-[#0a0e1a] z-10">Ticker</th>
              <th className="text-right py-1.5 pr-3 font-normal">Price</th>
              <th className="text-right py-1.5 pr-3 font-normal">Chg%</th>
              <th className="text-left  py-1.5 pr-3 font-normal">Regime</th>
              <th className="text-center py-1.5 pr-3 font-normal">Grd</th>
              <th className="text-center py-1.5 pr-3 font-normal">Score</th>
              <th className="text-center py-1.5 pr-3 font-normal">Signal</th>
              <th className="text-right py-1.5 pr-3 font-normal">RSI</th>
              <th className="text-right py-1.5 pr-3 font-normal">MACD</th>
              <th className="text-right py-1.5 pr-3 font-normal">Sharpe</th>
              <th className="text-right py-1.5 pr-3 font-normal">Alpha</th>
              <th className="text-right py-1.5 pr-3 font-normal">Win%</th>
              <th className="text-right py-1.5 pr-3 font-normal">Calmar</th>
              <th className="text-right py-1.5 pr-3 font-normal">P/E</th>
              <th className="text-right py-1.5 font-normal">Trades</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => {
              const bt = r.backtest;
              const g = grade(r.score ?? 0);
              const rs = regimeShort(r.regime ?? "");
              const isHK = r.exchange === "HK";
              const priceFmt = isHK
                ? `HK$${(r.current_price ?? 0).toFixed(2)}`
                : `$${(r.current_price ?? 0).toFixed(2)}`;
              const changePct = r.change_pct ?? 0;

              return (
                <tr
                  key={r.symbol}
                  className="border-b border-[#1e2d4a]/30 hover:bg-[#1e2d4a]/10 transition-colors"
                >
                  {/* Ticker + name */}
                  <td className="py-1.5 pr-3 sticky left-0 bg-[#0a0e1a] z-10">
                    <div className="font-bold text-[#00d4ff]">{r.symbol}</div>
                    <div className="text-[#4a6080] text-[0.6rem] truncate max-w-[72px]">{r.name}</div>
                  </td>

                  {/* Price */}
                  <td className="py-1.5 pr-3 text-right font-mono text-[#c8d8f0]">
                    {priceFmt}
                  </td>

                  {/* Change % */}
                  <td className="py-1.5 pr-3 text-right font-mono">
                    <span className={changePct >= 0 ? "text-[#00ff88]" : "text-[#ff4757]"}>
                      {changePct >= 0 ? "▲" : "▼"}{Math.abs(changePct).toFixed(1)}%
                    </span>
                  </td>

                  {/* Regime */}
                  <td className="py-1.5 pr-3">
                    <span className={`text-[0.65rem] ${regimeColor(r.regime ?? "")}`}>
                      {rs.icon} {rs.label}
                    </span>
                  </td>

                  {/* Grade */}
                  <td className="py-1.5 pr-3 text-center">
                    <span className={`font-bold ${g.color}`}>{g.label}</span>
                  </td>

                  {/* Score */}
                  <td className="py-1.5 pr-3 text-center font-mono">
                    <span className={
                      (r.score ?? 0) >= 6.5 ? "text-[#00ff88]" :
                      (r.score ?? 0) >= 5.5 ? "text-[#ffa502]" : "text-[#ff4757]"
                    }>
                      {(r.score ?? 0).toFixed(1)}
                    </span>
                  </td>

                  {/* Signal */}
                  <td className="py-1.5 pr-3 text-center">
                    <SignalBadge signal={r.signal ?? "HOLD"} />
                  </td>

                  {/* RSI */}
                  <td className="py-1.5 pr-3 text-right font-mono">
                    <span className={
                      (bt?.rsi ?? 50) < 30 ? "text-[#00ff88]" :
                      (bt?.rsi ?? 50) > 70 ? "text-[#ff4757]" : "text-[#c8d8f0]"
                    }>
                      {bt?.rsi?.toFixed(0) ?? "—"}
                    </span>
                  </td>

                  {/* MACD Hist */}
                  <td className="py-1.5 pr-3 text-right font-mono">
                    <span className={(bt?.macd_hist ?? 0) >= 0 ? "text-[#00ff88]" : "text-[#ff4757]"}>
                      {bt?.macd_hist?.toFixed(2) ?? "—"}
                    </span>
                  </td>

                  {/* Sharpe */}
                  <td className="py-1.5 pr-3 text-right font-mono">
                    <Num v={bt?.sharpe} dec={2} positive />
                  </td>

                  {/* Alpha */}
                  <td className="py-1.5 pr-3 text-right font-mono">
                    <Num v={bt?.alpha} pct dec={1} positive />
                  </td>

                  {/* Win % */}
                  <td className="py-1.5 pr-3 text-right font-mono">
                    {bt?.num_trades && bt.num_trades > 0
                      ? <Num v={bt.win_rate} pct dec={0} />
                      : <span className="text-[#4a6080]">—</span>}
                  </td>

                  {/* Calmar */}
                  <td className="py-1.5 pr-3 text-right font-mono">
                    <Num v={bt?.calmar_ratio} dec={2} positive />
                  </td>

                  {/* P/E — placeholder (yfinance fundamental not available in browser) */}
                  <td className="py-1.5 pr-3 text-right text-[#4a6080]">
                    —
                  </td>

                  {/* Trades */}
                  <td className="py-1.5 text-right font-mono text-[#6b85a0]">
                    {bt?.num_trades ?? 0}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
