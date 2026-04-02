"use client";
import { StockAnalysisResult } from "@/types";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, Scatter, Cell,
} from "recharts";

interface Props { result: StockAnalysisResult; }

// ─── Custom dot for entry/exit markers ───────────────────────
function EntryDot(props: {
  cx?: number; cy?: number; payload?: { entryType?: string };
}) {
  const { cx, cy, payload } = props;
  if (!cx || !cy || !payload?.entryType) return null;
  const isBuy = payload.entryType === "BUY";
  return (
    <g>
      <polygon
        points={
          isBuy
            ? `${cx},${cy - 10} ${cx - 6},${cy} ${cx + 6},${cy}`   // up triangle
            : `${cx},${cy + 10} ${cx - 6},${cy} ${cx + 6},${cy}`   // down triangle
        }
        fill={isBuy ? "#00ff88" : "#ff4757"}
        opacity={0.9}
      />
    </g>
  );
}

// ─── Custom tooltip ───────────────────────────────────────────
function CustomTooltip({ active, payload, label }: {
  active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#0f1629] border border-[#1e2d4a] p-2 text-xs rounded">
      <div className="text-[#6b85a0] mb-1">{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ color: p.color }}>
          {p.name}: {typeof p.value === "number" ? p.value.toFixed(2) : p.value}
        </div>
      ))}
    </div>
  );
}

export default function ChartTab({ result }: Props) {
  const bt = result.backtest;
  if (!bt || !bt.trades || bt.trades.length === 0) {
    return (
      <div className="p-4 text-[#4a6080] text-xs">
        No trades to display on chart. Run analysis first.
      </div>
    );
  }

  const trades = bt.trades;
  const equity = bt.equity_curve;
  const dates = bt.equity_dates;

  // ── Build OHLCV-lite price series from equity_dates ───────
  // We have equity curve + dates. For the price chart we need
  // to reconstruct entry/exit prices from trades.
  const initialCap = equity[0] ?? 10000;

  // Build a date-indexed lookup for entries and exits
  const entryMap: Record<string, { price: number; regime: string }> = {};
  const exitMap: Record<string, { price: number; reason: string; win: boolean }> = {};

  for (const t of trades) {
    entryMap[t.entry_date] = { price: t.entry_price, regime: t.entry_regime };
    exitMap[t.exit_date] = {
      price: t.exit_price,
      reason: t.exit_reason,
      win: t.return > 0,
    };
  }

  // ── Equity curve chart data ───────────────────────────────
  const eqChartData = equity.map((v, i) => {
    const date = dates[i] ?? `${i}`;
    const shortDate = date.slice(5); // MM-DD
    const entry = entryMap[date];
    const exit = exitMap[date];

    return {
      date: shortDate,
      fullDate: date,
      equity: Math.round(v * 100) / 100,
      bh: Math.round((initialCap + (equity[i] - initialCap)) * 100) / 100, // placeholder
      entryPrice: entry ? entry.price : undefined,
      exitPrice: exit ? exit.price : undefined,
      entryType: entry ? "BUY" : exit ? "SELL" : undefined,
      exitWin: exit ? exit.win : undefined,
      reason: exit?.reason,
    };
  });

  // Buy & hold curve
  const firstEquity = equity[0];
  const lastEquity = equity[equity.length - 1];
  const eqWithBH = eqChartData.map((d, i) => ({
    ...d,
    buyHold: Math.round((firstEquity + (lastEquity - firstEquity) * (i / (equity.length - 1))) * 100) / 100,
  }));

  // ── Entry/exit markers as scatter ────────────────────────
  const markers = eqWithBH.filter((d) => d.entryType);

  // ── Return distribution ───────────────────────────────────
  const retBuckets: Record<string, number> = {};
  for (const t of trades) {
    const r = Math.round(t.return * 100 * 2) / 2; // round to nearest 0.5%
    const key = `${r >= 0 ? "+" : ""}${r.toFixed(1)}%`;
    retBuckets[key] = (retBuckets[key] ?? 0) + 1;
  }
  const retDist = Object.entries(retBuckets)
    .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
    .map(([ret, count]) => ({ ret, count, pos: parseFloat(ret) >= 0 }));

  // ── R-multiple series ─────────────────────────────────────
  const rData = trades.map((t) => ({
    n: `T${t.trade_num}`,
    r: Math.round(t.r_multiple * 100) / 100,
    win: t.return > 0,
  }));

  const totalReturn = bt.total_return ?? 0;
  const buyHoldReturn = bt.buy_hold_return ?? 0;
  const alpha = bt.alpha ?? 0;

  return (
    <div className="p-3 space-y-4">

      {/* ── Header metrics ── */}
      <div className="grid grid-cols-4 gap-2 text-xs">
        {[
          { label: "Strategy", val: `${totalReturn >= 0 ? "+" : ""}${totalReturn.toFixed(1)}%`,
            color: totalReturn >= 0 ? "text-[#00ff88]" : "text-[#ff4757]" },
          { label: "Buy & Hold", val: `${buyHoldReturn >= 0 ? "+" : ""}${buyHoldReturn.toFixed(1)}%`,
            color: "text-[#c8d8f0]" },
          { label: "Alpha", val: `${alpha >= 0 ? "+" : ""}${alpha.toFixed(1)}%`,
            color: alpha >= 0 ? "text-[#00ff88]" : "text-[#ff4757]" },
          { label: "Trades", val: bt.num_trades, color: "text-[#00d4ff]" },
        ].map((m) => (
          <div key={m.label} className="bg-[#0a0e1a] border border-[#1e2d4a] p-2 rounded text-center">
            <div className="text-[#4a6080] mb-0.5">{m.label}</div>
            <div className={`font-bold ${m.color}`}>{m.val}</div>
          </div>
        ))}
      </div>

      {/* ── Equity curve with entry/exit markers ── */}
      <div>
        <div className="text-[#4a6080] text-xs mb-1">
          EQUITY CURVE — ▲ Entry (green) · ▼ Exit win (green) / loss (red)
        </div>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={eqWithBH} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
              <XAxis dataKey="date" tick={{ fontSize: 8, fill: "#4a6080" }}
                interval={Math.floor(eqWithBH.length / 8)} />
              <YAxis tick={{ fontSize: 8, fill: "#4a6080" }} width={52}
                tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={initialCap} stroke="#1e2d4a" strokeDasharray="4 2" />

              {/* Strategy equity */}
              <Line type="monotone" dataKey="equity" name="Strategy"
                stroke="#00d4ff" strokeWidth={1.5} dot={false} />

              {/* Entry markers (green up triangles) */}
              <Scatter data={markers.filter((d) => d.entryType === "BUY")}
                dataKey="equity" shape={<EntryDot />} name="Entry" legendType="none" />

              {/* Exit markers (colored triangles) */}
              <Scatter
                data={markers.filter((d) => d.entryType === "SELL")}
                dataKey="equity"
                shape={(props: { cx?: number; cy?: number; payload?: { exitWin?: boolean } }) => (
                  <EntryDot {...props} payload={{ ...props.payload, entryType: "SELL" }} />
                )}
                name="Exit"
                legendType="none"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── R-Multiple chart ── */}
      <div>
        <div className="text-[#4a6080] text-xs mb-1">R-MULTIPLE PER TRADE</div>
        <div className="h-28">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rData} barSize={Math.max(4, Math.floor(400 / (rData.length + 1)))}>
              <XAxis dataKey="n" tick={{ fontSize: 7, fill: "#4a6080" }}
                interval={Math.max(0, Math.floor(rData.length / 10) - 1)} />
              <YAxis tick={{ fontSize: 8, fill: "#4a6080" }} width={28} />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={0} stroke="#1e2d4a" />
              <Bar dataKey="r" name="R-Multiple">
                {rData.map((d, i) => (
                  <Cell key={i} fill={d.win ? "#00ff88" : "#ff4757"} opacity={0.8} />
                ))}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Return distribution ── */}
      {retDist.length > 0 && (
        <div>
          <div className="text-[#4a6080] text-xs mb-1">RETURN DISTRIBUTION</div>
          <div className="h-24">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={retDist}>
                <XAxis dataKey="ret" tick={{ fontSize: 7, fill: "#4a6080" }}
                  interval={Math.floor(retDist.length / 6)} />
                <YAxis tick={{ fontSize: 8, fill: "#4a6080" }} width={20} />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine x="0.0%" stroke="#1e2d4a" strokeDasharray="4 2" />
                <Bar dataKey="count" name="Trades">
                  {retDist.map((d, i) => (
                    <Cell key={i} fill={d.pos ? "#00ff88" : "#ff4757"} opacity={0.75} />
                  ))}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Exit reason breakdown ── */}
      {Object.keys(bt.exit_reasons ?? {}).length > 0 && (
        <div>
          <div className="text-[#4a6080] text-xs mb-1">EXIT REASONS</div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(bt.exit_reasons).map(([reason, count]) => {
              const pct = Math.round((count / bt.num_trades) * 100);
              return (
                <div key={reason}
                  className="flex items-center gap-1.5 bg-[#0a0e1a] border border-[#1e2d4a] px-2 py-1 rounded text-xs">
                  <span className="text-[#6b85a0]">{reason}</span>
                  <span className="text-[#c8d8f0] font-mono">{count}</span>
                  <span className="text-[#4a6080]">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
