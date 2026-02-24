import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  initWallet: vi.fn(),
  signAndBroadcast: vi.fn(),
}));

vi.mock("../src/services/wallet.js", () => ({
  initWallet: mocks.initWallet,
  signAndBroadcast: mocks.signAndBroadcast,
}));

import { createRegenBurnProvider } from "../src/services/regen-burn/provider.js";

describe("Regen burn provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.initWallet.mockResolvedValue({ address: "regen1sender" });
    mocks.signAndBroadcast.mockResolvedValue({
      code: 0,
      transactionHash: "BURN_TX_1",
      height: 123,
      rawLog: "",
    });
  });

  it("returns skipped records when provider is disabled", async () => {
    const provider = createRegenBurnProvider({
      provider: "disabled",
    });

    const planned = await provider.planBurn({
      month: "2026-03",
      amountMicro: 600_000n,
    });

    expect(planned.status).toBe("skipped");
    expect(planned.amountMicro).toBe("600000");
  });

  it("plans and executes simulated burns", async () => {
    const provider = createRegenBurnProvider({
      provider: "simulated",
    });

    const planned = await provider.planBurn({
      month: "2026-03",
      amountMicro: 600_000n,
    });
    expect(planned.status).toBe("planned");

    const executed = await provider.executeBurn({
      month: "2026-03",
      amountMicro: 600_000n,
    });
    expect(executed.status).toBe("executed");
    expect(executed.txHash).toContain("sim_burn_");
  });

  it("executes on-chain burns via MsgSend", async () => {
    const provider = createRegenBurnProvider({
      provider: "onchain",
      burnAddress: "regen1burnaddressxyz",
    });

    const executed = await provider.executeBurn({
      month: "2026-03",
      amountMicro: 600_000n,
    });

    expect(executed.status).toBe("executed");
    expect(executed.txHash).toBe("BURN_TX_1");
    expect(mocks.signAndBroadcast).toHaveBeenCalledTimes(1);
    const messages = mocks.signAndBroadcast.mock.calls[0]?.[0];
    expect(messages[0]?.typeUrl).toBe("/cosmos.bank.v1beta1.MsgSend");
    expect(messages[0]?.value?.toAddress).toBe("regen1burnaddressxyz");
  });

  it("returns failed status when on-chain burn transaction is rejected", async () => {
    mocks.signAndBroadcast.mockResolvedValueOnce({
      code: 5,
      transactionHash: "BURN_TX_FAIL",
      height: 999,
      rawLog: "insufficient fees",
    });

    const provider = createRegenBurnProvider({
      provider: "onchain",
      burnAddress: "regen1burnaddressxyz",
    });

    const executed = await provider.executeBurn({
      month: "2026-03",
      amountMicro: 600_000n,
    });

    expect(executed.status).toBe("failed");
    expect(executed.message).toContain("insufficient fees");
  });
});
