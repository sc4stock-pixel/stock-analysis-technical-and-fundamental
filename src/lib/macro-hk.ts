// ============================================================
// HK MACRO ENGINE — V15.2  (SERVER ONLY)
// Factors & weights:
//   VHSI (volatility)      25%
//   USD/HKD peg            25%
//   HSI + HSTECH trends    20%
//   Southbound flow        15%
//   HIBOR 1M               7.5%
//   HK breadth proxy       7.5%
// ============================================================

import { HKMacroData, MacroFactor, MacroHeadline, hkMbsLabel } from "./macro-types";
export type { HKMacroData };

const W = {
  vhsi:       0.25,
  usdHkd:     0.25,
  hsiTrends:  0.20,
  southbound: 0.15,
  hibor:      0.075,
  breadth:    0.075,
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

    // VHSI scoring: low vol = bullish, high vol = bearish
    // Typical VHSI ranges: <18 low, 18-25 normal, 25-35 elevated, >35 fear
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
    // Fallback: realized vol from HSI 20-day series
    try {
      const hsi = await fetchYahooSeries("^HSI", 25);
      if (hsi.length >= 21) {
        const rets: number[] = [];
        for (let i = 1; i < hsi.length; i++) rets.push(Math.log(hsi[i] / hsi[i - 1]));
        const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
        const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
        const rvol = Math.sqrt(variance * 252) * 100; // annualized %
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
// HKD peg band: 7.75–7.85. Strong side: 7.75, Weak side: 7.85
// Green: 7.75–7.77 (strong side, ideal), Orange: 7.77–7.83 (normal), Red: 7.83–7.85 (weak side pressure)
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
      // Below 7.75 — HKMA defends strong side
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
// Uses EastMoney public API for Stock Connect southbound net flow
// Endpoint returns daily net buy/sell into HK market (southbound = mainland buying HK)
async function getSouthboundFlow(): Promise<MacroFactor> {
  // Primary: EastMoney Stock Connect API
  try {
    // EastMoney public API — returns recent southbound net flow data
    // fltt=2 = amount in CNY, sz=10 = last 10 days, type=2 = southbound (S→H)
    const url = "https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?lmt=10&klt=101&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56&ut=b2884a393a59ad64002292a3e90d46a5&secid=90.BK0002&cb=";
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://data.eastmoney.com/" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`EastMoney ${res.status}`);
    const text = await res.text();
    const json = JSON.parse(text);
    const klines: string[] = json?.data?.klines ?? [];
    if (klines.length === 0) throw new Error("no klines");

    // Each kline: "date,open,close,high,low,amount,volume"
    // For flow data: f52 = net flow today, f53 = net flow 5d cumulative
    // Parse last entry
    const last = klines[klines.length - 1].split(",");
    const netFlow = parseFloat(last[2] ?? "0"); // net in CNY hundred millions
    const flow5d  = klines.slice(-5).reduce((sum, k) => sum + parseFloat(k.split(",")[2] ?? "0"), 0);

    const score  = flow5d >= 50 ? 9 : flow5d >= 20 ? 8 : flow5d >= 5 ? 6 : flow5d >= -5 ? 5 : flow5d >= -20 ? 3 : 2;
    const signal: MacroFactor["signal"] = flow5d >= 10 ? "bullish" : flow5d <= -10 ? "bearish" : "neutral";
    const todayStr = netFlow >= 0 ? `+${netFlow.toFixed(1)}` : `${netFlow.toFixed(1)}`;
    const cumStr   = flow5d >= 0 ? `+${flow5d.toFixed(1)}` : `${flow5d.toFixed(1)}`;

    return {
      label: "Southbound",
      value: `${todayStr}亿`,
      score, signal,
      detail: `Today ${todayStr} · 5d ${cumStr}亿CNY`,
    };
  } catch { /* try fallback */ }

  // Fallback: EastMoney summary API (simpler endpoint)
  try {
    const url2 = "https://push2.eastmoney.com/api/qt/stock/get?ut=b2884a393a59ad64002292a3e90d46a5&fltt=2&invt=2&fields=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f43,f44,f45,f46,f47,f48,f49,f50,f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61&secid=90.BK0002&cb=";
    const res2 = await fetch(url2, {
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://data.eastmoney.com/" },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res2.ok) throw new Error("fallback fail");
    const json2 = JSON.parse(await res2.text());
    const data = json2?.data ?? {};
    // f62 or similar net flow field
    const netToday = (data.f62 ?? data.f184 ?? 0) / 1e8; // convert to 亿
    const score  = netToday >= 30 ? 8 : netToday >= 10 ? 7 : netToday >= 0 ? 5 : netToday >= -10 ? 4 : 2;
    const signal: MacroFactor["signal"] = netToday >= 5 ? "bullish" : netToday <= -5 ? "bearish" : "neutral";
    const valStr = netToday >= 0 ? `+${netToday.toFixed(1)}` : `${netToday.toFixed(1)}`;
    return {
      label: "Southbound", value: `${valStr}亿`,
      score, signal, detail: `Net inflow today`,
    };
  } catch { /* ignore */ }

  return { label: "Southbound", value: "—", score: 5, signal: "neutral", detail: "unavailable" };
}

// ── 5. HIBOR 1M ───────────────────────────────────────────────
// Primary: scrape HKAB (hkab.org.hk), Fallback: HKMA API
async function getHIBOR(): Promise<MacroFactor> {
  // Primary: HKAB scrape
  try {
    const res = await fetch("https://www.hkab.org.hk/hibor/listHibor.do", {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HKAB ${res.status}`);
    const html = await res.text();

    // Regex for 1-month HIBOR — table row with "1 Month" or "1M"
    // HKAB table format: <td>1 Month</td><td>X.XXXXX</td>
    const re = /1\s*[Mm]onth[\s\S]*?(\d+\.\d+)/;
    const m  = re.exec(html);
    if (!m) throw new Error("no HIBOR in HTML");
    const rate = parseFloat(m[1]);
    if (isNaN(rate) || rate <= 0 || rate > 30) throw new Error("invalid HIBOR");
    return scoreHIBOR(rate, "HKAB");
  } catch { /* fallback */ }

  // Fallback: HKMA Exchange Fund Bills stats API
  try {
    const url = "https://api.hkma.gov.hk/public/market-data-and-statistics/monthly-statistical-bulletin/money/hibor?pagesize=5&sortby=end_of_date&sortorder=desc";
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HKMA ${res.status}`);
    const json = await res.json();
    // HKMA returns array of monthly records with hibor_1m field
    const records: Array<Record<string, unknown>> = json?.result?.records ?? [];
    if (!records.length) throw new Error("no records");
    const latest = records[0];
    const rate = parseFloat(String(latest?.hibor_1m ?? latest?.["1m"] ?? "0"));
    if (isNaN(rate) || rate <= 0) throw new Error("invalid HKMA HIBOR");
    return scoreHIBOR(rate, "HKMA");
  } catch { /* ignore */ }

  return { label: "HIBOR 1M", value: "—", score: 5, signal: "neutral", detail: "unavailable" };
}

function scoreHIBOR(rate: number, source: string): MacroFactor {
  // HIBOR interpretation: low = accommodative (bullish for equities), high = tightening (bearish)
  // Historical HK HIBOR 1M ranges: 0.1–1% (low), 1–3% (normal), 3–5% (high), >5% (very high)
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
// Uses major HK ETFs and blue chips above 20-day SMA
async function getHKBreadth(): Promise<MacroFactor> {
  try {
    // Key HK ETFs + major blue chips via Yahoo
    const symbols = [
      "^HSI", "^HSTECH",
      "2800.HK", // Tracker Fund (HSI ETF)
      "3032.HK", // CSOP Hang Seng TECH
      "9988.HK", // Alibaba
      "0700.HK", // Tencent
      "1211.HK", // BYD
      "1810.HK", // Xiaomi
      "0005.HK", // HSBC
      "0941.HK", // China Mobile
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

    // HK-specific headlines: Finviz filter for HK/China news
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
        // eslint-disable-next-line no-cond-assign
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
