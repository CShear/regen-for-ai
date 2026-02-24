import type { ProtocolFeeBreakdown } from "./types.js";

const BPS_DENOMINATOR = 10_000;
const USD_CENT_TO_MICRO = 10_000n;

export function calculateProtocolFee(input: {
  grossBudgetUsdCents: number;
  protocolFeeBps: number;
  paymentDenom: "USDC" | "uusdc";
}): ProtocolFeeBreakdown {
  const { grossBudgetUsdCents, protocolFeeBps, paymentDenom } = input;

  if (!Number.isInteger(grossBudgetUsdCents) || grossBudgetUsdCents < 0) {
    throw new Error("grossBudgetUsdCents must be a non-negative integer");
  }
  if (
    !Number.isInteger(protocolFeeBps) ||
    protocolFeeBps < 0 ||
    protocolFeeBps > BPS_DENOMINATOR
  ) {
    throw new Error("protocolFeeBps must be an integer between 0 and 10000");
  }

  const protocolFeeUsdCents = Math.floor(
    (grossBudgetUsdCents * protocolFeeBps) / BPS_DENOMINATOR
  );
  const creditBudgetUsdCents = Math.max(grossBudgetUsdCents - protocolFeeUsdCents, 0);

  return {
    protocolFeeBps,
    grossBudgetUsdCents,
    protocolFeeUsdCents,
    protocolFeeMicro: (BigInt(protocolFeeUsdCents) * USD_CENT_TO_MICRO).toString(),
    protocolFeeDenom: paymentDenom,
    creditBudgetUsdCents,
  };
}
