import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runMonthlyBatch: vi.fn(),
  getExecutionHistory: vi.fn(),
  syncPaidInvoices: vi.fn(),
}));

vi.mock("../src/services/batch-retirement/executor.js", () => ({
  MonthlyBatchRetirementExecutor: class {
    runMonthlyBatch(input: unknown) {
      return mocks.runMonthlyBatch(input);
    }

    getExecutionHistory(input: unknown) {
      return mocks.getExecutionHistory(input);
    }
  },
}));

vi.mock("../src/services/subscription/pool-sync.js", () => ({
  SubscriptionPoolSyncService: class {
    syncPaidInvoices(input: unknown) {
      return mocks.syncPaidInvoices(input);
    }
  },
}));

import {
  getMonthlyBatchExecutionHistoryTool,
  runMonthlyReconciliationTool,
} from "../src/tools/monthly-batch-retirement.js";

function responseText(result: { content: Array<{ type: "text"; text: string }> }): string {
  return result.content[0]?.text ?? "";
}

describe("runMonthlyReconciliationTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.syncPaidInvoices.mockResolvedValue({
      scope: "all_customers",
      month: "2026-03",
      fetchedInvoiceCount: 2,
      processedInvoiceCount: 2,
      syncedCount: 2,
      duplicateCount: 0,
      skippedCount: 0,
      records: [
        {
          invoiceId: "in_1",
          contributionId: "contrib_1",
          duplicated: false,
          amountUsdCents: 300,
          paidAt: "2026-03-01T00:00:00.000Z",
        },
      ],
    });

    mocks.runMonthlyBatch.mockResolvedValue({
      status: "dry_run",
      month: "2026-03",
      creditType: undefined,
      budgetUsdCents: 300,
      plannedQuantity: "1.000000",
      plannedCostMicro: 3_000_000n,
      plannedCostDenom: "USDC",
      message: "Dry run complete. No on-chain transaction was broadcast.",
    });
    mocks.getExecutionHistory.mockResolvedValue([
      {
        id: "batch_1",
        month: "2026-03",
        creditType: "carbon",
        dryRun: false,
        status: "success",
        reason: "Success run",
        budgetUsdCents: 300,
        spentMicro: "2500000",
        spentDenom: "USDC",
        retiredQuantity: "1.250000",
        txHash: "TX123",
        executedAt: "2026-03-31T12:00:00.000Z",
      },
    ]);
  });

  it("runs all-customer sync before monthly batch by default", async () => {
    const result = await runMonthlyReconciliationTool({ month: "2026-03" });
    const text = responseText(result);

    expect(mocks.syncPaidInvoices).toHaveBeenCalledWith({
      month: "2026-03",
      limit: undefined,
      maxPages: undefined,
      allCustomers: true,
    });
    expect(mocks.runMonthlyBatch).toHaveBeenCalledWith({
      month: "2026-03",
      creditType: undefined,
      maxBudgetUsd: undefined,
      dryRun: undefined,
      force: undefined,
      reason: undefined,
      jurisdiction: undefined,
      paymentDenom: "USDC",
    });

    expect(text).toContain("## Monthly Reconciliation");
    expect(text).toContain("| Sync Scope | all_customers |");
    expect(text).toContain("| Batch Status | dry_run |");
    expect(text).toContain("| Scope | all_customers |");
  });

  it("supports customer-scoped sync input", async () => {
    await runMonthlyReconciliationTool({
      month: "2026-03",
      syncScope: "customer",
      email: "alice@example.com",
      customerId: "cus_123",
      userId: "user_123",
      invoiceLimit: 25,
      creditType: "carbon",
      dryRun: true,
      force: false,
    });

    expect(mocks.syncPaidInvoices).toHaveBeenCalledWith({
      month: "2026-03",
      email: "alice@example.com",
      customerId: "cus_123",
      userId: "user_123",
      limit: 25,
    });

    expect(mocks.runMonthlyBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        month: "2026-03",
        creditType: "carbon",
      })
    );
  });

  it("skips sync when sync_scope=none", async () => {
    const result = await runMonthlyReconciliationTool({
      month: "2026-03",
      syncScope: "none",
    });
    const text = responseText(result);

    expect(mocks.syncPaidInvoices).not.toHaveBeenCalled();
    expect(mocks.runMonthlyBatch).toHaveBeenCalledTimes(1);
    expect(text).toContain("| Scope | none |");
    expect(text).toContain("Contribution sync was skipped");
  });

  it("returns an error and skips batch execution if sync fails", async () => {
    mocks.syncPaidInvoices.mockRejectedValue(new Error("Stripe unavailable"));

    const result = await runMonthlyReconciliationTool({ month: "2026-03" });

    expect(result.isError).toBe(true);
    expect(responseText(result)).toContain(
      "Monthly reconciliation failed: Stripe unavailable"
    );
    expect(mocks.runMonthlyBatch).not.toHaveBeenCalled();
  });

  it("returns monthly batch execution history table", async () => {
    const result = await getMonthlyBatchExecutionHistoryTool(
      "2026-03",
      "success",
      "carbon",
      false,
      25
    );
    const text = responseText(result);

    expect(mocks.getExecutionHistory).toHaveBeenCalledWith({
      month: "2026-03",
      status: "success",
      creditType: "carbon",
      dryRun: false,
      limit: 25,
      newestFirst: true,
    });
    expect(text).toContain("## Monthly Batch Execution History");
    expect(text).toContain("| Returned Records | 1 |");
    expect(text).toContain("| batch_1 |");
    expect(text).toContain("| `TX123` |");
  });

  it("returns error response when monthly batch execution history query fails", async () => {
    mocks.getExecutionHistory.mockRejectedValue(
      new Error("month must be in YYYY-MM format")
    );
    const result = await getMonthlyBatchExecutionHistoryTool("03-2026");
    expect(result.isError).toBe(true);
    expect(responseText(result)).toContain(
      "Execution history query failed: month must be in YYYY-MM format"
    );
  });
});
