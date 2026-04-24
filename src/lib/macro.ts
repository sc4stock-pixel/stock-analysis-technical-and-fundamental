// ============================================================
// MACRO ENGINE — V15.1  (SERVER ONLY — Next.js API route)
// All data fetchers live here. Never imported by client components.
// Client-safe types/functions are in macro-types.ts
// ============================================================

import { MacroData, MacroFactor, MacroHeadline, mbsLabel } from "./macro-types";

export type { MacroData, MacroFactor, MacroHeadline };

// ── Weights ──────────────────────────────────────────────────
const W = {
  fearGreed:     0.20,
  vixStructure:  0.20,
  indexTrends:   0.25,
  adRatio:       0.15,
  newsSentiment: 0.10,
  breadth:       0.10,
};

// ────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────

async function fetchYahooClose(symbol: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" });
    if (!res.ok) return null;
    const json = await res.json();
    const closes: number[] = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const valid = closes.filter((c: number) => c != null && !isNaN(c));
    return valid.length > 0 ? valid[valid.length - 1] : null;
  } catch { return null; }
}

async function fetchYahooSeries(symbol: string, days = 25): Promise<number[]> {
  try {
    const end   = Math.floor(Date.now() / 1000);
    const start = end - days * 86400 * 2;
    const url   = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${start}&period2=${end}&interval=1d`;
    const res   = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" });
    if (!res.ok) return [];
    const json   = await res.json();
    const closes: number[] = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    return closes.filter((c: number) => c != null && !isNaN(c)).slice(-days);
  } catch { return []; }
}

// ── 1. Fear & Greed ──────────────────────────────────────────
async function getFearGreed(): Promise<MacroFactor> {
  try {
    const res2 = await fetch("https://api.alternative.me/fng/?limit=1", {
      headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store",
    });
    if (!res2.ok) throw new Error("fng fail");
    const json = await res2.json();
    const val  = parseInt(json?.data?.[0]?.value ?? "50", 10);
    const cat  = (json?.data?.[0]?.value_classification ?? "Neutral") as string;
    const score = val >= 75 ? 2 : val >= 60 ? 4 : val >= 45 ? 6 : val >= 30 ? 7 : 9;
    const signal: MacroFactor["signal"] = val >= 60 ? "bearish" : val <= 40 ? "bullish" : "neutral";
    return { label: "Fear & Greed", value: val, score, signal, detail: cat };
  } catch {
    try {
      const spy = await fetchYahooSeries("SPY", 20);
      if (spy.length >= 14) {
        const gains: number[] = [], losses: number[] = [];
        for (let i = 1; i < spy.length; i++) {
          const d = spy[i] - spy[i - 1];
          gains.push(d > 0 ? d : 0); losses.push(d < 0 ? -d : 0);
        }
        const ag = gains.reduce((a, b) => a + b, 0) / gains.length;
        const al = losses.reduce((a, b) => a + b, 0) / losses.length;
        const rsiVal = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
        const score = rsiVal >= 75 ? 2 : rsiVal >= 60 ? 5 : rsiVal >= 45 ? 6 : rsiVal >= 30 ? 7 : 9;
        const signal: MacroFactor["signal"] = rsiVal >= 60 ? "bearish" : rsiVal <= 40 ? "bullish" : "neutral";
        return { label: "Fear & Greed", value: `RSI≈${rsiVal.toFixed(0)}`, score, signal, detail: "SPY RSI proxy" };
      }
    } catch { /* ignore */ }
    return { label: "Fear & Greed", value: 50, score: 5, signal: "neutral", detail: "unavailable" };
  }
}

// ── 2. VIX Structure ─────────────────────────────────────────
async function getVixStructure(): Promise<MacroFactor> {
  try {
    const [vix, vix3m] = await Promise.all([
      fetchYahooClose("^VIX"),
      fetchYahooClose("^VIX3M"),
    ]);
    if (!vix) throw new Error("no VIX");
    let structureLabel = "Contango";
    let score = 6;
    let signal: MacroFactor["signal"] = "neutral";
    if (vix3m) {
      const ratio = vix / vix3m;
      if (ratio > 1.05) {
        structureLabel = "Backwardation ⚠️"; score = vix > 25 ? 2 : 3; signal = "bearish";
      } else if (ratio < 0.95) {
        structureLabel = "Contango ✅"; score = vix < 15 ? 8 : vix < 20 ? 7 : 5;
        signal = vix < 20 ? "bullish" : "neutral";
      } else {
        structureLabel = "Flat"; score = 5; signal = "neutral";
      }
    } else {
      score = vix < 15 ? 8 : vix < 20 ? 7 : vix < 25 ? 5 : vix < 30 ? 3 : 2;
      signal = vix < 20 ? "bullish" : vix > 25 ? "bearish" : "neutral";
      structureLabel = `VIX ${vix.toFixed(1)}`;
    }
    return {
      label: "VIX Structure",
      value: vix3m ? `${vix.toFixed(1)} / ${vix3m.toFixed(1)}` : vix.toFixed(1),
      score, signal, detail: structureLabel,
    };
  } catch {
    return { label: "VIX Structure", value: "—", score: 5, signal: "neutral", detail: "unavailable" };
  }
}

// ── 3. Index Trends ──────────────────────────────────────────
async function getIndexTrends(): Promise<MacroFactor> {
  try {
    const [spySeries, qqSeries, hsiSeries] = await Promise.all([
      fetchYahooSeries("^GSPC", 22),
      fetchYahooSeries("^IXIC", 22),
      fetchYahooSeries("^HSI", 22),
    ]);
    const trend20 = (s: number[]) => s.length < 5 ? 0 : (s[s.length - 1] - s[0]) / s[0] * 100;
    const ema10   = (s: number[]) => {
      if (!s.length) return 0;
      const a = 2 / 11; let e = s[0];
      for (let i = 1; i < s.length; i++) e = a * s[i] + (1 - a) * e;
      return e;
    };
    const spyAbove = spySeries.length > 0 && spySeries[spySeries.length - 1] > ema10(spySeries);
    const qqAbove  = qqSeries.length  > 0 && qqSeries[qqSeries.length - 1]   > ema10(qqSeries);
    const spyT = trend20(spySeries), qqT = trend20(qqSeries), hsiT = trend20(hsiSeries);
    const bull = [spyT > 0, qqT > 0, hsiT > 0, spyAbove, qqAbove].filter(Boolean).length;
    const score = bull >= 5 ? 9 : bull >= 4 ? 7 : bull >= 3 ? 6 : bull >= 2 ? 4 : 2;
    const signal: MacroFactor["signal"] = bull >= 4 ? "bullish" : bull <= 1 ? "bearish" : "neutral";
    const spyStr = spySeries.length > 0 ? `SPY${spyT >= 0 ? "+" : ""}${spyT.toFixed(1)}%` : "SPY—";
    const qqStr  = qqSeries.length  > 0 ? `QQQ${qqT  >= 0 ? "+" : ""}${qqT.toFixed(1)}%`  : "QQQ—";
    const hsiStr = hsiSeries.length > 0 ? `HSI${hsiT >= 0 ? "+" : ""}${hsiT.toFixed(1)}%` : "HSI—";
    return { label: "Index Trends", value: `${bull}/5 bull`, score, signal, detail: `${spyStr} ${qqStr} ${hsiStr}` };
  } catch {
    return { label: "Index Trends", value: "—", score: 5, signal: "neutral", detail: "unavailable" };
  }
}

// ── 4. Advance/Decline Ratio ─────────────────────────────────
async function getADRatio(): Promise<MacroFactor> {
  try {
    const [advSeries, decSeries] = await Promise.all([
      fetchYahooSeries("^ADVN", 5),
      fetchYahooSeries("^DECN", 5),
    ]);
    if (!advSeries.length || !decSeries.length) throw new Error("no A/D");
    const adv = advSeries[advSeries.length - 1];
    const dec = decSeries[decSeries.length - 1];
    const total = adv + dec;
    const ratio = total > 0 ? adv / total : 0.5;
    const len = Math.min(advSeries.length, decSeries.length);
    const adLines = Array.from({ length: len }, (_, i) => {
      const a = advSeries[i], d = decSeries[i];
      return a + d > 0 ? (a - d) / (a + d) : 0;
    });
    const adTrend = adLines.length >= 2 ? adLines[adLines.length - 1] - adLines[0] : 0;
    const score = ratio >= 0.65 ? 8 : ratio >= 0.55 ? 7 : ratio >= 0.45 ? 5 : ratio >= 0.35 ? 3 : 2;
    const signal: MacroFactor["signal"] = ratio >= 0.55 ? "bullish" : ratio <= 0.40 ? "bearish" : "neutral";
    const trendStr = adTrend > 0.05 ? "↑improving" : adTrend < -0.05 ? "↓weakening" : "→stable";
    return {
      label: "A/D Ratio", value: `${(ratio * 100).toFixed(0)}% adv`,
      score, signal, detail: `${adv.toFixed(0)}↑ ${dec.toFixed(0)}↓ ${trendStr}`,
    };
  } catch {
    return { label: "A/D Ratio", value: "—", score: 5, signal: "neutral", detail: "unavailable" };
  }
}

// ── 5. News Sentiment (Finviz RSS) ───────────────────────────
const BULL_KW = ["beat","beats","surge","rally","record","recovery","upgrade","outperform","buy","bullish","gain","jump","soar","strong","growth","breakout","positive","rebound","higher","optimism"];
const BEAR_KW = ["miss","misses","crash","plunge","recession","downgrade","sell","bearish","loss","drop","fall","weak","fear","tariff","inflation","concern","warning","risk","decline","default"];

function scoreHeadline(title: string): MacroHeadline["sentiment"] {
  const t = title.toLowerCase();
  let bull = 0, bear = 0;
  BULL_KW.forEach(k => { if (t.includes(k)) bull++; });
  BEAR_KW.forEach(k => { if (t.includes(k)) bear++; });
  return bull > bear ? "bullish" : bear > bull ? "bearish" : "neutral";
}

async function getNewsSentiment(): Promise<{ factor: MacroFactor; headlines: MacroHeadline[] }> {
  const headlines: MacroHeadline[] = [];
  const feeds = [
    { url: "https://finviz.com/news_feed.ashx", source: "Finviz" },
    { url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC&region=US&lang=en-US", source: "Yahoo" },
  ];
  for (const feed of feeds) {
    try {
      const res = await fetch(feed.url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      const text = await res.text();
      const matches = [...text.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/g)];
      let count = 0;
      for (const m of matches) {
        const title = (m[1] || m[2] || "").trim();
        if (!title || title.length < 10) continue;
        headlines.push({ title, sentiment: scoreHeadline(title), source: feed.source });
        if (++count >= 6) break;
      }
      if (headlines.length >= 8) break;
    } catch { /* timeout — skip */ }
  }
  if (!headlines.length) {
    return { factor: { label: "News Sentiment", value: "—", score: 5, signal: "neutral", detail: "unavailable" }, headlines: [] };
  }
  const bull = headlines.filter(h => h.sentiment === "bullish").length;
  const bear = headlines.filter(h => h.sentiment === "bearish").length;
  const bullPct = bull / headlines.length;
  const score = bullPct >= 0.7 ? 8 : bullPct >= 0.55 ? 6 : bullPct <= 0.30 ? 2 : bullPct <= 0.45 ? 4 : 5;
  const signal: MacroFactor["signal"] = bullPct >= 0.55 ? "bullish" : bullPct <= 0.40 ? "bearish" : "neutral";
  return {
    factor: { label: "News Sentiment", value: `${bull}🟢 ${bear}🔴`, score, signal, detail: `${headlines.length} headlines · ${(bullPct * 100).toFixed(0)}% bullish` },
    headlines: headlines.slice(0, 8),
  };
}

// ── 6. Market Breadth ────────────────────────────────────────
async function getMarketBreadth(): Promise<MacroFactor> {
  try {
    const spy = await fetchYahooSeries("SPY", 60);
    if (spy.length < 25) throw new Error("insufficient");
    const smaVal = (arr: number[], n: number, i: number) => {
      if (i < n - 1) return NaN;
      return arr.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n;
    };
    let above = 0, total = 0;
    for (let i = 19; i < spy.length; i++) {
      const s = smaVal(spy, 20, i);
      if (!isNaN(s)) { total++; if (spy[i] > s) above++; }
    }
    const pct = total > 0 ? above / total : 0.5;
    const ret5 = spy.length >= 6 ? (spy[spy.length - 1] - spy[spy.length - 6]) / spy[spy.length - 6] * 100 : 0;
    const score = pct >= 0.75 ? 8 : pct >= 0.6 ? 7 : pct >= 0.45 ? 5 : pct >= 0.3 ? 3 : 2;
    const signal: MacroFactor["signal"] = pct >= 0.6 ? "bullish" : pct <= 0.40 ? "bearish" : "neutral";
    return { label: "Market Breadth", value: `${(pct * 100).toFixed(0)}% >SMA20`, score, signal, detail: `SPY 5d: ${ret5 >= 0 ? "+" : ""}${ret5.toFixed(1)}%` };
  } catch {
    return { label: "Market Breadth", value: "—", score: 5, signal: "neutral", detail: "unavailable" };
  }
}

// ────────────────────────────────────────────────────────────
// Main export
// ────────────────────────────────────────────────────────────
export async function fetchMacroData(): Promise<MacroData> {
  try {
    const [fearGreed, vixStructure, indexTrends, adRatio, newsResult, breadth] = await Promise.all([
      getFearGreed(), getVixStructure(), getIndexTrends(),
      getADRatio(), getNewsSentiment(), getMarketBreadth(),
    ]);
    const { factor: newsSentiment, headlines } = newsResult;
    const mbs =
      fearGreed.score     * W.fearGreed     +
      vixStructure.score  * W.vixStructure  +
      indexTrends.score   * W.indexTrends   +
      adRatio.score       * W.adRatio       +
      newsSentiment.score * W.newsSentiment +
      breadth.score       * W.breadth;
    return {
      mbs: Math.round(mbs * 10) / 10,
      mbsLabel: mbsLabel(mbs),
      factors: { fearGreed, vixStructure, indexTrends, adRatio, newsSentiment, breadth },
      headlines,
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    const empty = (label: string): MacroFactor => ({ label, value: "—", score: 5, signal: "neutral", detail: "error" });
    return {
      mbs: 5.0, mbsLabel: "NEUTRAL",
      factors: {
        fearGreed: empty("Fear & Greed"), vixStructure: empty("VIX Structure"),
        indexTrends: empty("Index Trends"), adRatio: empty("A/D Ratio"),
        newsSentiment: empty("News Sentiment"), breadth: empty("Market Breadth"),
      },
      headlines: [],
      fetchedAt: new Date().toISOString(),
      error: String(e),
    };
  }
}
