'use client';
import { useState } from 'react';

interface Props {
  ticker: string;
}

interface PromptsData {
  ticker: string;
  deepDivePrompt: string;
  peerComparisonPrompt: string;
  bearCasePrompt: string;
  fetchedAt: string;
}

export default function FundamentalReport({ ticker }: Props) {
  const [prompts, setPrompts] = useState<PromptsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const fetchPrompts = async () => {
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
      else setPrompts(json.prompts);
    } catch {
      setError('Failed to fetch prompts');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    }
  };

  // Build combined prompt when prompts are available
  const combinedPrompt = prompts
    ? `You are a fundamental analyst. Generate the following three reports for ${prompts.ticker}:

--- DEEP DIVE ---
${prompts.deepDivePrompt}

--- PEER COMPARISON ---
${prompts.peerComparisonPrompt}

--- BEAR CASE ---
${prompts.bearCasePrompt}

Produce all three reports in order, separated by clear headings (e.g., "# Deep Dive", "# Peer Comparison", "# Bear Case").`
    : '';

  return (
    <div className="p-4 space-y-4">
      <button
        onClick={fetchPrompts}
        disabled={loading}
        className="bg-[#00d4ff]/10 border border-[#00d4ff]/40 text-[#00d4ff] px-4 py-2 rounded text-sm font-bold hover:bg-[#00d4ff]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
      >
        {loading ? '⏳ Fetching data...' : '📋 Generate Prompts'}
      </button>

      {error && <p className="text-[#ff4757] text-xs">{error}</p>}

      {prompts && (
        <div className="space-y-4">
          <p className="text-[#4a6080] text-xs">
            Data fetched at {new Date(prompts.fetchedAt).toLocaleString()}.
            Use the buttons below to copy individual prompts or the combined prompt.
            Paste into{' '}
            <a
              href="https://chat.deepseek.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#00d4ff] underline hover:text-[#00ff88]"
            >
              chat.deepseek.com
            </a>
            {' '}(free).
          </p>

          {/* Combined Copy Button – most convenient */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => copyToClipboard(combinedPrompt, 'combined')}
              className={`text-xs px-4 py-2 rounded border font-bold transition-all ${
                copied === 'combined'
                  ? 'border-[#00ff88] text-[#00ff88] bg-[#00ff88]/10'
                  : 'border-[#00d4ff] text-[#00d4ff] bg-[#00d4ff]/10 hover:bg-[#00d4ff]/20'
              }`}
            >
              {copied === 'combined' ? '✅ Copied!' : '📋 Copy Combined Prompt (All 3 Reports)'}
            </button>
            <span className="text-[#4a6080] text-xs">
              ({combinedPrompt.length.toLocaleString()} chars)
            </span>
          </div>

          <p className="text-[#4a6080] text-xs">
            After copying, run your macOS shortcut (⌘⇧D) to send directly to DeepSeek.
          </p>

          {/* Individual prompts – still available */}
          <details className="border border-[#1e2d4a] rounded" open>
            <summary className="cursor-pointer px-3 py-2 text-sm font-bold text-[#c8d8f0] hover:text-[#00d4ff] transition-colors bg-[#0f1629]">
              Individual Prompts
            </summary>
            <div className="p-3 space-y-4">
              <PromptBlock
                title="🧠 Deep Dive"
                prompt={prompts.deepDivePrompt}
                copied={copied}
                onCopy={copyToClipboard}
                index={1}
              />
              <PromptBlock
                title="📊 Peer Comparison"
                prompt={prompts.peerComparisonPrompt}
                copied={copied}
                onCopy={copyToClipboard}
                index={2}
              />
              <PromptBlock
                title="🐻 Bear Case"
                prompt={prompts.bearCasePrompt}
                copied={copied}
                onCopy={copyToClipboard}
                index={3}
              />
            </div>
          </details>
        </div>
      )}

      {!prompts && !loading && !error && (
        <p className="text-[#4a6080] text-xs">Click the button to generate research prompts for {ticker}.</p>
      )}
    </div>
  );
}

function PromptBlock({
  title,
  prompt,
  copied,
  onCopy,
  index,
}: {
  title: string;
  prompt: string;
  copied: string | null;
  onCopy: (text: string, label: string) => void;
  index: number;
}) {
  const label = `prompt-${index}`;
  const charCount = prompt.length;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-[#c8d8f0]">
        {title} <span className="text-[#4a6080] font-normal">({charCount.toLocaleString()} chars)</span>
      </p>
      <pre className="text-xs text-[#c8d8f0] bg-[#0a0e1a] p-3 rounded border border-[#1e2d4a] overflow-auto max-h-48 whitespace-pre-wrap">
        {prompt}
      </pre>
      <button
        onClick={() => onCopy(prompt, label)}
        className={`text-xs px-3 py-1 rounded border transition-all ${
          copied === label
            ? 'border-[#00ff88] text-[#00ff88] bg-[#00ff88]/10'
            : 'border-[#1e2d4a] text-[#4a6080] hover:border-[#00d4ff] hover:text-[#00d4ff]'
        }`}
      >
        {copied === label ? '✅ Copied!' : '📋 Copy'}
      </button>
    </div>
  );
}
