// ============================================================
// HK MACRO ENGINE — V15.2b  (SERVER ONLY)
// Updated weights:
//   VHSI (volatility)      25%
//   Southbound flow        20%
//   HSI + HSTECH trends    20%
//   USD/HKD peg            15%
//   HK breadth             10%
//   HIBOR 1M               10%
//
// Fixes:
//   Southbound: Yahoo ETF volume proxy (primary) + EastMoney (secondary)
//   HIBOR: HKMA correct field names + Yahoo ^IRX proxy fallback
// ============================================================

import { HKMacroData, MacroFactor, MacroHeadline, hkMbsLabel } from "./macro-types";
export type { HKMacroData };

const W = {
  vhsi:       0.25,
  southbound: 0.20,
  hsiTrends:  0.20,
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
    const score  = vhsi < 15 ? 9 : vhsi < 18 ? 8 : vhsi < 22 ? 7 : vhsi < 27 ? 5 : vhsi < 33 ? 3 : 2;
    const signal: MacroFactor["signal"] = vhsi < 20 ? "bullish" : vhsi > 28 ? "bearish" : "neutral";
    const label  = vhsi < 18 ? "Low Vol" : vhsi < 25 ? "Normal" : vhsi < 33 ? "Elevated" : "Fear";
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
// Primary:   Scrape data.eastmoney.com/hsgt/index.html (server-rendered)
// Secondary: Yahoo ETF proxy (fallback)
async function getSouthboundFlow(): Promise<MacroFactor> {

  // ── Source A: EastMoney server-rendered HSGT page ────────────
  try {
    const res = await fetch("https://data.eastmoney.com/hsgt/index.html", {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error("fetch failed");
    const html = await res.text();

    // The page embeds southbound net flow in its server HTML:
    //   ... 南向资金 净买额-40.92亿买入额510.94亿卖出额551.86亿 ...
    const match = html.match(/南向资金\s+净买额([+\-]?[0-9]+(?:\.[0-9]+)?)亿/);
    if (match) {
      const netYi = parseFloat(match[1]);   // value in 亿元
      if (!isNaN(netYi)) {
        const score  = netYi >= 50 ? 9 : netYi >= 20 ? 8 : netYi >= 5 ? 6 : netYi >= -5 ? 5 : netYi >= -20 ? 3 : 2;
        const signal: MacroFactor["signal"] = netYi >= 10 ? "bullish" : netYi <= -10 ? "bearish" : "neutral";
        const todayStr = netYi >= 0 ? `+${netYi.toFixed(1)}` : `${netYi.toFixed(1)}`;
        return {
          label: "Southbound",
          value: `${todayStr}亿`,
          score,
          signal,
          detail: `Today ${todayStr}亿 CNY (官方)`,
        };
      }
    }
  } catch { /* fall through to ETF proxy */ }

  // ── Source B: Yahoo ETF proxy (unchanged) ────────────────────
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

// ── 3. HSI & HSTECH Trends ────────────────────────────────────
async function getHSITrends(): Promise<MacroFactor> {
  try {
    const [hsiSeries, hstechSeries] = await Promise.all([
      fetchYahooSeries("^HSI", 22),
      fetchYahooSeries("^HSTECH", 22),
    ]);
    const trend20 = (s: number[]) => s.length < 5 ? 0 : (s[s.length - 1] - s[0]) / s[0] * 100;
    const ema10   = (s: number[]) => {
      if (!s.length) return 0;
      const a = 2 / 11; let e = s[0];
      for (let i = 1; i < s.length; i++) e = a * s[i] + (1 - a) * e;
      return e;
    };
    const hsiT        = trend20(hsiSeries);
    const hstechT     = trend20(hstechSeries);
    const hsiAbove    = hsiSeries.length    > 0 && hsiSeries[hsiSeries.length - 1]       > ema10(hsiSeries);
    const hstechAbove = hstechSeries.length > 0 && hstechSeries[hstechSeries.length - 1] > ema10(hstechSeries);
    const bull        = [hsiT > 0, hstechT > 0, hsiAbove, hstechAbove].filter(Boolean).length;
    const score       = bull === 4 ? 9 : bull === 3 ? 7 : bull === 2 ? 5 : bull === 1 ? 3 : 2;
    const signal: MacroFactor["signal"] = bull >= 3 ? "bullish" : bull <= 1 ? "bearish" : "neutral";
    const hsiStr    = hsiSeries.length    > 0 ? `HSI${hsiT >= 0 ? "+" : ""}${hsiT.toFixed(1)}%`       : "HSI—";
    const hstechStr = hstechSeries.length > 0 ? `Tech${hstechT >= 0 ? "+" : ""}${hstechT.toFixed(1)}%` : "Tech—";
    return { label: "HSI/HSTECH", value: `${bull}/4 bull`, score, signal, detail: `${hsiStr} ${hstechStr}` };
  } catch {
    return { label: "HSI/HSTECH", value: "—", score: 5, signal: "neutral", detail: "unavailable" };
  }
}

// ── 4. USD/HKD Peg Stability ──────────────────────────────────
async function getUSDHKD(): Promise<MacroFactor> {
  try {
    const rate = await fetchYahooClose("USDHKD=X");
    if (!rate) throw new Error("no USDHKD");
    let score: number;
    let signal: MacroFactor["signal"];
    let detail: string;
    if (rate >= 7.75 && rate <= 7.77) {
      score = 8; signal = "bullish"; detail = "Strong side (ideal)";
    } else if (rate > 7.77 && rate <= 7.80) {
      score = 7; signal = "bullish"; detail = "Mid-band (stable)";
    } else if (rate > 7.80 && rate <= 7.83) {
      score = 5; signal = "neutral"; detail = "Upper-mid (watch)";
    } else if (rate > 7.83 && rate <= 7.85) {
      score = 3; signal = "bearish"; detail = "Weak side (pressure)";
    } else if (rate > 7.85) {
      score = 1; signal = "bearish"; detail = "Above peg ceiling";
    } else {
      score = 6; signal = "neutral"; detail = "Below floor (HKMA)";
    }
    return { label: "USD/HKD Peg", value: rate.toFixed(4), score, signal, detail };
  } catch {
    return { label: "USD/HKD Peg", value: "—", score: 5, signal: "neutral", detail: "unavailable" };
  }
}

// ── 5. HK Market Breadth ─────────────────────────────────────
async function getHKBreadth(): Promise<MacroFactor> {
  try {
    const symbols = [
      "^HSI", "^HSTECH",
      "2800.HK",  // Tracker Fund
      "3033.HK",  // CSOP HSTECH ETF
      "9988.HK",  // Alibaba
      "0700.HK",  // Tencent
      "1211.HK",  // BYD
      "1810.HK",  // Xiaomi
      "0005.HK",  // HSBC
      "0941.HK",  // China Mobile
    ];
    const seriesArr = await Promise.all(symbols.map(s => fetchYahooSeries(s, 25)));
    let above = 0, total = 0;
    seriesArr.forEach(series => {
      if (series.length < 21) return;
      const sma20 = series.slice(-20).reduce((a, b) => a + b, 0) / 20;
      total++;
      if (series[series.length - 1] > sma20) above++;
    });
    if (total < 4) throw new Error("insufficient");
    const pct    = above / total;
    const score  = pct >= 0.75 ? 8 : pct >= 0.60 ? 7 : pct >= 0.45 ? 5 : pct >= 0.30 ? 3 : 2;
    const signal: MacroFactor["signal"] = pct >= 0.60 ? "bullish" : pct <= 0.40 ? "bearish" : "neutral";
    return { label: "HK Breadth", value: `${(pct * 100).toFixed(0)}% >SMA20`, score, signal, detail: `${above}/${total} >SMA20` };
  } catch {
    return { label: "HK Breadth", value: "—", score: 5, signal: "neutral", detail: "unavailable" };
  }
}

// ── 6. HIBOR 1M ───────────────────────────────────────────────
// Strategy:
//   Primary A: HKMA public API (correct field: hibor_1m)
//   Primary B: HKAB scrape (regex on rate table)
//   Fallback:  Yahoo Finance ^IRX (US 13-week T-bill) as proxy
//              HK HIBOR tracks Fed Funds closely due to peg
async function getHIBOR(): Promise<MacroFactor> {

  // ── Source A: HKMA daily interbank liquidity API ──────────────
  // Correct endpoint with actual field names
  const hkmaEndpoints = [
    // Daily monetary stats — has overnight, 1w, 1m HIBOR
    "https://api.hkma.gov.hk/public/market-data-and-statistics/daily-monetary-statistics/daily-figures-interbank-liquidity?pagesize=5&sortby=end_of_date&sortorder=desc",
    // Monthly statistical bulletin — has hibor series
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
      // Try all known field name variants for 1M HIBOR
      const fieldNames = [
        "hibor_1m", "hibor_1m_fixing", "one_month", "1m",
        "hibor_1month", "interbank_1m", "rate_1m",
      ];
      let rate: number | null = null;
      for (const field of fieldNames) {
        const val = parseFloat(String(rec[field] ?? ""));
        if (!isNaN(val) && val > 0 && val < 30) { rate = val; break; }
      }
      // Also check all numeric fields if named ones failed
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

  // ── Source B: HKAB website scrape ────────────────────────────
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
      // Multiple regex patterns to handle different HTML structures
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

  // ── Fallback: Yahoo ^IRX (13-week US T-bill) as HIBOR proxy ──
  // HK HIBOR tracks US rates tightly due to peg; IRX ≈ HIBOR O/N
  // 1M HIBOR ≈ IRX * 1.05 (slight premium due to HK credit)
  try {
    const irx = await fetchYahooClose("^IRX");
    if (irx && irx > 0) {
      const hiborProxy = irx * 1.05; // approximate 1M HIBOR from US T-bill
      return scoreHIBOR(hiborProxy, "^IRX proxy");
    }
  } catch { /* ignore */ }

  // ── Last resort: Fed Funds + spread proxy ─────────────────────
  try {
    // Use EFFR proxy from Yahoo (^TNX = 10yr, not ideal, but better than nothing)
    // Actually derive from USDHKD positioning: tight peg + high USDHKD = higher HIBOR
    const usdHkd = await fetchYahooClose("USDHKD=X");
    if (usdHkd) {
      // Historically: USDHKD closer to 7.85 = tighter liquidity = higher HIBOR
      const pegStress = (usdHkd - 7.75) / (7.85 - 7.75); // 0=strong side, 1=weak side
      const impliedHibor = 2.0 + pegStress * 4.0; // rough: 2% at strong side, 6% at weak
      return scoreHIBOR(impliedHibor, "Peg proxy");
    }
  } catch { /* ignore */ }

  return { label: "HIBOR 1M", value: "—", score: 5, signal: "neutral", detail: "unavailable" };
}

function scoreHIBOR(rate: number, source: string): MacroFactor {
  const score  = rate < 1.0 ? 8 : rate < 2.5 ? 7 : rate < 4.0 ? 5 : rate < 6.0 ? 3 : 2;
  const signal: MacroFactor["signal"] = rate < 2.0 ? "bullish" : rate > 4.5 ? "bearish" : "neutral";
  const label  = rate < 1.0 ? "Very Low" : rate < 2.5 ? "Low" : rate < 4.0 ? "Moderate" : rate < 6.0 ? "High" : "Very High";
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
      // Return factors in the new weight order for UI display
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
        hibor: empty("HIBOR 1M"), breadth: empty("HK Breadth"),
      },
      headlines: [],
      fetchedAt: new Date().toISOString(),
      error: String(e),
    };
  }
}
