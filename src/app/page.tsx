"use client";
import { useState, useCallback, useRef, useEffect } from "react";
import { AppConfig, StockAnalysisResult } from "@/types";
import { MacroData, mbsScoreAdjustment } from "@/lib/macro-types";
import { DEFAULT_CONFIG } from "@/lib/config";
import ConfigPanel from "@/components/ConfigPanel";
import PortfolioSummaryBar from "@/components/PortfolioSummaryBar";
import StockCard from "@/components/StockCard";

// Dynamic import avoids any server/client boundary issues with MacroPanel
import dynamic from "next/dynamic";
const MacroPanel = dynamic(() => import("@/components/MacroPanel"), { ssr: false });

// ── helpers ──────────────────────────────────────────────────
function applyMacroAdjustment(
  results: StockAnalysisResult[],
  mbs: number,
  applyToScore: boolean,
): StockAnalysisResult[] {
  if (!applyToScore) return results.map(r => ({ ...r, macro_adjustment: 0 }));
  const adj = mbsScoreAdjustment(mbs);
  return results.map(r => ({
    ...r,
    score: Math.max(0, Math.min(10, r.score + adj)),
    macro_adjustment: adj,
  }));
}

export default function Dashboard() {
  const [config, setConfig]           = useState<AppConfig>(DEFAULT_CONFIG);
  const [results, setResults]         = useState<StockAnalysisResult[]>([]);
  const [loading, setLoading]         = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [progress, setProgress]       = useState(0);
  const [progressSymbol, setProgressSymbol] = useState("");
  const [showConfig, setShowConfig]   = useState(false);
  const [highlightedSymbol, setHighlightedSymbol] = useState<string | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [macroData, setMacroData]     = useState<MacroData | null>(null);
  const [macroLoading, setMacroLoading] = useState(false);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Scroll-to-top ─────────────────────────────────────────
  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 300);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // ── Macro fetch ──────────────────────────────────────────
  const fetchMacro = useCallback(async (): Promise<MacroData | null> => {
    if (!config.macro?.enabled) return null;
    setMacroLoading(true);
    try {
      const res = await fetch("/api/macro");
      if (!res.ok) throw new Error(`Macro API ${res.status}`);
      const data = await res.json() as MacroData;
      setMacroData(data);
      return data;
    } catch (e) {
      console.warn("Macro fetch failed:", e);
      return null;
    } finally {
      setMacroLoading(false);
    }
  }, [config.macro?.enabled]);

  // ── Macro refresh (standalone) ───────────────────────────
  const refreshMacro = useCallback(async () => {
    const macroResult = await fetchMacro();
    if (macroResult && results.length > 0 && config.macro?.enabled) {
      setResults(prev =>
        applyMacroAdjustment(prev, macroResult.mbs, config.macro?.applyToScore ?? false)
      );
    }
  }, [fetchMacro, results.length, config.macro]);

  // ── Main analysis run ────────────────────────────────────
  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setProgress(0);
    setProgressSymbol("");
    setResults([]);
    setHighlightedSymbol(null);

    // Kick off macro fetch in background (non-blocking)
    const macroPromise = fetchMacro();

    const portfolio = config.stocks.PORTFOLIO;
    const allResults: StockAnalysisResult[] = [];

    for (let i = 0; i < portfolio.length; i++) {
      const stock = portfolio[i];
      setProgressSymbol(stock.symbol);
      try {
        const res = await fetch("/api/stocks", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ symbol: stock.symbol, config }),
        });
        if (res.ok) {
          const data = await res.json() as StockAnalysisResult;
          allResults.push(data);
          setResults([...allResults]);
        }
      } catch (e) {
        console.error(`Error fetching ${stock.symbol}:`, e);
      }
      setProgress(Math.round(((i + 1) / portfolio.length) * 100));
    }

    // Apply macro adjustment once both complete
    const macroResult = await macroPromise;
    if (macroResult && config.macro?.enabled) {
      const adjusted = applyMacroAdjustment(
        allResults,
        macroResult.mbs,
        config.macro?.applyToScore ?? false,
      );
      setResults(adjusted);
    }

    setLastUpdated(new Date().toLocaleTimeString());
    setProgressSymbol("");
    setLoading(false);
  }, [config, fetchMacro]);

  // ── Scroll to card ───────────────────────────────────────
  const scrollToCard = useCallback((symbol: string) => {
    const id = `card-${symbol.replace(/\./g, "-")}`;
    const el = document.getElementById(id);
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - 64;
    window.scrollTo({ top: y, behavior: "smooth" });
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    setHighlightedSymbol(symbol);
    highlightTimer.current = setTimeout(() => setHighlightedSymbol(null), 2000);
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0e1a]">

      {/* ── TOP BAR ── */}
      <header className="border-b border-[#1e2d4a] bg-[#0f1629] px-4 py-2.5 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <span className="text-[#00d4ff] font-bold text-sm tracking-widest">▶ TA DASHBOARD</span>
          <span className="text-[#4a6080] text-xs">V15</span>
          {lastUpdated && <span className="text-[#4a6080] text-xs">· Updated {lastUpdated}</span>}
          {loading && (
            <span className="text-[#ffa502] text-xs blink">
              · {progressSymbol ? `Scanning ${progressSymbol}…` : "Scanning…"} {progress}%
            </span>
          )}
          {/* MBS badge */}
          {config.macro?.enabled && (
            <span className={`text-[0.6rem] font-mono px-2 py-0.5 rounded border transition-colors ${
              macroData
                ? macroData.mbs >= 7   ? "text-[#00ff88] border-[#00ff88]/30 bg-[#00ff88]/5"
                : macroData.mbs >= 5.5 ? "text-[#ffa502] border-[#ffa502]/30 bg-[#ffa502]/5"
                :                        "text-[#ff4757] border-[#ff4757]/30 bg-[#ff4757]/5"
                : "text-[#4a6080] border-[#1e2d4a]"
            }`}>
              {macroData ? `MBS ${macroData.mbs.toFixed(1)}` : macroLoading ? "MBS…" : "🌐 MBS"}
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

      {/* ── MACRO INTELLIGENCE PANEL ── */}
      {config.macro?.enabled && (macroData !== null || macroLoading) && (
        <div className="border-b border-[#1e2d4a]">
          <MacroPanel
            data={macroData}
            loading={macroLoading}
            onRefresh={refreshMacro}
          />
        </div>
      )}

      {/* ── PORTFOLIO SUMMARY TABLE ── */}
      {results.length > 0 && (
        <div className="border-b border-[#1e2d4a]">
          <PortfolioSummaryBar
            results={results}
            onRowClick={scrollToCard}
          />
        </div>
      )}

      {/* ── STOCK CARDS ── */}
      <main className="p-4">
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

        {results.length > 0 && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {results.map((result) => {
              const cardId = `card-${result.symbol.replace(/\./g, "-")}`;
              const isHighlighted = highlightedSymbol === result.symbol;
              return (
                <div
                  key={result.symbol}
                  id={cardId}
                  className={`rounded-md transition-all duration-300 ${
                    isHighlighted
                      ? "ring-2 ring-[#00d4ff] ring-offset-2 ring-offset-[#0a0e1a] shadow-[0_0_20px_rgba(0,212,255,0.25)]"
                      : ""
                  }`}
                >
                  <StockCard result={result} config={config} />
                </div>
              );
            })}
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

      {/* ── SCROLL TO TOP ── */}
      <button
        onClick={scrollToTop}
        aria-label="Scroll to top"
        style={{
          position: "fixed", bottom: 30, right: 30,
          width: 44, height: 44, borderRadius: "50%",
          background: "linear-gradient(135deg, #00d4ff 0%, #0099cc 100%)",
          border: "none", cursor: "pointer", zIndex: 9999,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 18, color: "#0a0e1a", fontWeight: "bold",
          boxShadow: "0 4px 16px rgba(0,212,255,0.4)",
          opacity: showScrollTop ? 1 : 0,
          pointerEvents: showScrollTop ? "auto" : "none",
          transform: showScrollTop ? "scale(1)" : "scale(0.8)",
          transition: "opacity 0.25s ease, transform 0.25s ease, box-shadow 0.2s ease",
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.12)";
          (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 6px 24px rgba(0,212,255,0.6)";
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.transform = showScrollTop ? "scale(1)" : "scale(0.8)";
          (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 16px rgba(0,212,255,0.4)";
        }}
      >
        ↑
      </button>

    </div>
  );
}
