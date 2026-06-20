import type { TradeLogRecord } from "@/types/trade-log";

export interface Slippage {
  slippagePct: number; // signed raw: (fill/signal - 1) * 100, 4dp
  adverse: boolean;    // true = worse execution than signal
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export function computeSlippage(r: TradeLogRecord): Slippage | null {
  const sig = r.signal_price;
  const fill = r.actual_fill_price;
  if (!finite(sig) || sig === 0 || !finite(fill)) return null;
  const slippagePct = Math.round((fill / sig - 1) * 1e6) / 1e4;
  const adverse = r.type === "entry" ? fill > sig : fill < sig;
  return { slippagePct, adverse };
}

export function slippageLabel(r: TradeLogRecord): string {
  const s = computeSlippage(r);
  if (!s) return "—";
  const sign = s.slippagePct >= 0 ? "+" : "";
  return `${sign}${s.slippagePct.toFixed(2)}% (${s.adverse ? "adverse" : "favorable"})`;
}

interface Agg {
  filled: number;
  unfilled: number;
  avgPct: number | null;
  medianPct: number | null;
  pctAdverse: number | null;
}

function aggregate(recs: TradeLogRecord[]): Agg {
  const slips = recs.map(computeSlippage).filter((s): s is Slippage => s !== null);
  const filled = slips.length;
  const unfilled = recs.length - filled;
  if (filled === 0) {
    return { filled: 0, unfilled, avgPct: null, medianPct: null, pctAdverse: null };
  }
  const pcts = slips.map((s) => s.slippagePct).sort((a, b) => a - b);
  const avgPct = pcts.reduce((a, b) => a + b, 0) / filled;
  const mid = Math.floor(filled / 2);
  const medianPct = filled % 2 ? pcts[mid] : (pcts[mid - 1] + pcts[mid]) / 2;
  const pctAdverse = (slips.filter((s) => s.adverse).length / filled) * 100;
  return {
    filled,
    unfilled,
    avgPct: Math.round(avgPct * 1e4) / 1e4,
    medianPct: Math.round(medianPct * 1e4) / 1e4,
    pctAdverse: Math.round(pctAdverse * 1e4) / 1e4,
  };
}

export interface TradeLogSummary extends Agg {
  byParamsSource: Record<string, Agg>;
}

export function summarize(recs: TradeLogRecord[]): TradeLogSummary {
  const bySrc: Record<string, TradeLogRecord[]> = {};
  for (const r of recs) {
    const key = r.params_source ?? "unknown";
    (bySrc[key] ??= []).push(r);
  }
  const byParamsSource: Record<string, Agg> = {};
  for (const [key, list] of Object.entries(bySrc)) byParamsSource[key] = aggregate(list);
  return { ...aggregate(recs), byParamsSource };
}
