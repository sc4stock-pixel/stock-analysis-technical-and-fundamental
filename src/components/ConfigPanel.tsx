"use client";
import { useState } from "react";
import { AppConfig } from "@/types";

interface Props {
  config: AppConfig;
  onChange: (config: AppConfig) => void;
}

type TabId = "portfolio" | "signal" | "backtest" | "risk" | "supertrend" | "macro";

export default function ConfigPanel({ config, onChange }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("signal");
  const [newSymbol, setNewSymbol] = useState("");
  const [newName, setNewName] = useState("");
  const [newExchange, setNewExchange] = useState<"US" | "HK">("US");

  function update(path: string, value: unknown) {
    const keys = path.split(".");
    const next = JSON.parse(JSON.stringify(config));
    let obj: Record<string, unknown> = next;
    for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]] as Record<string, unknown>;
    obj[keys[keys.length - 1]] = value;
    onChange(next);
  }

  function addStock() {
    if (!newSymbol.trim()) return;
    const sym = newSymbol.toUpperCase().trim();
    if (config.stocks.PORTFOLIO.some(s => s.symbol === sym)) return;
    onChange({
      ...config,
      stocks: {
        PORTFOLIO: [...config.stocks.PORTFOLIO, { symbol: sym, name: newName || sym, exchange: newExchange }],
      },
    });
    setNewSymbol(""); setNewName("");
  }

  function removeStock(symbol: string) {
    onChange({
      ...config,
      stocks: { PORTFOLIO: config.stocks.PORTFOLIO.filter(s => s.symbol !== symbol) },
    });
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: "portfolio",  label: "Portfolio" },
    { id: "signal",     label: "Signal" },
    { id: "backtest",   label: "Backtest" },
    { id: "risk",       label: "Risk" },
    { id: "supertrend", label: "SuperTrend" },
    { id: "macro",      label: "🌐 Macro" },
  ];

  const labelCls = "text-[#4a6080] text-xs font-mono mb-1";
  const inputCls = "w-full bg-[#080d1a] border border-[#1e2d4a] text-[#c8d8f0] text-xs font-mono rounded px-2 py-1.5 focus:outline-none focus:border-[#00d4ff]";
  const sectionCls = "mb-4";
  const sectionTitle = "text-[#00d4ff] text-xs font-bold tracking-widest mb-3 border-b border-[#1e2d4a] pb-1";

  return (
    <div className="bg-[#0a1628] border border-[#1e2d4a] rounded">
      {/* Tab bar */}
      <div className="flex border-b border-[#1e2d4a] overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-3 py-2 text-xs font-mono whitespace-nowrap transition-colors ${
              activeTab === t.id
                ? "text-[#00d4ff] border-b-2 border-[#00d4ff] bg-[#00d4ff]/5"
                : "text-[#4a6080] hover:text-[#c8d8f0]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="p-4 max-h-[420px] overflow-y-auto">

        {/* ── PORTFOLIO ── */}
        {activeTab === "portfolio" && (
          <div>
            <div className={sectionTitle}>PORTFOLIO STOCKS</div>
            <div className="space-y-1.5 mb-4">
              {config.stocks.PORTFOLIO.map(s => (
                <div key={s.symbol} className="flex items-center justify-between bg-[#080d1a] border border-[#1e2d4a] rounded px-2 py-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[#00d4ff] text-xs font-mono font-bold">{s.symbol}</span>
                    <span className="text-[#4a6080] text-xs">{s.name}</span>
                    <span className={`text-[0.6rem] px-1 rounded ${s.exchange === "HK" ? "bg-[#ffa502]/10 text-[#ffa502]" : "bg-[#00d4ff]/10 text-[#00d4ff]"}`}>{s.exchange}</span>
                  </div>
                  <button onClick={() => removeStock(s.symbol)} className="text-[#ff4757] text-xs hover:text-red-400">✕</button>
                </div>
              ))}
            </div>
            <div className={sectionTitle}>ADD STOCK</div>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <div>
                <div className={labelCls}>Symbol</div>
                <input className={inputCls} value={newSymbol} onChange={e => setNewSymbol(e.target.value.toUpperCase())} placeholder="AAPL" />
              </div>
              <div>
                <div className={labelCls}>Name</div>
                <input className={inputCls} value={newName} onChange={e => setNewName(e.target.value)} placeholder="Apple" />
              </div>
              <div>
                <div className={labelCls}>Exchange</div>
                <select className={inputCls} value={newExchange} onChange={e => setNewExchange(e.target.value as "US" | "HK")}>
                  <option value="US">US</option>
                  <option value="HK">HK</option>
                </select>
              </div>
            </div>
            <button onClick={addStock} className="w-full bg-[#00d4ff]/10 border border-[#00d4ff]/30 text-[#00d4ff] text-xs font-mono py-1.5 rounded hover:bg-[#00d4ff]/20 transition-colors">
              + ADD STOCK
            </button>
          </div>
        )}

        {/* ── SIGNAL ── */}
        {activeTab === "signal" && (
          <div>
            <div className={sectionTitle}>SIGNAL PARAMETERS</div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Entry Threshold", path: "signal.entryThreshold", step: 0.1, min: 3, max: 9 },
                { label: "Exit Threshold", path: "signal.exitThreshold", step: 0.1, min: 1, max: 7 },
                { label: "Confirmation Bars", path: "signal.signalConfirmationBars", step: 1, min: 1, max: 10 },
                { label: "ADX Threshold", path: "signal.adxThreshold", step: 1, min: 10, max: 50 },
                { label: "Max Holding Days", path: "signal.maxHoldingDays", step: 1, min: 1, max: 60 },
                { label: "Earnings Buffer Days", path: "signal.earningsBufferDays", step: 1, min: 0, max: 30 },
              ].map(f => (
                <div key={f.path}>
                  <div className={labelCls}>{f.label}</div>
                  <input type="number" className={inputCls} step={f.step} min={f.min} max={f.max}
                    value={String(f.path.split(".").reduce((o, k) => (o as Record<string, unknown>)[k], config as unknown))}
                    onChange={e => update(f.path, parseFloat(e.target.value))} />
                </div>
              ))}
            </div>
            <div className={`${sectionCls} mt-4`}>
              <div className={sectionTitle}>FILTERS</div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={config.signal.trendGateEnabled}
                  onChange={e => update("signal.trendGateEnabled", e.target.checked)}
                  className="w-3 h-3 accent-[#00d4ff]" />
                <span className="text-xs font-mono text-[#c8d8f0]">Trend Gate Filter</span>
              </label>
            </div>
          </div>
        )}

        {/* ── BACKTEST ── */}
        {activeTab === "backtest" && (
          <div>
            <div className={sectionTitle}>BACKTEST PARAMETERS</div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Initial Capital ($)", path: "backtest.initialCapital", step: 1000, min: 1000, max: 1000000 },
                { label: "Lookback Days", path: "backtest.lookbackDays", step: 50, min: 100, max: 2000 },
                { label: "Commission Rate", path: "backtest.commissionRate", step: 0.0001, min: 0, max: 0.01 },
                { label: "Slippage Rate", path: "backtest.slippageRate", step: 0.0001, min: 0, max: 0.01 },
              ].map(f => (
                <div key={f.path}>
                  <div className={labelCls}>{f.label}</div>
                  <input type="number" className={inputCls} step={f.step} min={f.min} max={f.max}
                    value={String(f.path.split(".").reduce((o, k) => (o as Record<string, unknown>)[k], config as unknown))}
                    onChange={e => update(f.path, parseFloat(e.target.value))} />
                </div>
              ))}
            </div>
            <div className="mt-3">
              <div className={labelCls}>Signal Mode</div>
              <select className={inputCls} value={config.backtest.signal_mode}
                onChange={e => update("backtest.signal_mode", e.target.value)}>
                <option value="both">Both Strategies</option>
                <option value="score">Score Only</option>
                <option value="supertrend">SuperTrend Only</option>
              </select>
            </div>
            <div className="mt-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={config.backtest.use_van_tharp}
                  onChange={e => update("backtest.use_van_tharp", e.target.checked)}
                  className="w-3 h-3 accent-[#00d4ff]" />
                <span className="text-xs font-mono text-[#c8d8f0]">Van Tharp Position Sizing</span>
              </label>
            </div>
          </div>
        )}

        {/* ── RISK ── */}
        {activeTab === "risk" && (
          <div>
            <div className={sectionTitle}>RISK PARAMETERS</div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Risk Per Trade", path: "risk.riskPerTrade", step: 0.0025, min: 0.001, max: 0.05 },
                { label: "ATR Multiplier", path: "risk.atrMultiplier", step: 0.25, min: 0.5, max: 10 },
                { label: "Trailing ATR Mult", path: "risk.trailingAtrMultiplier", step: 0.25, min: 0.5, max: 5 },
                { label: "Max Position Size", path: "risk.maxPositionSize", step: 0.05, min: 0.05, max: 1.0 },
                { label: "Correlation Threshold", path: "risk.correlationThreshold", step: 0.05, min: 0.3, max: 1.0 },
                { label: "Correlation Penalty", path: "risk.correlationPenalty", step: 0.1, min: 0, max: 1.0 },
              ].map(f => (
                <div key={f.path}>
                  <div className={labelCls}>{f.label}</div>
                  <input type="number" className={inputCls} step={f.step} min={f.min} max={f.max}
                    value={String(f.path.split(".").reduce((o, k) => (o as Record<string, unknown>)[k], config as unknown))}
                    onChange={e => update(f.path, parseFloat(e.target.value))} />
                </div>
              ))}
            </div>
            <div className="mt-4">
              <div className={sectionTitle}>PORTFOLIO KILL SWITCH</div>
              <label className="flex items-center gap-2 cursor-pointer mb-2">
                <input type="checkbox" checked={config.portfolioRisk.killSwitchEnabled}
                  onChange={e => update("portfolioRisk.killSwitchEnabled", e.target.checked)}
                  className="w-3 h-3 accent-[#ff4757]" />
                <span className="text-xs font-mono text-[#c8d8f0]">Kill Switch Enabled</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Max Drawdown %", path: "portfolioRisk.maxDrawdownThreshold", step: 0.01, min: 0.05, max: 0.5 },
                  { label: "Cooling Period Days", path: "portfolioRisk.coolingPeriodDays", step: 1, min: 1, max: 30 },
                ].map(f => (
                  <div key={f.path}>
                    <div className={labelCls}>{f.label}</div>
                    <input type="number" className={inputCls} step={f.step} min={f.min} max={f.max}
                      value={String(f.path.split(".").reduce((o, k) => (o as Record<string, unknown>)[k], config as unknown))}
                      onChange={e => update(f.path, parseFloat(e.target.value))} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── SUPERTREND ── */}
        {activeTab === "supertrend" && (
          <div>
            <div className={sectionTitle}>SUPERTREND PARAMETERS</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className={labelCls}>ATR Period</div>
                <input type="number" className={inputCls} step={1} min={5} max={30}
                  value={config.supertrend.atrPeriod}
                  onChange={e => update("supertrend.atrPeriod", parseInt(e.target.value))} />
              </div>
              <div>
                <div className={labelCls}>Multiplier</div>
                <input type="number" className={inputCls} step={0.25} min={1} max={8}
                  value={config.supertrend.multiplier}
                  onChange={e => update("supertrend.multiplier", parseFloat(e.target.value))} />
              </div>
            </div>
            <div className="mt-3">
              <div className={labelCls}>EMA Filter Mode</div>
              <select className={inputCls} value={config.supertrend.filter_mode}
                onChange={e => update("supertrend.filter_mode", e.target.value)}>
                <option value="ema_only">EMA50 Only</option>
                <option value="full">Full Filter</option>
              </select>
            </div>
            <div className="mt-4 p-3 bg-[#080d1a] border border-[#1e2d4a] rounded text-[0.65rem] font-mono text-[#4a6080]">
              <div className="text-[#ffa502] mb-1">ℹ SuperTrend — macro unaffected</div>
              SuperTrend is a pure trend-following system. The MBS macro adjustment is intentionally not applied to ST entries or scoring. Configure MBS impact on the 🌐 Macro tab.
            </div>
          </div>
        )}

        {/* ── MACRO ── */}
        {activeTab === "macro" && (
          <div>
            <div className={sectionTitle}>🌐 MACROENGINE V15.1</div>

            {/* Master toggle */}
            <div className="bg-[#080d1a] border border-[#1e2d4a] rounded p-3 mb-4">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <div className="text-xs font-mono text-[#c8d8f0] font-bold">Enable Market Intelligence</div>
                  <div className="text-[0.65rem] text-[#4a6080] mt-0.5">Fetch macro data on each analysis run</div>
                </div>
                <div
                  onClick={() => update("macro.enabled", !config.macro.enabled)}
                  className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${config.macro.enabled ? "bg-[#00d4ff]/40" : "bg-[#1e2d4a]"}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${config.macro.enabled ? "left-5 bg-[#00d4ff]" : "left-0.5 bg-[#4a6080]"}`} />
                </div>
              </label>
            </div>

            {/* Apply to Score toggle */}
            <div className={`bg-[#080d1a] border rounded p-3 mb-4 transition-opacity ${config.macro.enabled ? "border-[#1e2d4a] opacity-100" : "border-[#1e2d4a]/30 opacity-40 pointer-events-none"}`}>
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <div className="text-xs font-mono text-[#c8d8f0] font-bold">Apply MBS to Score (SCR) Strategy</div>
                  <div className="text-[0.65rem] text-[#4a6080] mt-0.5">Adjusts SCR entry score based on macro environment</div>
                </div>
                <div
                  onClick={() => update("macro.applyToScore", !config.macro.applyToScore)}
                  className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${config.macro.applyToScore ? "bg-[#00ff88]/40" : "bg-[#1e2d4a]"}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${config.macro.applyToScore ? "left-5 bg-[#00ff88]" : "left-0.5 bg-[#4a6080]"}`} />
                </div>
              </label>
            </div>

            {/* SuperTrend info box */}
            <div className="bg-[#080d1a] border border-[#ffa502]/20 rounded p-3 mb-4">
              <div className="flex items-start gap-2">
                <span className="text-[#ffa502] text-sm shrink-0">⚡</span>
                <div>
                  <div className="text-xs font-mono text-[#ffa502] font-bold mb-1">SuperTrend — Always Unaffected</div>
                  <div className="text-[0.65rem] text-[#4a6080] leading-relaxed">
                    SuperTrend is a pure price-action trend system. MBS adjustments are intentionally excluded to preserve signal integrity. ST entries rely solely on ATR-based band logic and EMA50 filter.
                  </div>
                </div>
              </div>
            </div>

            {/* MBS tier table */}
            <div className={`transition-opacity ${config.macro.enabled && config.macro.applyToScore ? "opacity-100" : "opacity-40"}`}>
              <div className="text-[#4a6080] text-xs font-bold tracking-widest mb-2">MBS ADJUSTMENT TIERS</div>
              <div className="space-y-1">
                {[
                  { range: "≥ 7.0", label: "BULLISH",  adj: "+0.5", color: "text-[#00ff88]", bg: "bg-[#00ff88]/5",  border: "border-[#00ff88]/20" },
                  { range: "5.5–7.0", label: "NEUTRAL", adj: "±0.0", color: "text-[#c8d8f0]", bg: "bg-[#1e2d4a]/30", border: "border-[#1e2d4a]" },
                  { range: "4.0–5.5", label: "CAUTION", adj: "−0.3", color: "text-[#ffa502]", bg: "bg-[#ffa502]/5",  border: "border-[#ffa502]/20" },
                  { range: "2.5–4.0", label: "RISK-OFF", adj: "−0.5", color: "text-[#ff6b35]", bg: "bg-[#ff6b35]/5",  border: "border-[#ff6b35]/20" },
                  { range: "< 2.5",  label: "AVOID",   adj: "−1.0", color: "text-[#ff4757]", bg: "bg-[#ff4757]/5",  border: "border-[#ff4757]/20" },
                ].map(row => (
                  <div key={row.range} className={`flex items-center justify-between px-3 py-1.5 rounded border ${row.bg} ${row.border}`}>
                    <div className="flex items-center gap-3">
                      <span className="text-[#4a6080] text-xs font-mono w-16">{row.range}</span>
                      <span className={`text-xs font-mono font-bold ${row.color}`}>{row.label}</span>
                    </div>
                    <span className={`text-xs font-mono font-bold ${row.color}`}>{row.adj} SCR</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Data sources */}
            <div className="mt-4">
              <div className="text-[#4a6080] text-xs font-bold tracking-widest mb-2">DATA SOURCES</div>
              <div className="space-y-1">
                {[
                  { label: "Fear & Greed", src: "alternative.me", wt: "20%", cost: "Free" },
                  { label: "VIX Structure", src: "Yahoo Finance", wt: "20%", cost: "Free" },
                  { label: "Index Trends", src: "Yahoo Finance", wt: "25%", cost: "Free" },
                  { label: "A/D Ratio", src: "Yahoo ^ADVN/^DECN", wt: "15%", cost: "Free" },
                  { label: "News Sentiment", src: "Finviz RSS", wt: "10%", cost: "Free" },
                  { label: "Market Breadth", src: "SPY series proxy", wt: "10%", cost: "Free" },
                ].map(s => (
                  <div key={s.label} className="flex items-center justify-between px-2 py-1 bg-[#080d1a] border border-[#1e2d4a] rounded">
                    <div className="flex items-center gap-2">
                      <span className="text-[#c8d8f0] text-xs font-mono">{s.label}</span>
                      <span className="text-[#4a6080] text-[0.6rem]">{s.src}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[#00d4ff] text-[0.6rem] font-mono">{s.wt}</span>
                      <span className="text-[#00ff88] text-[0.6rem]">{s.cost}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
