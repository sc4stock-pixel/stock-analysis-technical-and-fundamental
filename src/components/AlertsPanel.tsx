"use client";
import { useState, useMemo } from "react";
import InfoTooltip from "@/components/InfoTooltip";
import { StockAnalysisResult } from "@/types";
import type { WorkerState } from "@/types/worker-state";
import type { ReconciledEvent } from "@/lib/worker-events";
import { buildAlertModel, type ActionableRow } from "@/lib/alert-model";

interface Props {
  results: StockAnalysisResult[];
  workerState?: WorkerState | null;
}

const EVENT_META: Record<string, { icon: string; label: string; cls: string }> = {
  flip_buy:    { icon: "⬆", label: "SuperTrend FLIP BUY",  cls: "border-[#00ff88]/25 bg-[#00ff88]/5" },
  flip_exit:   { icon: "⬇", label: "SuperTrend FLIP EXIT", cls: "border-[#ff4757]/25 bg-[#ff4757]/5" },
  tt_stripped: { icon: "⚠", label: "TT 5→4 STRIPPED",     cls: "border-[#ffa502]/25 bg-[#ffa502]/5" },
  tt_regained: { icon: "✅", label: "TT 4→5 REGAINED",     cls: "border-[#00ff88]/25 bg-[#00ff88]/5" },
  sma50_cross_up:   { icon: "📈", label: "CROSSED ABOVE SMA50", cls: "border-[#00ff88]/25 bg-[#00ff88]/5" },
  sma50_cross_down: { icon: "📉", label: "FELL BELOW SMA50",    cls: "border-[#ff4757]/25 bg-[#ff4757]/5" },
};

function workerEventRow(ev: ReconciledEvent, idx: number) {
  const meta = EVENT_META[ev.type] ?? { icon: "·", label: ev.type, cls: "" };
  const status = ev.confirmed ? "CONFIRMED" : "PROVISIONAL";
  const isFlip = ev.type === "flip_buy" || ev.type === "flip_exit";
  const stArrow = ev.currentDir === "up" ? "ST↑" : ev.currentDir === "down" ? "ST↓" : "";
  return (
    <div
      key={`worker-${idx}`}
      className={`flex items-start gap-2 text-xs p-1.5 rounded border mb-1 ${meta.cls} ${ev.superseded ? "opacity-50" : ""}`}
    >
      <span className="shrink-0">{meta.icon}</span>
      <span className="flex-1">
        <strong>{ev.ticker}</strong> {meta.label}
        <span className="text-[#4a6080] ml-1">
          [{ev.barDate} · {ev.session.toUpperCase()} · {status}]
        </span>
        {isFlip && ev.current && (
          <span className="ml-1 text-[#00ff88]">✓ current{stArrow ? ` (${stArrow})` : ""}</span>
        )}
        {isFlip && ev.superseded && ev.reverted && (
          <span className="ml-1 text-[#ffa502]">↳ reverted{stArrow ? ` · now ${stArrow}` : ""}</span>
        )}
        {isFlip && ev.superseded && !ev.reverted && (
          <span className="ml-1 text-[#4a6080]">↳ superseded</span>
        )}
      </span>
    </div>
  );
}

function ActRow({ r }: { r: ActionableRow }) {
  const out = r.stance === "out";
  const border = r.whipsaw ? "border-[#ffa502]/34 bg-[#ffa502]/5"
    : out ? (r.ttFlag ? "border-[#ff4757]/55 bg-[#ff4757]/8" : "border-[#ff4757]/30 bg-[#ff4757]/5")
    : "border-[#00ff88]/30 bg-[#00ff88]/5";
  const arrowColor = r.whipsaw ? "text-[#ffa502]" : out ? "text-[#ff4757]" : "text-[#00ff88]";
  const pill = out ? "bg-[#ff4757]/15 text-[#ff6b78]"
    : r.entryReady === false ? "bg-[#ffa502]/15 text-[#ffa502]"   // gate not passed — amber, not green
    : "bg-[#00ff88]/14 text-[#3affa0]";
  return (
    <div>
      <div className={`flex items-center gap-2 text-[0.7rem] rounded px-2 py-1.5 ${r.whipsaw ? "mb-0.5" : "mb-1.5"} border ${border}`}
           data-alert-type="flip" data-symbol={r.symbol} data-stance={r.stance} data-bars-since={r.barsSince}>
        <span className={`shrink-0 ${arrowColor}`}>{r.arrow}</span>
        <span className="font-mono font-bold text-[#e6edf5]">{r.symbol.replace(".HK", "")}</span>
        <span className="text-[#8aa0bd]">
          {r.change}
          {r.ttFlag && <span className="ml-1 font-mono text-[0.6rem] px-1 py-0.5 rounded bg-[#ffa502]/18 border border-[#ffa502]/45 text-[#ffa502]">{r.ttFlag}</span>}
        </span>
        <span className="flex-1" />
        {r.barsSince === 0
          ? <span className="font-mono text-[0.55rem] font-bold px-1 py-0.5 rounded bg-[#f59e0b]/20 border border-[#f59e0b]/40 text-[#f59e0b]">TODAY</span>
          : <span className="font-mono text-[0.6rem] text-[#6b82a3]">{r.barsSince}d</span>}
        <span className={`font-mono text-[0.6rem] font-medium px-1.5 py-0.5 rounded ${pill}`}
              title={r.entryReady === false ? "ST flipped up but price is below SMA50 — the strategy has NOT entered (waits for reclaim)" : undefined}>
          {out ? "OUT · ST↓" : r.entryReady === false ? "⏳ WAIT · ST↑" : "LONG · ST↑"}
        </span>
      </div>
      {r.whipsaw && r.rawCount != null && (
        <div className="font-mono text-[0.6rem] text-[#4a6080] pl-7 pb-1.5">{r.rawCount} raw events folded → see audit log</div>
      )}
    </div>
  );
}

export default function AlertsPanel({ results, workerState }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const model = useMemo(
    () => buildAlertModel(
      workerState?.events ?? [],
      workerState?.tickers ?? {},
      results,
    ),
    [results, workerState],
  );
  const { actOnThis, auditLog, otherAlerts } = model;
  const total = actOnThis.length + auditLog.length + otherAlerts.length;
  if (total === 0) return null;

  const hasExit = actOnThis.some(r => r.stance === "out");
  const pillCls = hasExit
    ? "bg-[#ff4757]/15 border-[#ff4757]/40 text-[#ff6b78]"
    : "bg-[#f59e0b]/15 border-[#f59e0b]/40 text-[#f59e0b]";

  return (
    <div className="bg-[#0f1629] border border-[#1e2d4a] rounded p-3 my-3">
      <div className="flex items-center justify-between cursor-pointer select-none" onClick={() => setCollapsed(!collapsed)}>
        <div className="flex items-center gap-2">
          <span className="text-[#f59e0b] text-sm font-bold">⚡ ALERTS</span>
          <InfoTooltip id="alerts" />
          <span className="text-[#4a6080] text-xs">({total})</span>
          {actOnThis.length > 0 && (
            <span className={`text-[0.6rem] font-mono font-bold px-1.5 py-0.5 rounded border ${pillCls}`}>
              {actOnThis.length} TO ACT
            </span>
          )}
        </div>
        <span className="text-[#4a6080] text-xs">{collapsed ? "▼" : "▲"}</span>
      </div>

      {!collapsed && (
        <div className="mt-2">
          {actOnThis.length > 0 && (
            <div className="mb-3">
              <div className="text-[0.6rem] font-mono text-[#e6edf5] tracking-widest mb-1.5">ACT ON THIS</div>
              {actOnThis.map((r, i) => <ActRow key={`act-${i}`} r={r} />)}
            </div>
          )}

          {auditLog.length > 0 && (
            <details className="mb-3">
              <summary className="text-[0.6rem] font-mono text-[#00d4ff] tracking-widest cursor-pointer">
                RECENT DETECTIONS — full audit log ({auditLog.length})
              </summary>
              <div className="mt-1.5">{auditLog.map((ev, i) => workerEventRow(ev, i))}</div>
            </details>
          )}

          {otherAlerts.length > 0 && (
            <div>
              <div className="text-[0.6rem] font-mono text-[#4a6080] tracking-widest mb-1.5">OTHER ALERTS</div>
              <div className="space-y-1.5">
                {otherAlerts.map((a, i) => (
                  <div key={`info-${i}`} className="flex items-start gap-2 text-[0.7rem] border-b border-[#1e2d4a]/30 pb-1 last:border-0"
                       data-alert-type={a.alertType} data-symbol={a.symbol ?? ""}>
                    <span className="shrink-0 mt-0.5">{a.icon}</span>
                    <span>{a.text.split(/(<strong>.*?<\/strong>)/g).map((p, j) =>
                      p.startsWith("<strong>") ? <strong key={j}>{p.replace(/<\/?strong>/g, "")}</strong> : p)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
