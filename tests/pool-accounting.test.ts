import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { JsonFilePoolAccountingStore } from "../src/services/pool-accounting/store.js";
import { PoolAccountingService } from "../src/services/pool-accounting/service.js";
import type { PoolAccountingState, PoolAccountingStore } from "../src/services/pool-accounting/types.js";

class InMemoryPoolAccountingStore implements PoolAccountingStore {
  private state: PoolAccountingState = { version: 1, contributions: [] };

  async readState(): Promise<PoolAccountingState> {
    return JSON.parse(JSON.stringify(this.state)) as PoolAccountingState;
  }

  async writeState(state: PoolAccountingState): Promise<void> {
    this.state = JSON.parse(JSON.stringify(state)) as PoolAccountingState;
  }
}

describe("PoolAccountingService", () => {
  let service: PoolAccountingService;

  beforeEach(() => {
    service = new PoolAccountingService(new InMemoryPoolAccountingStore());
  });

  it("records per-user contributions and maps tier amount defaults", async () => {
    const receipt = await service.recordContribution({
      email: "ALICE@example.com",
      tierId: "growth",
      contributedAt: "2026-02-10T12:00:00.000Z",
    });

    expect(receipt.record.userId).toBe("email:alice@example.com");
    expect(receipt.record.amountUsdCents).toBe(300);
    expect(receipt.record.month).toBe("2026-02");
    expect(receipt.userSummary).toMatchObject({
      userId: "email:alice@example.com",
      email: "alice@example.com",
      contributionCount: 1,
      totalUsdCents: 300,
      totalUsd: 3,
    });
    expect(receipt.monthSummary).toMatchObject({
      month: "2026-02",
      contributionCount: 1,
      uniqueContributors: 1,
      totalUsdCents: 300,
      totalUsd: 3,
    });
  });

  it("aggregates contributions per month across multiple users", async () => {
    await service.recordContribution({
      userId: "user-a",
      amountUsd: 1,
      contributedAt: "2026-03-01T00:00:00.000Z",
    });
    await service.recordContribution({
      userId: "user-a",
      amountUsd: 0.5,
      contributedAt: "2026-03-05T00:00:00.000Z",
    });
    await service.recordContribution({
      userId: "user-b",
      amountUsdCents: 300,
      contributedAt: "2026-03-06T00:00:00.000Z",
    });
    await service.recordContribution({
      userId: "user-b",
      amountUsdCents: 100,
      contributedAt: "2026-04-01T00:00:00.000Z",
    });

    const march = await service.getMonthlySummary("2026-03");
    expect(march).toMatchObject({
      month: "2026-03",
      contributionCount: 3,
      uniqueContributors: 2,
      totalUsdCents: 450,
      totalUsd: 4.5,
    });
    expect(march.contributors[0]).toMatchObject({
      userId: "user-b",
      contributionCount: 1,
      totalUsdCents: 300,
      totalUsd: 3,
    });
    expect(march.contributors[1]).toMatchObject({
      userId: "user-a",
      contributionCount: 2,
      totalUsdCents: 150,
      totalUsd: 1.5,
    });
  });

  it("returns user summary by customer lookup", async () => {
    await service.recordContribution({
      customerId: "cus_123",
      email: "alice@example.com",
      amountUsdCents: 100,
      contributedAt: "2026-03-01T00:00:00.000Z",
    });
    await service.recordContribution({
      customerId: "cus_123",
      email: "alice@example.com",
      amountUsdCents: 500,
      contributedAt: "2026-04-01T00:00:00.000Z",
    });

    const summary = await service.getUserSummary({ customerId: "cus_123" });
    expect(summary).toMatchObject({
      userId: "customer:cus_123",
      customerId: "cus_123",
      contributionCount: 2,
      totalUsdCents: 600,
      totalUsd: 6,
    });
    expect(summary?.byMonth).toHaveLength(2);
  });

  it("persists records via the JSON file store", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "pool-accounting-"));
    const ledgerPath = path.join(tempDir, "ledger.json");

    const first = new PoolAccountingService(
      new JsonFilePoolAccountingStore(ledgerPath)
    );
    await first.recordContribution({
      userId: "user-persisted",
      amountUsdCents: 200,
      contributedAt: "2026-02-01T00:00:00.000Z",
    });

    const second = new PoolAccountingService(
      new JsonFilePoolAccountingStore(ledgerPath)
    );
    const summary = await second.getUserSummary({ userId: "user-persisted" });

    expect(summary).toMatchObject({
      userId: "user-persisted",
      contributionCount: 1,
      totalUsdCents: 200,
      totalUsd: 2,
    });
  });

  it("lists available months in descending order", async () => {
    await service.recordContribution({
      userId: "user-a",
      amountUsdCents: 100,
      contributedAt: "2026-01-15T00:00:00.000Z",
    });
    await service.recordContribution({
      userId: "user-a",
      amountUsdCents: 100,
      contributedAt: "2026-03-15T00:00:00.000Z",
    });
    await service.recordContribution({
      userId: "user-a",
      amountUsdCents: 100,
      contributedAt: "2026-02-15T00:00:00.000Z",
    });

    const months = await service.listAvailableMonths();
    expect(months).toEqual(["2026-03", "2026-02", "2026-01"]);
  });

  it("deduplicates records when externalEventId is reused", async () => {
    const first = await service.recordContribution({
      customerId: "cus_123",
      amountUsdCents: 300,
      contributedAt: "2026-03-10T00:00:00.000Z",
      externalEventId: "stripe_invoice:in_123",
      source: "subscription",
    });

    const second = await service.recordContribution({
      customerId: "cus_123",
      amountUsdCents: 300,
      contributedAt: "2026-03-10T00:00:00.000Z",
      externalEventId: "stripe_invoice:in_123",
      source: "subscription",
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.record.id).toBe(first.record.id);

    const march = await service.getMonthlySummary("2026-03");
    expect(march.contributionCount).toBe(1);
    expect(march.totalUsdCents).toBe(300);
  });

  it("deduplicates concurrent records when externalEventId collides", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "pool-accounting-concurrent-"));
    const ledgerPath = path.join(tempDir, "ledger.json");
    const concurrentService = new PoolAccountingService(
      new JsonFilePoolAccountingStore(ledgerPath)
    );

    const receipts = await Promise.all(
      Array.from({ length: 10 }, () =>
        concurrentService.recordContribution({
          customerId: "cus_concurrent",
          amountUsdCents: 300,
          contributedAt: "2026-03-10T00:00:00.000Z",
          externalEventId: "stripe_invoice:in_concurrent",
          source: "subscription",
        })
      )
    );

    expect(receipts.filter((item) => item.duplicate)).toHaveLength(9);
    expect(new Set(receipts.map((item) => item.record.id)).size).toBe(1);

    const march = await concurrentService.getMonthlySummary("2026-03");
    expect(march.contributionCount).toBe(1);
    expect(march.totalUsdCents).toBe(300);
  });
});
