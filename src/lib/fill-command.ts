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

// A record is fillable only when it's a CONFIRMED (EOD-ratified) flip that isn't
// filled yet. Provisional intraday flips (confirmed === false) may never have
// executed — a same-day SuperTrend re-cross that the EOD bar didn't sustain — so
// they must not be filled.
export function isFillable(r: TradeLogRecord): boolean {
  return r.confirmed === true && r.actual_fill_price == null;
}

export type TargetResult =
  | { kind: "one"; id: string }
  | { kind: "none" }
  | { kind: "provisional"; id: string }
  | { kind: "ambiguous"; ids: string[] };

export function selectFillTarget(log: TradeLogRecord[], sel: FillSelector): TargetResult {
  if (sel.kind === "id") {
    const rec = log.find((r) => r.id === sel.id);
    if (!rec) return { kind: "none" };
    if (!rec.confirmed) return { kind: "provisional", id: sel.id };
    return { kind: "one", id: sel.id };
  }
  const fillable = log
    .filter((r) => r.ticker.toUpperCase() === sel.ticker && isFillable(r))
    .sort((a, b) => b.date.localeCompare(a.date));
  if (fillable.length === 0) return { kind: "none" };
  if (fillable.length === 1) return { kind: "one", id: fillable[0].id };
  return { kind: "ambiguous", ids: fillable.map((r) => r.id) };
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
