import { describe, it, expect } from "vitest";
import {
  allocateProportional,
  creditsToMicro,
  microToCredits,
  ATTRIBUTION_SCALE,
} from "../services/attribution.js";

describe("creditsToMicro / microToCredits", () => {
  it("round-trips integer credit counts exactly", () => {
    for (const n of [0, 1, 100, 1000.5]) {
      expect(microToCredits(creditsToMicro(n))).toBe(n);
    }
  });

  it("rounds half to nearest micro", () => {
    expect(creditsToMicro(0.0000005)).toBe(1n);
    expect(creditsToMicro(0.0000004)).toBe(0n);
  });

  it("clamps non-finite or negative input to 0", () => {
    expect(creditsToMicro(NaN)).toBe(0n);
    expect(creditsToMicro(-1)).toBe(0n);
    expect(creditsToMicro(Infinity)).toBe(0n);
  });

  it("ATTRIBUTION_SCALE is 1_000_000n", () => {
    expect(ATTRIBUTION_SCALE).toBe(1_000_000n);
  });
});

describe("allocateProportional (audit C1)", () => {
  it("returns zero shares when total is zero", () => {
    expect(allocateProportional(0n, [1n, 2n, 3n])).toEqual([0n, 0n, 0n]);
  });

  it("returns zero shares when all weights are zero", () => {
    expect(allocateProportional(100n, [0n, 0n, 0n])).toEqual([0n, 0n, 0n]);
  });

  it("returns empty array for empty weights", () => {
    expect(allocateProportional(100n, [])).toEqual([]);
  });

  it("rejects negative weights", () => {
    expect(() => allocateProportional(100n, [-1n, 2n])).toThrow();
  });

  it("splits 1.0 credit between equal subscribers exactly (no float drift)", () => {
    // Previous float code: 1/3 ≈ 0.333..., 3 * 0.333 = 0.999, 1 micro lost.
    const total = creditsToMicro(1); // 1_000_000n
    const shares = allocateProportional(total, [1n, 1n, 1n]);
    const sum = shares.reduce((a, b) => a + b, 0n);
    expect(sum).toBe(total);
    // Each share is 333_333n, with one bumped to 333_334n by largest-remainder.
    expect(shares.filter((s) => s === 333_333n).length).toBe(2);
    expect(shares.filter((s) => s === 333_334n).length).toBe(1);
  });

  it("the leftover micro goes to the largest-residual share, deterministically", () => {
    // weights [1, 2] with total 1n: floor shares are [0, 0], remainders are
    // [1, 2] (out of weightSum=3). Index 1 has the larger residual.
    expect(allocateProportional(1n, [1n, 2n])).toEqual([0n, 1n]);
  });

  it("weights determine proportion: 1:5 split of 6n exactly", () => {
    expect(allocateProportional(6n, [1n, 5n])).toEqual([1n, 5n]);
  });

  it("scales correctly to 1.5M credits across 1000 weighted subscribers", () => {
    const weights: bigint[] = [];
    for (let i = 0; i < 1000; i++) weights.push(BigInt(100 + (i % 50)));
    const total = creditsToMicro(1_500_000);
    const shares = allocateProportional(total, weights);
    expect(shares).toHaveLength(1000);
    const sum = shares.reduce((a, b) => a + b, 0n);
    expect(sum).toBe(total);
  });

  it("REGRESSION: subscriber A=$2, B=$10 gives B exactly 5x A's share", () => {
    const total = creditsToMicro(0.6); // 600_000n
    const shares = allocateProportional(total, [200n, 1000n]);
    expect(shares[0] + shares[1]).toBe(total);
    expect(shares[1]).toBe(shares[0] * 5n);
  });

  it("ties on remainder break by index (lower index gets the +1)", () => {
    // weights [1, 1] with total 1n: floor = [0, 0], remainders both 1.
    // Tie broken by idx → idx 0 gets the leftover micro.
    expect(allocateProportional(1n, [1n, 1n])).toEqual([1n, 0n]);
  });

  it("never allocates more than total even with extreme weights", () => {
    const total = creditsToMicro(1);
    // One huge weight + many tiny — naïve float would round and over-allocate.
    const weights = [10_000_000n, ...Array(100).fill(1n)];
    const shares = allocateProportional(total, weights);
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(total);
  });
});
