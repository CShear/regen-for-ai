import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runMonthlyBatch: vi.fn(),
  getExecutionHistory: vi.fn(),
  syncPaidInvoices: vi.fn(),
  getMonthlySummary: vi.fn(),
  acquireLock: vi.fn(),
  startRun: vi.fn(),
  finishRun: vi.fn(),
  recordBlockedRun: vi.fn(),
  getHistory: vi.fn(),
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

vi.mock("../src/services/pool-accounting/service.js", () => ({
  PoolAccountingService: class {
    getMonthlySummary(month: string) {
      return mocks.getMonthlySummary(month);
    }
  },
}));

vi.mock("../src/services/reconciliation-run-lock/service.js", () => ({
  ReconciliationRunLockService: class {
    acquire(lockKey: string) {
      return mocks.acquireLock(lockKey);
    }
  },
}));

vi.mock("../src/services/reconciliation-run-history/service.js", () => ({
  ReconciliationRunHistoryService: class {
    startRun(input: unknown) {
      return mocks.startRun(input);
    }

    finishRun(runId: string, input: unknown) {
      return mocks.finishRun(runId, input);
    }

    recordBlockedRun(input: unknown) {
      return mocks.recordBlockedRun(input);
    }

    getHistory(input: unknown) {
      return mocks.getHistory(input);
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
    vi.resetAllMocks();
    const activeLocks = new Set<string>();

    mocks.acquireLock.mockImplementation(async (lockKey: string) => {
      if (activeLocks.has(lockKey)) {
        return null;
      }

      activeLocks.add(lockKey);
      let released = false;
      return {
        key: lockKey,
        token: `token-${lockKey}`,
        release: async () => {
          if (released) {
            return;
          }
          released = true;
          activeLocks.delete(lockKey);
        },
      };
    });

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
    mocks.getMonthlySummary.mockResolvedValue({
      month: "2026-03",
      contributionCount: 2,
      uniqueContributors: 2,
      totalUsdCents: 600,
      totalUsd: 6,
      lastContributionAt: "2026-03-01T00:00:00.000Z",
      contributors: [],
    });
    mocks.startRun.mockResolvedValue({
      id: "reconcile_run_1",
    });
    mocks.finishRun.mockResolvedValue({
      id: "reconcile_run_1",
    });
    mocks.recordBlockedRun.mockResolvedValue({
      id: "reconcile_blocked_1",
    });
    mocks.getHistory.mockResolvedValue([]);
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

  it("surfaces warning when reconciliation history start fails", async () => {
    mocks.startRun.mockRejectedValueOnce(new Error("history store offline"));

    const result = await runMonthlyReconciliationTool({ month: "2026-03" });
    const text = responseText(result);

    expect(result.isError).toBeUndefined();
    expect(text).toContain("| Batch Status | dry_run |");
    expect(text).toContain("### Warnings");
    expect(text).toContain(
      "Reconciliation run history start failed: history store offline"
    );
  });

  it("surfaces warning when reconciliation history finalize fails", async () => {
    mocks.finishRun.mockRejectedValueOnce(new Error("history finalize failed"));

    const result = await runMonthlyReconciliationTool({ month: "2026-03" });
    const text = responseText(result);

    expect(result.isError).toBeUndefined();
    expect(text).toContain("| Batch Status | dry_run |");
    expect(text).toContain("### Warnings");
    expect(text).toContain(
      "Reconciliation run history finalize failed: history finalize failed"
    );
  });

  it("surfaces warning when blocked-run history write fails", async () => {
    let resolveFirstSync:
      | ((value: {
          scope: "all_customers";
          month: string;
          fetchedInvoiceCount: number;
          processedInvoiceCount: number;
          syncedCount: number;
          duplicateCount: number;
          skippedCount: number;
          records: [];
        }) => void)
      | undefined;

    mocks.syncPaidInvoices.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirstSync = resolve;
      })
    );
    mocks.recordBlockedRun.mockRejectedValueOnce(new Error("blocked audit failed"));

    const firstRun = runMonthlyReconciliationTool({ month: "2026-03" });
    await Promise.resolve();

    const blocked = await runMonthlyReconciliationTool({ month: "2026-03" });
    const blockedText = responseText(blocked);

    expect(blocked.isError).toBe(true);
    expect(blockedText).toContain("| Batch Status | blocked_in_progress |");
    expect(blockedText).toContain("### Warnings");
    expect(blockedText).toContain(
      "Reconciliation run history write failed: blocked audit failed"
    );

    resolveFirstSync?.({
      scope: "all_customers",
      month: "2026-03",
      fetchedInvoiceCount: 0,
      processedInvoiceCount: 0,
      syncedCount: 0,
      duplicateCount: 0,
      skippedCount: 0,
      records: [],
    });
    await firstRun;
  });

  it("returns timeout error when contribution sync exceeds sync_timeout_ms", async () => {
    vi.useFakeTimers();
    try {
      let resolveSync:
        | ((value: {
            scope: "all_customers";
            month: string;
            fetchedInvoiceCount: number;
            processedInvoiceCount: number;
            syncedCount: number;
            duplicateCount: number;
            skippedCount: number;
            records: [];
          }) => void)
        | undefined;
      mocks.syncPaidInvoices.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSync = resolve;
        })
      );

      const resultPromise = runMonthlyReconciliationTool({
        month: "2026-03",
        syncTimeoutMs: 5,
      });
      await vi.advanceTimersByTimeAsync(5);
      const result = await resultPromise;

      expect(result.isError).toBe(true);
      expect(responseText(result)).toContain(
        "Monthly reconciliation failed: Contribution sync timed out after 5ms"
      );
      expect(mocks.runMonthlyBatch).not.toHaveBeenCalled();

      resolveSync?.({
        scope: "all_customers",
        month: "2026-03",
        fetchedInvoiceCount: 0,
        processedInvoiceCount: 0,
        syncedCount: 0,
        duplicateCount: 0,
        skippedCount: 0,
        records: [],
      });
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains reconciliation lock until timed-out sync promise settles", async () => {
    vi.useFakeTimers();
    try {
      let resolveFirstSync:
        | ((value: {
            scope: "all_customers";
            month: string;
            fetchedInvoiceCount: number;
            processedInvoiceCount: number;
            syncedCount: number;
            duplicateCount: number;
            skippedCount: number;
            records: [];
          }) => void)
        | undefined;

      mocks.syncPaidInvoices.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirstSync = resolve;
        })
      );

      const timedOutRunPromise = runMonthlyReconciliationTool({
        month: "2026-03",
        syncTimeoutMs: 5,
      });
      await vi.advanceTimersByTimeAsync(5);
      const timedOutRun = await timedOutRunPromise;

      expect(timedOutRun.isError).toBe(true);
      expect(responseText(timedOutRun)).toContain(
        "Contribution sync timed out after 5ms"
      );

      const blocked = await runMonthlyReconciliationTool({ month: "2026-03" });
      expect(blocked.isError).toBe(true);
      expect(responseText(blocked)).toContain("| Batch Status | blocked_in_progress |");

      resolveFirstSync?.({
        scope: "all_customers",
        month: "2026-03",
        fetchedInvoiceCount: 0,
        processedInvoiceCount: 0,
        syncedCount: 0,
        duplicateCount: 0,
        skippedCount: 0,
        records: [],
      });
      for (let i = 0; i < 6; i += 1) {
        await Promise.resolve();
      }

      const retry = await runMonthlyReconciliationTool({ month: "2026-03" });
      expect(responseText(retry)).not.toContain("| Batch Status | blocked_in_progress |");
      expect(retry.isError).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns timeout error when batch phase exceeds batch_timeout_ms", async () => {
    vi.useFakeTimers();
    try {
      let resolveBatch: ((value: unknown) => void) | undefined;
      mocks.runMonthlyBatch.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveBatch = resolve;
        })
      );

      const resultPromise = runMonthlyReconciliationTool({
        month: "2026-03",
        batchTimeoutMs: 5,
      });
      await vi.advanceTimersByTimeAsync(5);
      const result = await resultPromise;

      expect(result.isError).toBe(true);
      expect(responseText(result)).toContain(
        "Monthly reconciliation failed: Monthly batch execution timed out after 5ms"
      );

      resolveBatch?.({
        status: "dry_run",
        month: "2026-03",
        creditType: undefined,
        budgetUsdCents: 300,
        plannedQuantity: "1.000000",
        plannedCostMicro: 3_000_000n,
        plannedCostDenom: "USDC",
        message: "late completion after timeout",
      });
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      vi.useRealTimers();
    }
  });

  it("validates timeout parameter bounds", async () => {
    const result = await runMonthlyReconciliationTool({
      month: "2026-03",
      syncTimeoutMs: 0,
    });

    expect(result.isError).toBe(true);
    expect(responseText(result)).toContain(
      "Monthly reconciliation failed: sync_timeout_ms must be an integer between 1 and 300000"
    );
    expect(mocks.syncPaidInvoices).not.toHaveBeenCalled();
  });

  it("blocks batch execution when all-customer sync is truncated", async () => {
    mocks.syncPaidInvoices.mockResolvedValueOnce({
      scope: "all_customers",
      month: "2026-03",
      truncated: true,
      hasMore: true,
      pageCount: 3,
      maxPages: 3,
      fetchedInvoiceCount: 50,
      processedInvoiceCount: 50,
      syncedCount: 50,
      duplicateCount: 0,
      skippedCount: 0,
      records: [],
    });

    const result = await runMonthlyReconciliationTool({ month: "2026-03" });
    const text = responseText(result);

    expect(result.isError).toBe(true);
    expect(text).toContain("| Batch Status | blocked_partial_sync |");
    expect(text).toContain("| Fetch Truncated | Yes |");
    expect(text).toContain("allow_partial_sync=true");
    expect(mocks.runMonthlyBatch).not.toHaveBeenCalled();
  });

  it("allows continuing with truncated all-customer sync when override is set", async () => {
    mocks.syncPaidInvoices.mockResolvedValueOnce({
      scope: "all_customers",
      month: "2026-03",
      truncated: true,
      hasMore: true,
      pageCount: 3,
      maxPages: 3,
      fetchedInvoiceCount: 50,
      processedInvoiceCount: 50,
      syncedCount: 50,
      duplicateCount: 0,
      skippedCount: 0,
      records: [],
    });

    const result = await runMonthlyReconciliationTool({
      month: "2026-03",
      allowPartialSync: true,
    });
    const text = responseText(result);

    expect(result.isError).toBeUndefined();
    expect(text).toContain("| Batch Status | dry_run |");
    expect(text).toContain("| Fetch Truncated | Yes |");
    expect(mocks.runMonthlyBatch).toHaveBeenCalledTimes(1);
  });

  it("blocks live execution without a latest dry-run record by default", async () => {
    mocks.getExecutionHistory.mockResolvedValueOnce([
      {
        id: "batch_success",
        month: "2026-03",
        creditType: undefined,
        dryRun: false,
        status: "success",
        reason: "success",
        budgetUsdCents: 300,
        spentMicro: "2500000",
        spentDenom: "USDC",
        retiredQuantity: "1.250000",
        executedAt: "2026-03-31T12:00:00.000Z",
      },
    ]);

    const result = await runMonthlyReconciliationTool({
      month: "2026-03",
      dryRun: false,
    });
    const text = responseText(result);

    expect(mocks.getExecutionHistory).toHaveBeenCalledWith({
      month: "2026-03",
      creditType: undefined,
      limit: 1,
      newestFirst: true,
    });
    expect(result.isError).toBe(true);
    expect(text).toContain("| Batch Status | blocked_preflight |");
    expect(text).toContain("latest execution state is `success`");
    expect(text).toContain("allow_execute_without_dry_run=true");
    expect(mocks.runMonthlyBatch).not.toHaveBeenCalled();
  });

  it("allows live execution when latest record is dry-run", async () => {
    mocks.getExecutionHistory.mockResolvedValueOnce([
      {
        id: "batch_dry",
        month: "2026-03",
        creditType: undefined,
        dryRun: true,
        status: "dry_run",
        reason: "plan",
        budgetUsdCents: 300,
        spentMicro: "0",
        spentDenom: "USDC",
        retiredQuantity: "0.000000",
        executedAt: "2026-03-31T13:00:00.000Z",
      },
    ]);

    const result = await runMonthlyReconciliationTool({
      month: "2026-03",
      dryRun: false,
    });
    const text = responseText(result);

    expect(result.isError).toBeUndefined();
    expect(text).toContain("| Batch Status | dry_run |");
    expect(mocks.runMonthlyBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        month: "2026-03",
        dryRun: false,
      })
    );
  });

  it("blocks live execution when latest dry-run is stale versus contributions", async () => {
    mocks.getExecutionHistory.mockResolvedValueOnce([
      {
        id: "batch_dry_old",
        month: "2026-03",
        creditType: undefined,
        dryRun: true,
        status: "dry_run",
        reason: "plan",
        budgetUsdCents: 300,
        spentMicro: "0",
        spentDenom: "USDC",
        retiredQuantity: "0.000000",
        executedAt: "2026-03-10T00:00:00.000Z",
      },
    ]);
    mocks.getMonthlySummary.mockResolvedValueOnce({
      month: "2026-03",
      contributionCount: 3,
      uniqueContributors: 2,
      totalUsdCents: 900,
      totalUsd: 9,
      lastContributionAt: "2026-03-20T00:00:00.000Z",
      contributors: [],
    });

    const result = await runMonthlyReconciliationTool({
      month: "2026-03",
      dryRun: false,
    });
    const text = responseText(result);

    expect(result.isError).toBe(true);
    expect(text).toContain("| Batch Status | blocked_preflight_stale_dry_run |");
    expect(text).toContain("latest `dry_run` (2026-03-10T00:00:00.000Z)");
    expect(text).toContain("latest contribution (2026-03-20T00:00:00.000Z)");
    expect(mocks.runMonthlyBatch).not.toHaveBeenCalled();
  });

  it("allows live execution without latest dry-run when override is enabled", async () => {
    mocks.getExecutionHistory.mockResolvedValueOnce([]);

    const result = await runMonthlyReconciliationTool({
      month: "2026-03",
      dryRun: false,
      allowExecuteWithoutDryRun: true,
    });
    const text = responseText(result);

    expect(result.isError).toBeUndefined();
    expect(text).toContain("| Batch Status | dry_run |");
    expect(mocks.runMonthlyBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        month: "2026-03",
        dryRun: false,
      })
    );
  });

  it("supports preflight-only mode and skips batch execution", async () => {
    const result = await runMonthlyReconciliationTool({
      month: "2026-03",
      preflightOnly: true,
    });
    const text = responseText(result);

    expect(result.isError).toBeUndefined();
    expect(text).toContain("| Batch Status | preflight_ok |");
    expect(text).toContain("preflight_only=true");
    expect(mocks.runMonthlyBatch).not.toHaveBeenCalled();
  });

  it("supports preflight-only mode for intended live execution when checks pass", async () => {
    mocks.getExecutionHistory.mockResolvedValueOnce([
      {
        id: "batch_dry_current",
        month: "2026-03",
        creditType: undefined,
        dryRun: true,
        status: "dry_run",
        reason: "plan",
        budgetUsdCents: 300,
        spentMicro: "0",
        spentDenom: "USDC",
        retiredQuantity: "0.000000",
        executedAt: "2026-03-31T13:00:00.000Z",
      },
    ]);
    mocks.getMonthlySummary.mockResolvedValueOnce({
      month: "2026-03",
      contributionCount: 2,
      uniqueContributors: 2,
      totalUsdCents: 600,
      totalUsd: 6,
      lastContributionAt: "2026-03-31T12:00:00.000Z",
      contributors: [],
    });

    const result = await runMonthlyReconciliationTool({
      month: "2026-03",
      dryRun: false,
      preflightOnly: true,
    });
    const text = responseText(result);

    expect(result.isError).toBeUndefined();
    expect(text).toContain("| Intended Execution Mode | live |");
    expect(text).toContain("| Batch Status | preflight_ok |");
    expect(mocks.runMonthlyBatch).not.toHaveBeenCalled();
  });

  it("blocks concurrent reconciliation runs for the same month and credit type", async () => {
    let resolveFirstSync:
      | ((value: {
          scope: "all_customers";
          month: string;
          fetchedInvoiceCount: number;
          processedInvoiceCount: number;
          syncedCount: number;
          duplicateCount: number;
          skippedCount: number;
          records: [];
        }) => void)
      | undefined;

    mocks.syncPaidInvoices.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirstSync = resolve;
      })
    );

    const firstRun = runMonthlyReconciliationTool({ month: "2026-03" });
    await Promise.resolve();

    const blocked = await runMonthlyReconciliationTool({ month: "2026-03" });
    const blockedText = responseText(blocked);

    expect(blocked.isError).toBe(true);
    expect(blockedText).toContain("| Batch Status | blocked_in_progress |");
    expect(blockedText).toContain("already in progress");
    expect(mocks.syncPaidInvoices).toHaveBeenCalledTimes(1);

    resolveFirstSync?.({
      scope: "all_customers",
      month: "2026-03",
      fetchedInvoiceCount: 0,
      processedInvoiceCount: 0,
      syncedCount: 0,
      duplicateCount: 0,
      skippedCount: 0,
      records: [],
    });

    const firstResult = await firstRun;
    expect(firstResult.isError).toBeUndefined();
    expect(mocks.runMonthlyBatch).toHaveBeenCalledTimes(1);
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
