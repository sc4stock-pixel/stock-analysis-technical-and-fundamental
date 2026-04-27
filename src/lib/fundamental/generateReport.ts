// src/lib/fundamental/generateReport.ts
import * as fetchers from './fetchers';

export interface FundamentalPrompts {
  ticker: string;
  deepDivePrompt: string;
  peerComparisonPrompt: string;
  bearCasePrompt: string;
  fetchedAt: string;
}

export async function generateFundamentalPrompts(ticker: string): Promise<FundamentalPrompts> {
  const [profile, keyStats, financials, peers, insiders, marginData, concentration] =
    await Promise.all([
      fetchers.getCompanyProfile(ticker),
      fetchers.getKeyStatistics(ticker),
      fetchers.getFinancialData(ticker),
      fetchers.getPeers(ticker),
      fetchers.getLatestInsiderTrades(ticker),
      fetchers.getMarginAndGrowth(ticker),
      fetchers.checkCustomerConcentration(ticker),
    ]);

  const description = profile?.longBusinessSummary ?? 'No description available.';
  const sector = profile?.sector ?? 'Unknown';
  const industry = profile?.industry ?? 'Unknown';

  const peerSymbols = peers.slice(0, 2);
  const peerFinancials: any[] = [];
  for (const p of peerSymbols) {
    const [pKey, pFin] = await Promise.all([
      fetchers.getKeyStatistics(p),
      fetchers.getFinancialData(p),
    ]);
    peerFinancials.push({
      symbol: p,
      psTTM: pKey?.psTrailing12Months?.raw?.toFixed(2) ?? 'N/A',
      psForward: pKey?.psForward?.raw?.toFixed(2) ?? 'N/A',
      pfcf: pKey?.priceToFreeCashFlows?.raw?.toFixed(2) ?? 'N/A',
      evEbitda: pKey?.enterpriseToEbitda?.raw?.toFixed(2) ?? 'N/A',
      grossMargin: pFin?.grossMargins?.raw ? (pFin.grossMargins.raw * 100).toFixed(1) : 'N/A',
      revenueGrowth: pFin?.revenueGrowth?.raw ? (pFin.revenueGrowth.raw * 100).toFixed(1) : 'N/A',
    });
  }

  // ── Abbreviated Deep Dive prompt ──────────────────────────
  const deepDivePrompt = `You are a fundamental analyst. Give an **abbreviated** Deep Dive on ${ticker}.
Use **bullet points** only — no paragraphs. Keep each bullet to one line.

1. **Business Model** (2-3 bullets):
   - Core product & how ${ticker} makes money.
2. **Moat** (3 bullets max):
   - Top 3 competitors, and whether ${ticker} has a durable edge (patent, switching cost, network effect, cost structure).
3. **Catalysts** (3 bullets max):
   - Upcoming launches, earnings, regulatory events, partnerships (next 12 months).
4. **Asymmetry** (2 bullets):
   - Valuation floor vs growth ceiling.

Use data below:
- Description: ${description}
- Sector: ${sector}, Industry: ${industry}
- Peers: ${peers.join(', ')}
- P/S TTM: ${keyStats?.psTrailing12Months?.raw ?? 'N/A'}, P/FCF: ${keyStats?.priceToFreeCashFlows?.raw ?? 'N/A'}, EV/EBITDA: ${keyStats?.enterpriseToEbitda?.raw ?? 'N/A'}, GM: ${financials?.grossMargins?.raw ? (financials.grossMargins.raw * 100).toFixed(1) + '%' : 'N/A'}, RevGr: ${financials?.revenueGrowth?.raw ? (financials.revenueGrowth.raw * 100).toFixed(1) + '%' : 'N/A'}
- Insider trades (5 most recent): ${JSON.stringify(insiders.slice(0, 5))}
- Customer concentration: ${concentration}

Format: bullet points, **no more than 10 bullets total**.`;

  // ── Abbreviated Peer Comparison prompt ────────────────────
  const peerTable = `| Metric | ${ticker} | ${peerSymbols[0] ?? 'N/A'} | ${peerSymbols[1] ?? 'N/A'} |
|--------|----------|-----------------|-----------------|
| P/S TTM | ${keyStats?.psTrailing12Months?.raw?.toFixed(2) ?? 'N/A'} | ${peerFinancials[0]?.psTTM ?? 'N/A'} | ${peerFinancials[1]?.psTTM ?? 'N/A'} |
| P/S Fwd | ${keyStats?.psForward?.raw?.toFixed(2) ?? 'N/A'} | ${peerFinancials[0]?.psForward ?? 'N/A'} | ${peerFinancials[1]?.psForward ?? 'N/A'} |
| P/FCF   | ${keyStats?.priceToFreeCashFlows?.raw?.toFixed(2) ?? 'N/A'} | ${peerFinancials[0]?.pfcf ?? 'N/A'} | ${peerFinancials[1]?.pfcf ?? 'N/A'} |
| EV/EBITDA | ${keyStats?.enterpriseToEbitda?.raw?.toFixed(2) ?? 'N/A'} | ${peerFinancials[0]?.evEbitda ?? 'N/A'} | ${peerFinancials[1]?.evEbitda ?? 'N/A'} |
| Gross Margin | ${financials?.grossMargins?.raw ? (financials.grossMargins.raw * 100).toFixed(1) + '%' : 'N/A'} | ${peerFinancials[0]?.grossMargin ?? 'N/A'}% | ${peerFinancials[1]?.grossMargin ?? 'N/A'}% |
| YoY Rev Growth | ${financials?.revenueGrowth?.raw ? (financials.revenueGrowth.raw * 100).toFixed(1) + '%' : 'N/A'} | ${peerFinancials[0]?.revenueGrowth ?? 'N/A'}% | ${peerFinancials[1]?.revenueGrowth ?? 'N/A'}% |`;

  const peerComparisonPrompt = `Analyse the valuation of ${ticker} vs peers. **Be concise**.
- Show the **Value/Growth Score** = P/S TTM + revenue growth % (lowest = best).
- State if the valuation makes sense relative to growth.
- **Max 5 bullet points** and the table from the data.

${peerTable}`;

  // ── Abbreviated Bear Case prompt ─────────────────────────
  const bearCasePrompt = `Act as a skeptical short-seller. List the **3 most serious red flags** for ${ticker}, ranked by severity.
**Bullet points only, one per flag**, with a one‑sentence source citation from the data below.
If you can't find 3, keep researching but still produce the top 3 you find.

Data:
- Customer concentration: ${concentration}
- Margin trend (last 4Q): ${JSON.stringify(marginData?.margins)}
- Insider sells (last 12m): ${JSON.stringify(insiders.slice(0, 10))}
- Revenue growth YoY: ${financials?.revenueGrowth?.raw ? (financials.revenueGrowth.raw * 100).toFixed(1) + '%' : 'N/A'}
- Gross margin: ${financials?.grossMargins?.raw ? (financials.grossMargins.raw * 100).toFixed(1) + '%' : 'N/A'}`;

  return {
    ticker,
    deepDivePrompt,
    peerComparisonPrompt,
    bearCasePrompt,
    fetchedAt: new Date().toISOString(),
  };
}
