"use client";
import { useState, useCallback } from "react";
import { DEFAULT_CONFIG } from "@/lib/config";
import { AppConfig, StockAnalysisResult } from "@/types";
import ConfigPanel from "@/components/ConfigPanel";
import PortfolioSummaryBar from "@/components/PortfolioSummaryBar";
import StockCard from "@/components/StockCard";

export default function Dashboard() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [results, setResults] = useState<StockAnalysisResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressSymbol, setProgressSymbol] = useState("");
  const [showConfig, setShowConfig] = useState(false);

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setProgress(0);
    setProgressSymbol("");
    setResults([]);

    const portfolio = config.stocks.PORTFOLIO;
    const allResults: StockAnalysisResult[] = [];

    for (let i = 0; i < portfolio.length; i++) {
      const stock = portfolio[i];
      setProgressSymbol(stock.symbol);
      try {
        const res = await fetch("/api/stocks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: stock.symbol, config }),
        });
        if (res.ok) {
          const data = await res.json();
          allResults.push(data);
          setResults([...allResults]);
        }
      } catch (e) {
        console.error(`Error fetching ${stock.symbol}:`, e);
      }
      setProgress(Math.round(((i + 1) / portfolio.length) * 100));
    }

    setLastUpdated(new Date().toLocaleTimeString());
    setProgressSymbol("");
    setLoading(false);
  }, [config]);

  return (
    <div className="min-h-screen bg-[#0a0e1a]">

      {/* ── TOP BAR ── */}
      <header className="border-b border-[#1e2d4a] bg-[#0f1629] px-4 py-2.5 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <span className="text-[#00d4ff] font-bold text-sm tracking-widest">▶ TA DASHBOARD</span>
          <span className="text-[#4a6080] text-xs">V12.5.6</span>
          {lastUpdated && <span className="text-[#4a6080] text-xs">· Updated {lastUpdated}</span>}
          {loading && (
            <span className="text-[#ffa502] text-xs blink">
              · {progressSymbol ? `Scanning ${progressSymbol}…` : `Scanning…`} {progress}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="px-3 py-1.5 text-xs border border-[#1e2d4a] text-[#6b85a0] hover:border-[#00d4ff] hover:text-[#00d4ff] rounded transition-all"
          >
            {showConfig ? "▲ HIDE CONFIG" : "▼ CONFIG"}
          </button>
          <button
            onClick={runAnalysis}
            disabled={loading}
            className="px-4 py-1.5 text-xs font-bold bg-[#00d4ff]/10 border border-[#00d4ff]/40 text-[#00d4ff] hover:bg-[#00d4ff]/20 disabled:opacity-40 disabled:cursor-not-allowed rounded transition-all"
          >
            {loading ? `SCANNING… ${progress}%` : "▶ RUN ANALYSIS"}
          </button>
        </div>
      </header>

      {/* ── CONFIG PANEL ── */}
      {showConfig && (
        <div className="border-b border-[#1e2d4a] bg-[#0a0e1a]">
          <ConfigPanel config={config} onChange={setConfig} />
        </div>
      )}

      {/* ── PORTFOLIO SUMMARY + SORTABLE TABLE ──
           Renders as soon as the first stock completes.
           The table IS the summary — it shows signals, regime, score,
           fundamentals and all backtest metrics in one sortable view. ── */}
      {results.length > 0 && (
        <div className="border-b border-[#1e2d4a]">
          <PortfolioSummaryBar
            results={results}
            onSymbolClick={(symbol) => {
              const el = document.getElementById(`card-${symbol}`);
              if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "start" });
                // Brief highlight flash
                el.classList.add("ring-2", "ring-[#00d4ff]", "ring-opacity-60", "rounded-lg");
                setTimeout(() => el.classList.remove("ring-2", "ring-[#00d4ff]", "ring-opacity-60", "rounded-lg"), 1500);
              }
            }}
          />
        </div>
      )}

      {/* ── STOCK CARDS ── */}
      <main className="p-4">

        {/* Skeleton while loading and no results yet */}
        {loading && results.length === 0 && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {config.stocks.PORTFOLIO.map((s) => (
              <div key={s.symbol} className="card p-4 h-48 animate-pulse">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-4 w-16 bg-[#1e2d4a] rounded" />
                  <div className="h-4 w-24 bg-[#1e2d4a] rounded" />
                </div>
                <div className="space-y-2">
                  <div className="h-3 w-full bg-[#1e2d4a] rounded" />
                  <div className="h-3 w-3/4 bg-[#1e2d4a] rounded" />
                  <div className="h-3 w-1/2 bg-[#1e2d4a] rounded" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Live results grid — streams in stock-by-stock */}
        {results.length > 0 && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {results.map((result) => (
              <div id={`card-${result.symbol}`} className="scroll-mt-16">
                <StockCard key={result.symbol} result={result} config={config} />
              </div>
            ))}
            {/* Skeleton placeholders for stocks still loading */}
            {loading && config.stocks.PORTFOLIO
              .filter(s => !results.some(r => r.symbol === s.symbol))
              .map(s => (
                <div key={s.symbol} className="card p-4 h-48 animate-pulse">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="h-4 w-16 bg-[#1e2d4a] rounded" />
                    <span className="text-[#4a6080] text-xs">{s.symbol}</span>
                  </div>
                  <div className="space-y-2">
                    <div className="h-3 w-full bg-[#1e2d4a] rounded" />
                    <div className="h-3 w-2/3 bg-[#1e2d4a] rounded" />
                  </div>
                  <div className="text-[#ffa502] text-xs mt-3 blink">scanning…</div>
                </div>
              ))
            }
          </div>
        )}

        {/* Empty state */}
        {!loading && results.length === 0 && (
          <div className="flex flex-col items-center justify-center h-96 text-[#4a6080]">
            <div className="text-4xl mb-4 opacity-20">◈</div>
            <div className="text-sm mb-1">No analysis running</div>
            <div className="text-xs mb-4">Click ▶ RUN ANALYSIS to scan your portfolio</div>
            <button
              onClick={runAnalysis}
              className="px-6 py-2 text-sm font-bold bg-[#00d4ff]/10 border border-[#00d4ff]/40 text-[#00d4ff] hover:bg-[#00d4ff]/20 rounded transition-all"
            >
              ▶ RUN ANALYSIS
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
