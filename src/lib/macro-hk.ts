// ============================================================
// HK MACRO ENGINE — V15.2c  (SERVER ONLY)
// Weights (revised):
//   VHSI (volatility)      20%
//   Southbound flow        20%
//   HSI + HSTECH trends    25%
//   USD/HKD peg            15%
//   Market Breadth         10%
//   HIBOR 1M               10%
//
// All scoring now matches Python macros.
// ============================================================

import { HKMacroData, MacroFactor, MacroHeadline, hkMbsLabel } from "./macro-types";
export type { HKMacroData };

const W = {
  vhsi:       0.20,
  southbound: 0.20,
  hsiTrends:  0.25,
  usdHkd:     0.15,
  breadth:    0.10,
  hibor:      0.10,
};

// ── Yahoo helpers ─────────────────────────────────────────────
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

async function fetchYahooOHLCV(symbol: string, days = 10): Promise<{ close: number; volume: number }[]> {
  try {
    const end   = Math.floor(Date.now() / 1000);
    const start = end - days * 86400 * 2;
    const url   = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${start}&period2=${end}&interval=1d`;
    const res   = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" });
    if (!res.ok) return [];
    const json   = await res.json();
    const q      = json?.chart?.result?.[0]?.indicators?.quote?.[0];
    if (!q) return [];
    const closes:  number[] = q.close  ?? [];
    const volumes: number[] = q.volume ?? [];
    const out: { close: number; volume: number }[] = [];
    for (let i = 0; i < closes.length; i++) {
      if (closes[i] != null && !isNaN(closes[i])) {
        out.push({ close: closes[i], volume: volumes[i] ?? 0 });
      }
    }
    return out.slice(-days);
  } catch { return []; }
}

// ── 1. VHSI — HK Volatility Index ────────────────────────────
async function getVHSI(): Promise<MacroFactor> {
  try {
    const vhsi = await fetchYahooClose("^VHSI");
    if (!vhsi) throw new Error("no VHSI");
    // Python alignment
    let score: number; let label: string;
    if (vhsi < 15)          { score = 9; label = "Low Vol"; }
    else if (vhsi < 18)    { score = 7; label = "Low Vol"; }
    else if (vhsi < 20)    { score = 7; label = "Low Vol"; }
    else if (vhsi < 22)    { score = 5; label = "Normal"; }
    else if (vhsi < 25)    { score = 5; label = "Normal"; }
    else if (vhsi < 27)    { score = 3; label = "Elevated"; }
    else if (vhsi < 30)    { score = 3; label = "Elevated"; }
    else if (vhsi < 33)    { score = 1; label = "Fear"; }
    else if (vhsi < 40)    { score = 1; label = "Fear"; }
    else                   { score = 0; label = "Crisis"; }
    const signal: MacroFactor["signal"] = score >= 7 ? "bullish" : score <= 3 ? "bearish" : "neutral";
    return { label: "VHSI", value: vhsi.toFixed(1), score, signal, detail: label };
  } catch {
    // Realized vol fallback from HSI 20-day
    try {
      const hsi = await fetchYahooSeries("^HSI", 25);
      if (hsi.length >= 21) {
        const rets: number[] = [];
        for (let i = 1; i < hsi.length; i++) rets.push(Math.log(hsi[i] / hsi[i - 1]));
        const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
        const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
        const rvol = Math.sqrt(variance * 252) * 100;
        const score  = rvol < 15 ? 9 : rvol < 20 ? 8 : rvol < 25 ? 6 : rvol < 32 ? 4 : 2;
        const signal: MacroFactor["signal"] = rvol < 20 ? "bullish" : rvol > 30 ? "bearish" : "neutral";
        return { label: "VHSI", value: `~${rvol.toFixed(1)}`, score, signal, detail: "HSI realized vol" };
      }
    } catch { /* ignore */ }
    return { label: "VHSI", value: "—", score: 5, signal: "neutral", detail: "unavailable" };
  }
}

// ── 2. Southbound Flow ────────────────────────────────────────
// Primary:   Static JSON generated by GitHub Action
// Secondary: Yahoo ETF proxy (fallback)
async function getSouthboundFlow(): Promise<MacroFactor> {

  // ── Source A: GitHub-hosted static JSON ─────────────────────
  try {
    const jsonUrl = "https://raw.githubusercontent.com/sc4stock-pixel/stock-analysis-technical-and-fundamental/main/southbound_data.json";
    const res = await fetch(jsonUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store",   // ← forces a fresh fetch every time
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const netYi = data.todayYi;
    if (typeof netYi !== "number") throw new Error("invalid number");

    // Python aligned scoring
    const score  = netYi >= 50 ? 9 : netYi >= 20 ? 7 : netYi >= 5 ? 6 : netYi >= -5 ? 5 : netYi >= -20 ? 3 : 1;
    const signal: MacroFactor["signal"] = netYi >= 10 ? "bullish" : netYi <= -10 ? "bearish" : "neutral";
    const todayStr = netYi >= 0 ? `+${netYi.toFixed(2)}` : `${netYi.toFixed(2)}`;

    console.log("[Southbound] Static JSON loaded:", todayStr, "亿");
    return {
      label: "Southbound",
      value: `${todayStr}亿`,
      score,
      signal,
      detail: `Today ${todayStr}亿 CNY (akshare)`,
    };
  } catch (err) {
    console.error("[Southbound] JSON fetch failed, fallback to ETF proxy:", err);
  }

  // ── Source B: Yahoo ETF proxy ────────────────────────────────
  try {
    const [tracker, hstech] = await Promise.all([
      fetchYahooOHLCV("2800.HK", 25),
      fetchYahooOHLCV("3033.HK", 25),
    ]);
    if (tracker.length < 21) throw new Error("insufficient data");

    const avgVol = tracker.slice(-21, -1).reduce((s, b) => s + b.volume, 0) / 20;
    const volRatio = avgVol > 0 ? tracker[tracker.length - 1].volume / avgVol : 1;
    const close5 = tracker[tracker.length - 6]?.close ?? tracker[0].close;
    const ret5d = close5 > 0 ? (tracker[tracker.length - 1].close - close5) / close5 * 100 : 0;

    let hstechRelStr = 0;
    if (hstech.length >= 6) {
      const hs5 = hstech[hstech.length - 6].close;
      const hsr5 = hs5 > 0 ? (hstech[hstech.length - 1].close - hs5) / hs5 * 100 : 0;
      hstechRelStr = hsr5 - ret5d;
    }

    const bull = [volRatio > 1.3, ret5d > 0, hstechRelStr > 0].filter(Boolean).length;
    const score = bull === 3 ? 8 : bull === 2 ? 5 : bull === 1 ? 3 : 2;
    const signal: MacroFactor["signal"] = bull >= 2 ? "bullish" : bull === 0 ? "bearish" : "neutral";

    return {
      label: "Southbound",
      value: `${ret5d >= 0 ? "+" : ""}${ret5d.toFixed(1)}%`,
      score,
      signal,
      detail: `2800.HK Vol ${volRatio.toFixed(1)}x avg · 5d ${ret5d >= 0 ? "+" : ""}${ret5d.toFixed(1)}%`,
    };
  } catch { /* fall through */ }

  return { label: "Southbound", value: "—", score: 5, signal: "neutral", detail: "unavailable" };
}

// ── 3. HSI & HSTECH Trends (10d/20d/50d momentum, score 0‑10) ─
async function getHSITrends(): Promise<MacroFactor> {
  try {
    const [hsiSeries, hstechIndex] = await Promise.all([
      fetchYahooSeries("^HSI", 60),
      fetchYahooSeries("^HSTECH", 60).catch(() => []),
    ]);
    const hstechSeries = hstechIndex.length >= 50 ? hstechIndex : await fetchYahooSeries("3033.HK", 60);

    const mom = (series: number[], days: number) =>
      series.length > days ? (series[series.length - 1] / series[series.length - 1 - days] - 1) * 100 : 0;

    const hsi10 = mom(hsiSeries, 10), hsi20 = mom(hsiSeries, 20), hsi50 = mom(hsiSeries, 50);
    const hstech10 = mom(hstechSeries, 10), hstech20 = mom(hstechSeries, 20), hstech50 = mom(hstechSeries, 50);

    const conditions = [hsi10 > 0, hsi20 > 0, hsi50 > 0, hstech10 > 0, hstech20 > 0, hstech50 > 0];
    const bullCount = conditions.filter(Boolean).length;

    const score = Math.round((bullCount / 6) * 10);
    const signal: MacroFactor["signal"] = score >= 7 ? "bullish" : score <= 3 ? "bearish" : "neutral";

    const detail = `HSI ${hsi10>=0?'+':''}${hsi10.toFixed(1)}% ${hsi20>=0?'+':''}${hsi20.toFixed(1)}% ${hsi50>=0?'+':''}${hsi50.toFixed(1)}% | Tech ${hstech10>=0?'+':''}${hstech10.toFixed(1)}% ${hstech20>=0?'+':''}${hstech20.toFixed(1)}% ${hstech50>=0?'+':''}${hstech50.toFixed(1)}%`;

    return {
      label: "Index Trends 10d/20d/50d%",
      value: `${score}/10`,
      score,
      signal,
      detail,
    };
  } catch {
    return { label: "HSI/HSTECH", value: "—", score: 5, signal: "neutral", detail: "unavailable" };
  }
}

// ── 4. USD/HKD Peg Stability ──────────────────────────────────
async function getUSDHKD(): Promise<MacroFactor> {
  try {
    const rate = await fetchYahooClose("USDHKD=X");
    if (!rate) throw new Error("no USDHKD");
    let score: number; let signal: MacroFactor["signal"]; let detail: string;
    // Python aligned scoring
    if (rate < 7.77)                     { score = 9; signal = "bullish"; detail = "Strong side (ideal)"; }
    else if (rate >= 7.77 && rate <= 7.78){ score = 9; signal = "bullish"; detail = "Strong side"; }
    else if (rate > 7.78 && rate <= 7.80){ score = 7; signal = "bullish"; detail = "Mid-band (stable)"; }
    else if (rate > 7.80 && rate <= 7.82){ score = 5; signal = "neutral"; detail = "Upper-mid (watch)"; }
    else if (rate > 7.82 && rate <= 7.83){ score = 3; signal = "bearish"; detail = "Upper-mid (watch)"; }
    else if (rate > 7.83 && rate <= 7.84){ score = 3; signal = "bearish"; detail = "Weak side (pressure)"; }
    else if (rate > 7.84 && rate <= 7.85){ score = 1; signal = "bearish"; detail = "Weak side (pressure)"; }
    else if (rate > 7.85)               { score = 0; signal = "bearish"; detail = "Above peg ceiling"; }
    else                                 { score = 6; signal = "neutral"; detail = "Below floor (HKMA)"; }
    return { label: "USD/HKD Peg", value: rate.toFixed(4), score, signal, detail };
  } catch {
    return { label: "USD/HKD Peg", value: "—", score: 5, signal: "neutral", detail: "unavailable" };
  }
}

// ── 5. HK Market Breadth (ETFs, SMA50, Python aligned) ──────
async function getHKBreadth(): Promise<MacroFactor> {
  try {
    const symbols = [
      "2800.HK",  // Tracker Fund (HSI)
      "3033.HK",  // CSOP HSTECH ETF
      "2828.HK",  // HSCEI ETF (H-shares)
      "2823.HK",  // iShares FTSE A50 China
      "3188.HK",  // CAM CSI300 ETF
    ];
    const seriesArr = await Promise.all(symbols.map(s => fetchYahooSeries(s, 55)));
    let above = 0, total = 0;
    seriesArr.forEach(series => {
      if (series.length < 51) return;
      const sma50 = series.slice(-50).reduce((a, b) => a + b, 0) / 50;
      total++;
      if (series[series.length - 1] > sma50) above++;
    });
    if (total < 3) throw new Error("insufficient");
    const pct = above / total;
    // Score alignment
    const score  = pct >= 0.80 ? 9 : pct >= 0.75 ? 7 : pct >= 0.60 ? 7 : pct >= 0.45 ? 5 : pct >= 0.30 ? 3 : pct >= 0.20 ? 3 : 1;
    const signal: MacroFactor["signal"] = pct >= 0.60 ? "bullish" : pct <= 0.30 ? "bearish" : "neutral";
    return {
      label: "Market Breadth",
      value: `${(pct * 100).toFixed(0)}% >SMA50`,
      score,
      signal,
      detail: `${above}/${total} >SMA50`,
    };
  } catch {
    return { label: "Market Breadth", value: "—", score: 5, signal: "neutral", detail: "unavailable" };
  }
}

// ── 6. HIBOR 1M ───────────────────────────────────────────────
async function getHIBOR(): Promise<MacroFactor> {

  // ── Source A: HKMA interbank liquidity API ──────────────────
  const hkmaEndpoints = [
    "https://api.hkma.gov.hk/public/market-data-and-statistics/daily-monetary-statistics/daily-figures-interbank-liquidity?pagesize=5&sortby=end_of_date&sortorder=desc",
    "https://api.hkma.gov.hk/public/market-data-and-statistics/monthly-statistical-bulletin/money/interest-rates-in-hong-kong?pagesize=3&sortby=end_of_date&sortorder=desc",
  ];
  for (const url of hkmaEndpoints) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const json = await res.json();
      const records: Array<Record<string, unknown>> = json?.result?.records ?? [];
      if (!records.length) continue;
      const rec = records[0];
      const fieldNames = [
        "hibor_1m", "hibor_1m_fixing", "one_month", "1m",
        "hibor_1month", "interbank_1m", "rate_1m",
      ];
      let rate: number | null = null;
      for (const field of fieldNames) {
        const val = parseFloat(String(rec[field] ?? ""));
        if (!isNaN(val) && val > 0 && val < 30) { rate = val; break; }
      }
      if (rate === null) {
        for (const [key, val] of Object.entries(rec)) {
          if (key.toLowerCase().includes("1m") || key.toLowerCase().includes("month")) {
            const v = parseFloat(String(val));
            if (!isNaN(v) && v > 0 && v < 30) { rate = v; break; }
          }
        }
      }
      if (rate !== null) return scoreHIBOR(rate, "HKMA");
    } catch { /* try next */ }
  }

  // ── Source B: HKAB website scrape ───────────────────────────
  const hkabUrls = [
    "https://www.hkab.org.hk/hibor/listHibor.do",
    "https://www.hkab.org.hk/en/market-information/hong-kong-interbank-offered-rate",
  ];
  for (const hkabUrl of hkabUrls) {
    try {
      const res = await fetch(hkabUrl, {
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html,application/xhtml+xml" },
        cache: "no-store",
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const patterns = [
        /1\s*[Mm]onth[^<]*<\/td>\s*<td[^>]*>\s*(\d+\.\d+)/,
        /1M[^<]*<\/td>\s*<td[^>]*>\s*(\d+\.\d+)/,
        />1\s*Month<\/[^>]+>\s*<[^>]+>\s*(\d+\.\d+)/,
        /hibor.*?1.*?month.*?(\d+\.\d{4,})/i,
        /(\d+\.\d{4,})\s*%?\s*<\/td>[\s\S]{0,200}1.Month/i,
      ];
      for (const re of patterns) {
        const m = re.exec(html);
        if (m) {
          const rate = parseFloat(m[1]);
          if (!isNaN(rate) && rate > 0 && rate < 30) return scoreHIBOR(rate, "HKAB");
        }
      }
    } catch { /* try next */ }
  }

  return { label: "HIBOR 1M", value: "—", score: 5, signal: "neutral", detail: "unavailable" };
}

function scoreHIBOR(rate: number, source: string): MacroFactor {
  // Python aligned scoring
  const score  = rate < 1.0 ? 9 : rate < 2.0 ? 7 : rate < 2.5 ? 7 : rate < 3.0 ? 5 : rate < 4.0 ? 3 : 1;
  const signal: MacroFactor["signal"] = rate < 2.5 ? "bullish" : rate > 3.0 ? "bearish" : "neutral";
  const label  = rate < 1.0 ? "Very Low" : rate < 2.0 ? "Low" : rate < 3.0 ? "Moderate" : rate < 6.0 ? "High" : "Very High";
  return { label: "HIBOR 1M", value: `${rate.toFixed(2)}%`, score, signal, detail: `${label} (${source})` };
}

// ── Main export ───────────────────────────────────────────────
export async function fetchHKMacroData(): Promise<HKMacroData> {
  try {
    const [vhsi, southbound, hsiTrends, usdHkd, breadth, hibor] = await Promise.all([
      getVHSI(), getSouthboundFlow(), getHSITrends(),
      getUSDHKD(), getHKBreadth(), getHIBOR(),
    ]);

    const mbs =
      vhsi.score       * W.vhsi       +
      southbound.score * W.southbound +
      hsiTrends.score  * W.hsiTrends  +
      usdHkd.score     * W.usdHkd     +
      breadth.score    * W.breadth    +
      hibor.score      * W.hibor;

    // HK headlines via Yahoo HK RSS
    const headlines: MacroHeadline[] = [];
    try {
      const feedUrls = [
        "https://feeds.finance.yahoo.com/rss/2.0/headline?s=^HSI&region=HK&lang=en-US",
        "https://feeds.finance.yahoo.com/rss/2.0/headline?s=9988.HK&region=HK&lang=en-US",
      ];
      for (const feedUrl of feedUrls) {
        try {
          const res = await fetch(feedUrl, {
            headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store",
            signal: AbortSignal.timeout(3000),
          });
          if (!res.ok) continue;
          const text = await res.text();
          const re = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/g;
          let m: RegExpExecArray | null;
          let count = 0;
          const BULL_KW = ["rise","gain","surge","rally","beat","upgrade","buy","strong","growth","rebound","inflow","positive"];
          const BEAR_KW = ["fall","drop","plunge","miss","downgrade","sell","weak","risk","outflow","negative","concern","tariff"];
          // eslint-disable-next-line no-cond-assign
          while ((m = re.exec(text)) !== null && count < 5) {
            const title = m[1].trim();
            if (title.length < 8 || title.toLowerCase().includes("yahoo finance")) continue;
            const t = title.toLowerCase();
            let bull = 0, bear = 0;
            BULL_KW.forEach(k => { if (t.includes(k)) bull++; });
            BEAR_KW.forEach(k => { if (t.includes(k)) bear++; });
            const sentiment: MacroHeadline["sentiment"] = bull > bear ? "bullish" : bear > bull ? "bearish" : "neutral";
            headlines.push({ title, sentiment, source: "Yahoo HK" });
            count++;
          }
        } catch { /* ignore */ }
        if (headlines.length >= 6) break;
      }
    } catch { /* ignore headlines */ }

    return {
      mbs: Math.round(mbs * 10) / 10,
      mbsLabel: hkMbsLabel(mbs),
      factors: { vhsi, usdHkd, hsiTrends, southbound, hibor, breadth },
      headlines,
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    const empty = (label: string): MacroFactor => ({ label, value: "—", score: 5, signal: "neutral", detail: "error" });
    return {
      mbs: 5.0, mbsLabel: "NEUTRAL",
      factors: {
        vhsi: empty("VHSI"), usdHkd: empty("USD/HKD Peg"),
        hsiTrends: empty("HSI/HSTECH"), southbound: empty("Southbound"),
        hibor: empty("HIBOR 1M"), breadth: empty("Market Breadth"),
      },
      headlines: [],
      fetchedAt: new Date().toISOString(),
      error: String(e),
    };
  }
}
