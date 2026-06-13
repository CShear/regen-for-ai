/**
 * Proportional attribution helpers.
 *
 * The pool run distributes a fixed total of credits across many subscribers
 * weighted by each subscriber's contribution. Doing this with float
 * arithmetic (audit C1) means the per-subscriber shares may not sum to
 * exactly the retired total — small drift, but compounds across many runs
 * and undermines the on-chain invariant that retirements are exact.
 *
 * `allocateProportional` uses the largest-remainder method (Hamilton):
 *   1. floor share for each weight: floor(total * weight / sumWeights)
 *   2. distribute the remainder, one micro-unit at a time, to the weights
 *      with the largest fractional residual (ties broken by index)
 * The returned bigint shares are guaranteed to sum to exactly `total`.
 */

/** Conversion scale used to ladder a JS-number credit count into bigint micro-credits. */
export const ATTRIBUTION_SCALE = 1_000_000n;

/**
 * Convert a JS number credit count (e.g. 1.5) to bigint micro-credits.
 * The single float touch — bounded error of 0.5 micro per conversion.
 */
export function creditsToMicro(credits: number): bigint {
  if (!Number.isFinite(credits) || credits < 0) return 0n;
  return BigInt(Math.round(credits * Number(ATTRIBUTION_SCALE)));
}

/** Convert bigint micro-credits back to a JS number for REAL-column storage. */
export function microToCredits(micro: bigint): number {
  return Number(micro) / Number(ATTRIBUTION_SCALE);
}

/**
 * Distribute `total` units across N buckets weighted by `weights`, returning
 * an array of bigint shares whose sum is exactly `total`.
 *
 * Returns an array of zeros if total === 0n or all weights sum to 0 — caller
 * should treat that as "nothing to allocate."
 */
export function allocateProportional(total: bigint, weights: readonly bigint[]): bigint[] {
  if (weights.length === 0 || total <= 0n) {
    return weights.map(() => 0n);
  }
  let weightSum = 0n;
  for (const w of weights) {
    if (w < 0n) throw new Error("Negative weight in allocateProportional");
    weightSum += w;
  }
  if (weightSum === 0n) {
    return weights.map(() => 0n);
  }

  // Floor shares + fractional residuals.
  const shares: bigint[] = new Array(weights.length).fill(0n);
  const residuals: { idx: number; remainder: bigint }[] = [];
  let allocated = 0n;
  for (let i = 0; i < weights.length; i++) {
    const numer = total * weights[i];
    const floor = numer / weightSum;
    const remainder = numer - floor * weightSum;
    shares[i] = floor;
    allocated += floor;
    residuals.push({ idx: i, remainder });
  }

  // Distribute remainder to largest residuals; stable on idx for determinism.
  let leftover = total - allocated;
  if (leftover > 0n) {
    residuals.sort((a, b) => {
      if (a.remainder === b.remainder) return a.idx - b.idx;
      return a.remainder < b.remainder ? 1 : -1;
    });
    for (let i = 0; i < residuals.length && leftover > 0n; i++) {
      shares[residuals[i].idx] += 1n;
      leftover -= 1n;
    }
  }

  return shares;
}
