import type { TradeLogRecord } from "@/types/trade-log";

const MAX_ENTRIES = 500; // mirror worker/trade_log.py

export type FillSelector =
  | { kind: "id"; id: string }
  | { kind: "ticker"; ticker: string };

export type FillCommand =
  | { mode: "list" }
  | { mode: "error"; reason: "price" | "date" | "usage" }
  | { mode: "fill"; selector: FillSelector; price: number; date: string | null };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseFillCommand(text: string): FillCommand {
  const parts = text.trim().split(/\s+/);
  // parts[0] is the command token (e.g. "/fill")
  const args = parts.slice(1);
  if (args.length === 0) return { mode: "list" };
  if (args.length < 2) return { mode: "error", reason: "usage" };
  const [target, priceStr, dateStr] = args;
  const price = Number(priceStr);
  if (!Number.isFinite(price) || price <= 0) return { mode: "error", reason: "price" };
  if (dateStr !== undefined && !DATE_RE.test(dateStr)) return { mode: "error", reason: "date" };
  const selector: FillSelector = target.includes("|")
    ? { kind: "id", id: target }
    : { kind: "ticker", ticker: target.toUpperCase() };
  return { mode: "fill", selector, price, date: dateStr ?? null };
}

export type TargetResult =
  | { kind: "one"; id: string }
  | { kind: "none" }
  | { kind: "ambiguous"; ids: string[] };

export function selectFillTarget(log: TradeLogRecord[], sel: FillSelector): TargetResult {
  if (sel.kind === "id") {
    return log.some((r) => r.id === sel.id) ? { kind: "one", id: sel.id } : { kind: "none" };
  }
  const unfilled = log
    .filter((r) => r.ticker.toUpperCase() === sel.ticker && r.actual_fill_price == null)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (unfilled.length === 0) return { kind: "none" };
  if (unfilled.length === 1) return { kind: "one", id: unfilled[0].id };
  return { kind: "ambiguous", ids: unfilled.map((r) => r.id) };
}

export function applyFill(
  log: TradeLogRecord[], id: string, price: number, date: string,
): TradeLogRecord[] {
  if (!Number.isFinite(price)) throw new Error("non-finite fill price");
  const out = log.map((r) =>
    r.id === id ? { ...r, actual_fill_price: price, actual_fill_date: date } : r);
  return out.slice(-MAX_ENTRIES);
}

export function stripNaN(raw: string): string {
  return raw.replace(/\bNaN\b/g, "null").replace(/-?Infinity\b/g, "null");
}
