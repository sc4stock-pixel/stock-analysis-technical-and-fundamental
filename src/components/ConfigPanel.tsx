"use client";
import { AppConfig } from "@/types";
import { DEFAULT_CONFIG } from "@/lib/config";
import { useState } from "react";

interface Props {
  config: AppConfig;
  onChange: (c: AppConfig) => void;
}

// Signal presets matching Python dashboard exactly
// Aggressive=5.0 | Moderate=5.5 (Python default) | Conservative=6.0
const SIGNAL_PRESETS = {
  aggressive: {
    entryThreshold: 5.0, exitThreshold: 3.5, signalConfirmationBars: 2,
    label: "AGGRESSIVE", desc: "Entry ≥5.0 · 2 confirm bars",
    color: "text-[#ff4757] border-[#ff4757]/40 hover:bg-[#ff4757]/10",
    activeColor: "bg-[#ff4757]/15 border-[#ff4757] text-[#ff4757]",
  },
  moderate: {
    entryThreshold: 5.5, exitThreshold: 4.0, signalConfirmationBars: 3,
    label: "MODERATE ★", desc: "Entry ≥5.5 · 3 bars · Python default",
    color: "text-[#00d4ff] border-[#00d4ff]/40 hover:bg-[#00d4ff]/10",
    activeColor: "bg-[#00d4ff]/15 border-[#00d4ff] text-[#00d4ff]",
  },
  conservative: {
    entryThreshold: 6.0, exitThreshold: 4.5, signalConfirmationBars: 3,
    label: "CONSERVATIVE", desc: "Entry ≥6.0 · 3 confirm bars",
    color: "text-[#00ff88] border-[#00ff88]/40 hover:bg-[#00ff88]/10",
    activeColor: "bg-[#00ff88]/15 border-[#00ff88] text-[#00ff88]",
  },
} as const;

type PresetKey = keyof typeof SIGNAL_PRESETS;

function detectActivePreset(config: AppConfig): PresetKey | null {
  for (const [key, p] of Object.entries(SIGNAL_PRESETS)) {
    if (
      config.signal.entryThreshold === p.entryThreshold &&
      config.signal.exitThreshold === p.exitThreshold &&
      config.signal.signalConfirmationBars === p.signalConfirmationBars
    ) return key as PresetKey;
  }
  return null;
}

function Slider({ label, value, min, max, step, onChange, format }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; format?: (v: number) => string;
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-[#6b85a0] text-xs w-44 shrink-0">{label}</label>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 h-1 accent-[#00d4ff]" />
      <span className="text-[#00d4ff] text-xs w-16 text-right font-mono">
        {format ? format(value) : value}
      </span>
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-[#6b85a0] text-xs w-44 shrink-0">{label}</label>
      <button onClick={() => onChange(!value)}
        className={`px-3 py-0.5 text-xs rounded border transition-all ${value
          ? "bg-[#00d4ff]/10 border-[#00d4ff]/40 text-[#00d4ff]"
          : "bg-[#1e2d4a]/40 border-[#1e2d4a] text-[#4a6080]"}`}>
        {value ? "ON" : "OFF"}
      </button>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[#00d4ff]/60 text-xs font-bold mb-2 tracking-widest">{children}</div>;
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 text-[0.65rem] text-[#4a6080] leading-relaxed border border-[#1e2d4a]/60 rounded p-2 bg-[#0a0e1a]">
      {children}
    </div>
  );
}

export default function ConfigPanel({ config, onChange }: Props) {
  const [portfolioInput, setPortfolioInput] = useState(
    config.stocks.PORTFOLIO.map((s) => `${s.symbol}:${s.name}:${s.exchange}`).join("\n")
  );

  const update = (path: string[], value: unknown) => {
    const nc = JSON.parse(JSON.stringify(config)) as AppConfig;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let obj: any = nc;
    for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
    obj[path[path.length - 1]] = value;
    onChange(nc);
  };

  const applyPreset = (key: PresetKey) => {
    const p = SIGNAL_PRESETS[key];
    onChange({
      ...config,
      signal: { ...config.signal, entryThreshold: p.entryThreshold, exitThreshold: p.exitThreshold, signalConfirmationBars: p.signalConfirmationBars },
    });
  };

  const resetAll = () => {
    onChange(DEFAULT_CONFIG);
    setPortfolioInput(DEFAULT_CONFIG.stocks.PORTFOLIO.map((s) => `${s.symbol}:${s.name}:${s.exchange}`).join("\n"));
  };

  const applyPortfolio = () => {
    const stocks = portfolioInput.split("\n").filter((l) => l.trim()).map((l) => {
      const [symbol, name, exchange] = l.split(":").map((s) => s.trim());
      return { symbol: (symbol ?? "").toUpperCase(), name: name ?? symbol ?? "", exchange: (exchange ?? "US") as "US" | "HK" };
    }).filter((s) => s.symbol);
    update(["stocks", "PORTFOLIO"], stocks);
  };

  const activePreset = detectActivePreset(config);

  return (
    <div className="p-4 space-y-4">

      {/* ── PRESET BUTTONS ── */}
      <div>
        <SectionTitle>SIGNAL PRESET</SectionTitle>
        <div className="flex flex-wrap gap-2 items-start">
          {(Object.entries(SIGNAL_PRESETS) as [PresetKey, typeof SIGNAL_PRESETS[PresetKey]][]).map(([key, p]) => {
            const isActive = activePreset === key;
            return (
              <button key={key} onClick={() => applyPreset(key)}
                className={`flex flex-col items-start px-3 py-2 rounded border text-xs transition-all min-w-[148px] ${isActive ? p.activeColor : `border-[#1e2d4a] ${p.color}`}`}>
                <span className="font-bold tracking-wide">{p.label}</span>
                <span className="text-[0.65rem] opacity-70 mt-0.5">{p.desc}</span>
              </button>
            );
          })}

          <button onClick={resetAll}
            className="flex flex-col items-start px-3 py-2 rounded border border-[#1e2d4a] text-[#4a6080] hover:border-[#ffa502]/60 hover:text-[#ffa502] text-xs transition-all min-w-[130px]">
            <span className="font-bold tracking-wide">↺ RESET ALL</span>
            <span className="text-[0.65rem] opacity-70 mt-0.5">All defaults</span>
          </button>
        </div>

        {/* Active preset status line */}
        <div className="mt-2 text-[0.65rem] text-[#4a6080]">
          {activePreset
            ? `▸ ${SIGNAL_PRESETS[activePreset].label.replace(" ★", "")} — entry ≥${config.signal.entryThreshold}, exit ≤${config.signal.exitThreshold}, confirm ${config.signal.signalConfirmationBars} bars`
            : `▸ Custom — entry ≥${config.signal.entryThreshold}, exit ≤${config.signal.exitThreshold}, confirm ${config.signal.signalConfirmationBars} bars`}
        </div>
      </div>

      <div className="border-t border-[#1e2d4a]" />

      {/* ── PARAM GRID ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">

        {/* SIGNAL PARAMS */}
        <div>
          <SectionTitle>SIGNAL PARAMS</SectionTitle>
          <div className="space-y-2">
            <Slider label="Entry Threshold" value={config.signal.entryThreshold}
              min={4.0} max={8.0} step={0.5} onChange={(v) => update(["signal", "entryThreshold"], v)} />
            <Slider label="Exit Threshold" value={config.signal.exitThreshold}
              min={2.0} max={5.5} step={0.5} onChange={(v) => update(["signal", "exitThreshold"], v)} />
            <Slider label="Default Confirm Bars" value={config.signal.signalConfirmationBars}
              min={0} max={5} step={1} onChange={(v) => update(["signal", "signalConfirmationBars"], v)} />
            <Slider label="Max Hold Days" value={config.signal.maxHoldingDays}
              min={3} max={60} step={1} format={(v) => `${v}d`}
              onChange={(v) => update(["signal", "maxHoldingDays"], v)} />
            <Toggle label="Trend Gate" value={config.signal.trendGateEnabled}
              onChange={(v) => update(["signal", "trendGateEnabled"], v)} />
          </div>
          <InfoBox>
            <span className="text-[#6b85a0] font-bold block mb-1">CONFIRM BARS (US exchange):</span>
            STRONG_UPTREND → 0 (instant)<br />
            STRENGTHENING → 0 (instant)<br />
            UPTREND → 1 bar  ·  RANGING → 2 bars<br />
            <span className="text-[#ffa502]">Vol Surge 2x+ → FORCE ENTRY</span>
            <div className="mt-1.5 text-[#00ff88]">
              ★ Entry Threshold &amp; Confirm Bars directly control<br />
              trade count — change preset → Run Analysis
            </div>
          </InfoBox>
        </div>

        {/* BACKTEST */}
        <div>
          <SectionTitle>BACKTEST</SectionTitle>
          <div className="space-y-2">
            <Slider label="Initial Capital" value={config.backtest.initialCapital}
              min={1000} max={100000} step={1000} format={(v) => `$${v.toLocaleString()}`}
              onChange={(v) => update(["backtest", "initialCapital"], v)} />
            <Slider label="Lookback Days" value={config.backtest.lookbackDays}
              min={100} max={504} step={21} format={(v) => `${v}d`}
              onChange={(v) => update(["backtest", "lookbackDays"], v)} />
            <Slider label="Commission" value={config.backtest.commissionRate}
              min={0} max={0.005} step={0.0005} format={(v) => `${(v * 100).toFixed(2)}%`}
              onChange={(v) => update(["backtest", "commissionRate"], v)} />
            <Slider label="Slippage" value={config.backtest.slippageRate}
              min={0} max={0.003} step={0.0005} format={(v) => `${(v * 100).toFixed(2)}%`}
              onChange={(v) => update(["backtest", "slippageRate"], v)} />
            <Toggle label="Van Tharp Sizing" value={config.backtest.use_van_tharp}
              onChange={(v) => update(["backtest", "use_van_tharp"], v)} />
          </div>
          <InfoBox>
            <span className="text-[#6b85a0]">Van Tharp OFF</span> = 100% equity/trade (raw α)<br />
            <span className="text-[#6b85a0]">Van Tharp ON</span> = ATR risk sizing (portfolio mode)
          </InfoBox>
        </div>

        {/* RISK */}
        <div>
          <SectionTitle>RISK &amp; KILL SWITCH</SectionTitle>
          <div className="space-y-2">
            <Slider label="ATR Mult (stop)" value={config.risk.atrMultiplier}
              min={1.0} max={5.0} step={0.25}
              onChange={(v) => update(["risk", "atrMultiplier"], v)} />
            <Slider label="Trailing ATR Mult" value={config.risk.trailingAtrMultiplier}
              min={0.5} max={3.0} step={0.25}
              onChange={(v) => update(["risk", "trailingAtrMultiplier"], v)} />
            <Slider label="Risk Per Trade" value={config.risk.riskPerTrade}
              min={0.005} max={0.03} step={0.0025} format={(v) => `${(v * 100).toFixed(2)}%`}
              onChange={(v) => update(["risk", "riskPerTrade"], v)} />
            <Slider label="Max Position Size" value={config.risk.maxPositionSize}
              min={0.05} max={1.0} step={0.05} format={(v) => `${(v * 100).toFixed(0)}%`}
              onChange={(v) => update(["risk", "maxPositionSize"], v)} />
            <Toggle label="Kill Switch" value={config.portfolioRisk.killSwitchEnabled}
              onChange={(v) => update(["portfolioRisk", "killSwitchEnabled"], v)} />
            <Slider label="Max DD Threshold" value={config.portfolioRisk.maxDrawdownThreshold}
              min={0.05} max={0.4} step={0.05} format={(v) => `${(v * 100).toFixed(0)}%`}
              onChange={(v) => update(["portfolioRisk", "maxDrawdownThreshold"], v)} />
            <Slider label="Cooling Period" value={config.portfolioRisk.coolingPeriodDays}
              min={1} max={20} step={1} format={(v) => `${v}d`}
              onChange={(v) => update(["portfolioRisk", "coolingPeriodDays"], v)} />
          </div>
          <InfoBox>
            <span className="text-[#ffa502] font-bold block mb-1">⚠ Regime-Adaptive Overrides (V12.5.3):</span>
            ATR Mult, Trailing ATR &amp; Max Hold are set per-trade<br />
            by the regime at entry — not these sliders:<br />
            <span className="text-[#6b85a0]">STRONG_UP: 60d · 2.0× · 2.0× trail</span><br />
            <span className="text-[#6b85a0]">UPTREND: 30d · 2.2× · 1.5× trail</span><br />
            <span className="text-[#6b85a0]">RANGING: 10d · 2.0× · 1.0× trail</span><br />
            <span className="text-[#00d4ff]">★ Entry Threshold controls trade count directly</span>
          </InfoBox>
        </div>

        {/* PORTFOLIO */}
        <div>
          <SectionTitle>PORTFOLIO  (symbol:name:exchange)</SectionTitle>
          <textarea
            value={portfolioInput}
            onChange={(e) => setPortfolioInput(e.target.value)}
            rows={12}
            className="w-full bg-[#0a0e1a] border border-[#1e2d4a] text-[#c8d8f0] text-xs p-2 rounded font-mono resize-none focus:outline-none focus:border-[#00d4ff]/40 leading-relaxed"
            spellCheck={false}
            placeholder={"AAPL:Apple:US\n0700.HK:Tencent:HK"}
          />
          <div className="flex gap-2 mt-2">
            <button onClick={applyPortfolio}
              className="flex-1 px-3 py-1.5 text-xs bg-[#00d4ff]/10 border border-[#00d4ff]/30 text-[#00d4ff] rounded hover:bg-[#00d4ff]/20 transition-all font-bold">
              APPLY
            </button>
            <button
              onClick={() => {
                const def = DEFAULT_CONFIG.stocks.PORTFOLIO.map((s) => `${s.symbol}:${s.name}:${s.exchange}`).join("\n");
                setPortfolioInput(def);
                update(["stocks", "PORTFOLIO"], DEFAULT_CONFIG.stocks.PORTFOLIO);
              }}
              className="px-3 py-1.5 text-xs border border-[#1e2d4a] text-[#4a6080] rounded hover:border-[#ffa502]/60 hover:text-[#ffa502] transition-all">
              ↺ DEFAULT
            </button>
          </div>
          <div className="mt-2 text-[0.65rem] text-[#4a6080]">
            One per line · Exchange: US or HK<br />
            e.g. <span className="text-[#6b85a0]">NVDA:NVIDIA:US</span>
          </div>
        </div>

      </div>
    </div>
  );
}
