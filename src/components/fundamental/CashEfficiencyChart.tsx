// src/components/fundamental/CashEfficiencyChart.tsx
'use client';
import {
  ComposedChart, Bar, Line, Cell, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import type { FundamentalsPayload } from '../../app/api/fundamentals/route';
import { fmtPeriodLabel } from './format';

interface Props { data: FundamentalsPayload; }

function cccDays(p: { ar?: number | null; inventory?: number | null; ap?: number | null; revenue?: number | null }): number | null {
  if (!p.revenue || !p.ar || !p.inventory || !p.ap) return null;
  const dso = (p.ar / p.revenue) * 90;
  const dio = (p.inventory / p.revenue) * 90;
  const dpo = (p.ap / p.revenue) * 90;
  return dso + dio - dpo;
}

function fmtFcfAbs(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  return `${sign}$${abs.toFixed(0)}`;
}

export default function CashEfficiencyChart({ data }: Props) {
  const rows = data.periods.slice(0, 4).map(p => {
    const shares = p.sharesOutstanding && p.sharesOutstanding > 1e6 ? p.sharesOutstanding : null;
    return {
      label: fmtPeriodLabel(p.endDate, data.frequency),
      fcfPerShare: (p.fcf != null && shares) ? p.fcf / shares : null,
      fcfAbs: p.fcf ?? null,
      ccc: cccDays(p),
    };
  }).reverse();

  const useFcfPerShare = rows.some(r => r.fcfPerShare != null);
  const fcfDataKey = useFcfPerShare ? "fcfPerShare" : "fcfAbs";
  const fcfLabel = useFcfPerShare ? "FCF/share" : "FCF (abs)";
  const cccAvailable = rows.some(r => r.ccc != null);
  const hasFcfData = rows.some(r => r.fcfPerShare != null || r.fcfAbs != null);

  // No useful data at all — don't render a blank chart
  if (!hasFcfData && !cccAvailable) return null;

  // Visual insight: FCF trend
  const insight = (() => {
    const fcfVals = data.periods.slice(0, 4).map(p => p.fcf).filter((v): v is number => v != null);
    if (fcfVals.length < 2) return null;
    const allPos = fcfVals.every(v => v > 0);
    const trending = fcfVals[0] > fcfVals[fcfVals.length - 1];
    if (allPos && trending)
      return { text: "📈 VISUAL INSIGHT: FCF consistently positive and in uptrend — strong cash generation 🟢", color: "text-emerald-400" };
    if (fcfVals[0] < 0)
      return { text: "⚠️ VISUAL INSIGHT: Negative FCF this period — monitor cash burn 🔴", color: "text-rose-400" };
    return null;
  })();

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-neutral-400">
          Cash Flow &amp; Efficiency
        </div>
        {!cccAvailable && (
          <div className="text-[10px] text-neutral-500">CCC unavailable for this reporter</div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={rows} margin={{ top: 10, right: 40, left: 10, bottom: 0 }}>
          <CartesianGrid stroke="#262626" strokeDasharray="2 2" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#a3a3a3" }} />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 10, fill: "#a3a3a3" }}
            tickFormatter={(v: number) => useFcfPerShare ? `$${v?.toFixed(2)}` : fmtFcfAbs(v)}
          />
          <YAxis yAxisId="right" orientation="right" reversed
                 tick={{ fontSize: 10, fill: "#a3a3a3" }}
                 label={{ value: "↓ days = better", angle: 90, position: "insideRight", fill: "#a3a3a3", fontSize: 9 }} />
          <Tooltip
            contentStyle={{ background: "#171717", border: "1px solid #404040", fontSize: 11 }}
            formatter={(value: unknown, name: string) => {
              const n = value as number;
              if (name === "CCC Days") return [`${n?.toFixed(0)} d`, name];
              return useFcfPerShare ? [`$${n?.toFixed(2)}`, name] : [fmtFcfAbs(n), name];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar yAxisId="left" dataKey={fcfDataKey} name={fcfLabel}>
            {rows.map((r, i) => (
              <Cell key={i} fill={((useFcfPerShare ? r.fcfPerShare : r.fcfAbs) ?? 0) >= 0 ? "#10b981" : "#f43f5e"} />
            ))}
          </Bar>
          {cccAvailable && (
            <Line yAxisId="right" dataKey="ccc" name="CCC Days"
                  stroke="#d97706" strokeWidth={2} dot={{ r: 3 }} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      {insight && <p className={`mt-2 text-[10px] font-mono ${insight.color}`}>{insight.text}</p>}
    </div>
  );
}
