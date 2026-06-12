"use client";
import { useState, useCallback } from "react";

interface DigestData { prompt: string; fetchedAt: string; dataAsOf: string | null; }

export default function DigestPrompt() {
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<DigestData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/digest-prompt", { cache: "no-store" });
      const json = await res.json();
      if (json.error) setError(json.error);
      else setData(json);
    } catch {
      setError("Failed to load digest prompt");
    } finally {
      setLoading(false);
    }
  }, []);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !data && !loading) void load();
  };

  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = data.prompt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="mb-4 rounded-lg border border-[#00d4ff]/35 bg-[#0f172a] overflow-hidden">
      <button onClick={toggle}
        className="w-full flex items-center justify-between px-4 py-3 bg-[#00d4ff]/[0.04] text-left">
        <div className="flex items-center gap-2">
          <span className="text-[#00d4ff] text-sm font-bold">📋 Daily Digest</span>
          <span className="text-[#4a6080] text-xs">— copy into DeepSeek / Gemini</span>
        </div>
        <span className="text-[#00d4ff] text-xs">{expanded ? "▲ Hide" : "▼ Show"}</span>
      </button>
      {expanded && (
        <div className="p-3 border-t border-[#00d4ff]/15">
          <div className="flex items-center justify-end gap-3 mb-2">
            <span className="text-[#4a6080] text-[11px] font-mono">
              {data?.dataAsOf ? `Data as of ${data.dataAsOf}` : loading ? "Loading…" : ""}
            </span>
            <button onClick={load} disabled={loading}
              className="text-[#00d4ff] text-[11px] border border-[#00d4ff]/40 bg-[#00d4ff]/10 px-2 py-1 rounded disabled:opacity-40">
              {loading ? "⏳" : "↻ Refresh"}
            </button>
          </div>
          {error && <p className="text-[#ff4757] text-xs mb-2">{error}</p>}
          {data && (
            <div className="relative">
              <pre className="max-h-[230px] overflow-auto bg-[#0a0e1a] border border-[#4a6080]/30 rounded-md p-3 text-[#8aa0bd] font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap">
                {data.prompt}
              </pre>
              <button onClick={copy}
                className="absolute top-2 right-2 bg-[#00d4ff] text-[#06202b] text-xs font-bold px-3 py-1.5 rounded">
                {copied ? "✓ Copied" : "📋 Copy prompt"}
              </button>
            </div>
          )}
          <div className="flex items-center gap-4 mt-3 pl-1">
            <span className="text-[#4a6080] text-[11px]">Paste into:</span>
            <a href="https://chat.deepseek.com" target="_blank" rel="noopener noreferrer" className="text-[#00d4ff] text-xs underline">chat.deepseek.com</a>
            <a href="https://gemini.google.com" target="_blank" rel="noopener noreferrer" className="text-[#00d4ff] text-xs underline">gemini.google.com</a>
          </div>
        </div>
      )}
    </div>
  );
}
