import { beforeEach, describe, expect, it, vi } from "vitest";
import { MonthlyBatchRetirementExecutor } from "../src/services/batch-retirement/executor.js";
import type {
  BatchExecutionState,
  BatchExecutionStore,
  BudgetOrderSelection,
  RegenAcquisitionRecord,
} from "../src/services/batch-retirement/types.js";

class InMemoryBatchExecutionStore implements BatchExecutionStore {
  private state: BatchExecutionState = { version: 1, executions: [] };

  async readState(): Promise<BatchExecutionState> {
    return JSON.parse(JSON.stringify(this.state)) as BatchExecutionState;
  }

  async writeState(state: BatchExecutionState): Promise<void> {
    this.state = JSON.parse(JSON.stringify(state)) as BatchExecutionState;
  }
}

describe("MonthlyBatchRetirementExecutor", () => {
  let store: InMemoryBatchExecutionStore;
  let selectOrdersForBudget: ReturnType<typeof vi.fn>;
  let signAndBroadcast: ReturnType<typeof vi.fn>;
  let waitForRetirement: ReturnType<typeof vi.fn>;
  let initWallet: ReturnType<typeof vi.fn>;
  let getMonthlySummary: ReturnType<typeof vi.fn>;
  let planAcquisition: ReturnType<typeof vi.fn>;
  let executeAcquisition: ReturnType<typeof vi.fn>;

  const selection: BudgetOrderSelection = {
    orders: [
      {
        sellOrderId: "101",
        batchDenom: "C01-001-2026",
        quantity: "1.250000",
        askAmount: "2000000",
        askDenom: "uusdc",
        costMicro: 2_500_000n,
      },
    ],
    totalQuantity: "1.250000",
    totalCostMicro: 2_500_000n,
    remainingBudgetMicro: 500_000n,
    paymentDenom: "uusdc",
    displayDenom: "USDC",
    exponent: 6,
    exhaustedBudget: false,
  };

  beforeEach(() => {
    store = new InMemoryBatchExecutionStore();
    selectOrdersForBudget = vi.fn().mockResolvedValue(selection);
    signAndBroadcast = vi.fn().mockResolvedValue({
      code: 0,
      transactionHash: "TX123",
      height: 123456,
      rawLog: "",
    });
    waitForRetirement = vi.fn().mockResolvedValue({ nodeId: "WyRet123" });
    initWallet = vi.fn().mockResolvedValue({ address: "regen1batchbuyer" });
    planAcquisition = vi.fn().mockResolvedValue({
      provider: "simulated",
      status: "planned",
      spendMicro: "300000",
      spendDenom: "USDC",
      estimatedRegenMicro: "600000",
      message: "Planned simulated DEX acquisition for 2026-03.",
    } satisfies RegenAcquisitionRecord);
    executeAcquisition = vi.fn().mockResolvedValue({
      provider: "simulated",
      status: "executed",
      spendMicro: "300000",
      spendDenom: "USDC",
      estimatedRegenMicro: "600000",
      acquiredRegenMicro: "600000",
      txHash: "sim_dex_abc",
      message: "Executed simulated DEX acquisition for 2026-03.",
    } satisfies RegenAcquisitionRecord);
    getMonthlySummary = vi.fn().mockResolvedValue({
      month: "2026-03",
      contributionCount: 3,
      uniqueContributors: 1,
      totalUsdCents: 300,
      totalUsd: 3,
      contributors: [
        {
          userId: "user-a",
          contributionCount: 3,
          totalUsdCents: 300,
          totalUsd: 3,
        },
      ],
    });
  });

  function createExecutor(walletConfigured = true): MonthlyBatchRetirementExecutor {
    return new MonthlyBatchRetirementExecutor({
      poolAccounting: { getMonthlySummary },
      executionStore: store,
      selectOrdersForBudget,
      isWalletConfigured: () => walletConfigured,
      initWallet,
      signAndBroadcast,
      waitForRetirement,
      regenAcquisitionProvider: {
        name: "simulated",
        planAcquisition,
        executeAcquisition,
      },
      loadConfig: () =>
        ({
          defaultJurisdiction: "US",
          protocolFeeBps: 1000,
        }) as any,
    });
  }

  it("returns no_contributions when month has no pool funds", async () => {
    getMonthlySummary.mockResolvedValueOnce({
      month: "2026-03",
      contributionCount: 0,
      uniqueContributors: 0,
      totalUsdCents: 0,
      totalUsd: 0,
      contributors: [],
    });
    const executor = createExecutor();

    const result = await executor.runMonthlyBatch({ month: "2026-03" });

    expect(result.status).toBe("no_contributions");
    expect(selectOrdersForBudget).not.toHaveBeenCalled();
  });

  it("executes dry-run by default and stores a dry-run execution record", async () => {
    const executor = createExecutor();

    const result = await executor.runMonthlyBatch({ month: "2026-03" });

    expect(result.status).toBe("dry_run");
    expect(selectOrdersForBudget).toHaveBeenCalledWith(
      undefined,
      2_700_000n,
      "USDC"
    );
    expect(signAndBroadcast).not.toHaveBeenCalled();
    expect(result.protocolFee).toMatchObject({
      protocolFeeBps: 1000,
      grossBudgetUsdCents: 300,
      protocolFeeUsdCents: 30,
      creditBudgetUsdCents: 270,
      protocolFeeDenom: "USDC",
    });
    expect(planAcquisition).toHaveBeenCalledWith({
      month: "2026-03",
      spendMicro: 300_000n,
      spendDenom: "USDC",
    });
    expect(executeAcquisition).not.toHaveBeenCalled();
    expect(result.regenAcquisition?.status).toBe("planned");
    expect(result.attributions).toHaveLength(1);
    expect(result.attributions?.[0]).toMatchObject({
      userId: "user-a",
      attributedBudgetUsdCents: 270,
      attributedQuantity: "1.250000",
    });

    const state = await store.readState();
    expect(state.executions).toHaveLength(1);
    expect(state.executions[0]?.status).toBe("dry_run");
    expect(state.executions[0]?.protocolFee?.protocolFeeUsdCents).toBe(30);
    expect(state.executions[0]?.attributions?.[0]?.userId).toBe("user-a");
  });

  it("executes on-chain batch and writes success record when dryRun=false", async () => {
    const executor = createExecutor(true);

    const result = await executor.runMonthlyBatch({
      month: "2026-03",
      dryRun: false,
      creditType: "carbon",
    });

    expect(result.status).toBe("success");
    expect(initWallet).toHaveBeenCalledTimes(1);
    expect(signAndBroadcast).toHaveBeenCalledTimes(1);
    expect(waitForRetirement).toHaveBeenCalledWith("TX123");
    expect(result.txHash).toBe("TX123");
    expect(result.retirementId).toBe("WyRet123");
    expect(result.protocolFee?.protocolFeeUsdCents).toBe(30);
    expect(planAcquisition).toHaveBeenCalledTimes(1);
    expect(executeAcquisition).toHaveBeenCalledWith({
      month: "2026-03",
      spendMicro: 300_000n,
      spendDenom: "USDC",
    });
    expect(result.regenAcquisition?.status).toBe("executed");
    expect(result.attributions).toHaveLength(1);

    const state = await store.readState();
    expect(state.executions).toHaveLength(1);
    expect(state.executions[0]).toMatchObject({
      month: "2026-03",
      status: "success",
      txHash: "TX123",
      creditType: "carbon",
    });
  });

  it("blocks duplicate successful monthly execution unless force=true", async () => {
    const executor = createExecutor(true);
    await executor.runMonthlyBatch({
      month: "2026-03",
      dryRun: false,
      creditType: "carbon",
    });

    const second = await executor.runMonthlyBatch({
      month: "2026-03",
      dryRun: false,
      creditType: "carbon",
    });
    expect(second.status).toBe("already_executed");
    expect(signAndBroadcast).toHaveBeenCalledTimes(1);

    const forced = await executor.runMonthlyBatch({
      month: "2026-03",
      dryRun: false,
      creditType: "carbon",
      force: true,
    });
    expect(forced.status).toBe("success");
    expect(signAndBroadcast).toHaveBeenCalledTimes(2);
  });
});
