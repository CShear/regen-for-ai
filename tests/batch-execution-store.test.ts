import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonFileBatchExecutionStore } from "../src/services/batch-retirement/store.js";
import type { BatchExecutionRecord } from "../src/services/batch-retirement/types.js";

const tempDirectories: string[] = [];

async function createStore() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "batch-execution-store-"));
  tempDirectories.push(dir);
  return new JsonFileBatchExecutionStore(
    path.join(dir, "monthly-batch-executions.json"),
    5_000,
    5,
    30_000
  );
}

function buildRecord(index: number): BatchExecutionRecord {
  return {
    id: `batch_${index}`,
    month: "2026-03",
    dryRun: true,
    status: "dry_run",
    reason: "test",
    budgetUsdCents: 100,
    spentMicro: "1000000",
    spentDenom: "USDC",
    retiredQuantity: "0.500000",
    executedAt: `2026-03-01T00:00:${String(index).padStart(2, "0")}.000Z`,
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((dir) =>
      rm(dir, { recursive: true, force: true })
    )
  );
});

describe("JsonFileBatchExecutionStore", () => {
  it("serializes concurrent withExclusiveState writes without dropping records", async () => {
    const store = await createStore();
    const records = Array.from({ length: 20 }, (_, index) =>
      buildRecord(index + 1)
    );

    await Promise.all(
      records.map((record) =>
        store.withExclusiveState!(async (state) => {
          await new Promise((resolve) => setTimeout(resolve, 2));
          state.executions.push(record);
        })
      )
    );

    const state = await store.readState();
    expect(state.executions).toHaveLength(20);
    expect(new Set(state.executions.map((item) => item.id)).size).toBe(20);
  });
});
