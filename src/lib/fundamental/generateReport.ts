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
  // 1. Gather all data
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

  // 2. Peer data (top 2)
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

  // 3. Build Deep Dive prompt
  const deepDivePrompt = `You are a fundamental analyst. Using the data below, write a comprehensive Deep Dive report on ${ticker} covering:

1. **Business Model**: How does ${ticker} make money? Explain its core product in plain English.
2. **Moat**: Top 3 competitors. Does ${ticker} have a durable edge (patent, switching cost, network effect, or cost structure) that rivals can't copy?
3. **Catalysts**: Upcoming launches, earnings, regulatory events, or partnerships in the next 12 months.
4. **Asymmetry**: Low valuation floor vs high growth ceiling? Why or why not?

**Data:**
- Company description: ${description}
- Sector: ${sector}, Industry: ${industry}
- Peers recommended: ${peers.join(', ')}
- Key statistics: P/S TTM: ${keyStats?.psTrailing12Months?.raw ?? 'N/A'}, P/FCF: ${keyStats?.priceToFreeCashFlows?.raw ?? 'N/A'}, EV/EBITDA: ${keyStats?.enterpriseToEbitda?.raw ?? 'N/A'}, Gross margin: ${financials?.grossMargins?.raw ? (financials.grossMargins.raw * 100).toFixed(1) + '%' : 'N/A'}, Revenue growth: ${financials?.revenueGrowth?.raw ? (financials.revenueGrowth.raw * 100).toFixed(1) + '%' : 'N/A'}
- Recent insider trades (last 12 months): ${JSON.stringify(insiders.slice(0, 5), null, 2)}
- Customer concentration check: ${concentration}

Format your answer in markdown with clear headings.`;

  // 4. Build Peer Comparison prompt
  const peerTable = `| Metric | ${ticker} | ${peerSymbols[0] ?? 'N/A'} | ${peerSymbols[1] ?? 'N/A'} |
|--------|----------|-----------------|-----------------|
| P/S TTM | ${keyStats?.psTrailing12Months?.raw?.toFixed(2) ?? 'N/A'} | ${peerFinancials[0]?.psTTM ?? 'N/A'} | ${peerFinancials[1]?.psTTM ?? 'N/A'} |
| P/S Fwd | ${keyStats?.psForward?.raw?.toFixed(2) ?? 'N/A'} | ${peerFinancials[0]?.psForward ?? 'N/A'} | ${peerFinancials[1]?.psForward ?? 'N/A'} |
| P/FCF   | ${keyStats?.priceToFreeCashFlows?.raw?.toFixed(2) ?? 'N/A'} | ${peerFinancials[0]?.pfcf ?? 'N/A'} | ${peerFinancials[1]?.pfcf ?? 'N/A'} |
| EV/EBITDA | ${keyStats?.enterpriseToEbitda?.raw?.toFixed(2) ?? 'N/A'} | ${peerFinancials[0]?.evEbitda ?? 'N/A'} | ${peerFinancials[1]?.evEbitda ?? 'N/A'} |
| Gross Margin | ${financials?.grossMargins?.raw ? (financials.grossMargins.raw * 100).toFixed(1) + '%' : 'N/A'} | ${peerFinancials[0]?.grossMargin ?? 'N/A'}% | ${peerFinancials[1]?.grossMargin ?? 'N/A'}% |
| YoY Rev Growth | ${financials?.revenueGrowth?.raw ? (financials.revenueGrowth.raw * 100).toFixed(1) + '%' : 'N/A'} | ${peerFinancials[0]?.revenueGrowth ?? 'N/A'}% | ${peerFinancials[1]?.revenueGrowth ?? 'N/A'}% |`;

  const peerComparisonPrompt = `Given the following valuation table for ${ticker} vs its peers, build a relative valuation analysis and calculate a **Value/Growth Score** = P/S TTM + revenue growth %. Lowest score = most growth per dollar of valuation.

${peerTable}

Interpret the table and conclude whether ${ticker}'s valuation makes sense relative to growth. Format in markdown.`;

  // 5. Build Bear Case prompt
  const bearCasePrompt = `Act as a **skeptical short-seller** researching ${ticker}. Using the provided data, give the **3 most serious red flags**, ranked by severity. Check for:

- **Customer concentration**: Any single customer over 25% of revenue — latest 10-K finding: ${concentration}
- **Margin compression**: Last 4 quarters:
${JSON.stringify(marginData?.margins, null, 2)}
- **Unscheduled insider selling** (not pre-planned 10b5-1) — last 12 months:
${JSON.stringify(insiders.slice(0, 10), null, 2)}
- **Widening GAAP vs non-GAAP gap** (if available from earnings)
- **Guidance cuts** in the last 12 months

Cite sources for each red flag. **If you can't find 3 real reasons to be bearish, you haven't done the research.** Format in markdown.`;

  return {
    ticker,
    deepDivePrompt,
    peerComparisonPrompt,
    bearCasePrompt,
    fetchedAt: new Date().toISOString(),
  };
}
