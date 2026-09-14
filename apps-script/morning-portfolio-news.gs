/*************************************************
 *  Morning Portfolio News Bot – Google Apps Script
 *  Sources: Yahoo Finance | Google News | MarketWatch
 *
 *  v19 changes (news-identity fix):
 *   - FIXED ticker/name collision: an ambiguous short name (e.g. 0939.HK
 *     "CCB") was used verbatim as both the Google News query AND the
 *     relevance needle, so US-listed Coastal Financial Corp (NASDAQ:CCB)
 *     headlines were pulled under China Construction Bank. Verified
 *     2026-08-24: q='"CCB" stock' returned 56/99 Coastal Financial items.
 *   - Ambiguous names are now resolved through NEWS_PROFILES to a full
 *     company name + market qualifier + impostor exclusions, and the bare
 *     acronym is no longer an accepted match needle for those entries.
 *   - VERIFIED: Google News IGNORES the hl/gl/ceid region params for these
 *     queries (canonical link comes back en-US/US regardless), so region
 *     scoping is NOT a defense — the query text must disambiguate.
 *   - auditPortfolioNews() flags any portfolio entry whose name is
 *     ambiguous and has no profile, so the 17th ticker self-reports
 *     instead of silently pulling the wrong company's news.
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
   NEWS IDENTITY, AMBIGUITY & RELEVANCE (v19)
   Shared by Yahoo + Google so loosely-related market-wide
   headlines (e.g. a GOOGL story under AAPL) get dropped, and
   word-boundary matching avoids substring junk (META!=metaverse).

   v19 adds the identity layer. portfolio.json carries a SHORT
   DISPLAY name ("CCB"), which is fine for the dashboard but is not
   a unique search key: "CCB" is also NASDAQ:CCB (Coastal Financial
   Corp). Any short all-caps name has this problem, so instead of
   special-casing one ticker we (a) detect ambiguous names by rule
   and (b) resolve them through NEWS_PROFILES.
   ========================================================= */

// Low-value / spam headline patterns dropped for every ticker.
const DENY = [
  /shares?\s+(sold|bought|purchased|acquired)\s+by/i,  // 13F filing spam
  /\bschedule\s+13[dfg]\b/i,
  /\b13[dfg]\s+filing\b/i,
];

/* ---------------------------------------------------------
   NEWS_PROFILES — keyed by portfolio.json symbol.
   Only AMBIGUOUS names need an entry; run auditPortfolioNews()
   to see which ones those are. Fields:
     full     : full company/fund name — the default quoted search phrase.
     phrases  : OPTIONAL. Search phrases OR'd together, when one name is
                too narrow to find the instrument (index ETFs especially).
                Defaults to [full]. A profiled ticker must never go silent.
     aliases  : additional ACCEPTED match needles. NOTE: the bare
                short name is deliberately absent for entries where
                the acronym belongs to somebody else (0939.HK), and
                present where the acronym IS the real identity (SPY).
     exclude  : impostor names — subtracted from the query AND used
                as a per-entry denylist on the results.
   portfolio.json is intentionally NOT edited: it is the shared
   universe read by the web app, Telegram and Python, and "CCB" is
   the display name Steven wants to see there.
   --------------------------------------------------------- */
const NEWS_PROFILES = {
  '0939.HK': {
    full:    'China Construction Bank',
    aliases: ['CCB Corp', 'CICHY', '中國建設銀行', '建設銀行'],
    exclude: ['Coastal Financial', 'China Construction Bank Indonesia'],
  },
  '1211.HK': {
    full:    'BYD',
    aliases: ['BYD Company', 'BYD Auto', 'BYDDY', 'BYDDF', '比亞迪'],
    exclude: ['Boyd Gaming'],
  },
  '3033.HK': {
    full:    'Hang Seng TECH Index ETF',
    phrases: ['Hang Seng TECH Index ETF', 'Hang Seng Tech ETF', 'Hang Seng TECH Index'],
    aliases: ['HSTech ETF', 'Hang Seng Tech', 'Hang Seng TECH Index', 'HSTECH', '3033'],
    exclude: [],
  },
  'SPY': {
    full:    'SPDR S&P 500 ETF',
    phrases: ['SPDR S&P 500 ETF', 'S&P 500 ETF', 'SPY ETF'],
    aliases: ['SPY', 'S&P 500', 'SPDR S&P 500'],
    exclude: ['Spy Shots'],
  },
  'QQQ': {
    full:    'Invesco QQQ',
    phrases: ['Invesco QQQ', 'QQQ ETF', 'Nasdaq 100 ETF'],
    aliases: ['QQQ', 'Nasdaq 100', 'Nasdaq-100'],
    exclude: [],
  },
  // Reviewed and NOT collision-prone, but profiled anyway so the acronym
  // is not the only needle — headlines that spell the name out were being
  // dropped by the relevance filter.
  'AMD': {
    full:    'AMD',
    aliases: ['AMD', 'Advanced Micro Devices'],
    exclude: [],
  },
  'TSM': {
    full:    'TSMC',
    aliases: ['TSMC', 'TSM', 'Taiwan Semiconductor'],
    exclude: [],
  },
  // portfolio.json name "Meta" collapses to the symbol (name.toUpperCase()
  // === symbol), so the query degraded to the bare ticker. The full name is
  // both unambiguous and better-targeted.
  'META': {
    full:    'Meta Platforms',
    aliases: ['Meta Platforms', 'Meta', 'META'],
    exclude: [],
  },
};

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// A name is AMBIGUOUS when it carries no lower-case word — i.e. it is a
// short ticker-like acronym rather than a company name. These cannot be
// trusted as a unique search key on their own.
function isAmbiguousName(name) {
  const n = String(name || '').trim();
  if (!n || /\s/.test(n)) return false;          // multi-word names are specific enough
  return n.length <= 4 && n === n.toUpperCase(); // e.g. CCB, BYD, SPY, QQQ, AMD
}

// Resolved news identity for a portfolio entry.
// Returns {symbol, base, full, needles[], excludes[], hasProfile, ambiguous}
function identityFor(entry) {
  const sym  = entry.symbol;
  const base = sym.replace('.HK', '');
  const name = (entry.name && entry.name.toUpperCase() !== sym) ? entry.name : base;
  const prof = NEWS_PROFILES[sym] || null;

  let needles;
  if (prof) {
    // Profiled: the profile defines the ACCEPTED needles. The portfolio
    // display name is NOT auto-included — that is what let "CCB" through.
    needles = [prof.full].concat(prof.aliases || []).concat([sym]);
    if (sym !== base && !isAmbiguousName(base)) needles.push(base);
  } else {
    // Unprofiled: previous behaviour. Multi-word names must match as a
    // full phrase (avoids "China" -> every China story).
    needles = /\s/.test(name) ? [name, sym] : [name, base, sym];
  }

  return {
    symbol:     sym,
    base:       base,
    full:       prof ? prof.full : name,
    phrases:    prof ? ((prof.phrases && prof.phrases.length) ? prof.phrases : [prof.full]) : [name],
    needles:    needles.map(x => String(x).trim()).filter(x => x.length >= 2),
    excludes:   prof ? (prof.exclude || []) : [],
    hasProfile: !!prof,
    ambiguous:  isAmbiguousName(name),
  };
}

// Kept for backwards compatibility with any caller expecting needles.
function needlesFor(entry) { return identityFor(entry).needles; }

// Word-boundary, case-insensitive match against any needle.
function matchesEntry(entry, title) {
  const id = identityFor(entry);
  const T  = ' ' + String(title).toUpperCase() + ' ';
  // An impostor name in the headline disqualifies it outright.
  if (id.excludes.some(x => T.indexOf(String(x).toUpperCase()) !== -1)) return false;
  return id.needles.some(n => {
    const re = new RegExp('(^|[^A-Z0-9])' + escapeRe(n.toUpperCase()) + '([^A-Z0-9]|$)');
    return re.test(T);
  });
}

function isDenied(title) {
  return DENY.some(re => re.test(String(title)));
}

/* ---------------------------------------------------------
   QUERY BUILDER — the actual collision fix.
   Google News ignores hl/gl/ceid for these searches (verified
   2026-08-24: the canonical link returns en-US/US even when HK is
   requested), so the MARKET must be expressed inside the query text,
   not in the region params.
   --------------------------------------------------------- */
function marketQualifier(entry) {
  return entry.exchange === 'HK'
    ? '"Hong Kong" OR HKEX OR SEHK OR stock OR shares'
    : 'stock OR shares';
}

function buildNewsQuery(entry) {
  const id = identityFor(entry);
  const phrase = id.phrases.length > 1
    ? '(' + id.phrases.map(x => '"' + x + '"').join(' OR ') + ')'
    : '"' + id.phrases[0] + '"';
  let q = phrase + ' (' + marketQualifier(entry) + ')';
  id.excludes.forEach(x => { q += ' -"' + x + '"'; });
  return q;
}

/* =========================================================
   AUDIT — run manually from the Apps Script editor.
   Answers "what if I ran hundreds of names?": every ambiguous
   name without a profile is reported, so a newly added ticker
   surfaces here instead of silently importing another company's
   news. Returns the list of unresolved entries.
   ========================================================= */
function auditPortfolioNews() {
  const portfolio = getPortfolio();
  const unresolved = [];
  console.log('--- news-identity audit: ' + portfolio.length + ' tickers ---');
  portfolio.forEach(e => {
    const id = identityFor(e);
    let status;
    if (id.ambiguous && !id.hasProfile) { status = 'AMBIGUOUS - NEEDS PROFILE'; unresolved.push(e.symbol); }
    else if (id.hasProfile)             { status = 'profiled'; }
    else                                { status = 'ok'; }
    console.log([e.symbol, '(' + e.name + ')', '->', id.full, '|', status,
                 '| query: ' + buildNewsQuery(e)].join(' '));
  });
  console.log(unresolved.length
    ? 'ACTION: add NEWS_PROFILES entries for ' + unresolved.join(', ')
    : 'All ambiguous names are resolved.');
  return unresolved;
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
    const sym = entry.symbol;

    // v19: query is built from the RESOLVED identity (full company name +
    // market qualifier + impostor exclusions), never from the bare short
    // name. `when:2d` is a valid Google News operator; the post-parse date
    // filter below is the real guarantee in case it's ignored.
    const q = buildNewsQuery(entry) + ' when:2d';
    // Region params are kept for the cases where Google does honour them,
    // but they are NOT the defense — see marketQualifier().
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
