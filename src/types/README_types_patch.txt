Add this optional field to StockAnalysisResult interface in src/types/index.ts
Find the line: st_open_return_pct: number | null;
Add AFTER it:

  st_opt_params?: {
    atrPeriod:  number;
    multiplier: number;
    sharpe:     number;
    numTrades:  number;
  };
