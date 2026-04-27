'use client';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown'; // Install with npm i react-markdown if you want, or use dangerouslySetInnerHTML with marked

interface Props {
  ticker: string;
}

export default function FundamentalReport({ ticker }: Props) {
  const [report, setReport] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchReport = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/fundamental', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker }),
      });
      const json = await res.json();
      if (json.error) setError(json.error);
      else setReport(json.report);
    } catch {
      setError('Failed to fetch report');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <button
        onClick={fetchReport}
        disabled={loading}
        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
      >
        {loading ? 'Generating...' : 'Generate Fundamental Report'}
      </button>
      {error && <p className="text-red-600 mt-2">{error}</p>}
      {report && (
        <div className="mt-4 prose max-w-none">
          <ReactMarkdown>{report}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
