import type { WorkerState } from "@/types/worker-state";
import { DIGEST_EDITORIAL_SPEC } from "./editorialSpec";
import { pct20d, downsideToStopPct, distanceToFlipPct, eventCount, isDefaultParams, fmtPct, fmtKronos } from "./metrics";

export interface KronosRawEntry { last_price: number; forward: { p50: number[] } }
export interface TimesfmRawEntry { last_price: number; price_targets: { p50: number[] }; st_persistence?: { flip_risk?: string } }
export interface DigestInputs {
  state: WorkerState;
  kronos: Record<string, KronosRawEntry | { _metadata?: unknown }>;
  timesfm: Record<string, TimesfmRawEntry | { _metadata?: unknown }>;
}

function pad(s: string, n: number): string { return (s + " ".repeat(n)).slice(0, n); }

export function assembleDigestPrompt({ state, kronos, timesfm }: DigestInputs): string {
  const header = "TICK       dir  TT   px       stop     risk%  flip%  K20d   TF20d  fRisk  #ev";
  const rows: string[] = [];
  for (const [sym, t] of Object.entries(state.tickers)) {
    const kr = kronos[sym] as KronosRawEntry | undefined;
    const tf = timesfm[sym] as TimesfmRawEntry | undefined;
    const k = kr && "forward" in kr ? pct20d(kr.forward.p50, kr.last_price) : null;
    const tfv = tf && "price_targets" in tf ? pct20d(tf.price_targets.p50, tf.last_price) : null;
    const frisk = tf && "st_persistence" in tf ? (tf.st_persistence?.flip_risk ?? "—") : "—";
    rows.push(
      pad(sym, 10) + " " +
      pad(t.dir, 4) + " " +
      pad(`${t.score}/7`, 4) + " " +
      pad(t.price.toFixed(2), 8) + " " +
      pad(t.stop.toFixed(2), 8) + " " +
      pad(fmtPct(downsideToStopPct(t)), 6) + " " +
      pad(fmtPct(distanceToFlipPct(t)), 6) + " " +
      pad(fmtKronos(k), 6) + " " +
      pad(fmtPct(tfv), 6) + " " +
      pad(frisk, 6) + " " +
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
    header,
    ...rows,
    "",
    `Recent events: ${recentEvents}`,
  ].join("\n");
}
