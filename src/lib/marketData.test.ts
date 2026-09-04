import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchYahooOHLCV, settledCloseForBar } from "@/lib/marketData";

// ── Fixtures ────────────────────────────────────────────────────────────────
// Shape mirrors the real Yahoo chart payload for AAPL on 2026-09-04: the
// 2026-09-03 bar has Open/High/Low/Volume populated but `close: null`, while
// meta.regularMarketPrice holds the actual settle (328.21 @ 20:00:01Z).
const DAY = 86400;
const LAST_TS = Math.floor(Date.parse("2026-09-03T13:30:00Z") / 1000); // US open
const SETTLE_TS = Math.floor(Date.parse("2026-09-03T20:00:01Z") / 1000); // US close
const N_BARS = 60;
// Escalating closes so "one session back" and "two sessions back" are
// distinguishable — the change-% assertion below depends on it.
const closeAt = (i: number) => 300 + i * 0.4; // bars 0..58 -> 300.00 .. 323.20
const PREV_CLOSE = closeAt(N_BARS - 2);       // 2026-09-02
const PREV_PREV_CLOSE = closeAt(N_BARS - 3);  // 2026-09-01 (used when the bar is dropped)

const TIMESTAMPS = Array.from({ length: N_BARS }, (_, i) => LAST_TS - (N_BARS - 1 - i) * DAY);

/** chart payload; `close` on the final bar is replaced by `finalClose` (null by default). */
function chart(meta: Record<string, unknown>, finalClose: number | null = null) {
  const n = N_BARS;
  return {
    chart: {
      result: [{
        meta,
        timestamp: TIMESTAMPS,
        indicators: {
          quote: [{
            open:   Array.from({ length: n }, (_, i) => (i === n - 1 ? 324.95 : closeAt(i))),
            high:   Array.from({ length: n }, (_, i) => (i === n - 1 ? 330.81 : closeAt(i) + 2)),
            low:    Array.from({ length: n }, (_, i) => (i === n - 1 ? 324.11 : closeAt(i) - 2)),
            close:  Array.from({ length: n }, (_, i) => (i === n - 1 ? finalClose : closeAt(i))),
            volume: Array.from({ length: n }, () => 1_000_000),
          }],
        },
      }],
    },
  };
}

const SETTLED_META = { regularMarketPrice: 328.21, regularMarketTime: SETTLE_TS };

function stubChart(payload: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
  })));
}

afterEach(() => { vi.unstubAllGlobals(); });

// ── settledCloseForBar: the two guards ──────────────────────────────────────
describe("settledCloseForBar", () => {
  it("returns the settle when the quote belongs to the bar's own session and has stopped moving", () => {
    const now = Date.parse("2026-09-04T01:00:00Z"); // 5h after the close
    expect(settledCloseForBar(SETTLED_META, LAST_TS, now)).toBe(328.21);
  });

  it("guard 1 — rejects a quote from a different session", () => {
    const nextDay = { regularMarketPrice: 328.21, regularMarketTime: SETTLE_TS + DAY };
    expect(settledCloseForBar(nextDay, LAST_TS, Date.parse("2026-09-04T01:00:00Z"))).toBeNull();
  });

  it("guard 2 — rejects a quote that is still ticking (live intraday session)", () => {
    const fiveMinAfterClose = SETTLE_TS * 1000 + 5 * 60 * 1000;
    expect(settledCloseForBar(SETTLED_META, LAST_TS, fiveMinAfterClose)).toBeNull();
  });

  it("rejects missing / non-numeric / non-positive meta", () => {
    const now = Date.parse("2026-09-04T01:00:00Z");
    expect(settledCloseForBar({}, LAST_TS, now)).toBeNull();
    expect(settledCloseForBar(null, LAST_TS, now)).toBeNull();
    expect(settledCloseForBar({ regularMarketPrice: "328.21", regularMarketTime: SETTLE_TS }, LAST_TS, now)).toBeNull();
    expect(settledCloseForBar({ regularMarketPrice: 0, regularMarketTime: SETTLE_TS }, LAST_TS, now)).toBeNull();
    expect(settledCloseForBar({ regularMarketPrice: 328.21 }, LAST_TS, now)).toBeNull();
  });
});

// ── fetchYahooOHLCV: end-to-end bar assembly ────────────────────────────────
describe("fetchYahooOHLCV null-Close handling", () => {
  it("repairs the final bar instead of dropping it, so barDate matches the worker", async () => {
    stubChart(chart(SETTLED_META));
    const r = await fetchYahooOHLCV("AAPL", 400);

    expect(r).not.toBeNull();
    expect(r!.bars).toHaveLength(N_BARS);
    expect(r!.bars[r!.bars.length - 1]).toMatchObject({
      date: "2026-09-03", close: 328.21, high: 330.81, low: 324.11,
    });
    // changePct is now measured against the true prior close, not a stale one
    expect(r!.currentPrice).toBe(328.21);
    expect(r!.changePct).toBeCloseTo(((328.21 - PREV_CLOSE) / PREV_CLOSE) * 100, 6);
  });

  it("drops an INTERIOR null Close — it cannot be recovered and would poison every window", async () => {
    const payload = chart(SETTLED_META);
    payload.chart.result[0].indicators.quote[0].close[30] = null;
    stubChart(payload);

    const r = await fetchYahooOHLCV("AAPL", 400);
    expect(r!.bars).toHaveLength(N_BARS - 1);
    expect(r!.bars.every(b => Number.isFinite(b.close))).toBe(true);
    expect(r!.bars[r!.bars.length - 1].date).toBe("2026-09-03");
  });

  it("drops the final bar when meta belongs to a different session", async () => {
    stubChart(chart({
      regularMarketPrice: 328.21,
      regularMarketTime: SETTLE_TS + DAY,
      regularMarketChange: 4.0,
    }));
    const r = await fetchYahooOHLCV("AAPL", 400);

    expect(r!.bars).toHaveLength(N_BARS - 1);
    expect(r!.bars[r!.bars.length - 1].date).toBe("2026-09-02");
    // currentPrice legitimately stays the live quote. What must NOT happen is
    // measuring that quote against a close two sessions back and calling it a
    // one-day move — the change must come from Yahoo's own quote change.
    expect(r!.currentPrice).toBe(328.21);
    expect(r!.changePct).toBeCloseTo((4.0 / (328.21 - 4.0)) * 100, 6);
    expect(r!.changePct).not.toBeCloseTo(
      ((328.21 - PREV_PREV_CLOSE) / PREV_PREV_CLOSE) * 100, 6
    );
  });

  it("drops the final bar when the settle falls outside the bar's own [low, high]", async () => {
    stubChart(chart({ regularMarketPrice: 900, regularMarketTime: SETTLE_TS }));
    const r = await fetchYahooOHLCV("AAPL", 400);

    expect(r!.bars).toHaveLength(N_BARS - 1);
    expect(r!.bars[r!.bars.length - 1].date).toBe("2026-09-02");
  });

  it("leaves a clean payload untouched", async () => {
    stubChart(chart(SETTLED_META, 328.21));
    const r = await fetchYahooOHLCV("AAPL", 400);

    expect(r!.bars).toHaveLength(N_BARS);
    expect(r!.bars[r!.bars.length - 1].close).toBe(328.21);
  });
});
