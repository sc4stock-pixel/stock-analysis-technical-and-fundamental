// src/components/fundamental/GrowthLeverageChart.tsx
'use client';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid, LabelList,
} from 'recharts';
import type { FundamentalsPayload } from '../../app/api/fundamentals/route';
import { fmtPeriodLabel, fmtMoney } from './format';

interface Props { data: FundamentalsPayload; }

export default function GrowthLeverageChart({ data }: Props) {
  const rows = data.periods.slice(0, 4).map(p => ({
    label: fmtPeriodLabel(p.endDate, data.frequency),
    revenue: p.revenue ?? null,
    netIncome: p.netIncome ?? null,
    gmPct: p.revenue && p.grossProfit ? (p.grossProfit / p.revenue) * 100 : null,
    omPct: p.revenue && p.operatingIncome ? (p.operatingIncome / p.revenue) * 100 : null,
  })).reverse();

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/40 p-3">
      <div className="mb-2 text-xs uppercase tracking-wider text-neutral-400">
        Growth &amp; Operating Leverage
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={rows} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#262626" strokeDasharray="2 2" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#a3a3a3" }} />
          <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "#a3a3a3" }} tickFormatter={(v) => fmtMoney(v)} />
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: "#a3a3a3" }} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
          <Tooltip
            contentStyle={{ background: "#171717", border: "1px solid #404040", fontSize: 11 }}
            formatter={(value: unknown, name: string) => {
              const n = value as number;
              return name.includes("Margin") ? [`${n?.toFixed(1)}%`, name] : [fmtMoney(n), name];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar yAxisId="left" dataKey="revenue"   name="Revenue"    fill="#2563eb" />
          <Bar yAxisId="left" dataKey="netIncome" name="Net Income" fill="#93c5fd" />
          <Line yAxisId="right" dataKey="gmPct" name="Gross Margin" stroke="#b45309" strokeWidth={1.5} dot={false}>
            <LabelList dataKey="gmPct" position="top" formatter={(v: unknown) => { const n = v as number; return n != null ? `${n.toFixed(0)}%` : ""; }} style={{ fontSize: 9, fill: "#b45309" }} />
          </Line>
          <Line yAxisId="right" dataKey="omPct" name="Operating Margin" stroke="#d97706" strokeWidth={2.5} dot={{ r: 3 }}>
            <LabelList dataKey="omPct" position="top" formatter={(v: unknown) => { const n = v as number; return n != null ? `${n.toFixed(0)}%` : ""; }} style={{ fontSize: 9, fill: "#d97706" }} />
          </Line>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
