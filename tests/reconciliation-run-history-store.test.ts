import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonFileReconciliationRunStore } from "../src/services/reconciliation-run-history/store.js";
import type { ReconciliationRunRecord } from "../src/services/reconciliation-run-history/types.js";

const tempDirectories: string[] = [];

async function createStore() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "reconciliation-runs-store-"));
  tempDirectories.push(dir);
  return new JsonFileReconciliationRunStore(
    path.join(dir, "monthly-reconciliation-runs.json"),
    5_000,
    5,
    30_000
  );
}

function buildRecord(index: number): ReconciliationRunRecord {
  const startedAt = `2026-03-01T00:00:${String(index).padStart(2, "0")}.000Z`;
  return {
    id: `reconcile_${index}`,
    month: "2026-03",
    syncScope: "all_customers",
    executionMode: "dry_run",
    preflightOnly: false,
    force: false,
    status: "completed",
    batchStatus: "dry_run",
    startedAt,
    finishedAt: startedAt,
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((dir) =>
      rm(dir, { recursive: true, force: true })
    )
  );
});

describe("JsonFileReconciliationRunStore", () => {
  it("serializes concurrent withExclusiveState writes without dropping records", async () => {
    const store = await createStore();
    const records = Array.from({ length: 20 }, (_, index) =>
      buildRecord(index + 1)
    );

    await Promise.all(
      records.map((record) =>
        store.withExclusiveState!(async (state) => {
          await new Promise((resolve) => setTimeout(resolve, 2));
          state.runs.push(record);
        })
      )
    );

    const state = await store.readState();
    expect(state.runs).toHaveLength(20);
    expect(new Set(state.runs.map((item) => item.id)).size).toBe(20);
  });
});
