// ============================================================
// TYPES — V15.1 + MacroEngine
// ============================================================

export interface StockConfig {
  symbol: string;
  name: string;
  exchange: "US" | "HK";
}

export interface AppConfig {
  stocks: {
    PORTFOLIO: StockConfig[];
  };
  analysis: {
    rsiPeriod: number;
    macdFast: number;
    macdSlow: number;
    macdSignal: number;
    adxPeriod: number;
    atrPeriod: number;
    smaShort: number;
    smaLong: number;
    volumePeriod: number;
    divergenceLookback: number;
    divergenceThreshold: number;
    scoreHistoryBars: number;
  };
  signal: {
    entryThreshold: number;
    exitThreshold: number;
    signalConfirmationBars: number;
    adxThreshold: number;
    maxHoldingDays: number;
    trendGateEnabled: boolean;
    earningsBufferDays: number;
  };
  backtest: {
    enabled: boolean;
    initialCapital: number;
    lookbackDays: number;
    commissionRate: number;
    slippageRate: number;
    use_van_tharp: boolean;
    signal_mode: "score" | "supertrend" | "both";
  };
  risk: {
    riskPerTrade: number;
    atrMultiplier: number;
    trailingAtrMultiplier: number;
    maxPositionSize: number;
    correlationThreshold: number;
    correlationPenalty: number;
  };
  portfolioRisk: {
    killSwitchEnabled: boolean;
    maxDrawdownThreshold: number;
    coolingPeriodDays: number;
  };
  monteCarlo: {
    enabled: boolean;
    runs: number;
    blockBootstrap: boolean;
    dualMethod: boolean;
    divergenceThreshold: number;
  };
  walkForward: {
    enabled: boolean;
    trainRatio: number;
    maxDegradation: number;
    reoptimizeDays: number;
  };
  supertrend: {
    atrPeriod: number;
    multiplier: number;
    filter_mode: "ema_only" | "full";
  };
  // V15.1 MacroEngine
  macro: {
    enabled: boolean;          // fetch macro data
    applyToScore: boolean;     // apply MBS adjustment to SCR score (ST unaffected)
  };
}

export interface Trade {
  trade_num: number;
  entry_date: string;
  exit_date: string;
  entry_idx: number;
  exit_idx: number;
  entry_price: number;
  exit_price: number;
  return: number;
  pnl: number;
  shares: number;
  bars_held: number;
  r_multiple: number;
  exit_reason: string;
  atr_stop_price: number;
  trailing_stop: number | null;
  mae_pct: number;
  mfe_pct: number;
  actual_risk_pct: number;
  entry_regime: string;
  atr_mult: number;
  trail_mult: number;
  max_hold_days: number;
}

export interface FibTargets {
  t1: number | null;
  t2: number | null;
  t3: number | null;
  swing_low: number | null;
  base_move: number | null;
}

export interface CandlestickPattern {
  pattern: string;
  sentiment: "bullish" | "bearish" | "neutral";
  bar_index: number;
  label: string;
}

export interface BacktestResult {
  symbol: string;
  trades: Trade[];
  num_trades: number;
  win_rate: number;
  expectancy: number;
  total_return: number;
  total_return_250d: number;
  total_return_500d: number;
  sharpe: number;
  sortino: number;
  max_drawdown: number;
  profit_factor: number;
  avg_win: number;
  avg_loss: number;
  r_multiples: number[];
  equity_curve: number[];
  equity_dates: string[];
  signal_bars: number;
  buy_hold_return: number;
  alpha: number;
  alpha_status: string;
  calmar_ratio: number;
  ulcer_index: number;
  omega_ratio: number;
  exit_reasons: Record<string, number>;
  avg_mae: number;
  avg_mfe: number;
  winner_mae: number;
  loser_mae: number;
  winner_mfe: number;
  kill_switch_triggered: boolean;
  latest_atr: number | null;
  latest_price: number;
  rsi_divergence: number;
  rsi_divergence_type: string;
  avg_duration: number;
  median_duration: number;
  min_duration: number;
  max_duration: number;
  avg_winner_duration: number;
  avg_loser_duration: number;
  median_winner_duration: number;
  median_loser_duration: number;
  score_history: number[];
  // Technical indicators
  rsi: number | null;
  macd_hist: number | null;
  adx: number | null;
  atr_pct: number | null;
  vol_ratio: number | null;
  bb_position: number | null;
  // Trading plan
  support_level: number | null;
  resistance_level: number | null;
  stop_loss_price: number | null;
  fib_targets: FibTargets;
  week_52_high: number | null;
  week_52_low: number | null;
  sma_20: number | null;
  sma_50: number | null;
  ema_20: number | null;
  // Patterns
  candlestick_patterns: CandlestickPattern[];
}

export interface MonteCarloResult {
  runs: number;
  method: string;
  prob_profit: number;
  median_equity: number;
  worst_equity: number;
  best_equity: number;
  avg_max_dd: number;
  var_5: number;
  divergence: number | null;
  methods_agree: boolean;
  confidence: string;
}

export interface WalkForwardResult {
  best_params: { entryThreshold: number; maxHoldingDays: number };
  train_sharpe: number;
  test_sharpe: number;
  efficiency_ratio: number;
  efficiency_quality: string;
  passed: boolean;
}

export interface KellyResult {
  kelly_fraction: number;
  full_kelly: number;
  recommended_fraction: number;
  sizing_method: string;
  atr_shares: number;
  correlation_adjustment: number;
  correlated_with: string | null;
}

export interface RegimeInfo {
  regime: string;
  atr_ratio: number;
  adx_slope: number;
  bullish_count: number;
  is_high_volatility: boolean;
  is_extreme_dislocation: boolean;
}

export interface StrategyMetrics {
  total_return: number;
  total_return_250d: number;
  total_return_500d: number;
  win_rate: number;
  num_trades: number;
  profit_factor: number;
  max_drawdown: number;
  sharpe: number;
  sortino: number;
  expectancy: number;
  avg_win: number;
  avg_loss: number;
  alpha: number;
  trades: Trade[];
}

export interface StrategyComparison {
  score: StrategyMetrics;
  supertrend: StrategyMetrics;
  winner: "score" | "supertrend" | "tie";
  winner_margin: number;
}

export interface StockAnalysisResult {
  symbol: string;
  name: string;
  exchange: string;
  signal: string;
  score: number;
  confidence: number;
  regime: string;
  regime_info: RegimeInfo;
  current_price: number;
  change_pct: number;
  backtest: BacktestResult | null;
  monte_carlo: MonteCarloResult | null;
  st_monte_carlo: MonteCarloResult | null;
  walk_forward: WalkForwardResult | null;
  kelly: KellyResult | null;
  fundamentals?: Fundamentals;
  error?: string;
  chart_bars?: ChartBar[];
  // SuperTrend
  st_direction: number;
  st_value: number;
  st_stop_distance_pct: number;
  st_open_return_pct: number | null;
  st_opt_params?: {
    atrPeriod:  number;
    multiplier: number;
    sharpe:     number;
    numTrades:  number;
  };
  comparison: StrategyComparison | null;
  // V15.1 MacroEngine
  macro_adjustment?: number;   // MBS adjustment applied to score (0 if disabled)
}

export interface Fundamentals {
  pe_ratio: number | null;
  forward_pe: number | null;
  eps_trailing: number | null;
  eps_forward: number | null;
  eps_growth: number | null;
  analyst_target: number | null;
  analyst_rating: string | null;
}

export interface PortfolioResponse {
  results: StockAnalysisResult[];
  timestamp: string;
  config: AppConfig;
}

export interface OHLCVBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  atr: number;
  rsi: number;
  macd: number;
  macdSignal: number;
  macdHist: number;
  adx: number;
  plusDI: number;
  minusDI: number;
  sma20: number;
  sma50: number;
  ema20: number;
  ema20Slope: number;
  bbUpper: number;
  bbMid: number;
  bbLower: number;
  bbPosition: number;
  adxSlope: number;
  volRatio: number;
  volAccumulation: number;
  trendGate: number;
  rsiDivergence: number;
  rsiDivergenceType: string;
  regime: string;
  score: number;
  scoreAdjusted: number;
  volumeSurge: number;
  confidence: number;
  rawSignal: string;
  signalConfirmed: string;
  entrySignal: string;
  forceEntry: number;
  supertrend: number;
  supertrendDir: number;
  supertrendSignal: string;
  stEntrySignal: string;
  ema50: number;
}

export interface PriceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sma20: number;
  sma50: number;
  bbUpper: number;
  bbLower: number;
  score: number;
  signal: string;
  entrySignal: string;
}

export interface ChartBar {
  date: string;
  close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  sma20: number;
  sma50: number;
  ema20: number;
  ema50: number;
  bbUpper: number;
  bbLower: number;
  signal: string;
  score: number;
  rsi: number;
  macd: number;
  macdSig: number;
  macdHist: number;
  adx: number;
  pdi: number;
  mdi: number;
  supertrend: number;
  supertrendDir: number;
}

export interface RegimeBadge {
  icon: string;
  label: string;
  dir: string;
}

export interface TimesfmPriceTargets {
  t1: number;
  t2: number;
  t3: number;
  p10: number[];
  p50: number[];
  p90: number[];
}

export interface TimesfmForecasts {
  [symbol: string]: TimesfmPriceTargets;
}
