// ============================================================
// MONTE CARLO SIMULATION — exact port of Python V12.5.6
// Dual method: Block Bootstrap + Parametric Log-Normal
// ============================================================
import { AppConfig, MonteCarloResult } from "@/types";

function blockBootstrap(
  returns: number[],
  blockSize: number,
  initialCapital: number,
  runs: number
): {
  prob_profit: number;
  median_equity: number;
  worst_equity: number;
  best_equity: number;
  avg_max_dd: number;
  var_5: number;
} {
  const n = returns.length;
  const finalEquities: number[] = [];
  const maxDrawdowns: number[] = [];

  for (let r = 0; r < runs; r++) {
    const bootstrapped: number[] = [];
    const numBlocks = Math.ceil(n / blockSize);
    for (let b = 0; b < numBlocks; b++) {
      const start = Math.floor(Math.random() * n);
      for (let j = 0; j < blockSize; j++) {
        bootstrapped.push(returns[(start + j) % n]);
      }
    }

    let equity = initialCapital;
    let peak = initialCapital;
    let maxDd = 0;

    for (let k = 0; k < n; k++) {
      equity *= 1 + bootstrapped[k];
      if (equity > peak) peak = equity;
      const dd = peak > 0 ? (peak - equity) / peak : 0;
      if (dd > maxDd) maxDd = dd;
    }

    finalEquities.push(equity);
    maxDrawdowns.push(maxDd);
  }

  finalEquities.sort((a, b) => a - b);
  const profitCount = finalEquities.filter((e) => e > initialCapital).length;
  const median =
    finalEquities.length % 2 === 0
      ? (finalEquities[finalEquities.length / 2 - 1] + finalEquities[finalEquities.length / 2]) / 2
      : finalEquities[Math.floor(finalEquities.length / 2)];

  const p5Idx = Math.floor(finalEquities.length * 0.05);
  const var5 = ((finalEquities[p5Idx] - initialCapital) / initialCapital) * 100;

  return {
    prob_profit: Math.round((profitCount / runs) * 1000) / 10,
    median_equity: Math.round(median * 100) / 100,
    worst_equity: Math.round(finalEquities[0] * 100) / 100,
    best_equity: Math.round(finalEquities[finalEquities.length - 1] * 100) / 100,
    avg_max_dd: Math.round((maxDrawdowns.reduce((a, b) => a + b, 0) / runs) * 10000) / 100,
    var_5: Math.round(var5 * 100) / 100,
  };
}

function parametric(
  returns: number[],
  initialCapital: number,
  runs: number
): { median_equity: number } {
  // V8: Log-normal (GBM) — better tail risk than normal
  const logReturns = returns.map((r) => Math.log(1 + r));
  const n = logReturns.length;
  const muLog = logReturns.reduce((a, b) => a + b, 0) / n;
  const variance = logReturns.reduce((a, b) => a + (b - muLog) ** 2, 0) / n;
  const sigmaLog = Math.sqrt(variance);

  const finalEquities: number[] = [];
  for (let r = 0; r < runs; r++) {
    // Box-Muller transform for normal samples
    let sumLog = 0;
    for (let i = 0; i < n; i++) {
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      sumLog += muLog + sigmaLog * z;
    }
    finalEquities.push(initialCapital * Math.exp(sumLog));
  }

  finalEquities.sort((a, b) => a - b);
  const mid = Math.floor(finalEquities.length / 2);
  const median =
    finalEquities.length % 2 === 0
      ? (finalEquities[mid - 1] + finalEquities[mid]) / 2
      : finalEquities[mid];

  return { median_equity: Math.round(median * 100) / 100 };
}

export function runMonteCarlo(
  equityCurve: number[],
  config: AppConfig
): MonteCarloResult | null {
  if (!config.monteCarlo.enabled || equityCurve.length < 30) return null;

  // Daily returns from equity curve
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1];
    if (prev === 0) { returns.push(0); continue; }
    const r = (equityCurve[i] - prev) / prev;
    returns.push(r);
  }

  // Check for NaN/Inf (V9 FIX #6)
  if (returns.some((r) => isNaN(r) || !isFinite(r))) {
    return null;
  }

  if (returns.length < 30) return null;

  const { runs } = config.monteCarlo;
  const initialCapital = config.backtest.initialCapital;
  const blockSize = Math.max(5, Math.round(Math.sqrt(returns.length)));

  const blockResult = blockBootstrap(returns, blockSize, initialCapital, runs);
  let paramResult: { median_equity: number } | null = null;
  if (config.monteCarlo.dualMethod) {
    paramResult = parametric(returns, initialCapital, runs);
  }

  let divergence: number | null = null;
  let methodsAgree = true;
  if (paramResult && blockResult.median_equity > 0) {
    divergence = Math.abs(blockResult.median_equity - paramResult.median_equity) / blockResult.median_equity;
    methodsAgree = divergence < config.monteCarlo.divergenceThreshold;
    divergence = Math.round(divergence * 1000) / 10;
  }

  return {
    runs,
    method: config.monteCarlo.dualMethod ? "Dual-Method" : "Block Bootstrap",
    prob_profit: blockResult.prob_profit,
    median_equity: blockResult.median_equity,
    worst_equity: blockResult.worst_equity,
    best_equity: blockResult.best_equity,
    avg_max_dd: blockResult.avg_max_dd,
    var_5: blockResult.var_5,
    divergence,
    methods_agree: methodsAgree,
    confidence: methodsAgree ? "HIGH" : "MODERATE",
  };
}
