/*************************************************
 *  Morning Portfolio News Bot – Google Apps Script
 *  Sources: Yahoo Finance | Google News | MarketWatch
 *
 *  v18 changes:
 *   - Single source of truth: tickers + names come from portfolio.json
 *     in the v17 repo (same file the web app, Telegram bot & Python
 *     scripts read). Falls back to a cached list so the email never breaks.
 *   - Email shows company names + groups by HK / US exchange.
 *   - Fixed Google News (was returning nothing): valid `when:` operator,
 *     per-exchange region, and name-based query/filter so HK tickers
 *     (e.g. 1810.HK → "Xiaomi") finally match.
 *************************************************/

/* ------------- USER SETTINGS / FALLBACK ------------- */
const USER_EMAIL = Session.getActiveUser().getEmail(); // auto-fills your Gmail
// Used ONLY if portfolio.json can't be fetched and no cache exists:
const STOCK_LIST = 'NVDA,GOOGL,AAPL,TSLA,MSFT,TSM,META,AMZN,BABA,9988.HK,0700.HK,1810.HK,1211.HK';
const DELIVERY_HOUR = 8;                                // 0-23, change via web form
const PORTFOLIO_URL =
  'https://raw.githubusercontent.com/sc4stock-pixel/stock-analysis-technical-and-fundamental/main/portfolio.json';
/* ---------------------------------------------------- */

const PROP = PropertiesService.getScriptProperties();

/* =========================================================
   RELEVANCE FILTERS (v2)
   Shared by Yahoo + Google so loosely-related market-wide
   headlines (e.g. a GOOGL story under AAPL) get dropped, and
   word-boundary matching avoids substring junk (META≠metaverse).
   ========================================================= */
// Low-value / spam headline patterns dropped for every ticker.
const DENY = [
  /shares?\s+(sold|bought|purchased|acquired)\s+by/i,  // 13F filing spam
  /\bschedule\s+13[dfg]\b/i,
  /\b13[dfg]\s+filing\b/i,
];

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Needles to identify an article as being about `entry`.
// Multi-word names must match as a full phrase (avoids "China"→every China story);
// single-word names also allow the base/symbol code.
function needlesFor(entry) {
  const sym  = entry.symbol;
  const base = sym.replace('.HK', '');
  const name = (entry.name && entry.name.toUpperCase() !== sym) ? entry.name : base;
  const multiWord = /\s/.test(name);
  const list = multiWord ? [name, sym] : [name, base, sym];
  return list.map(s => String(s).trim()).filter(s => s.length >= 2);
}

// Word-boundary, case-insensitive match against any needle.
function matchesEntry(entry, title) {
  const T = ' ' + String(title).toUpperCase() + ' ';
  return needlesFor(entry).some(n => {
    const re = new RegExp('(^|[^A-Z0-9])' + escapeRe(n.toUpperCase()) + '([^A-Z0-9]|$)');
    return re.test(T);
  });
}

function isDenied(title) {
  return DENY.some(re => re.test(String(title)));
}

function setup() {
  PROP.setProperty('EMAIL', USER_EMAIL);
  PROP.setProperty('TICKERS', STOCK_LIST);
  PROP.setProperty('HOUR', String(DELIVERY_HOUR));
  getPortfolio(); // warm the portfolio.json cache
  console.log('Setup complete. Hour:', PROP.getProperty('HOUR'));
}

/* =========================================================
   SINGLE SOURCE OF TRUTH — portfolio.json (with fallback)
   Returns: [{symbol, name, exchange}, ...]
   ========================================================= */
function getPortfolio() {
  try {
    // cache-buster sidesteps the raw.githubusercontent CDN cache
    const resp = UrlFetchApp.fetch(PORTFOLIO_URL + '?cb=' + Date.now(),
                                   {muteHttpExceptions: true});
    if (resp.getResponseCode() !== 200) throw new Error('HTTP ' + resp.getResponseCode());

    const data = JSON.parse(resp.getContentText());
    const list = (data.portfolio || [])
      .map(s => ({
        symbol:   String(s.symbol   || '').trim().toUpperCase(),
        name:     String(s.name     || '').trim(),
        exchange: String(s.exchange || '').trim().toUpperCase()
      }))
      .filter(s => s.symbol);
    if (!list.length) throw new Error('empty portfolio array');

    // Cache last-known-good so a future outage still works
    PROP.setProperty('TICKERS', list.map(s => s.symbol).join(','));
    PROP.setProperty('PORTFOLIO_JSON', JSON.stringify(list));
    return list;
  } catch (err) {
    console.log('portfolio.json fetch failed (' + err + ') — using fallback');
    const cached = PROP.getProperty('PORTFOLIO_JSON');
    if (cached) {
      try { return JSON.parse(cached); } catch (e) {}
    }
    // last resort: bare symbol list, infer name=symbol & exchange from suffix
    return (PROP.getProperty('TICKERS') || STOCK_LIST)
      .split(',').map(t => t.trim().toUpperCase()).filter(Boolean)
      .map(sym => ({symbol: sym, name: sym, exchange: sym.includes('.HK') ? 'HK' : 'US'}));
  }
}

/* ---------- daily runner ---------- */
function main() {
  const portfolio = getPortfolio();
  const email     = PROP.getProperty('EMAIL') || USER_EMAIL;
  const newsMap   = fetchNews(portfolio);
  const htmlBody  = buildEmail(newsMap, portfolio);
  GmailApp.sendEmail(email,
    `Morning Portfolio News – ${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM dd')}`,
    'Please enable HTML to see this message.',
    {htmlBody});
}

/* =========================================================
   3-SOURCE FETCHER  (bullet-proof: never returns null)
   ========================================================= */
function fetchNews(portfolio) {
  const out = {};
  const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
  const now = new Date();

  portfolio.forEach(entry => {
    const y = tryYahoo(entry);
    const g = tryGoogle(entry);
    const m = tryMarketWatch(entry);

    const recent = dedupe([...y, ...g, ...m]
      .filter(a => now - a.date <= TWO_DAYS_MS)
      .sort((p, q) => q.date - p.date));

    out[entry.symbol] = recent.length ? recent.slice(0, 12) : fallbackErr();
  });
  return out;

  /* ---------- Yahoo (by symbol — now name-filtered, v2) ---------- */
  function tryYahoo(entry) {
    const ticker = entry.symbol;
    const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ticker)}`;
    try {
      const items = parseRSS(url).map(normalise)
        .filter(i => now - i.date <= TWO_DAYS_MS)
        .filter(i => matchesEntry(entry, i.title) && !isDenied(i.title)); // v2: drop cross-ticker noise
      if (items.length) return items.slice(0, 4).map(o => ({...o, badge: 'Y'}));
    } catch (e) { console.log('Yahoo failed for ' + ticker + ': ' + e.message); }
    return [];
  }

  /* ---------- Google News (by company NAME — the HK fix) ---------- */
  function tryGoogle(entry) {
    const sym   = entry.symbol;
    const name  = (entry.name && entry.name.toUpperCase() !== sym) ? entry.name : sym.replace('.HK', '');

    // `when:2d` is a valid Google News operator; the post-parse date filter
    // below is the real guarantee in case it's ignored.
    const q = `"${name}" stock when:2d`;
    const region = entry.exchange === 'HK'
      ? 'hl=en-HK&gl=HK&ceid=HK:en'
      : 'hl=en-US&gl=US&ceid=US:en';
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${region}`;

    try {
      const items = parseRSS(url).map(normalise)
        .filter(i => now - i.date <= TWO_DAYS_MS)
        .filter(i => matchesEntry(entry, i.title) && !isDenied(i.title)); // v2: word-boundary + denylist
      if (items.length) return items.slice(0, 6).map(o => ({...o, badge: 'G'}));
    } catch (e) { console.log('Google failed for ' + sym + ': ' + e.message); }
    return [];
  }

  /* ---------- MarketWatch (US only; URL is ticker-specific) ---------- */
  function tryMarketWatch(entry) {
    const ticker = entry.symbol;
    if (entry.exchange === 'HK' || ticker.includes('.HK')) return []; // unsupported for HK

    const url = `https://www.marketwatch.com/investing/stock/${encodeURIComponent(ticker)}/rss`;
    try {
      const items = parseRSS(url).map(normalise)
        .filter(i => now - i.date <= TWO_DAYS_MS)
        .filter(i => !isDenied(i.title)); // v2: drop filing spam (URL already ticker-scoped)
      if (items.length) return items.slice(0, 4).map(o => ({...o, badge: 'M'}));
    } catch (e) {
      console.log('MarketWatch failed for ' + ticker + ': ' + e.message);
    }
    return [];
  }

  /* ---------- shared RSS -> item[] helper ---------- */
  function parseRSS(url) {
    try {
      const xml = UrlFetchApp.fetch(url, {muteHttpExceptions: true}).getContentText();
      const doc = XmlService.parse(xml);
      const channel = doc.getRootElement().getChild('channel');
      if (!channel) return [];
      return channel.getChildren('item') || [];
    } catch (e) {
      console.log('RSS parsing failed for URL: ' + url + ', Error: ' + e.message);
      return [];
    }
  }

  /* ---------- normalise an <item> into our object ---------- */
  function normalise(item) {
    if (!item) return {title: '(No title)', link: '#', date: new Date(), badge: ''};
    try {
      return {
        title: item.getChild('title')?.getText() || '(No title)',
        link:  item.getChild('link')?.getText()  || '#',
        date:  new Date(item.getChild('pubDate')?.getText() || new Date())
      };
    } catch (e) {
      console.log('Error normalizing item: ' + e.message);
      return {title: '(Parse error)', link: '#', date: new Date(), badge: ''};
    }
  }

  /* ---------- dedupe by normalised title ---------- */
  function dedupe(arr) {
    const seen = {}; const res = [];
    arr.forEach(a => {
      const k = (a.title || '').toLowerCase().replace(/\s+/g, ' ').trim();
      if (k && !seen[k]) { seen[k] = 1; res.push(a); }
    });
    return res;
  }

  /* ---------- ultimate fallback ---------- */
  function fallbackErr() {
    return [{title: '(No recent news)', link: '#', date: new Date(), badge: ''}];
  }
}

/* =========================================================
   E-MAIL BUILDER (name + exchange aware)
   ========================================================= */
function buildEmail(newsMap, portfolio) {
  const style = `<style>
    body{font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333}
    h3{margin:22px 0 6px;padding-bottom:4px;border-bottom:2px solid #004c99;color:#004c99}
    table{border-collapse:collapse;width:100%;margin-bottom:18px}
    th{background:#004c99;color:#fff;text-align:left;padding:6px 9px}
    td{border-bottom:1px solid #ddd;padding:6px 9px}
    .ticker{font-weight:bold;font-size:15px}
    .date{font-size:11px;color:#666;white-space:nowrap}
    .ts{font-size:12px;color:#777;margin-top:0}
    a{color:#004c99;text-decoration:none}
    a:hover{text-decoration:underline}
    .badge{background:#004c99;color:#fff;font-size:10px;padding:2px 4px;border-radius:3px;margin-right:4px}
    .legend{font-size:12px;color:#555}
  </style>`;

  let body = `<html><head><meta charset="utf-8">${style}</head><body>
    <h2>&#128200; Your morning portfolio news</h2>
    <p class="ts">Generated ${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'EEE, MMM dd HH:mm')}` +
    ` &middot; ${portfolio.length} tickers from portfolio.json</p>`;

  // HK group first, then US, preserving portfolio.json order within each group
  const order = portfolio.slice().sort((a, b) => {
    if (a.exchange === b.exchange) return 0;
    return a.exchange === 'HK' ? -1 : 1;
  });

  let lastExch = null;
  order.forEach(e => {
    if (e.exchange !== lastExch) {
      body += `<h3>${e.exchange === 'HK' ? '&#127469;&#127472; Hong Kong' : '&#127482;&#127480; United States'}</h3>`;
      lastExch = e.exchange;
    }
    const flag = e.exchange === 'HK' ? '&#127469;&#127472;' : '&#127482;&#127480;';
    const arts = newsMap[e.symbol] || [{title: '(No recent news)', link: '#', date: new Date(), badge: ''}];
    body += `<table>
      <tr><th colspan="2" class="ticker">${flag} ${e.symbol} &mdash; ${e.name || e.symbol}</th></tr>`;
    arts.forEach(art => {
      const badge = art.badge ? `<span class="badge">${art.badge}</span>` : '';
      body += `<tr>
        <td>${badge}<a href="${art.link}" target="_blank">${art.title}</a></td>
        <td class="date">${Utilities.formatDate(art.date, Session.getScriptTimeZone(), 'MMM dd HH:mm')}</td>
      </tr>`;
    });
    body += '</table>';
  });

  body += `<p class="legend">Sources: <span class="badge">Y</span> Yahoo Finance` +
          ` &middot; <span class="badge">G</span> Google News &middot; <span class="badge">M</span> MarketWatch</p>`;
  body += `<p style="font-size:12px;color:#777">
    Tickers are managed in <a href="https://github.com/sc4stock-pixel/stock-analysis-technical-and-fundamental/blob/main/portfolio.json" target="_blank">portfolio.json</a>
    (edit via the dashboard). Change delivery time <a href="${ScriptApp.getService().getUrl()}" target="_blank">here</a>.
  </p></body></html>`;
  return body;
}

/* =========================================================
   WEB FORM — now only controls delivery hour + fallback list
   ========================================================= */
function doGet() {
  const tickers = PROP.getProperty('TICKERS') || STOCK_LIST;
  const hour    = Number(PROP.getProperty('HOUR'));
  const html = `<!DOCTYPE html>
<html>
<head>
  <base target="_top">
  <style>body{font-family:Arial;margin:30px} input,select{width:320px;padding:6px} button{padding:8px 18px} small{color:#777}</style>
</head>
<body>
  <h3>Portfolio News Bot – Settings</h3>
  <p><b>Tickers now come from <code>portfolio.json</code></b> (the v17 repo / dashboard).
     The box below is only the <i>fallback</i> used if that fetch ever fails.</p>
  <form onsubmit="saveSettings(this); return false;">
    <label>Fallback tickers (comma separated):<br>
      <input name="t" value="${tickers}" required>
    </label><br><br>
    <label>Deliver at (hour 0-23, server time ${Session.getScriptTimeZone()}):<br>
      <input name="h" type="number" min="0" max="23" value="${hour}" required>
    </label><br><br>
    <button type="submit">Save & reschedule</button>
    <button type="button" onclick="testNow()">Send test e-mail now</button>
  </form>
  <p id="msg"></p>
  <script>
    function saveSettings(f) {
      google.script.run
        .withSuccessHandler(function(){document.getElementById('msg').innerHTML='Saved & trigger updated.';})
        .saveForm(f.t.value, Number(f.h.value));
    }
    function testNow() {
      document.getElementById('msg').innerHTML='Sending test e-mail…';
      google.script.run
        .withSuccessHandler(function(){document.getElementById('msg').innerHTML='Test mail sent.';})
        .main();
    }
  </script>
</body>
</html>`;
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function saveForm(tickersStr, hourNum) {
  PROP.setProperty('TICKERS', tickersStr.replace(/ /g, '').toUpperCase());
  PROP.setProperty('HOUR', String(hourNum));
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'main') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('main').timeBased().everyDays(1).atHour(hourNum).create();
}
