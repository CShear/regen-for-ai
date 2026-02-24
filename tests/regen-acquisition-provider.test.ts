import { describe, expect, it } from "vitest";
import {
  createRegenAcquisitionProvider,
} from "../src/services/regen-acquisition/provider.js";

describe("Regen acquisition provider", () => {
  it("returns skipped records when provider is disabled", async () => {
    const provider = createRegenAcquisitionProvider({
      provider: "disabled",
      simulatedRateUregenPerUsdc: 2_000_000,
    });

    const planned = await provider.planAcquisition({
      month: "2026-03",
      spendMicro: 300_000n,
      spendDenom: "USDC",
    });

    expect(planned.status).toBe("skipped");
    expect(planned.estimatedRegenMicro).toBe("0");
  });

  it("plans and executes simulated DEX acquisitions", async () => {
    const provider = createRegenAcquisitionProvider({
      provider: "simulated",
      simulatedRateUregenPerUsdc: 2_000_000,
    });

    const planned = await provider.planAcquisition({
      month: "2026-03",
      spendMicro: 300_000n,
      spendDenom: "USDC",
    });
    expect(planned.status).toBe("planned");
    expect(planned.estimatedRegenMicro).toBe("600000");

    const executed = await provider.executeAcquisition({
      month: "2026-03",
      spendMicro: 300_000n,
      spendDenom: "USDC",
    });
    expect(executed.status).toBe("executed");
    expect(executed.acquiredRegenMicro).toBe("600000");
    expect(executed.txHash).toContain("sim_dex_");
  });
});
