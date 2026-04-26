// ============================================================
// HK MACRO ENGINE — V15.2  (SERVER ONLY)
// Factors & weights:
//   VHSI (volatility)      25%
//   USD/HKD peg            15%
//   HSI + HSTECH trends    20%
//   Southbound flow        20%
//   HIBOR 1M               10%
//   HK breadth proxy       10%
// ============================================================

import { HKMacroData, MacroFactor, MacroHeadline, hkMbsLabel } from "./macro-types";
export type { HKMacroData };

const W = {
  vhsi:       0.25,
  usdHkd:     0.15,
  hsiTrends:  0.20,
  southbound: 0.20,
  hibor:      0.10,
  breadth:    0.10,
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

// ── 1. VHSI — HK Volatility Index ────────────────────────────
async function getVHSI(): Promise<MacroFactor> {
  try {
    const vhsi = await fetchYahooClose("^VHSI");
    if (!vhsi) throw new Error("no VHSI");

    const score  = vhsi < 15 ? 9 : vhsi < 18 ? 8 : vhsi < 22 ? 7 : vhsi < 27 ? 5 : vhsi < 33 ? 3 : 2;
    const signal: MacroFactor["signal"] = vhsi < 20 ? "bullish" : vhsi > 28 ? "bearish" : "neutral";
    const label  = vhsi < 18 ? "Low Vol" : vhsi < 25 ? "Normal" : vhsi < 33 ? "Elevated" : "Fear";
    return {
      label: "VHSI",
      value: vhsi.toFixed(1),
      score, signal,
      detail: label,
    };
  } catch {
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
        return {
          label: "VHSI",
          value: `~${rvol.toFixed(1)}`,
          score, signal,
          detail: `Realized vol proxy`,
        };
      }
    } catch { /* ignore */ }
    return { label: "VHSI", value: "—", score: 5, signal: "neutral", detail: "unavailable" };
  }
}

// ── 2. USD/HKD Peg Stability ──────────────────────────────────
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
      score = 6; signal = "neutral"; detail = "Below floor (HKMA intervention)";
    }

    return {
      label: "USD/HKD Peg",
      value: rate.toFixed(4),
      score, signal, detail,
    };
  } catch {
    return { label: "USD/HKD Peg", value: "—", score: 5, signal: "neutral", detail: "unavailable" };
  }
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

    const hsiT    = trend20(hsiSeries);
    const hstechT = trend20(hstechSeries);
    const hsiAbove    = hsiSeries.length    > 0 && hsiSeries[hsiSeries.length - 1]       > ema10(hsiSeries);
    const hstechAbove = hstechSeries.length > 0 && hstechSeries[hstechSeries.length - 1] > ema10(hstechSeries);

    const bull = [hsiT > 0, hstechT > 0, hsiAbove, hstechAbove].filter(Boolean).length;
    const score  = bull === 4 ? 9 : bull === 3 ? 7 : bull === 2 ? 5 : bull === 1 ? 3 : 2;
    const signal: MacroFactor["signal"] = bull >= 3 ? "bullish" : bull <= 1 ? "bearish" : "neutral";

    const hsiStr    = hsiSeries.length    > 0 ? `HSI${hsiT >= 0 ? "+" : ""}${hsiT.toFixed(1)}%`       : "HSI—";
    const hstechStr = hstechSeries.length > 0 ? `Tech${hstechT >= 0 ? "+" : ""}${hstechT.toFixed(1)}%` : "Tech—";

    return {
      label: "HSI/HSTECH",
      value: `${bull}/4 bull`,
      score, signal,
      detail: `${hsiStr} ${hstechStr}`,
    };
  } catch {
    return { label: "HSI/HSTECH", value: "—", score: 5, signal: "neutral", detail: "unavailable" };
  }
}

// ── 4. Southbound Flow ────────────────────────────────────────
// Fixed: uses correct secid "1.000005" for combined southbound
async function getSouthboundFlow(): Promise<MacroFactor> {
  // Primary: KAMT kline for combined southbound (secid=1.000005)
  try {
    const secid = '1.000005'; // combined southbound (港股通沪+深)
    const url = `https://push2.eastmoney.com/api/qt/kamt.kline/get?secid=${secid}&fields1=f1,f2,f3,f4&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&klt=101&lmt=5`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://data.eastmoney.com/' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const klines: string[] = json?.data?.klines ?? [];
    if (klines.length === 0) throw new Error('no klines');
    const last = klines[klines.length - 1].split(',');
    const today = parseFloat(last[1] ?? '0');   // f52 = net today (CNY 亿)
    const fiveDay = klines.slice(-5).reduce((sum, k) => sum + parseFloat(k.split(',')[1] ?? '0'), 0);
    const score  = fiveDay >= 50 ? 9 : fiveDay >= 20 ? 8 : fiveDay >= 5 ? 6 : fiveDay >= -5 ? 5 : fiveDay >= -20 ? 3 : 2;
    const signal: MacroFactor['signal'] = fiveDay >= 10 ? 'bullish' : fiveDay <= -10 ? 'bearish' : 'neutral';
    const todayStr = today >= 0 ? `+${today.toFixed(1)}` : `${today.toFixed(1)}`;
    const cumStr   = fiveDay >= 0 ? `+${fiveDay.toFixed(1)}` : `${fiveDay.toFixed(1)}`;
    return {
      label: 'Southbound',
      value: `${todayStr}亿`,
      score, signal,
      detail: `Today ${todayStr} · 5d ${cumStr}亿CNY`,
    };
  } catch (e) {
    console.error('Southbound combined failed:', e);
  }

  // Fallback: sum SH + SZ
  try {
    const fetchOne = async (secid: string) => {
      const url = `https://push2.eastmoney.com/api/qt/kamt.kline/get?secid=${secid}&fields1=f1,f2,f3,f4&fields2=f51,f52,f53&klt=101&lmt=5`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store', signal: AbortSignal.timeout(5000) });
      const json = await res.json();
      const klines: string[] = json?.data?.klines ?? [];
      if (!klines.length) return [0, 0];
      const last = klines[klines.length - 1].split(',');
      const today = parseFloat(last[1] ?? '0');
      const fiveDay = klines.slice(-5).reduce((sum, k) => sum + parseFloat(k.split(',')[1] ?? '0'), 0);
      return [today, fiveDay];
    };
    const [shToday, sh5d] = await fetchOne('1.000003'); // 沪走港
    const [szToday, sz5d] = await fetchOne('1.000004'); // 深走港
    const today = shToday + szToday;
    const fiveDay = sh5d + sz5d;
    if (today === 0 && fiveDay === 0) throw new Error('zero flow');
    const score  = fiveDay >= 50 ? 9 : fiveDay >= 20 ? 8 : fiveDay >= 5 ? 6 : fiveDay >= -5 ? 5 : fiveDay >= -20 ? 3 : 2;
    const signal: MacroFactor['signal'] = fiveDay >= 10 ? 'bullish' : fiveDay <= -10 ? 'bearish' : 'neutral';
    const todayStr = today >= 0 ? `+${today.toFixed(1)}` : `${today.toFixed(1)}`;
    const cumStr   = fiveDay >= 0 ? `+${fiveDay.toFixed(1)}` : `${fiveDay.toFixed(1)}`;
    return {
      label: 'Southbound',
      value: `${todayStr}亿`,
      score, signal,
      detail: `Today ${todayStr} · 5d ${cumStr}亿CNY`,
    };
  } catch (e) {
    console.error('Southbound sum fallback failed:', e);
  }

  return { label: 'Southbound', value: '—', score: 5, signal: 'neutral', detail: 'unavailable' };
}

// ── 5. HIBOR 1M ───────────────────────────────────────────────
// Fixed: HKAB CSV export as primary (reliable), fallback Yahoo Finance "HIBOR1M="
async function getHIBOR(): Promise<MacroFactor> {
  // Primary: HKAB CSV export (always returns clean data)
  try {
    const url = 'https://www.hkab.org.hk/hibor/listHiborExport.do?type=1'; // CSV format
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HKAB CSV ${res.status}`);
    const csv = await res.text();
    // CSV columns: Date, O/N, 1 Wk, 2 Wk, 1 Mth, 2 Mth, 3 Mth, 6 Mth, 12 Mth
    const lines = csv.trim().split('\n');
    if (lines.length < 2) throw new Error('no data');
    const lastLine = lines[lines.length - 1].split(',');
    // 1Mth is the 5th column (index 4)
    const rateStr = lastLine[4]?.trim();
    if (!rateStr) throw new Error('missing 1m');
    const rate = parseFloat(rateStr);
    if (isNaN(rate) || rate <= 0 || rate > 30) throw new Error('invalid HIBOR');
    return scoreHIBOR(rate, 'HKAB CSV');
  } catch (e) {
    console.error('HKAB CSV failed:', e);
  }

  // Fallback: Yahoo Finance 1-month HIBOR (ticker HIBOR1M=X)
  try {
    const rate = await fetchYahooClose("HIBOR1M=X");
    if (rate && !isNaN(rate) && rate > 0 && rate < 30) {
      return scoreHIBOR(rate, 'Yahoo');
    }
  } catch (e) {
    console.error('Yahoo HIBOR failed:', e);
  }

  return { label: 'HIBOR 1M', value: '—', score: 5, signal: 'neutral', detail: 'unavailable' };
}

function scoreHIBOR(rate: number, source: string): MacroFactor {
  const score  = rate < 1.0 ? 8 : rate < 2.5 ? 7 : rate < 4.0 ? 5 : rate < 6.0 ? 3 : 2;
  const signal: MacroFactor["signal"] = rate < 2.0 ? "bullish" : rate > 4.5 ? "bearish" : "neutral";
  const label  = rate < 1.0 ? "Very Low" : rate < 2.5 ? "Low" : rate < 4.0 ? "Moderate" : rate < 6.0 ? "High" : "Very High";
  return {
    label: "HIBOR 1M",
    value: `${rate.toFixed(3)}%`,
    score, signal,
    detail: `${label} (${source})`,
  };
}

// ── 6. HK Market Breadth proxy ────────────────────────────────
async function getHKBreadth(): Promise<MacroFactor> {
  try {
    const symbols = [
      "^HSI", "^HSTECH",
      "2800.HK", "3032.HK",
      "9988.HK", "0700.HK", "1211.HK", "1810.HK", "0005.HK", "0941.HK",
    ];
    const seriesArr = await Promise.all(symbols.map(s => fetchYahooSeries(s, 25)));
    let above = 0, total = 0;
    seriesArr.forEach(series => {
      if (series.length < 21) return;
      const sma20 = series.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const cur   = series[series.length - 1];
      total++;
      if (cur > sma20) above++;
    });
    if (total < 4) throw new Error("insufficient");
    const pct    = above / total;
    const score  = pct >= 0.75 ? 8 : pct >= 0.60 ? 7 : pct >= 0.45 ? 5 : pct >= 0.30 ? 3 : 2;
    const signal: MacroFactor["signal"] = pct >= 0.60 ? "bullish" : pct <= 0.40 ? "bearish" : "neutral";
    return {
      label: "HK Breadth",
      value: `${(pct * 100).toFixed(0)}% >SMA20`,
      score, signal,
      detail: `${above}/${total} >SMA20`,
    };
  } catch {
    return { label: "HK Breadth", value: "—", score: 5, signal: "neutral", detail: "unavailable" };
  }
}

// ── Main export ───────────────────────────────────────────────
export async function fetchHKMacroData(): Promise<HKMacroData> {
  try {
    const [vhsi, usdHkd, hsiTrends, southbound, hibor, breadth] = await Promise.all([
      getVHSI(), getUSDHKD(), getHSITrends(),
      getSouthboundFlow(), getHIBOR(), getHKBreadth(),
    ]);

    const mbs =
      vhsi.score       * W.vhsi       +
      usdHkd.score     * W.usdHkd     +
      hsiTrends.score  * W.hsiTrends  +
      southbound.score * W.southbound +
      hibor.score      * W.hibor      +
      breadth.score    * W.breadth;

    const headlines: MacroHeadline[] = [];
    try {
      const res = await fetch("https://feeds.finance.yahoo.com/rss/2.0/headline?s=^HSI&region=HK&lang=zh-Hant-HK", {
        headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store",
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const text = await res.text();
        const re = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/g;
        let m: RegExpExecArray | null;
        let count = 0;
        const BULL_HK = ["上涨","升","买入","强势","增持","看好","回升","反弹","资金流入"];
        const BEAR_HK = ["下跌","跌","卖出","弱势","减持","看淡","回落","下行","资金流出"];
        while ((m = re.exec(text)) !== null && count < 6) {
          const title = m[1].trim();
          if (title.length < 5) continue;
          const t = title.toLowerCase();
          let bull = 0, bear = 0;
          BULL_HK.forEach(k => { if (t.includes(k)) bull++; });
          BEAR_HK.forEach(k => { if (t.includes(k)) bear++; });
          const sentiment: MacroHeadline["sentiment"] = bull > bear ? "bullish" : bear > bull ? "bearish" : "neutral";
          headlines.push({ title, sentiment, source: "Yahoo HK" });
          count++;
        }
      }
    } catch { /* ignore */ }

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
        hibor: empty("HIBOR 1M"), breadth: empty("HK Breadth"),
      },
      headlines: [],
      fetchedAt: new Date().toISOString(),
      error: String(e),
    };
  }
}
