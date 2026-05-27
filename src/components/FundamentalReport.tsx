// src/components/FundamentalReport.tsx
'use client';
import FundamentalCharts from './fundamental/FundamentalCharts';
import FundamentalPrompts from './fundamental/FundamentalPrompts';

interface Props { ticker: string; }

export default function FundamentalReport({ ticker }: Props) {
  return (
    <div className="p-4 space-y-6">
      <FundamentalCharts ticker={ticker} />
      <div className="border-t border-neutral-800 pt-4">
        <FundamentalPrompts ticker={ticker} />
      </div>
    </div>
  );
}
