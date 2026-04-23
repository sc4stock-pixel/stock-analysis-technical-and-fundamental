// ============================================================
// MACRO ENGINE — V15.1
// Market Background Score (MBS) — server-side only (API route)
//
// Sources:
//   Fear & Greed   alternative.me/api       free  20%
//   VIX Structure  Yahoo Finance ^VIX/^VIX3M free  20%
//   Index Trends   Yahoo Finance indices     free  25%
//   A/D Ratio      Yahoo Finance ^ADVN/^DECN free  15%
//   News Sentiment Finviz RSS + keyword      free  10%
//   Market Breadth SPY 20d breadth proxy     free  10%
// ============================================================

export interface MacroFactor {
  label: string;
  value: number | string;
  score: number;      // 0–10
  signal: "bullish" | "bearish" | "neutral";
  detail: string;
}

export interface MacroHeadline {
  title: string;
  sentiment: "bullish" | "bearish" | "neutral";
  source: string;
}

export interface MacroData {
  mbs: number;                  // 0–10 Market Background Score
  mbsLabel: string;             // "CAUTION" | "BULLISH" | etc.
  factors: {
    fearGreed:    MacroFactor;
    vixStructure: MacroFactor;
    indexTrends:  MacroFactor;
    adRatio:      MacroFactor;
    newsSentiment: MacroFactor;
    breadth:      MacroFactor;
  };
  headlines: MacroHeadline[];
  fetchedAt: string;
  error?: string;
}

// ── Weights ──────────────────────────────────────────────────
const W = {
  fearGreed:    0.20,
  vixStructure: 0.20,
  indexTrends:  0.25,
  adRatio:      0.15,
  newsSentiment: 0.10,
  breadth:      0.10,
};

// ── Score → label ────────────────────────────────────────────
export function mbsLabel(mbs: number): string {
  if (mbs >= 7.0) return "BULLISH";
  if (mbs >= 5.5) return "NEUTRAL";
  if (mbs >= 4.0) return "CAUTION";
  if (mbs >= 2.5) return "RISK-OFF";
  return "AVOID";
}

// ── MBS → score adjustment (Score strategy only) ─────────────
export function mbsScoreAdjustment(mbs: number): number {
  if (mbs >= 7.0) return  0.5;
  if (mbs >= 5.5) return  0.0;
  if (mbs >= 4.0) return -0.3;
  if (mbs >= 2.5) return -0.5;
  return -1.0;
}

// ────────────────────────────────────────────────────────────
// Data Fetchers
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
    const res  = await fetch("https://fear-and-greed-index.p.rapidapi.com/v1/fgi", {
      headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store",
    });
    // Primary: alternative.me (free, no key)
    const res2 = await fetch("https://api.alternative.me/fng/?limit=1", {
      headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store",
    });
    if (!res2.ok) throw new Error("fng fail");
    const json = await res2.json();
    const val  = parseInt(json?.data?.[0]?.value ?? "50", 10);
    const cat  = json?.data?.[0]?.value_classification ?? "Neutral";

    const score = val >= 75 ? 2 : val >= 60 ? 4 : val >= 45 ? 6 : val >= 30 ? 7 : 9;
    const signal: MacroFactor["signal"] = val >= 60 ? "bearish" : val <= 40 ? "bullish" : "neutral";

    return { label: "Fear & Greed", value: val, score, signal, detail: cat };
  } catch {
    // Fallback: RSI proxy via SPY
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
        const rsi = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
        const score = rsi >= 75 ? 2 : rsi >= 60 ? 5 : rsi >= 45 ? 6 : rsi >= 30 ? 7 : 9;
        const signal: MacroFactor["signal"] = rsi >= 60 ? "bearish" : rsi <= 40 ? "bullish" : "neutral";
        return { label: "Fear & Greed", value: `RSI≈${rsi.toFixed(0)}`, score, signal, detail: "SPY RSI proxy" };
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
    const vixVal = vix;

    let structureLabel = "Contango";
    let score = 6;
    let signal: MacroFactor["signal"] = "neutral";

    if (vix3m && vix) {
      const ratio = vix / vix3m;
      if (ratio > 1.05) {
        structureLabel = "Backwardation ⚠️";
        score = vixVal > 25 ? 2 : 3;
        signal = "bearish";
      } else if (ratio < 0.95) {
        structureLabel = "Contango ✅";
        score = vixVal < 15 ? 8 : vixVal < 20 ? 7 : 5;
        signal = vixVal < 20 ? "bullish" : "neutral";
      } else {
        structureLabel = "Flat";
        score = 5; signal = "neutral";
      }
    } else {
      // VIX level only
      score = vixVal < 15 ? 8 : vixVal < 20 ? 7 : vixVal < 25 ? 5 : vixVal < 30 ? 3 : 2;
      signal = vixVal < 20 ? "bullish" : vixVal > 25 ? "bearish" : "neutral";
      structureLabel = `VIX ${vixVal.toFixed(1)}`;
    }

    return {
      label: "VIX Structure",
      value: vix3m ? `${vixVal.toFixed(1)} / ${vix3m.toFixed(1)}` : vixVal.toFixed(1),
      score, signal,
      detail: structureLabel,
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

    function trend20(series: number[]): number {
      if (series.length < 5) return 0;
      const cur = series[series.length - 1];
      const prev20 = series[0];
      return prev20 > 0 ? (cur - prev20) / prev20 * 100 : 0;
    }

    function ema10(series: number[]): number {
      if (series.length === 0) return 0;
      const alpha = 2 / 11;
      let e = series[0];
      for (let i = 1; i < series.length; i++) e = alpha * series[i] + (1 - alpha) * e;
      return e;
    }

    const spyTrend   = trend20(spySeries);
    const qqTrend    = trend20(qqSeries);
    const hsiTrend   = trend20(hsiSeries);

    const spyAboveEma = spySeries.length > 0 && spySeries[spySeries.length - 1] > ema10(spySeries);
    const qqAboveEma  = qqSeries.length  > 0 && qqSeries[qqSeries.length - 1]   > ema10(qqSeries);
    const hsiAboveEma = hsiSeries.length > 0 && hsiSeries[hsiSeries.length - 1] > ema10(hsiSeries);

    const bullCount = [spyTrend > 0, qqTrend > 0, hsiTrend > 0, spyAboveEma, qqAboveEma].filter(Boolean).length;
    const score = bullCount >= 5 ? 9 : bullCount >= 4 ? 7 : bullCount >= 3 ? 6 : bullCount >= 2 ? 4 : 2;
    const signal: MacroFactor["signal"] = bullCount >= 4 ? "bullish" : bullCount <= 1 ? "bearish" : "neutral";

    const spyStr   = spySeries.length > 0 ? `SPY${spyTrend >= 0 ? "+" : ""}${spyTrend.toFixed(1)}%` : "SPY—";
    const qqStr    = qqSeries.length  > 0 ? `QQQ${qqTrend  >= 0 ? "+" : ""}${qqTrend.toFixed(1)}%`  : "QQQ—";
    const hsiStr   = hsiSeries.length > 0 ? `HSI${hsiTrend >= 0 ? "+" : ""}${hsiTrend.toFixed(1)}%` : "HSI—";

    return {
      label: "Index Trends", value: `${bullCount}/5 bull`,
      score, signal, detail: `${spyStr} ${qqStr} ${hsiStr}`,
    };
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

    if (advSeries.length === 0 || decSeries.length === 0) throw new Error("no A/D data");

    const adv = advSeries[advSeries.length - 1];
    const dec = decSeries[decSeries.length - 1];
    const total = adv + dec;
    const ratio = total > 0 ? adv / total : 0.5;

    // 5-day smoothed A/D line direction
    const adLines: number[] = [];
    const len = Math.min(advSeries.length, decSeries.length);
    for (let i = 0; i < len; i++) {
      const a = advSeries[i], d = decSeries[i];
      adLines.push(a + d > 0 ? (a - d) / (a + d) : 0);
    }
    const adTrend = adLines.length >= 2
      ? adLines[adLines.length - 1] - adLines[0]
      : 0;

    const score = ratio >= 0.65 ? 8 : ratio >= 0.55 ? 7 : ratio >= 0.45 ? 5 : ratio >= 0.35 ? 3 : 2;
    const signal: MacroFactor["signal"] = ratio >= 0.55 ? "bullish" : ratio <= 0.40 ? "bearish" : "neutral";
    const trendStr = adTrend > 0.05 ? "↑improving" : adTrend < -0.05 ? "↓weakening" : "→stable";

    return {
      label: "A/D Ratio", value: `${(ratio * 100).toFixed(0)}% adv`,
      score, signal,
      detail: `${adv.toFixed(0)}↑ ${dec.toFixed(0)}↓ ${trendStr}`,
    };
  } catch {
    return { label: "A/D Ratio", value: "—", score: 5, signal: "neutral", detail: "unavailable" };
  }
}

// ── 5. News Sentiment (Finviz RSS + keyword scoring) ─────────
const BULL_KEYWORDS = [
  "beat", "beats", "surge", "rally", "record", "recovery", "upgrade",
  "outperform", "buy", "bullish", "gain", "jump", "soar", "strong",
  "growth", "breakout", "positive", "rebound", "higher", "optimism",
];
const BEAR_KEYWORDS = [
  "miss", "misses", "crash", "plunge", "recession", "downgrade",
  "sell", "bearish", "loss", "drop", "fall", "weak", "fear",
  "tariff", "inflation", "concern", "warning", "risk", "decline", "default",
];

function scoreHeadline(title: string): MacroHeadline["sentiment"] {
  const t = title.toLowerCase();
  let bull = 0, bear = 0;
  BULL_KEYWORDS.forEach(k => { if (t.includes(k)) bull++; });
  BEAR_KEYWORDS.forEach(k => { if (t.includes(k)) bear++; });
  if (bull > bear) return "bullish";
  if (bear > bull) return "bearish";
  return "neutral";
}

async function getNewsSentiment(): Promise<{ factor: MacroFactor; headlines: MacroHeadline[] }> {
  const headlines: MacroHeadline[] = [];

  // Finviz market news RSS
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
      // Parse <title> tags from RSS (skip channel title)
      const matches = [...text.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/g)];
      let count = 0;
      for (const m of matches) {
        const title = (m[1] || m[2] || "").trim();
        if (!title || title.length < 10 || title.toLowerCase().includes("finviz") || title.toLowerCase().includes("yahoo finance news")) continue;
        const sentiment = scoreHeadline(title);
        headlines.push({ title, sentiment, source: feed.source });
        count++;
        if (count >= 6) break;
      }
      if (headlines.length >= 8) break;
    } catch { /* timeout or network error — skip */ }
  }

  if (headlines.length === 0) {
    return {
      factor: { label: "News Sentiment", value: "—", score: 5, signal: "neutral", detail: "unavailable" },
      headlines: [],
    };
  }

  const bull  = headlines.filter(h => h.sentiment === "bullish").length;
  const bear  = headlines.filter(h => h.sentiment === "bearish").length;
  const total = headlines.length;
  const bullPct = total > 0 ? bull / total : 0.5;

  const score = bullPct >= 0.7 ? 8 : bullPct >= 0.55 ? 6 : bullPct <= 0.30 ? 2 : bullPct <= 0.45 ? 4 : 5;
  const signal: MacroFactor["signal"] = bullPct >= 0.55 ? "bullish" : bullPct <= 0.40 ? "bearish" : "neutral";

  return {
    factor: {
      label: "News Sentiment", value: `${bull}🟢 ${bear}🔴`,
      score, signal,
      detail: `${total} headlines · ${(bullPct * 100).toFixed(0)}% bullish`,
    },
    headlines: headlines.slice(0, 8),
  };
}

// ── 6. Market Breadth (SPY 20d high % proxy) ─────────────────
async function getMarketBreadth(): Promise<MacroFactor> {
  try {
    // Use SPY 50d series: count days close > 20d SMA as breadth proxy
    const spy = await fetchYahooSeries("SPY", 60);
    if (spy.length < 25) throw new Error("insufficient data");

    // Simple 20d SMA
    function sma(arr: number[], n: number, i: number): number {
      if (i < n - 1) return NaN;
      return arr.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n;
    }

    let aboveCount = 0, total = 0;
    for (let i = 19; i < spy.length; i++) {
      const s = sma(spy, 20, i);
      if (!isNaN(s)) { total++; if (spy[i] > s) aboveCount++; }
    }
    const breadthPct = total > 0 ? aboveCount / total : 0.5;

    // Also compute recent momentum: last 5d return
    const ret5d = spy.length >= 6
      ? (spy[spy.length - 1] - spy[spy.length - 6]) / spy[spy.length - 6] * 100
      : 0;

    const score = breadthPct >= 0.75 ? 8 : breadthPct >= 0.6 ? 7 : breadthPct >= 0.45 ? 5 : breadthPct >= 0.3 ? 3 : 2;
    const signal: MacroFactor["signal"] = breadthPct >= 0.6 ? "bullish" : breadthPct <= 0.40 ? "bearish" : "neutral";

    return {
      label: "Market Breadth",
      value: `${(breadthPct * 100).toFixed(0)}% >SMA20`,
      score, signal,
      detail: `SPY 5d: ${ret5d >= 0 ? "+" : ""}${ret5d.toFixed(1)}%`,
    };
  } catch {
    return { label: "Market Breadth", value: "—", score: 5, signal: "neutral", detail: "unavailable" };
  }
}

// ────────────────────────────────────────────────────────────
// Main: fetchMacroData
// ────────────────────────────────────────────────────────────
export async function fetchMacroData(): Promise<MacroData> {
  try {
    const [
      fearGreed, vixStructure, indexTrends, adRatio,
      newsResult, breadth,
    ] = await Promise.all([
      getFearGreed(),
      getVixStructure(),
      getIndexTrends(),
      getADRatio(),
      getNewsSentiment(),
      getMarketBreadth(),
    ]);

    const { factor: newsSentiment, headlines } = newsResult;

    const mbs =
      fearGreed.score    * W.fearGreed    +
      vixStructure.score * W.vixStructure +
      indexTrends.score  * W.indexTrends  +
      adRatio.score      * W.adRatio      +
      newsSentiment.score * W.newsSentiment +
      breadth.score      * W.breadth;

    return {
      mbs: Math.round(mbs * 10) / 10,
      mbsLabel: mbsLabel(mbs),
      factors: { fearGreed, vixStructure, indexTrends, adRatio, newsSentiment, breadth },
      headlines,
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    return {
      mbs: 5.0, mbsLabel: "NEUTRAL",
      factors: {
        fearGreed:    { label: "Fear & Greed",    value: "—", score: 5, signal: "neutral", detail: "error" },
        vixStructure: { label: "VIX Structure",   value: "—", score: 5, signal: "neutral", detail: "error" },
        indexTrends:  { label: "Index Trends",    value: "—", score: 5, signal: "neutral", detail: "error" },
        adRatio:      { label: "A/D Ratio",       value: "—", score: 5, signal: "neutral", detail: "error" },
        newsSentiment:{ label: "News Sentiment",  value: "—", score: 5, signal: "neutral", detail: "error" },
        breadth:      { label: "Market Breadth",  value: "—", score: 5, signal: "neutral", detail: "error" },
      },
      headlines: [],
      fetchedAt: new Date().toISOString(),
      error: String(e),
    };
  }
}
