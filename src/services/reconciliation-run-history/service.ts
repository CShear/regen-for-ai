import { randomUUID } from "node:crypto";
import { JsonFileReconciliationRunStore } from "./store.js";
import type {
  FinishReconciliationRunInput,
  ReconciliationRunHistoryQuery,
  ReconciliationRunRecord,
  ReconciliationRunStore,
  RecordBlockedReconciliationRunInput,
  StartReconciliationRunInput,
} from "./types.js";

const MONTH_REGEX = /^\d{4}-\d{2}$/;

function sortByStartedAtAsc(records: ReconciliationRunRecord[]): void {
  records.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

function normalizeLimit(value?: number): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.min(200, Math.max(1, value))
    : 50;
}

export class ReconciliationRunHistoryService {
  constructor(
    private readonly store: ReconciliationRunStore = new JsonFileReconciliationRunStore()
  ) {}

  private async mutateState<T>(
    updater: (state: { version: 1; runs: ReconciliationRunRecord[] }) => T | Promise<T>
  ): Promise<T> {
    if (this.store.withExclusiveState) {
      return this.store.withExclusiveState(updater);
    }

    const state = await this.store.readState();
    const result = await updater(state);
    await this.store.writeState(state);
    return result;
  }

  async startRun(
    input: StartReconciliationRunInput
  ): Promise<ReconciliationRunRecord> {
    if (!MONTH_REGEX.test(input.month)) {
      throw new Error("month must be in YYYY-MM format");
    }

    return this.mutateState((state) => {
      const record: ReconciliationRunRecord = {
        id: `reconcile_${randomUUID()}`,
        month: input.month,
        creditType: input.creditType,
        syncScope: input.syncScope,
        executionMode: input.executionMode,
        preflightOnly: input.preflightOnly,
        force: input.force,
        status: "in_progress",
        batchStatus: "in_progress",
        startedAt: new Date().toISOString(),
      };

      state.runs.push(record);
      sortByStartedAtAsc(state.runs);
      return record;
    });
  }

  async finishRun(
    runId: string,
    input: FinishReconciliationRunInput
  ): Promise<ReconciliationRunRecord> {
    return this.mutateState((state) => {
      const record = state.runs.find((item) => item.id === runId);
      if (!record) {
        throw new Error(`Unknown reconciliation run id: ${runId}`);
      }

      record.status = input.status;
      record.batchStatus = input.batchStatus;
      record.sync = input.sync;
      record.message = input.message;
      record.error = input.error;
      record.finishedAt = new Date().toISOString();

      sortByStartedAtAsc(state.runs);
      return record;
    });
  }

  async recordBlockedRun(
    input: RecordBlockedReconciliationRunInput
  ): Promise<ReconciliationRunRecord> {
    if (!MONTH_REGEX.test(input.month)) {
      throw new Error("month must be in YYYY-MM format");
    }

    return this.mutateState((state) => {
      const now = new Date().toISOString();
      const record: ReconciliationRunRecord = {
        id: `reconcile_${randomUUID()}`,
        month: input.month,
        creditType: input.creditType,
        syncScope: input.syncScope,
        executionMode: input.executionMode,
        preflightOnly: input.preflightOnly,
        force: input.force,
        status: "blocked",
        batchStatus: input.batchStatus,
        sync: input.sync,
        message: input.message,
        startedAt: now,
        finishedAt: now,
      };

      state.runs.push(record);
      sortByStartedAtAsc(state.runs);
      return record;
    });
  }

  async getHistory(
    query: ReconciliationRunHistoryQuery = {}
  ): Promise<ReconciliationRunRecord[]> {
    if (query.month && !MONTH_REGEX.test(query.month)) {
      throw new Error("month must be in YYYY-MM format");
    }

    const state = await this.store.readState();
    const filtered = state.runs.filter((item) => {
      if (query.month && item.month !== query.month) return false;
      if (query.status && item.status !== query.status) return false;
      if (query.creditType && item.creditType !== query.creditType) return false;
      return true;
    });

    const newestFirst = query.newestFirst !== false;
    filtered.sort((a, b) =>
      newestFirst
        ? b.startedAt.localeCompare(a.startedAt)
        : a.startedAt.localeCompare(b.startedAt)
    );

    return filtered.slice(0, normalizeLimit(query.limit));
  }
}
