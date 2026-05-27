// src/lib/fundamental/generateReport.ts
import * as fetchers from './fetchers';

export interface FundamentalPrompts {
  ticker: string;
  deepDivePrompt: string;
  peerComparisonPrompt: string;
  bearCasePrompt: string;
  riskValuationPrompt: string;
  earningsAnalysisPrompt: string;
  fetchedAt: string;
}

/** Most recently reported quarter, assuming earnings land ~6 weeks after quarter-end. */
function latestReportedQuarter(): string {
  const d = new Date();
  const m = d.getMonth() + 1; // 1-12
  const y = d.getFullYear();
  // Jan-Mar: Q4 of prev year is the latest reported (Q4 earnings out Feb-Mar);
  //   for very early Jan use Q3 of prev year.
  if (m === 1)               return `Q3 ${y - 1}`;
  if (m >= 2 && m <= 4)      return `Q4 ${y - 1}`;
  if (m >= 5 && m <= 7)      return `Q1 ${y}`;
  if (m >= 8 && m <= 10)     return `Q2 ${y}`;
  /* m === 11 || m === 12 */ return `Q3 ${y}`;
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
  const deepDivePrompt = `Act as a Quantitative Equity Researcher Analyst. Give an **abbreviated** Deep Dive on ${ticker}.
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

  // ── Quantitative Risk & Valuation prompt (4th) ─────────────────
  const riskValuationPrompt = `Act as a Quantitative Equity Researcher Analyst. Generate a risk & valuation report for ${ticker}. In addition to standard financials, apply the following advanced filters:

**Capital Efficiency:** Calculate the Rule of 40 and ROIC. Compare ROIC to the 5-year sector median.

**Valuation Context:** Provide current P/E and P/S vs. their 5-year historical means. Use a 'Z-Score' approach (Is it >1 standard deviation from the mean?).

**The 'Moat' Analysis:** Evaluate R&D as a % of Revenue. Is the company out-investing its peers to maintain its lead?

**Earnings Quality:** Check the gap between Net Income and Free Cash Flow. If FCF is significantly lower than Net Income, flag it as 'Aggressive Accounting/Low Quality.'

**Volatility Risk:** Report the 30-day realized volatility vs. the VIX and provide the Maximum Drawdown (MDD) over the last 12 months.

Use any available data from the following snapshot, but supplement with real-time web searches where necessary:
- Description: ${description}
- Sector: ${sector}, Industry: ${industry}
- P/S TTM: ${keyStats?.psTrailing12Months?.raw ?? 'N/A'}, P/FCF: ${keyStats?.priceToFreeCashFlows?.raw ?? 'N/A'}, EV/EBITDA: ${keyStats?.enterpriseToEbitda?.raw ?? 'N/A'}
- GM: ${financials?.grossMargins?.raw ? (financials.grossMargins.raw * 100).toFixed(1) + '%' : 'N/A'}, RevGr: ${financials?.revenueGrowth?.raw ? (financials.revenueGrowth.raw * 100).toFixed(1) + '%' : 'N/A'}
- Insider trades: ${JSON.stringify(insiders.slice(0, 5))}
- Customer concentration: ${concentration}
- Margin trend: ${JSON.stringify(marginData?.margins)}
`;

  // ── Earnings Analysis prompt (5th) ────────────────────────
  const quarter = latestReportedQuarter();
  const earningsAnalysisPrompt = `Act as an institutional equity research analyst specializing in quantitative fundamental analysis.

Your FIRST priority is to use your live web-browsing capabilities to locate, access, and download the primary source materials for ${ticker}'s latest ${quarter} earnings results. Specifically, look for:
1. The official Earnings Press Release (or HKEX Announcement if an HK stock).
2. The complete Earnings Call Transcript / Webcast Replay Transcript.

Search reliable financial repositories, including the company's official Investor Relations page, Seeking Alpha, Yahoo Finance, or exchange filing systems to retrieve this text. Once retrieved, confirm the sources you are using by printing their titles at the top of your response.

Using the exact data from those downloaded documents, conduct a rigorous, critical teardown of the results. Avoid generic management platitudes and analyze the structural realities using the following 6 sections:

1. The Headline vs. Internal Reality
- Top and Bottom Line: Contrast actual Revenue, Operating Income, and EPS against both consensus Wall Street expectations and management's own prior guidance. State the exact beat/miss margins.
- Organic Growth: Strip out any impact from foreign exchange (FX) fluctuations or recent acquisitions to identify the true organic growth rate of the core business.

2. Margin Degradation or Expansion (Efficiency Check)
- Component Breakdown: Calculate and analyze the sequential (QoQ) and year-over-year (YoY) changes in Gross Margin, Operating Margin, and Net Margin.
- Operational Leverage: Did operating expenses (S&M, R&D, G&A) grow faster or slower than revenue? Pinpoint exactly where the company is gaining efficiency or losing control of costs.

3. Balance Sheet Signals & Cash Quality
- Earnings Quality: Compare Net Income to Free Cash Flow (FCF). If FCF significantly lags Net Income, identify the working capital drag (e.g., uncollected accounts receivable or rising inventory).
- Asset Velocity: Analyze changes in Inventory levels and Days Sales Outstanding (DSO). Is inventory piling up faster than sales growth?
- Liquidity & Leverage: Note any material changes in cash balances, net debt, or short-term borrowings this quarter.

4. Segment Performance & KPI Deep Dive
- Disaggregate the results by primary business segments and geographies. Which specific segment acted as the growth engine, and which underperformed?
- Analyze the trajectory of the company's core non-financial operational KPIs (e.g., Average Revenue Per User (ARPU), Cloud Remaining Performance Obligations (RPO), units shipped, or production run-rates).

5. Forward Guidance & Management Tone
- Guidance Vector: Detail the explicit guidance provided for the upcoming quarter and full year (Revenue, margins, Capex). Is management guiding up, down, or holding steady compared to current consensus?
- Conference Call Tone & Reassurance: Highlight the top 2-3 toughest questions asked by analysts during the Q&A session. How effectively did management address concerns regarding competition, pricing pressure, or macro headwinds?

6. Long-Thesis Alignment (The "So What?")
- Evaluate how this single quarter alters the structural long-term investment thesis. Does this report confirm the stock is an efficient compounder, signal a temporary speed bump, or expose structural deterioration (value trap) for a long-only portfolio?

Provide a final, concise "Earnings Quality Score" from 1 to 10 (with 10 being flawless execution and pristine cash flow) along with a 2-sentence justification. Do not include standard financial disclaimers; focus purely on the structural data.`;

  return {
    ticker,
    deepDivePrompt,
    peerComparisonPrompt,
    bearCasePrompt,
    riskValuationPrompt,
    earningsAnalysisPrompt,
    fetchedAt: new Date().toISOString(),
  };
}
