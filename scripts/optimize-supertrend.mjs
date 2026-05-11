// scripts/optimize-supertrend.mjs
// Monthly SuperTrend parameter optimizer — run by GitHub Actions.
// Fetches OHLCV for each stock, runs a grid search (ATR x Multiplier),
// and commits the best per-stock params to st_params.json.
//
// Grid: ATR periods [10,12,14] × Multipliers [2.5,2.75,3.0,3.25,3.5]
// Metric: Sharpe ratio (same as web-app supertrend_optimizer.ts)

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

// ── Config ───────────────────────────────────────────────────────
const PORTFOLIO = [
  "9988.HK","0700.HK","1211.HK","1810.HK","0175.HK","3033.HK",
  "AAPL","MSFT","GOOGL","META","AMD","NVDA","TSM","SPY","QQQ",
];
const ATR_PERIODS  = [10, 12, 14];
const MULTIPLIERS  = [2.5, 2.75, 3.0, 3.25, 3.5];
const MIN_TRADES   = 2;
const INITIAL_CAP  = 10000;
const COMMISSION   = 0.001;
const SLIPPAGE     = 0.0005;
const LOOKBACK_DAYS = 500;
const CACHE_FILE   = join(process.cwd(), "st_params.json");

// ── Date helpers ─────────────────────────────────────────────────
function nextFirstSunday(fromDate) {
  const d = new Date(fromDate);
  const firstOfNext = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  const daysToSun   = (7 - firstOfNext.getDay()) % 7;
  const sun = new Date(firstOfNext);
  sun.setDate(1 + daysToSun);
  return sun.toISOString().split("T")[0];
}

// ── Indicators ───────────────────────────────────────────────────
function ewm(values, alpha) {
  const out = new Array(values.length).fill(NaN);
  let init  = false;
  for (let i = 0; i < values.length; i++) {
    if (isNaN(values[i])) continue;
    if (!init) { out[i] = values[i]; init = true; }
    else {
      const prev = !isNaN(out[i - 1]) ? out[i - 1] : values[i];
      out[i] = alpha * values[i] + (1 - alpha) * prev;
    }
  }
  return out;
}

function calcATR(highs, lows, closes, period) {
  const tr = highs.map((h, i) =>
    i === 0
      ? h - lows[i]
      : Math.max(h - lows[i], Math.abs(h - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]))
  );
  return ewm(tr, 1 / period);
}

function calcSMA(values, period) {
  return values.map((_, i) => {
    if (i < period - 1) return NaN;
    return values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
  });
}

function calcSupertrend(highs, lows, closes, atrPeriod, multiplier) {
  const n      = closes.length;
  const atrArr = calcATR(highs, lows, closes, atrPeriod);
  const stLine = new Array(n).fill(NaN);
  const dirArr = new Array(n).fill(-1);
  const sigArr = new Array(n).fill("HOLD");
  const upper  = new Array(n).fill(NaN);
  const lower  = new Array(n).fill(NaN);

  for (let i = 0; i < n; i++) {
    if (isNaN(atrArr[i])) continue;
    const hl2 = (highs[i] + lows[i]) / 2;
    upper[i]  = hl2 + multiplier * atrArr[i];
    lower[i]  = hl2 - multiplier * atrArr[i];
  }

  let first = -1;
  for (let i = 0; i < n; i++) { if (!isNaN(atrArr[i])) { first = i; break; } }
  if (first < 0) return [stLine, dirArr, sigArr];

  stLine[first] = upper[first];
  dirArr[first] = closes[first] > upper[first] ? 1 : -1;

  for (let i = first + 1; i < n; i++) {
    if (isNaN(upper[i]) || isNaN(lower[i])) {
      upper[i] = upper[i - 1]; lower[i] = lower[i - 1];
      dirArr[i] = dirArr[i - 1]; stLine[i] = stLine[i - 1];
      continue;
    }
    if (closes[i - 1] > stLine[i - 1]) lower[i] = Math.max(lower[i], lower[i - 1]);
    else                                upper[i] = Math.min(upper[i], upper[i - 1]);

    let dir;
    if      (closes[i] > upper[i - 1]) dir = 1;
    else if (closes[i] < lower[i - 1]) dir = -1;
    else                                dir = dirArr[i - 1];

    dirArr[i] = dir;
    stLine[i] = dir === 1 ? lower[i] : upper[i];
    if (dirArr[i - 1] !== dir) sigArr[i] = dir === 1 ? "BUY" : "SELL";
  }

  for (let i = 1; i < n; i++) {
    if (isNaN(stLine[i]) && !isNaN(stLine[i - 1])) stLine[i] = stLine[i - 1];
  }
  return [stLine, dirArr, sigArr];
}

// ── Backtest (mirrors supertrend_optimizer.ts quickSTBacktest) ───
function mean(arr) {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

function quickBacktest(bars, stLine, stDir, stSig) {
  const entry = new Array(bars.length).fill("HOLD");
  for (let i = 1; i < bars.length; i++) {
    if (i + 1 >= bars.length) continue;
    const cur  = bars[i];
    const prev = bars[i - 1];
    if (stSig[i] === "SELL") { entry[i + 1] = "SELL"; continue; }
    if (stSig[i] === "BUY")  {
      if (cur.close > cur.sma50) entry[i + 1] = "BUY";
      continue;
    }
    if (stDir[i] === 1 && cur.close > cur.sma50 && prev.close <= prev.sma50) {
      entry[i + 1] = "BUY";
    }
  }

  const equity = [INITIAL_CAP];
  let running  = INITIAL_CAP;
  let pos      = null;
  const trades = [];

  for (let i = 1; i < bars.length; i++) {
    const cur = bars[i];
    if (!pos) {
      if (entry[i] === "BUY") {
        const ep   = cur.open * (1 + SLIPPAGE);
        const shs  = Math.floor((running * 0.998) / ep);
        const stop = (!isNaN(stLine[i - 1]) && stLine[i - 1] > 0) ? stLine[i - 1] : ep - 2 * cur.atr;
        pos = { entryPrice: ep, entryCost: ep * (1 + COMMISSION), shares: shs, equity: running, stop };
      }
    } else {
      if (!isNaN(stLine[i]) && stLine[i] > pos.stop) pos.stop = stLine[i];
      if (cur.low <= pos.stop || stSig[i - 1] === "SELL") {
        const rawExit  = Math.min(pos.stop, cur.open);
        const exitP    = rawExit * (1 - SLIPPAGE);
        const proceeds = exitP * (1 - COMMISSION);
        const ret      = (exitP - pos.entryPrice) / pos.entryPrice;
        running = pos.equity + (proceeds - pos.entryCost) * pos.shares;
        trades.push({ ret });
        pos = null;
      }
    }
    equity.push(pos ? pos.equity + (cur.close - pos.entryPrice) * pos.shares : running);
  }

  if (trades.length < MIN_TRADES) return { sharpe: -999, totalReturn: 0, numTrades: trades.length };

  const dailyRets = [];
  for (let i = 1; i < equity.length; i++) {
    const p = equity[i - 1];
    dailyRets.push(p > 0 ? (equity[i] - p) / p : 0);
  }
  const m   = mean(dailyRets);
  const std = Math.sqrt(mean(dailyRets.map(r => (r - m) ** 2)));
  const sharpe      = std > 0 ? (m * 252) / (std * Math.sqrt(252)) : 0;
  const totalReturn = (running - INITIAL_CAP) / INITIAL_CAP * 100;
  return { sharpe, totalReturn, numTrades: trades.length };
}

function optimizeST(rawBars) {
  const highs  = rawBars.map(b => b.high);
  const lows   = rawBars.map(b => b.low);
  const closes = rawBars.map(b => b.close);
  const atr14  = calcATR(highs, lows, closes, 14);
  const sma50  = calcSMA(closes, 50);
  const bars   = rawBars.map((b, i) => ({ ...b, atr: atr14[i] ?? 0, sma50: sma50[i] ?? 0 }));

  let best = { atrPeriod: 10, multiplier: 3.0, sharpe: -Infinity, totalReturn: -Infinity, numTrades: 0 };
  let fall = { ...best };

  for (const atrP of ATR_PERIODS) {
    for (const mult of MULTIPLIERS) {
      const [stLine, stDir, stSig] = calcSupertrend(highs, lows, closes, atrP, mult);
      const r = quickBacktest(bars, stLine, stDir, stSig);
      if (r.numTrades >= MIN_TRADES) {
        if (r.sharpe > best.sharpe) best = { atrPeriod: atrP, multiplier: mult, ...r };
      } else {
        if (r.totalReturn > fall.totalReturn) fall = { atrPeriod: atrP, multiplier: mult, ...r };
      }
    }
  }

  return best.sharpe === -Infinity ? fall : best;
}

// ── Yahoo Finance fetch ──────────────────────────────────────────
async function fetchOHLCV(symbol) {
  const calDays = Math.floor(LOOKBACK_DAYS * 7 / 5) + 20;
  const end     = Math.floor(Date.now() / 1000);
  const start   = end - calDays * 86400;
  const url     = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${start}&period2=${end}&interval=1d&events=div,splits`;

  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json   = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error("No chart data");

  const timestamps = result.timestamp ?? [];
  const ohlcv      = result.indicators?.quote?.[0];
  if (!ohlcv) throw new Error("No OHLCV");

  const bars = [];
  for (let i = 0; i < timestamps.length; i++) {
    const o = ohlcv.open?.[i], h = ohlcv.high?.[i];
    const l = ohlcv.low?.[i],  c = ohlcv.close?.[i];
    const v = ohlcv.volume?.[i];
    if (o == null || h == null || l == null || c == null || c <= 0) continue;
    bars.push({ date: new Date(timestamps[i] * 1000).toISOString().split("T")[0], open: o, high: h, low: l, close: c, volume: v ?? 0 });
  }
  if (bars.length < 50) throw new Error("Too few bars");
  return bars;
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  // Load existing cache (preserve any fields we don't touch)
  let cache;
  try {
    cache = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
  } catch {
    cache = { last_optimized: null, next_optimization: null, optimization_count: 0, stocks: {} };
  }
  if (!cache.stocks) cache.stocks = {};

  const today = new Date().toISOString().split("T")[0];
  console.log(`\nSuperTrend optimization — ${today}`);
  console.log(`Grid: ATR ${ATR_PERIODS.join("/")} × Mult ${MULTIPLIERS.join("/")}\n`);

  for (const symbol of PORTFOLIO) {
    try {
      const bars = await fetchOHLCV(symbol);
      console.log(`  ${symbol}: ${bars.length} bars`);
      const result = optimizeST(bars);
      cache.stocks[symbol] = {
        atr_period:   result.atrPeriod,
        multiplier:   result.multiplier,
        total_return: Math.round(result.totalReturn * 100) / 100,
        sharpe:       Math.round(result.sharpe * 100) / 100,
        num_trades:   result.numTrades,
      };
      console.log(`    → ATR=${result.atrPeriod}, Mult=${result.multiplier}, Return=${result.totalReturn.toFixed(1)}%, Sharpe=${result.sharpe.toFixed(2)}, Trades=${result.numTrades}`);
    } catch (e) {
      console.warn(`  ${symbol}: FAILED — ${e.message}`);
    }
  }

  cache.last_optimized    = today;
  cache.next_optimization = nextFirstSunday(new Date(today));
  cache.optimization_count = (cache.optimization_count ?? 0) + 1;

  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2) + "\n");
  console.log(`\nSaved ${CACHE_FILE}`);
  console.log(`Next optimization: ${cache.next_optimization}`);
}

main().catch(e => { console.error(e); process.exit(1); });
