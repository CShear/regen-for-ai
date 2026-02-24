import { MonthlyBatchRetirementExecutor } from "../services/batch-retirement/executor.js";
import type {
  BatchExecutionStatus,
  RunMonthlyBatchResult,
} from "../services/batch-retirement/types.js";
import { PoolAccountingService } from "../services/pool-accounting/service.js";
import {
  SubscriptionPoolSyncService,
  type SubscriptionPoolSyncResult,
} from "../services/subscription/pool-sync.js";
import { loadConfig } from "../config.js";
import { calculateProtocolFee } from "../services/batch-retirement/fee.js";
import { ReconciliationRunHistoryService } from "../services/reconciliation-run-history/service.js";
import { ReconciliationRunLockService } from "../services/reconciliation-run-lock/service.js";
import type {
  ReconciliationRunStatus,
  ReconciliationRunSyncSummary,
} from "../services/reconciliation-run-history/types.js";

const executor = new MonthlyBatchRetirementExecutor();
const poolAccounting = new PoolAccountingService();
const poolSync = new SubscriptionPoolSyncService();
const reconciliationHistory = new ReconciliationRunHistoryService();
const reconciliationRunLockService = new ReconciliationRunLockService();
const MONTH_REGEX = /^\d{4}-\d{2}$/;

type SyncScope = "none" | "customer" | "all_customers";

export interface RunMonthlyReconciliationInput {
  month: string;
  creditType?: "carbon" | "biodiversity";
  maxBudgetUsd?: number;
  dryRun?: boolean;
  preflightOnly?: boolean;
  force?: boolean;
  allowPartialSync?: boolean;
  allowExecuteWithoutDryRun?: boolean;
  syncTimeoutMs?: number;
  batchTimeoutMs?: number;
  reason?: string;
  jurisdiction?: string;
  syncScope?: SyncScope;
  email?: string;
  customerId?: string;
  userId?: string;
  invoiceLimit?: number;
  invoiceMaxPages?: number;
}

function reconciliationLockKey(
  month: string,
  creditType?: "carbon" | "biodiversity"
): string {
  return `${month}:${creditType || "all"}`;
}

function resolveTimeoutMs(value: number | undefined, label: string): number | undefined {
  if (typeof value === "undefined") return undefined;
  if (!Number.isInteger(value) || value < 1 || value > 300_000) {
    throw new Error(`${label} must be an integer between 1 and 300000`);
  }
  return value;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  label: string,
  onTimeout?: (pendingPromise: Promise<T>) => void
): Promise<T> {
  if (!timeoutMs) {
    return promise;
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      onTimeout?.(promise);
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function appendWarningsSection(lines: string[], warnings: string[]): void {
  if (warnings.length === 0) {
    return;
  }

  lines.push(
    "",
    "### Warnings",
    "",
    ...warnings.map((warning) => `- ${warning}`)
  );
}

function toReconciliationSyncSummary(
  syncScope: SyncScope,
  result?: SubscriptionPoolSyncResult
): ReconciliationRunSyncSummary {
  if (!result) {
    return {
      scope: syncScope,
      fetchedInvoiceCount: 0,
      processedInvoiceCount: 0,
      syncedCount: 0,
      duplicateCount: 0,
      skippedCount: 0,
    };
  }

  return {
    scope: result.scope,
    fetchedInvoiceCount: result.fetchedInvoiceCount,
    processedInvoiceCount: result.processedInvoiceCount,
    syncedCount: result.syncedCount,
    duplicateCount: result.duplicateCount,
    skippedCount: result.skippedCount,
    truncated: result.truncated,
    hasMore: result.hasMore,
    pageCount: result.pageCount,
    maxPages: result.maxPages,
  };
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatMicroAmount(amount: bigint, denom: string, exponent: number): string {
  const divisor = 10n ** BigInt(exponent);
  const whole = amount / divisor;
  const frac = amount % divisor;
  const fracStr = frac.toString().padStart(exponent, "0").replace(/0+$/, "");
  return fracStr ? `${whole.toString()}.${fracStr} ${denom}` : `${whole.toString()} ${denom}`;
}

function denomExponent(denom: string): number {
  return denom.toLowerCase() === "uusdc" ? 6 : 6;
}

function formatRegenMicro(value: string): string {
  const amount = BigInt(value);
  return formatMicroAmount(amount, "REGEN", 6);
}

function renderMonthlyBatchResult(
  result: RunMonthlyBatchResult,
  title: string = "Monthly Batch Retirement"
): string {
  const lines: string[] = [
    `## ${title}`,
    "",
    `| Field | Value |`,
    `|-------|-------|`,
    `| Status | ${result.status} |`,
    `| Month | ${result.month} |`,
    `| Credit Type | ${result.creditType || "all"} |`,
    `| Gross Budget | ${formatUsd(result.budgetUsdCents)} |`,
    `| Planned Quantity | ${result.plannedQuantity} |`,
    `| Planned Cost | ${formatMicroAmount(result.plannedCostMicro, result.plannedCostDenom, denomExponent(result.plannedCostDenom))} |`,
  ];

  if (result.protocolFee) {
    const pct = (result.protocolFee.protocolFeeBps / 100).toFixed(2);
    lines.splice(
      7,
      0,
      `| Protocol Fee | ${formatUsd(result.protocolFee.protocolFeeUsdCents)} (${pct}%) |`,
      `| Credit Purchase Budget | ${formatUsd(result.protocolFee.creditBudgetUsdCents)} |`
    );
  }

  if (result.creditMix) {
    lines.push(
      `| Credit Mix Policy | ${result.creditMix.policy} |`,
      `| Credit Mix Strategy | ${result.creditMix.strategy} |`
    );
  }

  if (result.regenAcquisition) {
    lines.push(
      `| REGEN Acquisition Status | ${result.regenAcquisition.status} (${result.regenAcquisition.provider}) |`,
      `| REGEN Acquisition Spend | ${formatMicroAmount(BigInt(result.regenAcquisition.spendMicro), result.regenAcquisition.spendDenom, denomExponent(result.regenAcquisition.spendDenom))} |`,
      `| Estimated REGEN | ${formatRegenMicro(result.regenAcquisition.estimatedRegenMicro)} |`
    );

    if (result.regenAcquisition.acquiredRegenMicro) {
      lines.push(
        `| Acquired REGEN | ${formatRegenMicro(result.regenAcquisition.acquiredRegenMicro)} |`
      );
    }
    if (result.regenAcquisition.txHash) {
      lines.push(
        `| REGEN Acquisition Tx | \`${result.regenAcquisition.txHash}\` |`
      );
    }
  }

  if (result.regenBurn) {
    lines.push(
      `| REGEN Burn Status | ${result.regenBurn.status} (${result.regenBurn.provider}) |`,
      `| REGEN Burn Amount | ${formatMicroAmount(BigInt(result.regenBurn.amountMicro), "REGEN", 6)} |`
    );
    if (result.regenBurn.burnAddress) {
      lines.push(`| REGEN Burn Address | \`${result.regenBurn.burnAddress}\` |`);
    }
    if (result.regenBurn.txHash) {
      lines.push(`| REGEN Burn Tx | \`${result.regenBurn.txHash}\` |`);
    }
  }

  if (result.txHash) {
    lines.push(`| Transaction Hash | \`${result.txHash}\` |`);
  }
  if (typeof result.blockHeight === "number") {
    lines.push(`| Block Height | ${result.blockHeight} |`);
  }
  if (result.retirementId) {
    lines.push(`| Retirement ID | ${result.retirementId} |`);
  }

  if (result.attributions && result.attributions.length > 0) {
    lines.push(
      "",
      "### Fractional Attribution",
      "",
      "| User ID | Share | Attributed Budget | Attributed Quantity |",
      "|---------|-------|-------------------|---------------------|",
      ...result.attributions.slice(0, 25).map((item) => {
        const share = `${(item.sharePpm / 10_000).toFixed(2)}%`;
        return `| ${item.userId} | ${share} | ${formatUsd(item.attributedBudgetUsdCents)} | ${item.attributedQuantity} |`;
      })
    );

    if (result.attributions.length > 25) {
      lines.push(
        "",
        `Showing 25 of ${result.attributions.length} attribution rows.`
      );
    }
  }

  if (result.creditMix) {
    lines.push(
      "",
      "### Credit Mix Allocation",
      "",
      "| Credit Type | Budget | Spent | Quantity | Orders |",
      "|-------------|--------|-------|----------|--------|",
      ...result.creditMix.allocations.map(
        (item) =>
          `| ${item.creditType} | ${formatMicroAmount(BigInt(item.budgetMicro), result.plannedCostDenom, denomExponent(result.plannedCostDenom))} | ${formatMicroAmount(BigInt(item.spentMicro), result.plannedCostDenom, denomExponent(result.plannedCostDenom))} | ${item.selectedQuantity} | ${item.orderCount} |`
      )
    );
  }

  lines.push("", result.message);
  if (result.regenAcquisition) {
    lines.push(`REGEN acquisition: ${result.regenAcquisition.message}`);
  }
  if (result.regenBurn) {
    lines.push(`REGEN burn: ${result.regenBurn.message}`);
  }

  return lines.join("\n");
}

function renderSyncSummary(
  syncScope: SyncScope,
  result?: SubscriptionPoolSyncResult
): string {
  if (syncScope === "none") {
    return [
      "| Field | Value |",
      "|-------|-------|",
      "| Scope | none |",
      "| Status | skipped |",
      "| Details | Contribution sync was skipped for this run. |",
    ].join("\n");
  }

  if (!result) {
    return [
      "| Field | Value |",
      "|-------|-------|",
      `| Scope | ${syncScope} |`,
      "| Status | no_data |",
    ].join("\n");
  }

  const lines: string[] = [
    "| Field | Value |",
    "|-------|-------|",
    `| Scope | ${result.scope} |`,
    `| Invoices Fetched | ${result.fetchedInvoiceCount} |`,
    `| Invoices Processed | ${result.processedInvoiceCount} |`,
    `| Synced | ${result.syncedCount} |`,
    `| Duplicates | ${result.duplicateCount} |`,
    `| Skipped (month filter) | ${result.skippedCount} |`,
  ];

  if (result.scope === "all_customers") {
    lines.push(
      `| Pages Fetched | ${typeof result.pageCount === "number" ? result.pageCount : "N/A"} |`,
      `| Max Pages | ${typeof result.maxPages === "number" ? result.maxPages : "N/A"} |`,
      `| Fetch Truncated | ${result.truncated ? "Yes" : "No"} |`
    );
  }

  if (result.records.length > 0) {
    lines.push(
      "",
      "| Invoice ID | Contribution ID | Amount | Duplicate |",
      "|------------|------------------|--------|-----------|",
      ...result.records.slice(0, 20).map(
        (record) =>
          `| ${record.invoiceId} | ${record.contributionId} | ${formatUsd(record.amountUsdCents)} | ${record.duplicated ? "Yes" : "No"} |`
      )
    );

    if (result.records.length > 20) {
      lines.push("", `Showing 20 of ${result.records.length} processed invoices.`);
    }
  }

  if (result.scope === "all_customers" && result.truncated) {
    lines.push(
      "",
      "Warning: invoice fetch stopped before Stripe pagination was exhausted. Increase `invoice_max_pages` and rerun to avoid partial reconciliation."
    );
  }

  return lines.join("\n");
}

export async function runMonthlyBatchRetirementTool(
  month: string,
  creditType?: "carbon" | "biodiversity",
  maxBudgetUsd?: number,
  dryRun?: boolean,
  force?: boolean,
  reason?: string,
  jurisdiction?: string
) {
  try {
    const result = await executor.runMonthlyBatch({
      month,
      creditType,
      maxBudgetUsd,
      dryRun,
      force,
      reason,
      jurisdiction,
      paymentDenom: "USDC",
    });

    return {
      content: [
        {
          type: "text" as const,
          text: renderMonthlyBatchResult(result),
        },
      ],
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown monthly batch error";
    return {
      content: [
        {
          type: "text" as const,
          text: `Monthly batch retirement failed: ${message}`,
        },
      ],
      isError: true,
    };
  }
}

export async function getMonthlyBatchExecutionHistoryTool(
  month?: string,
  status?: BatchExecutionStatus,
  creditType?: "carbon" | "biodiversity",
  dryRun?: boolean,
  limit?: number
) {
  try {
    const records = await executor.getExecutionHistory({
      month,
      status,
      creditType,
      dryRun,
      limit,
      newestFirst: true,
    });

    const lines: string[] = [
      "## Monthly Batch Execution History",
      "",
      "| Filter | Value |",
      "|--------|-------|",
      `| Month | ${month || "all"} |`,
      `| Status | ${status || "all"} |`,
      `| Credit Type | ${creditType || "all"} |`,
      `| Dry Run | ${typeof dryRun === "boolean" ? String(dryRun) : "all"} |`,
      `| Returned Records | ${records.length} |`,
    ];

    if (records.length === 0) {
      lines.push("", "No batch execution records matched the provided filters.");
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }

    lines.push(
      "",
      "| Executed At | ID | Month | Status | Dry Run | Credit Type | Budget | Retired Quantity | Tx Hash |",
      "|-------------|----|-------|--------|---------|-------------|--------|------------------|---------|",
      ...records.map(
        (record) =>
          `| ${record.executedAt} | ${record.id} | ${record.month} | ${record.status} | ${record.dryRun ? "Yes" : "No"} | ${record.creditType || "all"} | ${formatUsd(record.budgetUsdCents)} | ${record.retiredQuantity} | ${record.txHash ? `\`${record.txHash}\`` : "N/A"} |`
      )
    );

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown execution history error";
    return {
      content: [
        {
          type: "text" as const,
          text: `Execution history query failed: ${message}`,
        },
      ],
      isError: true,
    };
  }
}

export async function getMonthlyReconciliationStatusTool(
  month: string,
  creditType?: "carbon" | "biodiversity"
) {
  try {
    if (!MONTH_REGEX.test(month)) {
      throw new Error("month must be in YYYY-MM format");
    }

    const monthlySummary = await poolAccounting.getMonthlySummary(month);
    const config = loadConfig();
    const protocolFee = calculateProtocolFee({
      grossBudgetUsdCents: monthlySummary.totalUsdCents,
      protocolFeeBps: config.protocolFeeBps,
      paymentDenom: "USDC",
    });
    const [latestExecution, latestSuccessExecution] = await Promise.all([
      executor
        .getExecutionHistory({
          month,
          creditType,
          limit: 1,
          newestFirst: true,
        })
        .then((records) => records[0]),
      executor
        .getExecutionHistory({
          month,
          creditType,
          status: "success",
          limit: 1,
          newestFirst: true,
        })
        .then((records) => records[0]),
    ]);

    const hasContributions = monthlySummary.totalUsdCents > 0;
    const alreadySucceeded = Boolean(latestSuccessExecution);
    const readyForExecution = hasContributions && !alreadySucceeded;

    let recommendation = "Run `run_monthly_reconciliation` with `sync_scope=all_customers`.";
    if (!hasContributions) {
      recommendation =
        "No contributions found. Sync invoices first (`run_monthly_reconciliation` with sync enabled), then re-check.";
    } else if (alreadySucceeded) {
      recommendation =
        `A successful execution already exists for this month${latestSuccessExecution?.executedAt ? ` (latest success: ${latestSuccessExecution.executedAt})` : ""}. Use \`force=true\` only if rerun is intentional.`;
    } else if (latestExecution?.status === "failed") {
      recommendation =
        "Latest execution failed. Run `run_monthly_reconciliation` with `dry_run=true` first, then execute with `dry_run=false`.";
    } else if (latestExecution?.status === "dry_run") {
      recommendation =
        "Dry-run record exists. Execute with `dry_run=false` when ready.";
    }

    const lines: string[] = [
      "## Monthly Reconciliation Status",
      "",
      "| Field | Value |",
      "|-------|-------|",
      `| Month | ${month} |`,
      `| Credit Type Filter | ${creditType || "all"} |`,
      `| Contribution Count | ${monthlySummary.contributionCount} |`,
      `| Unique Contributors | ${monthlySummary.uniqueContributors} |`,
      `| Gross Pool Budget | ${formatUsd(monthlySummary.totalUsdCents)} |`,
      `| Protocol Fee | ${formatUsd(protocolFee.protocolFeeUsdCents)} (${(protocolFee.protocolFeeBps / 100).toFixed(2)}%) |`,
      `| Net Credit Budget | ${formatUsd(protocolFee.creditBudgetUsdCents)} |`,
      `| Latest Execution Status | ${latestExecution?.status || "none"} |`,
      `| Latest Execution At | ${latestExecution?.executedAt || "N/A"} |`,
      `| Any Successful Execution | ${alreadySucceeded ? "Yes" : "No"} |`,
      `| Latest Successful Execution At | ${latestSuccessExecution?.executedAt || "N/A"} |`,
      `| Latest Execution Dry Run | ${latestExecution ? (latestExecution.dryRun ? "Yes" : "No") : "N/A"} |`,
      `| Latest Tx Hash | ${latestExecution?.txHash ? `\`${latestExecution.txHash}\`` : "N/A"} |`,
      `| Latest Retirement ID | ${latestExecution?.retirementId || "N/A"} |`,
      `| Ready For Execution | ${readyForExecution ? "Yes" : "No"} |`,
      "",
      `Recommendation: ${recommendation}`,
    ];

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown reconciliation status error";
    return {
      content: [
        {
          type: "text" as const,
          text: `Monthly reconciliation status query failed: ${message}`,
        },
      ],
      isError: true,
    };
  }
}

export async function getMonthlyReconciliationRunHistoryTool(
  month?: string,
  status?: ReconciliationRunStatus,
  creditType?: "carbon" | "biodiversity",
  limit?: number
) {
  try {
    const records = await reconciliationHistory.getHistory({
      month,
      status,
      creditType,
      limit,
      newestFirst: true,
    });

    const lines: string[] = [
      "## Monthly Reconciliation Run History",
      "",
      "| Filter | Value |",
      "|--------|-------|",
      `| Month | ${month || "all"} |`,
      `| Status | ${status || "all"} |`,
      `| Credit Type | ${creditType || "all"} |`,
      `| Returned Records | ${records.length} |`,
    ];

    if (records.length === 0) {
      lines.push("", "No reconciliation runs matched the provided filters.");
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }

    lines.push(
      "",
      "| Started At | Finished At | ID | Month | Status | Batch Status | Mode | Preflight | Sync Scope | Credit Type | Sync Summary |",
      "|------------|-------------|----|-------|--------|--------------|------|-----------|------------|-------------|--------------|",
      ...records.map((record) => {
        const syncSummary = record.sync
          ? `${record.sync.syncedCount}/${record.sync.processedInvoiceCount} synced, ${record.sync.fetchedInvoiceCount} fetched${record.sync.truncated ? ", truncated" : ""}`
          : "N/A";

        return `| ${record.startedAt} | ${record.finishedAt || "N/A"} | ${record.id} | ${record.month} | ${record.status} | ${record.batchStatus} | ${record.executionMode} | ${record.preflightOnly ? "Yes" : "No"} | ${record.syncScope} | ${record.creditType || "all"} | ${syncSummary} |`;
      })
    );

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown reconciliation run history error";
    return {
      content: [
        {
          type: "text" as const,
          text: `Reconciliation run history query failed: ${message}`,
        },
      ],
      isError: true,
    };
  }
}

export async function runMonthlyReconciliationTool(
  input: RunMonthlyReconciliationInput
) {
  const syncScope = input.syncScope || "all_customers";
  const executionMode = input.dryRun === false ? "live" : "dry_run";
  const runStartInput = {
    month: input.month,
    creditType: input.creditType,
    syncScope,
    executionMode,
    preflightOnly: Boolean(input.preflightOnly),
    force: Boolean(input.force),
  } as const;
  const lockKey = reconciliationLockKey(input.month, input.creditType);
  const acquiredLock = await reconciliationRunLockService.acquire(lockKey);
  if (!acquiredLock) {
    let blockedRunId: string | undefined;
    const blockedWarnings: string[] = [];
    try {
      blockedRunId = (
        await reconciliationHistory.recordBlockedRun({
          ...runStartInput,
          batchStatus: "blocked_in_progress",
          message:
            "A reconciliation run for this month/credit type is already in progress.",
        })
      ).id;
    } catch (error) {
      blockedWarnings.push(
        `Reconciliation run history write failed: ${toErrorMessage(error, "Unknown history write error")}`
      );
    }

    const lines: string[] = [
      "## Monthly Reconciliation",
      "",
      "| Field | Value |",
      "|-------|-------|",
      `| Month | ${input.month} |`,
      `| Sync Scope | ${syncScope} |`,
      `| Credit Type | ${input.creditType || "all"} |`,
      "| Batch Status | blocked_in_progress |",
      `| Reconciliation Run ID | ${blockedRunId || "N/A"} |`,
      "",
      "A reconciliation run for this month/credit type is already in progress. Wait for it to finish, then retry.",
    ];
    appendWarningsSection(lines, blockedWarnings);
    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
      isError: true,
    };
  }

  let runId: string | undefined;
  let syncResult: SubscriptionPoolSyncResult | undefined;
  const runWarnings: string[] = [];
  const timedOutPendingOperations: Promise<unknown>[] = [];

  const trackTimedOutOperation = (pendingPromise: Promise<unknown>) => {
    timedOutPendingOperations.push(pendingPromise.catch(() => undefined));
  };
  const finishRun = async (
    finishInput: {
      status: Exclude<ReconciliationRunStatus, "in_progress">;
      batchStatus: string;
      sync?: ReconciliationRunSyncSummary;
      message?: string;
      error?: string;
    },
    context: string
  ) => {
    if (!runId) {
      return;
    }

    try {
      await reconciliationHistory.finishRun(runId, finishInput);
    } catch (error) {
      runWarnings.push(
        `${context}: ${toErrorMessage(error, "Unknown history write error")}`
      );
    }
  };

  try {
    try {
      runId = (await reconciliationHistory.startRun(runStartInput)).id;
    } catch (error) {
      runWarnings.push(
        `Reconciliation run history start failed: ${toErrorMessage(error, "Unknown history start error")}`
      );
    }

    const syncTimeoutMs = resolveTimeoutMs(
      input.syncTimeoutMs,
      "sync_timeout_ms"
    );
    const batchTimeoutMs = resolveTimeoutMs(
      input.batchTimeoutMs,
      "batch_timeout_ms"
    );

    if (syncScope === "customer") {
      syncResult = await withTimeout(
        poolSync.syncPaidInvoices({
          month: input.month,
          email: input.email,
          customerId: input.customerId,
          userId: input.userId,
          limit: input.invoiceLimit,
        }),
        syncTimeoutMs,
        "Contribution sync",
        trackTimedOutOperation
      );
    } else if (syncScope === "all_customers") {
      syncResult = await withTimeout(
        poolSync.syncPaidInvoices({
          month: input.month,
          limit: input.invoiceLimit,
          maxPages: input.invoiceMaxPages,
          allCustomers: true,
        }),
        syncTimeoutMs,
        "Contribution sync",
        trackTimedOutOperation
      );
    }

    if (
      syncScope === "all_customers" &&
      syncResult?.truncated &&
      !input.allowPartialSync
    ) {
      await finishRun(
        {
          status: "blocked",
          batchStatus: "blocked_partial_sync",
          sync: toReconciliationSyncSummary(syncScope, syncResult),
          message: "All-customer invoice sync was truncated by invoice_max_pages.",
        },
        "Reconciliation run history finalize failed"
      );

      const lines: string[] = [
        "## Monthly Reconciliation",
        "",
        "| Field | Value |",
        "|-------|-------|",
        `| Month | ${input.month} |`,
        `| Sync Scope | ${syncScope} |`,
        "| Batch Status | blocked_partial_sync |",
        `| Reconciliation Run ID | ${runId || "N/A"} |`,
        "",
        "### Contribution Sync",
        "",
        renderSyncSummary(syncScope, syncResult),
        "",
        "Batch execution was skipped because all-customer invoice sync was truncated by `invoice_max_pages` and may be incomplete.",
        "Increase `invoice_max_pages` and rerun, or set `allow_partial_sync=true` to override (not recommended).",
      ];
      appendWarningsSection(lines, runWarnings);

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        isError: true,
      };
    }

    if (input.dryRun === false && !input.allowExecuteWithoutDryRun) {
      const [latestExecution, monthSummary] = await Promise.all([
        executor
          .getExecutionHistory({
            month: input.month,
            creditType: input.creditType,
            limit: 1,
            newestFirst: true,
          })
          .then((records) => records[0]),
        poolAccounting.getMonthlySummary(input.month),
      ]);

      if (latestExecution?.status !== "dry_run") {
        await finishRun(
          {
            status: "blocked",
            batchStatus: "blocked_preflight",
            sync: toReconciliationSyncSummary(syncScope, syncResult),
            message:
              "Latest execution is not dry_run, so live execution preflight was blocked.",
          },
          "Reconciliation run history finalize failed"
        );

        const lines: string[] = [
          "## Monthly Reconciliation",
          "",
          "| Field | Value |",
          "|-------|-------|",
          `| Month | ${input.month} |`,
          `| Sync Scope | ${syncScope} |`,
          "| Batch Status | blocked_preflight |",
          `| Reconciliation Run ID | ${runId || "N/A"} |`,
          "",
          "### Contribution Sync",
          "",
          renderSyncSummary(syncScope, syncResult),
          "",
          `Live execution was blocked because the latest execution state is \`${latestExecution?.status || "none"}\`, not \`dry_run\`.`,
          "Run with `dry_run=true` first, then re-run with `dry_run=false`, or set `allow_execute_without_dry_run=true` to override.",
        ];
        appendWarningsSection(lines, runWarnings);

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          isError: true,
        };
      }

      if (
        monthSummary.lastContributionAt &&
        latestExecution.executedAt.localeCompare(monthSummary.lastContributionAt) < 0
      ) {
        await finishRun(
          {
            status: "blocked",
            batchStatus: "blocked_preflight_stale_dry_run",
            sync: toReconciliationSyncSummary(syncScope, syncResult),
            message: "Latest dry_run record is older than latest contribution.",
          },
          "Reconciliation run history finalize failed"
        );

        const lines: string[] = [
          "## Monthly Reconciliation",
          "",
          "| Field | Value |",
          "|-------|-------|",
          `| Month | ${input.month} |`,
          `| Sync Scope | ${syncScope} |`,
          "| Batch Status | blocked_preflight_stale_dry_run |",
          `| Reconciliation Run ID | ${runId || "N/A"} |`,
          "",
          "### Contribution Sync",
          "",
          renderSyncSummary(syncScope, syncResult),
          "",
          `Live execution was blocked because the latest \`dry_run\` (${latestExecution.executedAt}) is older than the latest contribution (${monthSummary.lastContributionAt}).`,
          "Run a fresh `dry_run=true` and then re-run live execution, or set `allow_execute_without_dry_run=true` to override.",
        ];
        appendWarningsSection(lines, runWarnings);

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          isError: true,
        };
      }
    }

    if (input.preflightOnly) {
      await finishRun(
        {
          status: "completed",
          batchStatus: "preflight_ok",
          sync: toReconciliationSyncSummary(syncScope, syncResult),
          message: "Preflight-only mode completed successfully.",
        },
        "Reconciliation run history finalize failed"
      );

      const lines: string[] = [
        "## Monthly Reconciliation",
        "",
        "| Field | Value |",
        "|-------|-------|",
        `| Month | ${input.month} |`,
        `| Sync Scope | ${syncScope} |`,
        `| Intended Execution Mode | ${input.dryRun === false ? "live" : "dry_run"} |`,
        "| Batch Status | preflight_ok |",
        `| Reconciliation Run ID | ${runId || "N/A"} |`,
        "",
        "### Contribution Sync",
        "",
        renderSyncSummary(syncScope, syncResult),
        "",
        "Preflight checks passed. No batch execution was performed because `preflight_only=true`.",
      ];
      appendWarningsSection(lines, runWarnings);

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }

    const batchResult = await withTimeout(
      executor.runMonthlyBatch({
        month: input.month,
        creditType: input.creditType,
        maxBudgetUsd: input.maxBudgetUsd,
        dryRun: input.dryRun,
        force: input.force,
        reason: input.reason,
        jurisdiction: input.jurisdiction,
        paymentDenom: "USDC",
      }),
      batchTimeoutMs,
      "Monthly batch execution",
      trackTimedOutOperation
    );

    const finalStatus: Exclude<ReconciliationRunStatus, "in_progress"> =
      batchResult.status === "failed" ? "failed" : "completed";
    await finishRun(
      {
        status: finalStatus,
        batchStatus: batchResult.status,
        sync: toReconciliationSyncSummary(syncScope, syncResult),
        message: batchResult.message,
        error: batchResult.status === "failed" ? batchResult.message : undefined,
      },
      "Reconciliation run history finalize failed"
    );

    const lines: string[] = [
      "## Monthly Reconciliation",
      "",
      "| Field | Value |",
      "|-------|-------|",
      `| Month | ${input.month} |`,
      `| Sync Scope | ${syncScope} |`,
      `| Batch Status | ${batchResult.status} |`,
      `| Reconciliation Run ID | ${runId || "N/A"} |`,
      "",
      "### Contribution Sync",
      "",
      renderSyncSummary(syncScope, syncResult),
      "",
      "### Batch Retirement",
      "",
      renderMonthlyBatchResult(batchResult, "Monthly Batch Retirement"),
    ];
    appendWarningsSection(lines, runWarnings);

    return {
      content: [{ type: "text" as const, text: lines.join("\n") }],
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown reconciliation error";

    await finishRun(
      {
        status: "failed",
        batchStatus: "error",
        sync: toReconciliationSyncSummary(syncScope, syncResult),
        message,
        error: message,
      },
      "Reconciliation run history finalize failed"
    );

    const lines: string[] = [`Monthly reconciliation failed: ${message}`];
    appendWarningsSection(lines, runWarnings);

    return {
      content: [
        {
          type: "text" as const,
          text: lines.join("\n"),
        },
      ],
      isError: true,
    };
  } finally {
    const releaseLock = async () => {
      try {
        await acquiredLock.release();
      } catch {
        // lock release best-effort; stale TTL recovery still prevents deadlock
      }
    };

    if (timedOutPendingOperations.length > 0) {
      void Promise.allSettled(timedOutPendingOperations).then(() =>
        releaseLock()
      );
    } else {
      await releaseLock();
    }
  }
}
