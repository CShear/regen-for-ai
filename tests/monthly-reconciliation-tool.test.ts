import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runMonthlyBatch: vi.fn(),
  syncPaidInvoices: vi.fn(),
}));

vi.mock("../src/services/batch-retirement/executor.js", () => ({
  MonthlyBatchRetirementExecutor: class {
    runMonthlyBatch(input: unknown) {
      return mocks.runMonthlyBatch(input);
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

import { runMonthlyReconciliationTool } from "../src/tools/monthly-batch-retirement.js";

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
});
