import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonFilePoolAccountingStore } from "../src/services/pool-accounting/store.js";
import type { ContributionRecord } from "../src/services/pool-accounting/types.js";

const tempDirectories: string[] = [];

async function createStore() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pool-accounting-store-"));
  tempDirectories.push(dir);
  return new JsonFilePoolAccountingStore(
    path.join(dir, "pool-accounting-ledger.json"),
    5_000,
    5,
    30_000
  );
}

function buildRecord(index: number): ContributionRecord {
  const contributedAt = `2026-03-01T00:00:${String(index).padStart(2, "0")}.000Z`;
  return {
    id: `contrib_${index}`,
    userId: "user-a",
    amountUsdCents: 100,
    contributedAt,
    month: "2026-03",
    source: "subscription",
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((dir) =>
      rm(dir, { recursive: true, force: true })
    )
  );
});

describe("JsonFilePoolAccountingStore", () => {
  it("serializes concurrent withExclusiveState writes without dropping records", async () => {
    const store = await createStore();
    const records = Array.from({ length: 20 }, (_, index) =>
      buildRecord(index + 1)
    );

    await Promise.all(
      records.map((record) =>
        store.withExclusiveState!(async (state) => {
          await new Promise((resolve) => setTimeout(resolve, 2));
          state.contributions.push(record);
        })
      )
    );

    const state = await store.readState();
    expect(state.contributions).toHaveLength(20);
    expect(new Set(state.contributions.map((item) => item.id)).size).toBe(20);
  });
});
