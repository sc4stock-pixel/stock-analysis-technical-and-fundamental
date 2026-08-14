/**
 * Report receipts — make every fan-out report prove it accounted for its input.
 *
 * The recurring failure in this codebase is a transform that does some work, prints
 * an answer, and never checks the answer against what went in. On 2026-08-14 the
 * on-demand execution alert counted 16 assets in its footer and rendered 14 rows:
 * GOOGL and 0939.HK matched no tier and were dropped in silence. Nothing compared
 * the two numbers because they came from different code paths.
 *
 * A receipt does that comparison in public, in one line:
 *
 *   16 in → 2 buy · 2 tactical · 2 hold · 4 stripped · 6 watch = 16 ✓
 *   16 in → 2 buy · 2 tactical · 4 stripped · 6 watch = 14 ⚠️ 2 UNACCOUNTED: GOOGL, 0939
 *
 * It is deliberately independent of *how* a report sorts its items, so it catches a
 * missing name for any reason — a classification gap, a de-duplication bug, a tier
 * that is computed but never rendered, or a message truncated before delivery.
 *
 * Returns plain text (no HTML) so callers escape once at their own surface; that also
 * keeps this module free of imports from the Telegram formatters.
 */

export interface ReceiptBucket {
  /** Short label for the receipt line, e.g. "buy", "watch". */
  label: string;
  /** Symbols the report placed in this bucket. */
  symbols: readonly string[];
}

export interface ReceiptOptions {
  /** Display transform applied to symbols in the receipt text, e.g. strip ".HK". */
  display?: (symbol: string) => string;
  /**
   * The report body as it will actually be sent. When supplied, a symbol that no
   * bucket lost but that does not appear in the text is still reported unaccounted —
   * this is what catches a tier that was computed and then never rendered.
   */
  renderedText?: string;
  /** Cap on how many symbols are named in the text before it elides. */
  maxNamed?: number;
}

export interface Receipt {
  /** One-line plain-text receipt, ready to escape and append. */
  text: string;
  /** In the universe, but in no bucket (or missing from renderedText). */
  unaccounted: string[];
  /** In more than one bucket — double-counted. */
  duplicated: string[];
  /** In a bucket but not in the universe — invented by the report. */
  unexpected: string[];
  /** True when the report accounted for its input exactly once each. */
  ok: boolean;
}

function nameList(symbols: string[], display: (s: string) => string, max: number): string {
  const shown = symbols.slice(0, max).map(display);
  const rest = symbols.length - shown.length;
  return shown.join(", ") + (rest > 0 ? `, +${rest} more` : "");
}

/**
 * Reconciles the items a report was given against the buckets it sorted them into.
 *
 * @param universe every item the report was asked to account for (duplicates ignored)
 * @param buckets  the report's rendered buckets, in display order
 */
export function buildReceipt(
  universe: readonly string[],
  buckets: readonly ReceiptBucket[],
  opts: ReceiptOptions = {},
): Receipt {
  const display = opts.display ?? ((s: string) => s);
  const maxNamed = opts.maxNamed ?? 5;

  const universeSet = new Set(universe);
  const counts = new Map<string, number>();
  for (const b of buckets) {
    for (const s of b.symbols) counts.set(s, (counts.get(s) ?? 0) + 1);
  }

  const unaccounted: string[] = [];
  const duplicated: string[] = [];
  // Array.from, not `for..of` over the Set — the tsconfig target predates downlevelIteration.
  for (const s of Array.from(universeSet)) {
    const n = counts.get(s) ?? 0;
    if (n === 0) unaccounted.push(s);
    else if (n > 1) duplicated.push(s);
    else if (opts.renderedText !== undefined && !opts.renderedText.includes(display(s))) {
      // Bucketed but never made it into the message body.
      unaccounted.push(s);
    }
  }
  const unexpected = Array.from(counts.keys()).filter(s => !universeSet.has(s));

  const parts = buckets
    .filter(b => b.symbols.length > 0)
    .map(b => `${b.symbols.length} ${b.label}`)
    .join(" · ");
  const placed = buckets.reduce((n, b) => n + b.symbols.length, 0);

  const flags: string[] = [];
  if (unaccounted.length > 0)
    flags.push(`⚠️ ${unaccounted.length} UNACCOUNTED: ${nameList(unaccounted, display, maxNamed)}`);
  if (duplicated.length > 0)
    flags.push(`⚠️ ${duplicated.length} DOUBLE-COUNTED: ${nameList(duplicated, display, maxNamed)}`);
  if (unexpected.length > 0)
    flags.push(`⚠️ ${unexpected.length} UNEXPECTED: ${nameList(unexpected, display, maxNamed)}`);

  const ok = flags.length === 0;
  const sum = `= ${placed}${ok ? " ✓" : ""}`;
  const text = [`${universeSet.size} in → ${parts || "(none)"}`, sum, ...flags].join(" ");

  return { text, unaccounted, duplicated, unexpected, ok };
}
