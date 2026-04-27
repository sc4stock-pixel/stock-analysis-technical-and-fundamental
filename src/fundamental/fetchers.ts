// src/lib/fundamental/fetchers.ts
import * as cheerio from 'cheerio';

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance';

// ── Yahoo Finance v8 helpers (no API key) ────────────────────
export async function fetchYahooModule(symbol: string, module: string) {
  try {
    const url = `${YAHOO_BASE}/quoteSummary/${encodeURIComponent(symbol)}?modules=${module}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Yahoo ${res.status}`);
    const json = await res.json();
    return json?.quoteSummary?.result?.[0]?.[module] ?? null;
  } catch (e) {
    console.error(`Yahoo module ${module} for ${symbol} failed:`, e);
    return null;
  }
}

export async function getCompanyProfile(symbol: string) {
  const data = await fetchYahooModule(symbol, 'assetProfile');
  return data ?? {};
}

export async function getKeyStatistics(symbol: string) {
  const data = await fetchYahooModule(symbol, 'defaultKeyStatistics');
  return data ?? {};
}

export async function getFinancialData(symbol: string) {
  const data = await fetchYahooModule(symbol, 'financialData');
  return data ?? {};
}

export async function getIncomeStatementQuarterly(symbol: string) {
  const data = await fetchYahooModule(symbol, 'incomeStatementHistoryQuarterly');
  return data?.incomeStatementHistory ?? [];
}

// ── Peer list via Yahoo recommendations ──────────────────────
export async function getPeers(symbol: string): Promise<string[]> {
  try {
    const url = `https://query2.finance.yahoo.com/v6/finance/recommendationsbysymbol/${encodeURIComponent(symbol)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const json = await res.json();
    const recs = json?.finance?.result?.[0]?.recommendedSymbols ?? [];
    return recs.map((r: any) => r.symbol).slice(0, 6); // top 6 peers
  } catch {
    return [];
  }
}

// ── Latest 10-K textual search for customer concentration ─────
export async function checkCustomerConcentration(symbol: string) {
  try {
    // Get CIK from ticker
    const tickerUrl = `https://www.sec.gov/cgi-bin/browse-edgar?CIK=${encodeURIComponent(symbol)}&action=getcompany`;
    const res1 = await fetch(tickerUrl, {
      headers: { 'User-Agent': 'my-app (your@email.com)' },
    });
    const html1 = await res1.text();
    const cikMatch = html1.match(/CIK=(\d{10})/);
    if (!cikMatch) return 'Unable to find CIK';
    const cik = cikMatch[1];

    // Get latest 10-K filing
    const filingUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-K&owner=exclude&count=1`;
    const res2 = await fetch(filingUrl, {
      headers: { 'User-Agent': 'my-app (your@email.com)' },
    });
    const html2 = await res2.text();
    const $ = cheerio.load(html2);
    const docLink = $('a[id="documentsbutton"]').attr('href');
    if (!docLink) return 'No recent 10-K found';
    const fullDocUrl = `https://www.sec.gov${docLink}`;

    // Get filing document list page
    const res3 = await fetch(fullDocUrl, {
      headers: { 'User-Agent': 'my-app (your@email.com)' },
    });
    const html3 = await res3.text();
    const $$ = cheerio.load(html3);
    const filingHref = $$('table.tableFile a').first().attr('href');
    if (!filingHref) return 'No filing document';
    const docUrl = `https://www.sec.gov${filingHref}`;

    // Fetch 10-K text
    const res4 = await fetch(docUrl, {
      headers: { 'User-Agent': 'my-app (your@email.com)' },
    });
    const text = await res4.text();
    // Crude search for "customer" and "concentrat" (10-K may mention single customer risk)
    const hasConcentration = /single customer|customer concentration/i.test(text);
    return hasConcentration ? 'Yes – single customer risk mentioned in latest 10-K. Review the filing for details.' :
      'No clear single customer >25% mentioned in the latest 10-K.';
  } catch (e) {
    return 'Could not retrieve 10-K.';
  }
}

// ── Insider transactions via openinsider.com scraping ────────
export async function getLatestInsiderTrades(symbol: string) {
  try {
    const url = `http://openinsider.com/screener?s=${encodeURIComponent(symbol)}&o=&pl=&ph=&ll=&lh=&fd=-1&fdr=12m&td=0&tdr=&fdlyl=&fdlyh=&daysago=&xp=1&xs=1&vl=&vh=&ocl=&och=&sic1=-1&sicl=100&sich=9999&grp=0&nfl=&nfh=&nil=&nih=&nol=&noh=&v2l=&v2h=&oc2l=&oc2h=&sortcol=0&cnt=5&page=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);
    const trades: any[] = [];
    $('table.tinytable tbody tr').each((_, el) => {
      const cells = $(el).find('td');
      if (cells.length < 10) return;
      const filingDate = $(cells[1]).text().trim();
      const tradeDate = $(cells[2]).text().trim();
      const insider = $(cells[4]).text().trim();
      const title = $(cells[5]).text().trim();
      const tradeType = $(cells[6]).text().trim();
      const qty = $(cells[8]).text().trim();
      const price = $(cells[9]).text().trim();
      const owned = $(cells[10]).text().trim();
      trades.push({ filingDate, tradeDate, insider, title, tradeType, qty, price, owned });
    });
    return trades;
  } catch (e) {
    return [];
  }
}

// ── Margin / growth from quarterly income statements ──────────
export async function getMarginAndGrowth(symbol: string) {
  const quarters = await getIncomeStatementQuarterly(symbol);
  if (!quarters || quarters.length < 4) return null;
  const latest = quarters.slice(0, 4).reverse(); // oldest->newest
  const margins = latest.map(q => {
    const rev = q.totalRevenue?.raw ?? 0;
    const gp = q.grossProfit?.raw ?? 0;
    const op = q.operatingIncome?.raw ?? 0;
    return {
      date: q.endDate?.fmt ?? '',
      revenue: rev / 1e8, // in 100 million
      grossMargin: rev ? (gp / rev * 100).toFixed(1) : null,
      operatingMargin: rev ? (op / rev * 100).toFixed(1) : null,
    };
  });
  // YoY revenue growth (latest vs same quarter last year)
  const yoyGrowth = quarters.length >= 5 ?
    ((latest[3].totalRevenue?.raw ?? 0) / (quarters[4].totalRevenue?.raw ?? 1) - 1) * 100 : null;
  return { margins, yoyGrowth: yoyGrowth ? yoyGrowth.toFixed(1) : 'N/A' };
}
