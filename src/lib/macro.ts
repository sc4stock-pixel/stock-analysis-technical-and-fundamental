// ============================================================
// US MACRO ENGINE — V15.2  (SERVER ONLY)
// Changes vs V15.1:
//   - Fear & Greed: CNN endpoint (replaces alternative.me)
//   - A/D Ratio: multiple fallback sources (fixed "unavailable")
//   - Market Breadth: multi-ETF proxy (more accurate)
//   - Index Trends: SPY + QQQ + DIA only (HSI moved to HK engine)
// ============================================================

import { MacroData, MacroFactor, MacroHeadline, mbsLabel } from "./macro-types";
export type { MacroData, MacroFactor, MacroHeadline };

const W = {
  fearGreed:     0.20,
  vixStructure:  0.20,
  indexTrends:   0.25,
  adRatio:       0.15,
  newsSentiment: 0.10,
  breadth:       0.10,
};

// ── Shared Yahoo helpers ──────────────────────────────────────
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

// ── 1. Fear & Greed — CNN endpoint ───────────────────────────
async function getFearGreed(): Promise<MacroFactor> {
  // Primary: CNN Fear & Greed dataviz endpoint
  try {
    const res = await fetch(
      "https://production.dataviz.cnn.io/index/fearandgreed/graphdata",
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Referer": "https://www.cnn.com/",
          "Origin": "https://www.cnn.com",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) throw new Error(`CNN F&G ${res.status}`);
    const json = await res.json();
    // CNN returns { fear_and_greed: { score, rating, ... } }
    const fg = json?.fear_and_greed;
    const val = typeof fg?.score === "number" ? Math.round(fg.score) : null;
    const rat = (fg?.rating ?? "neutral") as string;
    if (val === null) throw new Error("no score");

    const score  = val >= 75 ? 2 : val >= 60 ? 4 : val >= 45 ? 6 : val >= 30 ? 7 : 9;
    const signal: MacroFactor["signal"] = val >= 60 ? "bearish" : val <= 40 ? "bullish" : "neutral";
    const label  = rat.charAt(0).toUpperCase() + rat.slice(1);
    return { label: "Fear & Greed", value: val, score, signal, detail: `CNN: ${label}` };
  } catch { /* fall through to alternative.me */ }

  // Fallback: alternative.me
  try {
    const res2 = await fetch("https://api.alternative.me/fng/?limit=1", {
      headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res2.ok) throw new Error("fng fail");
    const json = await res2.json();
    const val  = parseInt(json?.data?.[0]?.value ?? "50", 10);
    const cat  = (json?.data?.[0]?.value_classification ?? "Neutral") as string;
    const score = val >= 75 ? 2 : val >= 60 ? 4 : val >= 45 ? 6 : val >= 30 ? 7 : 9;
    const signal: MacroFactor["signal"] = val >= 60 ? "bearish" : val <= 40 ? "bullish" : "neutral";
    return { label: "Fear & Greed", value: val, score, signal, detail: `Alt.me: ${cat}` };
  } catch { /* ignore */ }

  // Last resort: SPY RSI proxy
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
      const score  = rsiVal >= 75 ? 2 : rsiVal >= 60 ? 5 : rsiVal >= 45 ? 6 : rsiVal >= 30 ? 7 : 9;
      const signal: MacroFactor["signal"] = rsiVal >= 60 ? "bearish" : rsiVal <= 40 ? "bullish" : "neutral";
      return { label: "Fear & Greed", value: `~${rsiVal.toFixed(0)}`, score, signal, detail: "SPY RSI proxy" };
    }
  } catch { /* ignore */ }

  return { label: "Fear & Greed", value: "—", score: 5, signal: "neutral", detail: "unavailable" };
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
        structureLabel = "Backwardation"; score = vix > 25 ? 2 : 3; signal = "bearish";
      } else if (ratio < 0.95) {
        structureLabel = "Contango"; score = vix < 15 ? 8 : vix < 20 ? 7 : 5;
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

// ── 3. Index Trends — US (SPX + IXIC, 3 momentum periods each) ─
async function getIndexTrends(): Promise<MacroFactor> {
  try {
    // We need 50 bars + offset; fetch 60 days to be safe
    const [spxSeries, ixicSeries] = await Promise.all([
      fetchYahooSeries("^GSPC", 60),
      fetchYahooSeries("^IXIC", 60),
    ]);

    const mom = (series: number[], days: number) =>
      series.length > days ? (series[series.length - 1] / series[series.length - 1 - days] - 1) * 100 : 0;

    // 10‑day, 20‑day, 50‑day momentum for each index
    const spx10 = mom(spxSeries, 10), spx20 = mom(spxSeries, 20), spx50 = mom(spxSeries, 50);
    const ixic10 = mom(ixicSeries, 10), ixic20 = mom(ixicSeries, 20), ixic50 = mom(ixicSeries, 50);

    // Conditions: momentum > 0
    const conditions = [spx10 > 0, spx20 > 0, spx50 > 0, ixic10 > 0, ixic20 > 0, ixic50 > 0];
    const bullCount = conditions.filter(Boolean).length;

    // Map count (0‑6) to a 0‑10 score (linear)
    const score = Math.round((bullCount / 6) * 10);
    const signal: MacroFactor["signal"] = score >= 7 ? "bullish" : score <= 3 ? "bearish" : "neutral";

    const detail = `SPX ${spx10>=0?'+':''}${spx10.toFixed(1)}% ${spx20>=0?'+':''}${spx20.toFixed(1)}% ${spx50>=0?'+':''}${spx50.toFixed(1)}% | IXIC ${ixic10>=0?'+':''}${ixic10.toFixed(1)}% ${ixic20>=0?'+':''}${ixic20.toFixed(1)}% ${ixic50>=0?'+':''}${ixic50.toFixed(1)}%`;

    return {
      label: "Index Trends",
      value: `${score}/10`,
      score,
      signal,
      detail,
    };
  } catch {
    return { label: "Index Trends 10d/20d/50d%", value: "—", score: 5, signal: "neutral", detail: "unavailable" };
  }
}

// ── 4. Advance/Decline Ratio — multiple sources ───────────────
async function getADRatio(): Promise<MacroFactor> {
  // Source A: Yahoo ^ADD (NYSE A-D daily line change)
  try {
    const addSeries = await fetchYahooSeries("^ADD", 5);
    if (addSeries.length >= 3) {
      // ADD is the daily net (advancing - declining) count
      const latest = addSeries[addSeries.length - 1];
      // Typical NYSE daily range: -2500 to +2500
      // Normalise to 0-1 breadth ratio
      const ratio = (latest + 3000) / 6000; // shifted to [0,1]
      const clampedRatio = Math.max(0, Math.min(1, ratio));
      const trend5d = addSeries.length >= 3
        ? addSeries.slice(-3).reduce((a, b) => a + b, 0) / 3
        : latest;
      const trendStr = trend5d > 200 ? "improving" : trend5d < -200 ? "weakening" : "stable";
      const score = clampedRatio >= 0.65 ? 8 : clampedRatio >= 0.55 ? 7 : clampedRatio >= 0.45 ? 5 : clampedRatio >= 0.35 ? 3 : 2;
      const signal: MacroFactor["signal"] = clampedRatio >= 0.55 ? "bullish" : clampedRatio <= 0.40 ? "bearish" : "neutral";
      return {
        label: "A/D Ratio", value: latest > 0 ? `+${latest.toFixed(0)}` : `${latest.toFixed(0)}`,
        score, signal, detail: `NYSE A-D ${trendStr}`,
      };
    }
  } catch { /* try next */ }

  // Source B: ADVN / DECN
  try {
    const [advSeries, decSeries] = await Promise.all([
      fetchYahooSeries("^ADVN", 5),
      fetchYahooSeries("^DECN", 5),
    ]);
    if (advSeries.length > 0 && decSeries.length > 0) {
      const adv = advSeries[advSeries.length - 1];
      const dec = decSeries[decSeries.length - 1];
      const total = adv + dec;
      const ratio = total > 0 ? adv / total : 0.5;
      const score = ratio >= 0.65 ? 8 : ratio >= 0.55 ? 7 : ratio >= 0.45 ? 5 : ratio >= 0.35 ? 3 : 2;
      const signal: MacroFactor["signal"] = ratio >= 0.55 ? "bullish" : ratio <= 0.40 ? "bearish" : "neutral";
      return {
        label: "A/D Ratio", value: `${(ratio * 100).toFixed(0)}% adv`,
        score, signal, detail: `${adv.toFixed(0)} adv / ${dec.toFixed(0)} dec`,
      };
    }
  } catch { /* try next */ }

  // Source C: Compute from sector ETF mix (XLK, XLF, XLE, XLV, XLI, XLU)
  try {
    const sectors = ["XLK", "XLF", "XLE", "XLV", "XLI", "XLU", "XLP", "XLY", "XLB", "XLRE"];
    const series = await Promise.all(sectors.map(s => fetchYahooSeries(s, 2)));
    let up = 0, dn = 0;
    series.forEach(s => {
      if (s.length >= 2) {
        if (s[s.length - 1] > s[s.length - 2]) up++;
        else dn++;
      }
    });
    const total = up + dn;
    if (total >= 5) {
      const ratio = up / total;
      const score = ratio >= 0.7 ? 8 : ratio >= 0.6 ? 7 : ratio >= 0.4 ? 5 : ratio >= 0.3 ? 3 : 2;
      const signal: MacroFactor["signal"] = ratio >= 0.6 ? "bullish" : ratio <= 0.35 ? "bearish" : "neutral";
      return {
        label: "A/D Ratio", value: `${up}/${total} sec up`,
        score, signal, detail: "Sector breadth proxy",
      };
    }
  } catch { /* ignore */ }

  return { label: "A/D Ratio", value: "—", score: 5, signal: "neutral", detail: "unavailable" };
}

// ── 5. News Sentiment ─────────────────────────────────────────
const BULL_KW = ["beat","beats","surge","rally","record","recovery","upgrade","outperform","buy","bullish","gain","jump","soar","strong","growth","breakout","positive","rebound","higher","optimism"];
const BEAR_KW = ["miss","misses","crash","plunge","recession","downgrade","sell","bearish","loss","drop","fall","weak","fear","tariff","inflation","concern","warning","risk","decline","default"];

function scoreHeadline(title: string): MacroHeadline["sentiment"] {
  const t = title.toLowerCase();
  let bull = 0, bear = 0;
  BULL_KW.forEach(k => { if (t.includes(k)) bull++; });
  BEAR_KW.forEach(k => { if (t.includes(k)) bear++; });
  return bull > bear ? "bullish" : bear > bull ? "bearish" : "neutral";
}

function extractTitlesFromRSS(text: string, limit: number): string[] {
  const titles: string[] = [];
  const re = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/g;
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(text)) !== null) {
    const title = m[1].trim();
    if (title.length >= 10) titles.push(title);
    if (titles.length >= limit) break;
  }
  return titles;
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
        headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store",
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      const text = await res.text();
      const titles = extractTitlesFromRSS(text, 6);
      for (const title of titles) {
        headlines.push({ title, sentiment: scoreHeadline(title), source: feed.source });
      }
      if (headlines.length >= 8) break;
    } catch { /* timeout */ }
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
    factor: { label: "News Sentiment", value: `${bull}B ${bear}Be`, score, signal, detail: `${headlines.length} headlines ${(bullPct * 100).toFixed(0)}% bull` },
    headlines: headlines.slice(0, 8),
  };
}

// ── 6. Market Breadth — multi-ETF proxy ──────────────────────
// Uses % of major sector ETFs above their own 20-day SMA.
// More accurate than SPY-series-only proxy; matches investing.com method.
async function getMarketBreadth(): Promise<MacroFactor> {
  try {
    // Core ETFs: broad market + sectors
    const etfs = ["SPY", "QQQ", "IWM", "XLK", "XLF", "XLE", "XLV", "XLI", "XLU", "XLP", "XLY", "XLB", "XLRE", "GLD", "TLT"];
    const seriesArr = await Promise.all(etfs.map(e => fetchYahooSeries(e, 25)));

    let aboveCount = 0, totalCount = 0;
    seriesArr.forEach(series => {
      if (series.length < 21) return;
      const sma20 = series.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const cur   = series[series.length - 1];
      totalCount++;
      if (cur > sma20) aboveCount++;
    });

    if (totalCount < 5) throw new Error("insufficient ETF data");

    const pct = aboveCount / totalCount;

    // Also compute SPY 5d momentum for detail
    const spySeries = seriesArr[0];
    const ret5 = spySeries.length >= 6
      ? (spySeries[spySeries.length - 1] - spySeries[spySeries.length - 6]) / spySeries[spySeries.length - 6] * 100
      : 0;

    const score  = pct >= 0.75 ? 8 : pct >= 0.60 ? 7 : pct >= 0.45 ? 5 : pct >= 0.30 ? 3 : 2;
    const signal: MacroFactor["signal"] = pct >= 0.60 ? "bullish" : pct <= 0.40 ? "bearish" : "neutral";
    return {
      label: "Market Breadth",
      value: `${(pct * 100).toFixed(0)}% >SMA20`,
      score, signal,
      detail: `${aboveCount}/${totalCount} ETFs · SPY 5d ${ret5 >= 0 ? "+" : ""}${ret5.toFixed(1)}%`,
    };
  } catch {
    return { label: "Market Breadth", value: "—", score: 5, signal: "neutral", detail: "unavailable" };
  }
}

// ── Main export ───────────────────────────────────────────────
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
