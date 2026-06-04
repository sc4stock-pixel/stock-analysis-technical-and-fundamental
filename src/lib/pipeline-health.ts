export interface Validity { total: number; validCount: number; degraded: boolean; }

/** A row is valid when it has no error and a real price. Degraded when 0 valid or <50%. */
export function classifyValidity(payload: Array<Record<string, unknown>>): Validity {
  const total = payload.length;
  const validCount = payload.filter(
    r => !r.error && typeof r.current_price === "number" && (r.current_price as number) > 0
  ).length;
  const degraded = total > 0 && validCount < total * 0.5;
  return { total, validCount, degraded };
}

export function degradedAlertText(v: Validity, surface: string): string {
  return `⚠️ <b>PIPELINE DEGRADED</b> — ${surface}\n${v.validCount}/${v.total} stocks returned valid data. Report suppressed.`;
}
