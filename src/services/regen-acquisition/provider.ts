import { randomUUID } from "node:crypto";
import type { RegenAcquisitionRecord } from "../batch-retirement/types.js";

const MICRO_FACTOR = 1_000_000n;

export interface RegenAcquisitionInput {
  month: string;
  spendMicro: bigint;
  spendDenom: "USDC" | "uusdc";
}

export interface RegenAcquisitionProvider {
  name: string;
  planAcquisition(input: RegenAcquisitionInput): Promise<RegenAcquisitionRecord>;
  executeAcquisition(input: RegenAcquisitionInput): Promise<RegenAcquisitionRecord>;
}

export interface RegenAcquisitionProviderConfig {
  provider: "disabled" | "simulated";
  simulatedRateUregenPerUsdc: number;
}

function normalizeSpendDenom(denom: "USDC" | "uusdc"): "USDC" | "uusdc" {
  return denom.toLowerCase() === "uusdc" ? "uusdc" : "USDC";
}

function toRegenMicro(spendMicro: bigint, rateUregenPerUsdc: bigint): bigint {
  return (spendMicro * rateUregenPerUsdc) / MICRO_FACTOR;
}

class DisabledRegenAcquisitionProvider implements RegenAcquisitionProvider {
  name = "disabled";

  async planAcquisition(input: RegenAcquisitionInput): Promise<RegenAcquisitionRecord> {
    return {
      provider: this.name,
      status: "skipped",
      spendMicro: input.spendMicro.toString(),
      spendDenom: normalizeSpendDenom(input.spendDenom),
      estimatedRegenMicro: "0",
      message:
        "REGEN acquisition provider is disabled. Set REGEN_ACQUISITION_PROVIDER=simulated (or a future live provider) to enable protocol fee swaps.",
    };
  }

  async executeAcquisition(input: RegenAcquisitionInput): Promise<RegenAcquisitionRecord> {
    return this.planAcquisition(input);
  }
}

class SimulatedRegenAcquisitionProvider implements RegenAcquisitionProvider {
  name = "simulated";
  private readonly rateUregenPerUsdc: bigint;

  constructor(rateUregenPerUsdc: number) {
    if (!Number.isInteger(rateUregenPerUsdc) || rateUregenPerUsdc <= 0) {
      throw new Error("simulatedRateUregenPerUsdc must be a positive integer");
    }
    this.rateUregenPerUsdc = BigInt(rateUregenPerUsdc);
  }

  async planAcquisition(input: RegenAcquisitionInput): Promise<RegenAcquisitionRecord> {
    const spendDenom = normalizeSpendDenom(input.spendDenom);
    if (input.spendMicro <= 0n) {
      return {
        provider: this.name,
        status: "skipped",
        spendMicro: "0",
        spendDenom,
        estimatedRegenMicro: "0",
        message: "Protocol fee spend is zero; no REGEN acquisition planned.",
      };
    }

    const estimatedRegenMicro = toRegenMicro(input.spendMicro, this.rateUregenPerUsdc);
    return {
      provider: this.name,
      status: "planned",
      spendMicro: input.spendMicro.toString(),
      spendDenom,
      estimatedRegenMicro: estimatedRegenMicro.toString(),
      message: `Planned simulated DEX acquisition for ${input.month}.`,
    };
  }

  async executeAcquisition(input: RegenAcquisitionInput): Promise<RegenAcquisitionRecord> {
    const planned = await this.planAcquisition(input);
    if (planned.status === "skipped") return planned;

    return {
      provider: this.name,
      status: "executed",
      spendMicro: planned.spendMicro,
      spendDenom: planned.spendDenom,
      estimatedRegenMicro: planned.estimatedRegenMicro,
      acquiredRegenMicro: planned.estimatedRegenMicro,
      txHash: `sim_dex_${randomUUID()}`,
      message: `Executed simulated DEX acquisition for ${input.month}.`,
    };
  }
}

export function createRegenAcquisitionProvider(
  config: RegenAcquisitionProviderConfig
): RegenAcquisitionProvider {
  if (config.provider === "simulated") {
    return new SimulatedRegenAcquisitionProvider(config.simulatedRateUregenPerUsdc);
  }
  return new DisabledRegenAcquisitionProvider();
}
