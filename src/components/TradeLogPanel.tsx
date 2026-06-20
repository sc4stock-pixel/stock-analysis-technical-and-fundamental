"use client";
import { useState, useMemo } from "react";
import type { TradeLogRecord } from "@/types/trade-log";
import { computeSlippage, summarize } from "@/lib/slippage";

interface Props {
  records: TradeLogRecord[];
}

type SortKey = "date" | "ticker" | "slippage";

export default function TradeLogPanel({ records }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [asc, setAsc] = useState(false);

  const summary = useMemo(() => summarize(records), [records]);

  const sorted = useMemo(() => {
    const copy = [...records];
    copy.sort((a, b) => {
      if (sortKey === "slippage") {
        // Unfilled rows always sort to the bottom, regardless of direction.
        const sa = computeSlippage(a)?.slippagePct ?? null;
        const sb = computeSlippage(b)?.slippagePct ?? null;
        if (sa === null && sb === null) return 0;
        if (sa === null) return 1;
        if (sb === null) return -1;
        return asc ? sa - sb : sb - sa;
      }
      let cmp = 0;
      if (sortKey === "ticker") cmp = a.ticker.localeCompare(b.ticker);
      else cmp = a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker);
      return asc ? cmp : -cmp;
    });
    return copy;
  }, [records, sortKey, asc]);

  if (records.length === 0) return null;

  const setSort = (k: SortKey) => {
    if (k === sortKey) setAsc(!asc);
    else { setSortKey(k); setAsc(false); }
  };

  const arrow = (k: SortKey) => (k === sortKey ? (asc ? " ▲" : " ▼") : "");

  const fmtPct = (n: number | null) =>
    n === null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
  const fmtAdverse = (n: number | null) =>
    n === null ? "—" : `${n.toFixed(0)}%`;

  return (
    <div className="mx-4 my-3 rounded border border-[#1e2d4a] bg-[#0f1629]">

      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer select-none"
        onClick={() => setCollapsed(v => !v)}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[#00d4ff] text-xs font-bold tracking-widest">
            📒 TRADE LOG — EXECUTION ATTRIBUTION
          </span>
          <span className="text-[#4a6080] text-xs">
            ({summary.filled}/{summary.filled + summary.unfilled} filled)
          </span>
          <span className="text-[#1e2d4a]">|</span>
          <span className="text-[#4a6080] text-xs">
            Avg slip{" "}
            <span className="text-[#c8d8f0] font-bold">{fmtPct(summary.avgPct)}</span>
          </span>
          <span className="text-[#4a6080] text-xs">
            Median <span className="text-[#c8d8f0]">{fmtPct(summary.medianPct)}</span>
          </span>
          <span className="text-[#4a6080] text-xs">
            Adverse{" "}
            <span className={(summary.pctAdverse ?? 0) > 50 ? "text-[#ff4757] font-bold" : "text-[#c8d8f0]"}>
              {fmtAdverse(summary.pctAdverse)}
            </span>
          </span>
        </div>
        <span className="text-[#4a6080] text-xs">{collapsed ? "▼" : "▲"}</span>
      </div>

      {!collapsed && (
        <div className="px-3 pb-3 border-t border-[#1e2d4a]/50">

          {/* params_source split */}
          <div className="flex flex-wrap gap-2 mt-2">
            {(["optimized", "default_fallback"] as const).map((src) => {
              const a = summary.byParamsSource[src];
              if (!a) return null;
              return (
                <div
                  key={src}
                  className="rounded border border-[#1e2d4a] bg-[#0a0e1a] px-2.5 py-1.5"
                >
                  <div className="text-[0.6rem] text-[#4a6080] uppercase tracking-wider">
                    params_source: {src}
                  </div>
                  <div className="text-xs text-[#c8d8f0] font-bold mt-0.5">
                    {fmtPct(a.avgPct)}
                    <span className="text-[#4a6080] font-normal ml-1">
                      avg · {a.filled} filled ·{" "}
                      <span className={(a.pctAdverse ?? 0) > 50 ? "text-[#ff4757]" : "text-[#4a6080]"}>
                        {fmtAdverse(a.pctAdverse)} adverse
                      </span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Table */}
          <div className="overflow-x-auto mt-2 rounded border border-[#1e2d4a]">
            <table className="w-full text-xs min-w-[640px]">
              <thead>
                <tr className="bg-[#0f1629] border-b border-[#1e2d4a] text-[#4a6080] uppercase tracking-wider">
                  <th
                    className="text-left px-2 py-1.5 font-normal cursor-pointer select-none hover:text-[#c8d8f0]"
                    onClick={() => setSort("date")}
                  >Date{arrow("date")}</th>
                  <th
                    className="text-left px-2 py-1.5 font-normal cursor-pointer select-none hover:text-[#c8d8f0]"
                    onClick={() => setSort("ticker")}
                  >Ticker{arrow("ticker")}</th>
                  <th className="text-left px-2 py-1.5 font-normal">Type</th>
                  <th className="text-right px-2 py-1.5 font-normal">Signal</th>
                  <th className="text-right px-2 py-1.5 font-normal">Fill</th>
                  <th
                    className="text-right px-2 py-1.5 font-normal cursor-pointer select-none hover:text-[#c8d8f0]"
                    onClick={() => setSort("slippage")}
                  >Slippage{arrow("slippage")}</th>
                  <th className="text-left px-2 py-1.5 font-normal">Source</th>
                  <th className="text-right px-2 py-1.5 font-normal">TT</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, idx) => {
                  const s = computeSlippage(r);
                  return (
                    <tr
                      key={r.id}
                      className={`border-b border-[#1e2d4a]/40 ${idx % 2 === 0 ? "bg-[#0a0e1a]" : "bg-[#0f1629]"}`}
                    >
                      <td className="px-2 py-1.5 text-[#6b85a0]">{r.date}</td>
                      <td className="px-2 py-1.5 text-[#00d4ff] font-bold">{r.ticker}</td>
                      <td className="px-2 py-1.5 text-[#c8d8f0]">{r.type}</td>
                      <td className="px-2 py-1.5 text-right text-[#c8d8f0]">
                        {r.signal_price ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right text-[#c8d8f0]">
                        {r.actual_fill_price ?? "—"}
                      </td>
                      <td
                        className={`px-2 py-1.5 text-right font-bold ${
                          s ? (s.adverse ? "text-[#ff4757]" : "text-[#00ff88]") : "text-[#4a6080]"
                        }`}
                      >
                        {s ? `${s.slippagePct >= 0 ? "+" : ""}${s.slippagePct.toFixed(2)}%` : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-[#6b85a0]">{r.params_source ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right text-[#6b85a0]">{r.tt_score ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Footer note */}
          <div className="mt-2 text-[0.6rem] text-[#2a3d5a]">
            Slippage = (fill ÷ signal − 1) · Red = adverse fill · Green = favorable · Unfilled rows show —
          </div>
        </div>
      )}
    </div>
  );
}
