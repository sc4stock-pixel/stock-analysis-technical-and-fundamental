"use client";
import { AppConfig } from "@/types";
import { useState } from "react";

interface Props {
  config: AppConfig;
  onChange: (c: AppConfig) => void;
}

function Slider({ label, value, min, max, step, onChange, format }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; format?: (v: number) => string;
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-[#6b85a0] text-xs w-44 shrink-0">{label}</label>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 h-1 accent-[#00d4ff]"
      />
      <span className="text-[#00d4ff] text-xs w-16 text-right">
        {format ? format(value) : value}
      </span>
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-[#6b85a0] text-xs w-44 shrink-0">{label}</label>
      <button
        onClick={() => onChange(!value)}
        className={`px-3 py-0.5 text-xs rounded border transition-all ${value
          ? "bg-[#00d4ff]/10 border-[#00d4ff]/40 text-[#00d4ff]"
          : "bg-[#1e2d4a]/40 border-[#1e2d4a] text-[#4a6080]"
        }`}
      >
        {value ? "ON" : "OFF"}
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[#00d4ff]/60 text-xs font-bold mb-2 tracking-widest">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export default function ConfigPanel({ config, onChange }: Props) {
  const [portfolioInput, setPortfolioInput] = useState(
    config.stocks.PORTFOLIO.map((s) => `${s.symbol}:${s.name}:${s.exchange}`).join("\n")
  );

  const update = (path: string[], value: unknown) => {
    const newConfig = JSON.parse(JSON.stringify(config));
    let obj: Record<string, unknown> = newConfig;
    for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]] as Record<string, unknown>;
    obj[path[path.length - 1]] = value;
    onChange(newConfig);
  };

  const applyPortfolio = () => {
    const lines = portfolioInput.split("\n").filter((l) => l.trim());
    const stocks = lines.map((l) => {
      const [symbol, name, exchange] = l.split(":").map((s) => s.trim());
      return { symbol: symbol.toUpperCase(), name: name ?? symbol, exchange: (exchange ?? "US") as "US" | "HK" };
    }).filter((s) => s.symbol);
    update(["stocks", "PORTFOLIO"], stocks);
  };

  return (
    <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
      {/* SIGNAL */}
      <Section title="SIGNAL">
        <Slider label="Entry Threshold" value={config.signal.entryThreshold} min={4.5} max={8} step={0.5}
          onChange={(v) => update(["signal", "entryThreshold"], v)} />
        <Slider label="Exit Threshold" value={config.signal.exitThreshold} min={2} max={5.5} step={0.5}
          onChange={(v) => update(["signal", "exitThreshold"], v)} />
        <Slider label="Confirm Bars" value={config.signal.signalConfirmationBars} min={0} max={5} step={1}
          onChange={(v) => update(["signal", "signalConfirmationBars"], v)} />
        <Slider label="Max Hold Days" value={config.signal.maxHoldingDays} min={3} max={60} step={1}
          onChange={(v) => update(["signal", "maxHoldingDays"], v)} />
        <Toggle label="Trend Gate" value={config.signal.trendGateEnabled}
          onChange={(v) => update(["signal", "trendGateEnabled"], v)} />
      </Section>

      {/* BACKTEST */}
      <Section title="BACKTEST">
        <Slider label="Initial Capital" value={config.backtest.initialCapital} min={1000} max={100000} step={1000}
          onChange={(v) => update(["backtest", "initialCapital"], v)}
          format={(v) => `$${v.toLocaleString()}`} />
        <Slider label="Lookback Days" value={config.backtest.lookbackDays} min={100} max={504} step={21}
          onChange={(v) => update(["backtest", "lookbackDays"], v)}
          format={(v) => `${v}d`} />
        <Slider label="Commission" value={config.backtest.commissionRate} min={0} max={0.005} step={0.0005}
          onChange={(v) => update(["backtest", "commissionRate"], v)}
          format={(v) => `${(v * 100).toFixed(2)}%`} />
        <Toggle label="Van Tharp Sizing" value={config.backtest.use_van_tharp}
          onChange={(v) => update(["backtest", "use_van_tharp"], v)} />
      </Section>

      {/* RISK */}
      <Section title="RISK">
        <Slider label="ATR Multiplier" value={config.risk.atrMultiplier} min={1} max={5} step={0.25}
          onChange={(v) => update(["risk", "atrMultiplier"], v)} />
        <Slider label="Trailing ATR Mult" value={config.risk.trailingAtrMultiplier} min={0.5} max={3} step={0.25}
          onChange={(v) => update(["risk", "trailingAtrMultiplier"], v)} />
        <Slider label="Risk Per Trade" value={config.risk.riskPerTrade} min={0.005} max={0.03} step={0.0025}
          onChange={(v) => update(["risk", "riskPerTrade"], v)}
          format={(v) => `${(v * 100).toFixed(2)}%`} />
        <Slider label="Max Position" value={config.risk.maxPositionSize} min={0.05} max={1} step={0.05}
          onChange={(v) => update(["risk", "maxPositionSize"], v)}
          format={(v) => `${(v * 100).toFixed(0)}%`} />
        <Toggle label="Kill Switch" value={config.portfolioRisk.killSwitchEnabled}
          onChange={(v) => update(["portfolioRisk", "killSwitchEnabled"], v)} />
        <Slider label="Max Drawdown" value={config.portfolioRisk.maxDrawdownThreshold} min={0.05} max={0.4} step={0.05}
          onChange={(v) => update(["portfolioRisk", "maxDrawdownThreshold"], v)}
          format={(v) => `${(v * 100).toFixed(0)}%`} />
      </Section>

      {/* PORTFOLIO */}
      <Section title="PORTFOLIO (symbol:name:exchange)">
        <textarea
          value={portfolioInput}
          onChange={(e) => setPortfolioInput(e.target.value)}
          rows={10}
          className="w-full bg-[#0a0e1a] border border-[#1e2d4a] text-[#c8d8f0] text-xs p-2 rounded font-mono resize-none focus:outline-none focus:border-[#00d4ff]/40"
          spellCheck={false}
        />
        <button
          onClick={applyPortfolio}
          className="px-3 py-1 text-xs bg-[#00d4ff]/10 border border-[#00d4ff]/30 text-[#00d4ff] rounded hover:bg-[#00d4ff]/20 transition-all"
        >
          APPLY PORTFOLIO
        </button>
      </Section>
    </div>
  );
}
