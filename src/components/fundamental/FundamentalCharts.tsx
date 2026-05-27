// src/components/fundamental/FundamentalCharts.tsx
'use client';
import { useEffect, useState } from 'react';
import type { FundamentalsPayload } from '../../app/api/fundamentals/route';
import KpiStrip from './KpiStrip';
import GrowthLeverageChart from './GrowthLeverageChart';
import CashEfficiencyChart from './CashEfficiencyChart';
import QualityScorecards from './QualityScorecards';

interface Props { ticker: string; }

export default function FundamentalCharts({ ticker }: Props) {
  const [data, setData] = useState<FundamentalsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(`/api/fundamentals?symbol=${encodeURIComponent(ticker)}`)
      .then(r => r.json())
      .then(json => {
        if (cancelled) return;
        if (json.error) setError(json.error);
        else setData(json.data);
      })
      .catch(() => { if (!cancelled) setError('Failed to load fundamentals'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker]);

  if (loading) {
    return <div className="text-xs text-neutral-500 p-3">Loading fundamentals…</div>;
  }
  if (error) {
    return <div className="text-xs text-rose-400 p-3">Fundamentals error: {error}</div>;
  }
  if (!data || data.periods.length === 0) {
    return (
      <div className="text-xs text-neutral-500 p-3">
        No fundamentals data for {ticker}. Cache may not yet include this symbol — try the LLM prompts below.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <KpiStrip data={data} />
      <GrowthLeverageChart data={data} />
      <CashEfficiencyChart data={data} />
      <QualityScorecards data={data} />
    </div>
  );
}
