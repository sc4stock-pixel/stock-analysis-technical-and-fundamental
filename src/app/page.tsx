"use client";
import { useState, useCallback } from "react";
import { AppConfig, PortfolioResponse, StockAnalysisResult } from "@/types";
import { MacroData, mbsScoreAdjustment } from "@/lib/macro";
import { DEFAULT_CONFIG } from "@/lib/config";
import ConfigPanel from "@/components/ConfigPanel";
import PortfolioSummaryBar from "@/components/PortfolioSummaryBar";
import StockCard from "@/components/StockCard";
import MacroPanel from "@/components/MacroPanel";

// ─── helpers ───────────────────────────────────────────────
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

// ─── component ─────────────────────────────────────────────
export default function Home() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [results, setResults] = useState<StockAnalysisResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [macroData, setMacroData] = useState<MacroData | null>(null);
  const [macroLoading, setMacroLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [analysisTimestamp, setAnalysisTimestamp] = useState<string | null>(null);

  // ── Macro fetch ──────────────────────────────────────────
  const fetchMacro = useCallback(async () => {
    if (!config.macro.enabled) return null;
    setMacroLoading(true);
    try {
      const res = await fetch("/api/macro");
      if (!res.ok) throw new Error(`Macro API ${res.status}`);
      const data: MacroData = await res.json();
      setMacroData(data);
      return data;
    } catch (e) {
      console.warn("Macro fetch failed:", e);
      return null;
    } finally {
      setMacroLoading(false);
    }
  }, [config.macro.enabled]);

  // ── Main analysis run ────────────────────────────────────
  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch macro and stock data in parallel
      const [macroResult, portfolioRes] = await Promise.all([
        fetchMacro(),
        fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
        }),
      ]);

      if (!portfolioRes.ok) {
        const errJson = await portfolioRes.json().catch(() => ({}));
        throw new Error(errJson.error || `Analysis failed: ${portfolioRes.status}`);
      }

      const data: PortfolioResponse = await portfolioRes.json();
      let adjusted = data.results;

      // Apply macro adjustment to SCR scores if enabled
      if (macroResult && config.macro.enabled) {
        adjusted = applyMacroAdjustment(
          data.results,
          macroResult.mbs,
          config.macro.applyToScore,
        );
      }

      setResults(adjusted);
      setAnalysisTimestamp(data.timestamp ?? new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [config, fetchMacro]);

  // ── Macro refresh (standalone, no re-analysis) ───────────
  const refreshMacro = useCallback(async () => {
    const macroResult = await fetchMacro();
    if (macroResult && results.length > 0 && config.macro.enabled) {
      setResults(prev =>
        applyMacroAdjustment(prev, macroResult.mbs, config.macro.applyToScore)
      );
    }
  }, [fetchMacro, results.length, config.macro]);

  // ── Sorted results ───────────────────────────────────────
  const sortedResults = [...results].sort((a, b) => b.score - a.score);

  return (
    <div className="min-h-screen bg-[#040810] text-[#c8d8f0]">

      {/* ── Top bar ── */}
      <div className="border-b border-[#1e2d4a] bg-[#060c18]">
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-3">
            <span className="text-[#00d4ff] font-bold tracking-widest text-sm">📊 TRADING TA DASHBOARD</span>
            <span className="text-[#1e2d4a] text-xs">v15.1</span>
            {analysisTimestamp && (
              <span className="text-[#2a3d5a] text-xs font-mono">
                {new Date(analysisTimestamp).toLocaleTimeString()}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {config.macro.enabled && (
              <span className={`text-[0.6rem] font-mono px-2 py-0.5 rounded border ${
                macroData
                  ? macroData.mbs >= 7 ? "text-[#00ff88] border-[#00ff88]/30 bg-[#00ff88]/5"
                    : macroData.mbs >= 5.5 ? "text-[#ffa502] border-[#ffa502]/30 bg-[#ffa502]/5"
                    : "text-[#ff4757] border-[#ff4757]/30 bg-[#ff4757]/5"
                  : "text-[#4a6080] border-[#1e2d4a]"
              }`}>
                {macroData ? `MBS ${macroData.mbs.toFixed(1)}` : macroLoading ? "MBS…" : "MBS —"}
              </span>
            )}
            <button
              onClick={() => setShowConfig(v => !v)}
              className={`text-xs font-mono px-3 py-1.5 rounded border transition-colors ${
                showConfig
                  ? "bg-[#00d4ff]/10 border-[#00d4ff]/50 text-[#00d4ff]"
                  : "bg-transparent border-[#1e2d4a] text-[#4a6080] hover:text-[#c8d8f0]"
              }`}
            >
              ⚙ CONFIG
            </button>
            <button
              onClick={runAnalysis}
              disabled={loading}
              className={`text-xs font-mono px-4 py-1.5 rounded border font-bold transition-colors ${
                loading
                  ? "border-[#1e2d4a] text-[#4a6080] cursor-not-allowed"
                  : "border-[#00d4ff]/50 text-[#00d4ff] bg-[#00d4ff]/10 hover:bg-[#00d4ff]/20"
              }`}
            >
              {loading ? "ANALYZING…" : "▶ RUN ANALYSIS"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Config panel ── */}
      {showConfig && (
        <div className="px-4 py-3 border-b border-[#1e2d4a] bg-[#060c18]">
          <ConfigPanel config={config} onChange={setConfig} />
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="mx-4 mt-3 px-3 py-2 bg-[#ff4757]/10 border border-[#ff4757]/30 rounded text-xs text-[#ff4757] font-mono">
          ⚠ {error}
        </div>
      )}

      {/* ── Macro Intelligence Panel ── */}
      {config.macro.enabled && (macroData || macroLoading) && (
        <MacroPanel
          data={macroData}
          loading={macroLoading}
          onRefresh={refreshMacro}
        />
      )}

      {/* ── Portfolio summary bar ── */}
      {results.length > 0 && (
        <PortfolioSummaryBar results={sortedResults} config={config} />
      )}

      {/* ── Stock cards ── */}
      <div className="px-4 py-3 space-y-3">
        {loading && results.length === 0 && (
          <div className="text-center text-[#4a6080] text-xs font-mono py-12 animate-pulse">
            RUNNING ANALYSIS…
          </div>
        )}

        {!loading && results.length === 0 && (
          <div className="text-center text-[#2a3d5a] text-xs font-mono py-12">
            Press RUN ANALYSIS to begin
          </div>
        )}

        {sortedResults.map(result => (
          <StockCard
            key={result.symbol}
            result={result}
            config={config}
          />
        ))}
      </div>

      {/* ── Footer ── */}
      <div className="border-t border-[#1e2d4a] mt-6 px-4 py-3 text-center text-[#2a3d5a] text-[0.6rem] font-mono">
        trading-ta-dashboard v15.1 · MacroEngine · SuperTrend · Score Alpha · Not financial advice
      </div>
    </div>
  );
}
