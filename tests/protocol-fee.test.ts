import { describe, expect, it } from "vitest";
import { calculateProtocolFee } from "../src/services/batch-retirement/fee.js";

describe("calculateProtocolFee", () => {
  it("computes fee and net credit budget in cents and micro units", () => {
    const breakdown = calculateProtocolFee({
      grossBudgetUsdCents: 300,
      protocolFeeBps: 1000,
      paymentDenom: "USDC",
    });

    expect(breakdown).toEqual({
      protocolFeeBps: 1000,
      grossBudgetUsdCents: 300,
      protocolFeeUsdCents: 30,
      protocolFeeMicro: "300000",
      protocolFeeDenom: "USDC",
      creditBudgetUsdCents: 270,
    });
  });

  it("uses floor rounding for fractional-cent fee results", () => {
    const breakdown = calculateProtocolFee({
      grossBudgetUsdCents: 101,
      protocolFeeBps: 1200,
      paymentDenom: "uusdc",
    });

    expect(breakdown.protocolFeeUsdCents).toBe(12);
    expect(breakdown.creditBudgetUsdCents).toBe(89);
    expect(breakdown.protocolFeeMicro).toBe("120000");
    expect(breakdown.protocolFeeDenom).toBe("uusdc");
  });

  it("rejects invalid protocol fee bps values", () => {
    expect(() =>
      calculateProtocolFee({
        grossBudgetUsdCents: 100,
        protocolFeeBps: 10001,
        paymentDenom: "USDC",
      })
    ).toThrow("protocolFeeBps must be an integer between 0 and 10000");
  });
});
