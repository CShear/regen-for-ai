import { randomUUID } from "node:crypto";
import type { EncodeObject } from "@cosmjs/proto-signing";
import { initWallet, signAndBroadcast } from "../wallet.js";
import type { RegenBurnRecord } from "../batch-retirement/types.js";

export interface RegenBurnInput {
  month: string;
  amountMicro: bigint;
}

export interface RegenBurnProvider {
  name: string;
  planBurn(input: RegenBurnInput): Promise<RegenBurnRecord>;
  executeBurn(input: RegenBurnInput): Promise<RegenBurnRecord>;
}

export interface RegenBurnProviderConfig {
  provider: "disabled" | "simulated" | "onchain";
  burnAddress?: string;
}

function skippedRecord(provider: string, input: RegenBurnInput, message: string): RegenBurnRecord {
  return {
    provider,
    status: "skipped",
    amountMicro: input.amountMicro.toString(),
    denom: "uregen",
    message,
  };
}

class DisabledRegenBurnProvider implements RegenBurnProvider {
  name = "disabled";

  async planBurn(input: RegenBurnInput): Promise<RegenBurnRecord> {
    return skippedRecord(
      this.name,
      input,
      "REGEN burn provider is disabled. Set REGEN_BURN_PROVIDER to simulated or onchain to enable burn execution."
    );
  }

  async executeBurn(input: RegenBurnInput): Promise<RegenBurnRecord> {
    return this.planBurn(input);
  }
}

class SimulatedRegenBurnProvider implements RegenBurnProvider {
  name = "simulated";

  async planBurn(input: RegenBurnInput): Promise<RegenBurnRecord> {
    if (input.amountMicro <= 0n) {
      return skippedRecord(
        this.name,
        input,
        "No REGEN amount available to burn."
      );
    }

    return {
      provider: this.name,
      status: "planned",
      amountMicro: input.amountMicro.toString(),
      denom: "uregen",
      burnAddress: "simulated-burn-address",
      message: `Planned simulated REGEN burn for ${input.month}.`,
    };
  }

  async executeBurn(input: RegenBurnInput): Promise<RegenBurnRecord> {
    const planned = await this.planBurn(input);
    if (planned.status === "skipped") return planned;

    return {
      ...planned,
      status: "executed",
      txHash: `sim_burn_${randomUUID()}`,
      message: `Executed simulated REGEN burn for ${input.month}.`,
    };
  }
}

class OnChainRegenBurnProvider implements RegenBurnProvider {
  name = "onchain";
  private readonly burnAddress: string;

  constructor(burnAddress: string) {
    const normalized = burnAddress.trim();
    if (!normalized) {
      throw new Error(
        "REGEN_BURN_ADDRESS is required when REGEN_BURN_PROVIDER=onchain"
      );
    }
    this.burnAddress = normalized;
  }

  async planBurn(input: RegenBurnInput): Promise<RegenBurnRecord> {
    if (input.amountMicro <= 0n) {
      return skippedRecord(
        this.name,
        input,
        "No REGEN amount available to burn."
      );
    }

    return {
      provider: this.name,
      status: "planned",
      amountMicro: input.amountMicro.toString(),
      denom: "uregen",
      burnAddress: this.burnAddress,
      message: `Planned on-chain REGEN burn for ${input.month}.`,
    };
  }

  async executeBurn(input: RegenBurnInput): Promise<RegenBurnRecord> {
    const planned = await this.planBurn(input);
    if (planned.status === "skipped") return planned;

    const { address } = await initWallet();
    const sendMsg: EncodeObject = {
      typeUrl: "/cosmos.bank.v1beta1.MsgSend",
      value: {
        fromAddress: address,
        toAddress: this.burnAddress,
        amount: [
          {
            denom: "uregen",
            amount: input.amountMicro.toString(),
          },
        ],
      },
    };

    const tx = await signAndBroadcast([sendMsg]);
    if (tx.code !== 0) {
      return {
        ...planned,
        status: "failed",
        message: `REGEN burn transaction failed (code ${tx.code}): ${tx.rawLog || "unknown error"}`,
      };
    }

    return {
      ...planned,
      status: "executed",
      txHash: tx.transactionHash,
      message: `Executed on-chain REGEN burn for ${input.month}.`,
    };
  }
}

export function createRegenBurnProvider(
  config: RegenBurnProviderConfig
): RegenBurnProvider {
  if (config.provider === "simulated") {
    return new SimulatedRegenBurnProvider();
  }
  if (config.provider === "onchain") {
    return new OnChainRegenBurnProvider(config.burnAddress || "");
  }
  return new DisabledRegenBurnProvider();
}
