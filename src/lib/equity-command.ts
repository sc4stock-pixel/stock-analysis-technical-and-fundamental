import { htmlEscape } from "@/lib/telegram";

// KV key + value shape for the owner-settable sizing equity figure.
// The autopilot worker (separate repo) reads this key directly; the set
// value is gospel — no cross-checks against live account data.
export const EQUITY_KV_KEY = "sizing_equity_usd";

export const EQUITY_MIN = 1_000;
export const EQUITY_MAX = 100_000_000;
export const EQUITY_DEFAULT = 100_000; // worker's built-in fallback when KV is unset

export interface EquityRecord {
  value: number;
  updated_at: string; // ISO timestamp
}

export type ParsedEquityCommand =
  | { show: true }
  | { value: number }
  | { error: string };

const USAGE = `Usage: <code>/equity</code> (show) or <code>/equity 105000</code> (set)\nRange: $${EQUITY_MIN.toLocaleString("en-US")} - $${EQUITY_MAX.toLocaleString("en-US")}`;

/** Parses "/equity", "/equity 105000", "/equity 105,000", "/equity $105000". */
export function parseEquityCommand(text: string): ParsedEquityCommand {
  const parts = text.trim().split(/\s+/);
  const args = parts.slice(1);
  if (args.length === 0) return { show: true };
  if (args.length > 1) return { error: USAGE };

  const raw = args[0].trim();
  const cleaned = raw.replace(/^\$/, "").replace(/,/g, "");

  if (!/^\d+$/.test(cleaned)) return { error: USAGE };

  const value = Number(cleaned);
  if (!Number.isFinite(value) || !Number.isInteger(value)) return { error: USAGE };
  if (value < EQUITY_MIN || value > EQUITY_MAX) return { error: USAGE };

  return { value };
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

/** Builds the HTML-safe reply for a show (no update) or a set (update) request. */
export function formatEquityReply(current: EquityRecord | null, updated?: EquityRecord): string {
  if (updated) {
    const from = current ? fmtUsd(current.value) : `built-in default ${fmtUsd(EQUITY_DEFAULT)}`;
    return htmlEscape(`Sizing equity updated: ${from} → ${fmtUsd(updated.value)}`);
  }
  if (!current) {
    return htmlEscape(`No equity set — worker uses its built-in default ${fmtUsd(EQUITY_DEFAULT)}`);
  }
  const date = current.updated_at.slice(0, 10);
  return htmlEscape(`Sizing equity: ${fmtUsd(current.value)} (updated ${date})`);
}
