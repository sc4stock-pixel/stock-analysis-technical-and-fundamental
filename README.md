# 🌐 WEB APP — Next.js / Vercel dashboard

> **This is the WEB front-end** (TypeScript, Next.js 14, deployed to Vercel).
> Directory: `stock-analysis-technical-and-fundamental`
>
> **Not to be confused with** the Python analysis engine in the sibling
> directory `stock_analysis/` (the 🐍 PY ENGINE that generates the HTML report,
> Telegram alerts, and runs the SuperTrend/backtest pipeline locally).

| | This repo (WEB) | Sibling repo (PY) |
|---|---|---|
| Language | TypeScript / React | Python |
| Runtime | Browser + Vercel serverless | Local / Jupyter |
| Entry | `src/app/page.tsx` | `run_analysis.ipynb` |
| Forecast JSONs | **generates** `kronos_forecasts.json`, `timesfm_forecasts.json` via GH Actions | **consumes** them (read-only copies) |

---

## trading-ta-dashboard
Trading Dashboard - Claude
