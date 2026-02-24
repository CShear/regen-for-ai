export type ReconciliationRunStatus =
  | "in_progress"
  | "completed"
  | "blocked"
  | "failed";

export type ReconciliationExecutionMode = "dry_run" | "live";

export interface ReconciliationRunSyncSummary {
  scope: "none" | "customer" | "all_customers";
  fetchedInvoiceCount: number;
  processedInvoiceCount: number;
  syncedCount: number;
  duplicateCount: number;
  skippedCount: number;
  truncated?: boolean;
  hasMore?: boolean;
  pageCount?: number;
  maxPages?: number;
}

export interface ReconciliationRunRecord {
  id: string;
  month: string;
  creditType?: "carbon" | "biodiversity";
  syncScope: "none" | "customer" | "all_customers";
  executionMode: ReconciliationExecutionMode;
  preflightOnly: boolean;
  force: boolean;
  status: ReconciliationRunStatus;
  batchStatus: string;
  sync?: ReconciliationRunSyncSummary;
  message?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface ReconciliationRunState {
  version: 1;
  runs: ReconciliationRunRecord[];
}

export interface ReconciliationRunStore {
  readState(): Promise<ReconciliationRunState>;
  writeState(state: ReconciliationRunState): Promise<void>;
  withExclusiveState?<T>(
    updater: (state: ReconciliationRunState) => T | Promise<T>
  ): Promise<T>;
}

export interface StartReconciliationRunInput {
  month: string;
  creditType?: "carbon" | "biodiversity";
  syncScope: "none" | "customer" | "all_customers";
  executionMode: ReconciliationExecutionMode;
  preflightOnly: boolean;
  force: boolean;
}

export interface FinishReconciliationRunInput {
  status: Exclude<ReconciliationRunStatus, "in_progress">;
  batchStatus: string;
  sync?: ReconciliationRunSyncSummary;
  message?: string;
  error?: string;
}

export interface RecordBlockedReconciliationRunInput
  extends StartReconciliationRunInput {
  batchStatus: string;
  sync?: ReconciliationRunSyncSummary;
  message?: string;
}

export interface ReconciliationRunHistoryQuery {
  month?: string;
  status?: ReconciliationRunStatus;
  creditType?: "carbon" | "biodiversity";
  limit?: number;
  newestFirst?: boolean;
}
