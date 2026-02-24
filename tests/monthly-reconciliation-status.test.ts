import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMonthlySummary: vi.fn(),
  getExecutionHistory: vi.fn(),
  loadConfig: vi.fn(),
}));

vi.mock("../src/services/batch-retirement/executor.js", () => ({
  MonthlyBatchRetirementExecutor: class {
    getExecutionHistory(input: unknown) {
      return mocks.getExecutionHistory(input);
    }

    runMonthlyBatch() {
      throw new Error("not implemented for this test");
    }
  },
}));

vi.mock("../src/services/pool-accounting/service.js", () => ({
  PoolAccountingService: class {
    getMonthlySummary(month: string) {
      return mocks.getMonthlySummary(month);
    }
  },
}));

vi.mock("../src/services/subscription/pool-sync.js", () => ({
  SubscriptionPoolSyncService: class {
    syncPaidInvoices() {
      throw new Error("not implemented for this test");
    }
  },
}));

vi.mock("../src/config.js", () => ({
  loadConfig: mocks.loadConfig,
}));

import { getMonthlyReconciliationStatusTool } from "../src/tools/monthly-batch-retirement.js";

function responseText(result: { content: Array<{ type: "text"; text: string }> }): string {
  return result.content[0]?.text ?? "";
}

describe("getMonthlyReconciliationStatusTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfig.mockReturnValue({ protocolFeeBps: 1000 });
    mocks.getMonthlySummary.mockResolvedValue({
      month: "2026-03",
      contributionCount: 0,
      uniqueContributors: 0,
      totalUsdCents: 0,
      totalUsd: 0,
      contributors: [],
    });
    mocks.getExecutionHistory.mockResolvedValue([]);
  });

  it("reports no-contribution status with blocked readiness", async () => {
    const result = await getMonthlyReconciliationStatusTool("2026-03");
    const text = responseText(result);

    expect(mocks.getExecutionHistory).toHaveBeenCalledWith({
      month: "2026-03",
      creditType: undefined,
      limit: 1,
      newestFirst: true,
    });
    expect(text).toContain("## Monthly Reconciliation Status");
    expect(text).toContain("| Gross Pool Budget | $0.00 |");
    expect(text).toContain("| Protocol Fee | $0.00 (10.00%) |");
    expect(text).toContain("| Latest Execution Status | none |");
    expect(text).toContain("| Ready For Execution | No |");
    expect(text).toContain("Recommendation: No contributions found");
  });

  it("reports ready state with recovery guidance after failed execution", async () => {
    mocks.getMonthlySummary.mockResolvedValueOnce({
      month: "2026-03",
      contributionCount: 2,
      uniqueContributors: 2,
      totalUsdCents: 500,
      totalUsd: 5,
      contributors: [],
    });
    mocks.getExecutionHistory.mockResolvedValueOnce([
      {
        id: "batch_fail",
        month: "2026-03",
        creditType: "carbon",
        dryRun: false,
        status: "failed",
        reason: "RPC error",
        budgetUsdCents: 500,
        spentMicro: "0",
        spentDenom: "USDC",
        retiredQuantity: "0.000000",
        error: "rpc unavailable",
        executedAt: "2026-03-31T12:00:00.000Z",
      },
    ]);

    const result = await getMonthlyReconciliationStatusTool("2026-03", "carbon");
    const text = responseText(result);

    expect(text).toContain("| Credit Type Filter | carbon |");
    expect(text).toContain("| Gross Pool Budget | $5.00 |");
    expect(text).toContain("| Net Credit Budget | $4.50 |");
    expect(text).toContain("| Latest Execution Status | failed |");
    expect(text).toContain("| Ready For Execution | Yes |");
    expect(text).toContain("dry_run=true");
  });

  it("reports already-executed state when latest run succeeded", async () => {
    mocks.getMonthlySummary.mockResolvedValueOnce({
      month: "2026-03",
      contributionCount: 3,
      uniqueContributors: 1,
      totalUsdCents: 300,
      totalUsd: 3,
      contributors: [],
    });
    mocks.getExecutionHistory.mockResolvedValueOnce([
      {
        id: "batch_success",
        month: "2026-03",
        creditType: "carbon",
        dryRun: false,
        status: "success",
        reason: "Done",
        budgetUsdCents: 300,
        spentMicro: "2500000",
        spentDenom: "USDC",
        retiredQuantity: "1.250000",
        txHash: "TX123",
        retirementId: "WyRet123",
        executedAt: "2026-03-31T12:00:00.000Z",
      },
    ]);

    const result = await getMonthlyReconciliationStatusTool("2026-03", "carbon");
    const text = responseText(result);

    expect(text).toContain("| Latest Execution Status | success |");
    expect(text).toContain("| Latest Tx Hash | `TX123` |");
    expect(text).toContain("| Latest Retirement ID | WyRet123 |");
    expect(text).toContain("| Ready For Execution | No |");
    expect(text).toContain("A successful execution already exists");
  });

  it("returns error for invalid month format", async () => {
    const result = await getMonthlyReconciliationStatusTool("03-2026");
    expect(result.isError).toBe(true);
    expect(responseText(result)).toContain(
      "Monthly reconciliation status query failed: month must be in YYYY-MM format"
    );
  });
});
