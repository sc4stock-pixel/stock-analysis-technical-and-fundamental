# apps-script/

Source of the **Google Apps Script** projects that orbit this web app. These are
deployed in Apps Script (script.google.com), not built by Next.js/Vercel — this
folder just version-controls their source alongside the web app.

## `morning-portfolio-news.gs`

The **"Daily portfolio news to email"** Apps Script project
(`scriptId: 12ITlCDK2a0Pc_zXEwj2EVm8R-3LLtBbGH3Nw_8J9bvgdUA7TkRsCbleW`).
Sends the daily **Morning Portfolio News** email (Yahoo Finance + Google News +
MarketWatch headlines, badged `Y`/`G`/`M`).

### Single source of truth
Tickers **and company names** come from [`portfolio.json`](../portfolio.json) at
the repo root — the same file the web app, Telegram bot, and Python scripts read.
The script fetches it **read-only** over `raw.githubusercontent.com` via
`UrlFetchApp`; it never writes it (the only writer is the dashboard's
`/api/save-portfolio` route). A cached copy in Script Properties is the fallback
if the fetch ever fails, so the email never breaks.

### Key behaviour
- Groups output by exchange (HK / US) with company names.
- Google News searches by **company name** (fixes HK tickers like `1810.HK` →
  "Xiaomi" that the old numeric-code search missed).
- Relevance filters: word-boundary name matching + a small denylist for 13F
  filing spam, applied to Yahoo and Google to drop cross-ticker noise.
- Emoji are emitted as ASCII HTML entities + `<meta charset="utf-8">` so the
  email body can't be mangled by source encoding.

### Deploy (manual)
1. Open the Apps Script project and its news `.gs` file.
2. Replace the file's contents with `morning-portfolio-news.gs`, **Save**.
3. Run `setup()` once (warms the portfolio cache; authorizes the `UrlFetchApp`
   scope for GitHub).
4. Optional: open the web form and click **"Send test e-mail now"**.

> To automate deploys later, wire up [`clasp`](https://github.com/google/clasp)
> with this `scriptId` and `clasp push` from CI.

### Tuning
Ambiguous short names (e.g. `CCB`) can match unrelated headlines. Fix by editing
the `name` in `portfolio.json` (e.g. `CCB` → `China Construction Bank`) — `name`
is display-only everywhere and all lookups key on `symbol`, so this is safe
across the whole stack.
