/**
 * Knowledge-point mastery as a Beta-Bernoulli estimate. We always report a range, never a bare
 * point estimate, so sparse evidence reads as uncertainty instead of false precision.
 */
export interface BetaState {
  alpha: number;
  beta: number;
}

export interface MasterySummary {
  mean: number;
  low: number;
  high: number;
}

const PRIOR_STRENGTH = 2;
const Z_90 = 1.645;

/** Prior from the learner's self-rated confidence (0..1). Weak on purpose: evidence dominates fast. */
export function priorFromConfidence(confidence: number): BetaState {
  const c = clamp01(confidence);
  return { alpha: 1 + PRIOR_STRENGTH * c, beta: 1 + PRIOR_STRENGTH * (1 - c) };
}

/**
 * Update with one observation. `outcome` is 1 for correct, 0 for incorrect, or a fractional score
 * for graded open responses. Harder items weigh more when correct and less when wrong.
 */
export function updateBeta(state: BetaState, outcome: number, difficulty = 0.5, weight = 1): BetaState {
  const o = clamp01(outcome);
  const d = clamp01(difficulty);
  const successWeight = weight * (0.5 + d);
  const failureWeight = weight * (1.5 - d);
  return {
    alpha: state.alpha + o * successWeight,
    beta: state.beta + (1 - o) * failureWeight,
  };
}

export function summarize({ alpha, beta }: BetaState): MasterySummary {
  const n = alpha + beta;
  const mean = alpha / n;
  const sd = Math.sqrt((alpha * beta) / (n * n * (n + 1)));
  return { mean, low: clamp01(mean - Z_90 * sd), high: clamp01(mean + Z_90 * sd) };
}

/** Aggregate concept estimates into a skill estimate (simple average of means and bounds). */
export function aggregate(summaries: MasterySummary[]): MasterySummary | null {
  if (summaries.length === 0) return null;
  const avg = (f: (s: MasterySummary) => number) => summaries.reduce((a, s) => a + f(s), 0) / summaries.length;
  return { mean: avg((s) => s.mean), low: avg((s) => s.low), high: avg((s) => s.high) };
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}
