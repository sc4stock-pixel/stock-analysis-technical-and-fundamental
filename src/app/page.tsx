"use client";
import { useState, useCallback, useRef, useEffect } from "react";
import { AppConfig, StockAnalysisResult } from "@/types";
import { MacroData, HKMacroData, mbsScoreAdjustment } from "@/lib/macro-types";
import { DEFAULT_CONFIG } from "@/lib/config";
import ConfigPanel from "@/components/ConfigPanel";
import PortfolioSummaryBar from "@/components/PortfolioSummaryBar";
import LegendDrawer from "@/components/LegendDrawer";
import InfoTooltip from "@/components/InfoTooltip";
import StockCard, { TABS, Tab } from "@/components/StockCard";
import dynamic from "next/dynamic";
import AlertsPanel from "@/components/AlertsPanel";
import DigestPrompt from "@/components/DigestPrompt";
import { UserButton } from "@clerk/nextjs";
import OpenPositionsPanel from "@/components/OpenPositionsPanel";
import NavPanel from "@/components/NavPanel";
import { fetchTimesfmForecasts } from "@/lib/timesfm";
import { fetchKronosForecasts } from "@/lib/kronos";
import { supertrend } from "@/lib/indicators";
import type { TimesfmForecasts, KronosForecasts } from "@/types";
import type { WorkerState } from "@/types/worker-state";

const MacroPanel   = dynamic(() => import("@/components/MacroPanel"),   { ssr: false });
const MacroPanelHK = dynamic(() => import("@/components/MacroPanelHK"), { ssr: false });

function applyDualMacroAdjustment(
  results: StockAnalysisResult[],
  usMbs:  number | null,
  hkMbs:  number | null,
  applyToScore: boolean,
): StockAnalysisResult[] {
  if (!applyToScore) return results.map(r => ({ ...r, macro_adjustment: 0 }));
  return results.map(r => {
    const isHK  = r.exchange === "HK";
    const mbs   = isHK ? hkMbs : usMbs;
    if (mbs === null) return { ...r, macro_adjustment: 0 };
    const adj = mbsScoreAdjustment(mbs);
    return {
      ...r,
      score: Math.max(0, Math.min(10, r.score + adj)),
      macro_adjustment: adj,
    };
  });
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

  const [macroData, setMacroData]       = useState<MacroData | null>(null);
  const [macroLoading, setMacroLoading] = useState(false);
  const [hkMacroData, setHKMacroData]       = useState<HKMacroData | null>(null);
  const [hkMacroLoading, setHKMacroLoading] = useState(false);
  const [timesfmData, setTimesfmData] = useState<TimesfmForecasts | null>(null);
  const [timesfmLoading, setTimesfmLoading] = useState(false);
  const [kronosData, setKronosData] = useState<KronosForecasts | null>(null);

  const [stOptimizing, setStOptimizing] = useState(false);
  // Global tab broadcast — null means each card uses its own state
  const [globalTab, setGlobalTab] = useState<Tab | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [stOptMsg, setStOptMsg]         = useState<string | null>(null);

  const [tgSending, setTgSending]   = useState(false);
  const [tgMsg, setTgMsg]           = useState<string | null>(null);

  const [savePortfolioLoading, setSavePortfolioLoading] = useState(false);
  const [savePortfolioMsg, setSavePortfolioMsg]         = useState<string | null>(null);
  const [backtestLoading, setBacktestLoading]           = useState(false);

  const [workerState, setWorkerState] = useState<WorkerState | null>(null);

  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load portfolio.json from GitHub on mount — restores any previously saved portfolio
  useEffect(() => {
    fetch(
      "https://raw.githubusercontent.com/sc4stock-pixel/stock-analysis-technical-and-fundamental/main/portfolio.json",
      { cache: "no-store" }
    )
      .then(r => r.ok ? r.json() : null)
      .then((data: { portfolio: AppConfig["stocks"]["PORTFOLIO"] } | null) => {
        if (data?.portfolio?.length) {
          setConfig(prev => ({ ...prev, stocks: { PORTFOLIO: data.portfolio } }));
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load worker KV state on mount — overlay for Autopilot signals + freshness badge
  useEffect(() => {
    fetch("/api/state")
      .then(r => r.ok ? r.json() : null)
      .then((data: WorkerState | null) => { if (data?.version != null) setWorkerState(data); })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 300);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToTop = useCallback(() => window.scrollTo({ top: 0, behavior: "smooth" }), []);

  const fetchUSMacro = useCallback(async (): Promise<MacroData | null> => {
    if (!config.macro?.enabled) return null;
    setMacroLoading(true);
    try {
      const res = await fetch("/api/macro");
      if (!res.ok) throw new Error(`US Macro ${res.status}`);
      const data = await res.json() as MacroData;
      setMacroData(data);
      return data;
    } catch (e) {
      console.warn("US Macro fetch failed:", e);
      return null;
    } finally {
      setMacroLoading(false);
    }
  }, [config.macro?.enabled]);

  const fetchHKMacro = useCallback(async (): Promise<HKMacroData | null> => {
    if (!config.macro?.enabled) return null;
    const hasHK = config.stocks.PORTFOLIO.some(s => s.exchange === "HK");
    if (!hasHK) return null;
    setHKMacroLoading(true);
    try {
      const res = await fetch("/api/macro-hk");
      if (!res.ok) throw new Error(`HK Macro ${res.status}`);
      const data = await res.json() as HKMacroData;
      setHKMacroData(data);
      return data;
    } catch (e) {
      console.warn("HK Macro fetch failed:", e);
      return null;
    } finally {
      setHKMacroLoading(false);
    }
  }, [config.macro?.enabled, config.stocks.PORTFOLIO]);

  const refreshUSMacro = useCallback(async () => {
    const usResult = await fetchUSMacro();
    if (results.length > 0 && config.macro?.enabled) {
      setResults(prev => applyDualMacroAdjustment(
        prev,
        usResult?.mbs ?? null,
        hkMacroData?.mbs ?? null,
        config.macro?.applyToScore ?? false,
      ));
    }
  }, [fetchUSMacro, results.length, config.macro, hkMacroData]);

  const refreshHKMacro = useCallback(async () => {
    const hkResult = await fetchHKMacro();
    if (results.length > 0 && config.macro?.enabled) {
      setResults(prev => applyDualMacroAdjustment(
        prev,
        macroData?.mbs ?? null,
        hkResult?.mbs ?? null,
        config.macro?.applyToScore ?? false,
      ));
    }
  }, [fetchHKMacro, results.length, config.macro, macroData]);

  const fetchTimesfm = useCallback(async () => {
    setTimesfmLoading(true);
    try {
      const data = await fetchTimesfmForecasts();
      setTimesfmData(data);
    } catch {
      setTimesfmData(null);
    } finally {
      setTimesfmLoading(false);
    }
    const k = await fetchKronosForecasts();
    if (k) setKronosData(k);
  }, []);

  useEffect(() => {
    if (results.length > 0 && !timesfmData) {
      fetchTimesfm();
    }
  }, [results, timesfmData, fetchTimesfm]);

  async function savePortfolio() {
    setSavePortfolioLoading(true);
    setSavePortfolioMsg(null);
    try {
      const res = await fetch("/api/save-portfolio", {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ portfolio: config.stocks.PORTFOLIO }),
      });
      const data = await res.json();
      setSavePortfolioMsg(data.success
        ? `Saved ${data.count} stocks to repo ✓`
        : `Error: ${data.error}`);
    } catch (e) {
      setSavePortfolioMsg(`Error: ${String(e)}`);
    } finally {
      setSavePortfolioLoading(false);
    }
  }

  const syncWithParams = useCallback(async () => {
    setBacktestLoading(true);
    setResults([]);
    setHighlightedSymbol(null);
    const overrideSTParams = {
      atrPeriod:  config.supertrend.atrPeriod,
      multiplier: config.supertrend.multiplier,
    };
    const portfolio    = config.stocks.PORTFOLIO;
    const allResults: StockAnalysisResult[] = [];
    for (let i = 0; i < portfolio.length; i++) {
      const stock = portfolio[i];
      try {
        const res = await fetch("/api/stocks", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ symbol: stock.symbol, config, overrideSTParams }),
        });
        if (res.ok) {
          const data = await res.json() as StockAnalysisResult;
          allResults.push(data);
          setResults([...allResults]);
        }
      } catch (e) {
        console.error(`Error syncing ${stock.symbol}:`, e);
      }
    }
    setLastUpdated(new Date().toLocaleTimeString());
    setBacktestLoading(false);
  }, [config]);

  async function triggerSTOptimization() {
    setStOptimizing(true);
    setStOptMsg(null);
    try {
      const res = await fetch("/api/st-params", { method: "POST" });
      const data = await res.json();
      setStOptMsg(data.success
        ? "Triggered — params will update in ~2 min after the workflow commits."
        : `Error: ${data.error}`);
    } catch (e) {
      setStOptMsg(`Error: ${String(e)}`);
    } finally {
      setStOptimizing(false);
    }
  }

  async function sendTelegramNotification(finalResults: StockAnalysisResult[]) {
    if (finalResults.length === 0) return;
    setTgSending(true);
    setTgMsg(null);
    try {
      // Strip chart_bars (too large for API body limit) and precompute flip info
      // so buildTelegramMessage on the server can still include the ST flip section.
      const payload = finalResults.map(r => {
        const { chart_bars, ...slim } = r;
        if (chart_bars && chart_bars.length >= 2) {
          const atr = r.st_opt_params?.atrPeriod ?? 10;
          const mul = r.st_opt_params?.multiplier ?? 3.0;
          const [stArr, dir] = supertrend(
            chart_bars.map(b => b.high),
            chart_bars.map(b => b.low),
            chart_bars.map(b => b.close),
            atr, mul,
          );
          let flipType: "BULLISH" | "BEARISH" | null = null;
          let barsSince = 999;
          let stopAtFlip: number | null = null;
          let closeAtFlip: number | null = null;
          for (let i = dir.length - 1; i >= 1; i--) {
            if (dir[i] !== dir[i - 1]) {
              barsSince   = dir.length - 1 - i;
              flipType    = dir[i] === 1 ? "BULLISH" : "BEARISH";
              stopAtFlip  = stArr[i - 1] ?? null;
              closeAtFlip = chart_bars[i].close;
              break;
            }
          }
          return { ...slim, _flip: { flipType, barsSince, stopAtFlip, closeAtFlip } };
        }
        return slim;
      });
      const res = await fetch("/api/telegram", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ results: payload }),
      });
      const data = await res.json();
      if (res.status === 503) {
        setTgMsg("Telegram not configured — add TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID to env vars.");
      } else {
        setTgMsg(data.ok ? "📱 Sent to Telegram!" : `Telegram error: ${data.error ?? "unknown"}`);
      }
    } catch (e) {
      setTgMsg(`Telegram error: ${String(e)}`);
    } finally {
      setTgSending(false);
      // Keep errors visible until dismissed; auto-dismiss success after 6s
    }
  }

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setProgress(0);
    setProgressSymbol("");
    setResults([]);
    setHighlightedSymbol(null);

    const [usPromise, hkPromise] = [fetchUSMacro(), fetchHKMacro()];

    const portfolio    = config.stocks.PORTFOLIO;
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

    const [usResult, hkResult] = await Promise.all([usPromise, hkPromise]);
    let finalResults = allResults;
    if (config.macro?.enabled) {
      finalResults = applyDualMacroAdjustment(
        allResults,
        usResult?.mbs ?? null,
        hkResult?.mbs ?? null,
        config.macro?.applyToScore ?? false,
      );
      setResults(finalResults);
    }

    fetchTimesfm();

    // Auto-send when there are BUY/SELL signals OR an ST flip within the last 2 bars
    // (covers same-day flips AND yesterday's close, since analysis often runs pre-market)
    const hasSignals = finalResults.some(
      r => r.signal === "BUY" || r.signal === "SELL" || r.signal === "STRONG_SELL"
    );
    const hasRecentFlip = finalResults.some(r => {
      const bars = r.chart_bars;
      if (!bars || bars.length < 3) return false;
      const atr = r.st_opt_params?.atrPeriod ?? 10;
      const mul = r.st_opt_params?.multiplier ?? 3.0;
      const [, dir] = supertrend(bars.map(b => b.high), bars.map(b => b.low), bars.map(b => b.close), atr, mul);
      if (dir.length < 3) return false;
      return dir[dir.length - 1] !== dir[dir.length - 2] ||   // flipped today
             dir[dir.length - 2] !== dir[dir.length - 3];      // flipped yesterday
    });
    if (hasSignals || hasRecentFlip) sendTelegramNotification(finalResults);

    setLastUpdated(new Date().toLocaleTimeString());
    setProgressSymbol("");
    setLoading(false);
  }, [config, fetchUSMacro, fetchHKMacro, fetchTimesfm]);

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

  const hasHKStocks = config.stocks.PORTFOLIO.some(s => s.exchange === "HK");

  return (
    <div className="min-h-screen bg-[#0a0e1a]">

      {/* TOP BAR */}
      <header className="border-b border-[#1e2d4a] bg-[#0f1629] px-4 py-2.5 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <span className="text-[#00d4ff] font-bold text-sm tracking-widest">▶ AUTOPILOT</span>
          <span className="text-[#4a6080] text-xs">v17.0</span>
          {lastUpdated && <span className="text-[#4a6080] text-xs">· Updated {lastUpdated}</span>}
          {workerState?.updatedAt && (() => {
            const ageMs = Date.now() - new Date(workerState.updatedAt!).getTime();
            const ageH  = ageMs / 3_600_000;
            const label = ageH < 1
              ? `${Math.round(ageMs / 60_000)}m ago`
              : `${ageH.toFixed(1)}h ago`;
            const cls = ageH < 2 ? "text-[#00ff88]" : ageH < 8 ? "text-[#ffa502]" : "text-[#ff4757]";
            return <span className={`text-xs font-mono ${cls}`}>· Worker {label}</span>;
          })()}
          {loading && (
            <span className="text-[#ffa502] text-xs blink">
              · {progressSymbol ? `Scanning ${progressSymbol}…` : "Scanning…"} {progress}%
            </span>
          )}
          {config.macro?.enabled && (
            <span className={`text-[0.6rem] font-mono px-2 py-0.5 rounded border transition-colors ${
              macroData
                ? macroData.mbs >= 7   ? "text-[#00ff88] border-[#00ff88]/30 bg-[#00ff88]/5"
                : macroData.mbs >= 5.5 ? "text-[#ffa502] border-[#ffa502]/30 bg-[#ffa502]/5"
                :                        "text-[#ff4757] border-[#ff4757]/30 bg-[#ff4757]/5"
                : "text-[#4a6080] border-[#1e2d4a]"
            }`}>
              {macroData ? `US ${macroData.mbs.toFixed(1)}` : macroLoading ? "US…" : "🌐 US"}
            </span>
          )}
          {config.macro?.enabled && hasHKStocks && (
            <span className={`text-[0.6rem] font-mono px-2 py-0.5 rounded border transition-colors ${
              hkMacroData
                ? hkMacroData.mbs >= 7   ? "text-[#00ff88] border-[#00ff88]/30 bg-[#00ff88]/5"
                : hkMacroData.mbs >= 5.5 ? "text-[#ffa502] border-[#ffa502]/30 bg-[#ffa502]/5"
                :                          "text-[#ff4757] border-[#ff4757]/30 bg-[#ff4757]/5"
                : "text-[#4a6080] border-[#1e2d4a]"
            }`}>
              {hkMacroData ? `HK ${hkMacroData.mbs.toFixed(1)}` : hkMacroLoading ? "HK…" : "🇭🇰 HK"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowConfig(!showConfig)}
            className="px-3 py-1.5 text-xs border border-[#1e2d4a] text-[#6b85a0] hover:border-[#00d4ff] hover:text-[#00d4ff] rounded transition-all">
            {showConfig ? "▲ HIDE CONFIG" : "▼ CONFIG"}
          </button>
          <button onClick={triggerSTOptimization} disabled={stOptimizing}
            title={stOptMsg ?? "Re-optimize SuperTrend params via GitHub Action"}
            className="px-3 py-1.5 text-xs border border-[#1e2d4a] text-[#6b85a0] hover:border-[#f59e0b] hover:text-[#f59e0b] disabled:opacity-40 disabled:cursor-not-allowed rounded transition-all">
            {stOptimizing ? "TRIGGERING…" : "⚡ OPTIMIZE ST"}
          </button>
          <button
            onClick={() => sendTelegramNotification(results)}
            disabled={tgSending || results.length === 0}
            title="Send current analysis to Telegram"
            className="px-3 py-1.5 text-xs border border-[#1e2d4a] text-[#6b85a0] hover:border-[#7c3aed] hover:text-[#a78bfa] disabled:opacity-40 disabled:cursor-not-allowed rounded transition-all">
            {tgSending ? "SENDING…" : "📱 NOTIFY"}
          </button>
          {results.length > 0 && (
            <div className="flex items-center gap-1 border border-[#1e2d4a] rounded px-1.5 py-0.5"
                 title="Broadcast a tab to all cards — click again to release">
              <span className="text-[#4a6080] text-[0.6rem] font-mono pr-1 select-none">ALL:</span>
              <InfoTooltip id="stock" />
              {(["OVERVIEW","CHART","BACKTEST","MONTE CARLO","PLAN","FUNDAMENTAL"] as Tab[]).map(t => {
                const labels: Record<Tab, string> = {
                  OVERVIEW: "OVR", CHART: "CHT", BACKTEST: "BKT",
                  "MONTE CARLO": "MC", PLAN: "PLN", FUNDAMENTAL: "FND",
                };
                const active = globalTab === t;
                return (
                  <button
                    key={t}
                    onClick={() => setGlobalTab(g => g === t ? null : t)}
                    title={active ? `Click to release — cards return to their own tabs` : `Show ${t} on all cards`}
                    className={`px-1.5 py-0.5 text-[0.6rem] font-mono rounded transition-all ${
                      active
                        ? "bg-[#f59e0b]/20 text-[#f59e0b] font-bold"
                        : "text-[#4a6080] hover:text-[#c8d8f0]"
                    }`}
                  >
                    {labels[t]}
                  </button>
                );
              })}
            </div>
          )}
          <button onClick={runAnalysis} disabled={loading}
            className="px-4 py-1.5 text-xs font-bold bg-[#00d4ff]/10 border border-[#00d4ff]/40 text-[#00d4ff] hover:bg-[#00d4ff]/20 disabled:opacity-40 disabled:cursor-not-allowed rounded transition-all">
            {loading ? `SCANNING… ${progress}%` : "▶ RUN ANALYSIS"}
          </button>
          <UserButton />
          <button
            type="button"
            onClick={() => setLegendOpen(true)}
            aria-haspopup="dialog"
            className="ml-2 inline-flex items-center gap-1.5 rounded-[5px] border border-[#1e2d4a] px-2.5 py-1 text-[0.7rem] tracking-[0.04em] text-[#6b85a0] transition-colors hover:border-[#00d4ff] hover:bg-[rgba(0,212,255,0.06)] hover:text-[#00d4ff] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00d4ff]"
          >
            <span className="text-[11px]">❔</span> How to read this
          </button>
        </div>
      </header>
      {stOptMsg && (
        <div className={`px-4 py-1.5 text-xs border-b ${stOptMsg.startsWith("Error") ? "border-red-900/40 text-red-400 bg-red-900/10" : "border-[#1e2d4a] text-[#f59e0b] bg-[#0a0e1a]"}`}>
          {stOptMsg}
        </div>
      )}
      {tgMsg && (
        <div className={`px-4 py-1.5 text-xs border-b flex items-center justify-between ${tgMsg.startsWith("Telegram error") || tgMsg.startsWith("Telegram not") ? "border-red-900/40 text-red-400 bg-red-900/10" : "border-[#1e2d4a] text-[#a78bfa] bg-[#0a0e1a]"}`}>
          <span>{tgMsg}</span>
          <button onClick={() => setTgMsg(null)} className="ml-4 opacity-60 hover:opacity-100 text-[#6b85a0]">✕</button>
        </div>
      )}

      {/* DAILY DIGEST PANEL — top-of-dashboard banner for copy-to-LLM workflow */}
      <div className="mx-4 mt-4">
        <DigestPrompt />
      </div>

      {/* CONFIG PANEL */}
      {showConfig && (
        <div className="border-b border-[#1e2d4a] bg-[#0a0e1a]">
          <ConfigPanel
            config={config}
            onChange={setConfig}
            onSavePortfolio={savePortfolio}
            savePortfolioLoading={savePortfolioLoading}
            savePortfolioMsg={savePortfolioMsg}
            onBacktestWithParams={syncWithParams}
            backtestLoading={backtestLoading}
          />
        </div>
      )}

      {/* US MACRO PANEL */}
      {config.macro?.enabled && (macroData !== null || macroLoading) && (
        <div className="border-b border-[#1e2d4a]">
          <MacroPanel data={macroData} loading={macroLoading} onRefresh={refreshUSMacro} />
        </div>
      )}

      {/* HK MACRO PANEL */}
      {config.macro?.enabled && hasHKStocks && (hkMacroData !== null || hkMacroLoading) && (
        <div className="border-b border-[#1e2d4a]">
          <MacroPanelHK data={hkMacroData} loading={hkMacroLoading} onRefresh={refreshHKMacro} />
        </div>
      )}

      {/* ALERTS PANEL — above portfolio summary for immediate visibility */}
      {(results.length > 0 || (workerState?.events?.length ?? 0) > 0) && (
        <div className="mx-4">
          <AlertsPanel results={results} workerState={workerState} />
        </div>
      )}

      {/* PORTFOLIO SUMMARY TABLE */}
      {results.length > 0 && (
        <div className="border-b border-[#1e2d4a]">
          <PortfolioSummaryBar
            results={results}
            onRowClick={scrollToCard}
            timesfmData={timesfmData}
            kronosData={kronosData}
          />
        </div>
      )}

      {/* OPEN POSITIONS PANEL */}
      {results.length > 0 && (
        <OpenPositionsPanel results={results} onSymbolClick={scrollToCard} />
      )}

      {/* AUTOPILOT REALIZED NAV PANEL */}
      <div className="mx-4">
        <NavPanel />
      </div>

      {/* STOCK CARDS */}
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
                <div key={result.symbol} id={cardId}
                  className={`rounded-md transition-all duration-300 ${
                    isHighlighted
                      ? "ring-2 ring-[#00d4ff] ring-offset-2 ring-offset-[#0a0e1a] shadow-[0_0_20px_rgba(0,212,255,0.25)]"
                      : ""
                  }`}>
                  <StockCard
                    result={result}
                    config={config}
                    timesfm={timesfmData?.[result.symbol]}
                    kronos={kronosData?.[result.symbol]}
                    forcedTab={globalTab ?? undefined}
                  />
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
            <button onClick={runAnalysis}
              className="px-6 py-2 text-sm font-bold bg-[#00d4ff]/10 border border-[#00d4ff]/40 text-[#00d4ff] hover:bg-[#00d4ff]/20 rounded transition-all">
              ▶ RUN ANALYSIS
            </button>
          </div>
        )}
      </main>

      {/* SCROLL TO TOP */}
      <button onClick={scrollToTop} aria-label="Scroll to top"
        style={{
          position: "fixed", bottom: 30, right: 30, width: 44, height: 44,
          borderRadius: "50%", background: "linear-gradient(135deg, #00d4ff 0%, #0099cc 100%)",
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
      >↑</button>
      <LegendDrawer open={legendOpen} onClose={() => setLegendOpen(false)} />
    </div>
  );
}
