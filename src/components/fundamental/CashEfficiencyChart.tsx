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

export default function CashEfficiencyChart({ data }: Props) {
  const rows = data.periods.slice(0, 4).map(p => {
    const shares = p.sharesOutstanding && p.sharesOutstanding > 1e6 ? p.sharesOutstanding : null;
    return {
      label: fmtPeriodLabel(p.endDate, data.frequency),
      fcfPerShare: (p.fcf != null && shares) ? p.fcf / shares : null,
      ccc: cccDays(p),
    };
  }).reverse();

  const cccAvailable = rows.some(r => r.ccc != null);

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
        <ComposedChart data={rows} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#262626" strokeDasharray="2 2" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#a3a3a3" }} />
          <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "#a3a3a3" }} tickFormatter={(v: number) => `$${v?.toFixed(2)}`} />
          <YAxis yAxisId="right" orientation="right" reversed
                 tick={{ fontSize: 10, fill: "#a3a3a3" }}
                 label={{ value: "↓ days = better", angle: 90, position: "insideRight", fill: "#a3a3a3", fontSize: 9 }} />
          <Tooltip
            contentStyle={{ background: "#171717", border: "1px solid #404040", fontSize: 11 }}
            formatter={(value: unknown, name: string) => {
              const n = value as number;
              return name === "CCC Days" ? [`${n?.toFixed(0)} d`, name] : [`$${n?.toFixed(2)}`, name];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar yAxisId="left" dataKey="fcfPerShare" name="FCF/share">
            {rows.map((r, i) => (
              <Cell key={i} fill={(r.fcfPerShare ?? 0) >= 0 ? "#10b981" : "#f43f5e"} />
            ))}
          </Bar>
          {cccAvailable && (
            <Line yAxisId="right" dataKey="ccc" name="CCC Days"
                  stroke="#d97706" strokeWidth={2} dot={{ r: 3 }} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
