import type { WorkerState } from "@/types/worker-state";
import { entryReadyOf } from "@/lib/worker-events";
import { DIGEST_EDITORIAL_SPEC } from "./editorialSpec";
import { pct5d, pct20d, downsideToStopPct, distanceToFlipPct, eventCount, isDefaultParams, fmtPct, fmtKronos } from "./metrics";

export interface KronosRawEntry { last_price: number; forward: { p50: number[] } }
export interface DigestInputs {
  state: WorkerState;
  kronos: Record<string, KronosRawEntry | { _metadata?: unknown }>;
}

const COLUMN_LEGEND = [
  "COLUMN LEGEND — read before interpreting:",
  "- dir: RAW SuperTrend direction (trend telemetry). up alone is NOT a long — the strategy is SuperTrend + 50d SMA: a long is active only when gate=✓. down = exited / no long.",
  "- gate: the strategy's SMA50 entry gate. ✓ = price>SMA50 with dir=up (real long / entry-ready); ⏳ = dir=up but price below SMA50 (flip WITHOUT entry — the strategy is NOT long, watching for reclaim); blank for down names.",
  "- TT: Trend-Template score 0-7 (structural/fundamental quality; 6-7 = elite).",
  "- px: latest price.",
  "- stop: the live SuperTrend line = the level a close must cross to flip dir (resistance when dir=down, support when dir=up). For an open long it is the EXIT; for a down name it is the BUY / flip-up trigger.",
  "- risk%: distance from px DOWN to stop for open longs (dir=up only) = downside cushion before the trailing exit. Blank for down names.",
  "- flip%: signed distance from px to the flip line (stop). + = stop above px, must rally that % to flip up (down names, a potential buy); − = stop below px, must fall that % to flip down (open longs). ~0% = knife-edge, about to flip. THIS is the actionable trigger to watch.",
  "- K5d / K20d: Kronos 5-day and 20-day model projection (% vs current price). K5d with >5% predicted move = high-conviction signal; \"noise\" (>25%) = discard.",
  "- #ev: count of recent flip events (whipsaw proxy; high = unreliable, low-follow-through signals).",
  "- *opt: optimized params; absent = default ATR10 x3.0.",
].join("\n");

function pad(s: string, n: number): string { return (s + " ".repeat(n)).slice(0, n); }

export function assembleDigestPrompt({ state, kronos }: DigestInputs): string {
  const header = "TICK       dir  gate TT   px       stop     risk%  flip%  K5d    K20d   #ev";
  const rows: string[] = [];
  for (const [sym, t] of Object.entries(state.tickers)) {
    const kr = kronos[sym] as KronosRawEntry | undefined;
    const k20 = kr && "forward" in kr ? pct20d(kr.forward.p50, kr.last_price) : null;
    const k5 = kr && "forward" in kr ? pct5d(kr.forward.p50, kr.last_price) : null;
    rows.push(
      pad(sym, 10) + " " +
      pad(t.dir, 4) + " " +
      pad(t.dir !== "up" ? "" : entryReadyOf(t) === false ? "⏳" : entryReadyOf(t) ? "✓" : "?", 4) + " " +
      pad(`${t.score}/7`, 4) + " " +
      pad(t.price.toFixed(2), 8) + " " +
      pad(t.stop.toFixed(2), 8) + " " +
      pad(fmtPct(downsideToStopPct(t)), 6) + " " +
      pad(fmtPct(distanceToFlipPct(t)), 6) + " " +
      pad(fmtPct(k5), 6) + " " +
      pad(fmtKronos(k20), 6) + " " +
      String(eventCount(state.events, sym)) +
      (isDefaultParams(t) ? "" : " *opt"),
    );
  }
  const recentEvents = state.events.slice(-10)
    .map((e) => `${e.ticker} ${e.type} ${e.confirmed ? "EOD" : "prov"} ${e.barDate}`)
    .join(" · ");
  return [
    DIGEST_EDITORIAL_SPEC,
    "",
    `DATA (KV state v${state.version}, as of ${state.updatedAt}; "*opt" = optimized params, else default ATR10 x3.0):`,
    COLUMN_LEGEND,
    "",
    header,
    ...rows,
    "",
    `Recent events: ${recentEvents}`,
  ].join("\n");
}
