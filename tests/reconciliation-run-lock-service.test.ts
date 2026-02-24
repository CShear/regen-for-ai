import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getReconciliationLockFilePath,
  ReconciliationRunLockService,
} from "../src/services/reconciliation-run-lock/service.js";

const tempDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "reconciliation-lock-"));
  tempDirectories.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((dir) =>
      rm(dir, { recursive: true, force: true })
    )
  );
});

describe("ReconciliationRunLockService", () => {
  it("acquires, blocks concurrent acquire, and releases cleanly", async () => {
    const dir = await createTempDirectory();
    const service = new ReconciliationRunLockService({
      lockDirectory: dir,
      lockTtlMs: 60_000,
    });

    const first = await service.acquire("2026-03:all");
    const second = await service.acquire("2026-03:all");

    expect(first).not.toBeNull();
    expect(second).toBeNull();

    await first?.release();

    const third = await service.acquire("2026-03:all");
    expect(third).not.toBeNull();
    await third?.release();
  });

  it("reclaims stale lock files and prevents stale handles from releasing new locks", async () => {
    const dir = await createTempDirectory();
    const service = new ReconciliationRunLockService({
      lockDirectory: dir,
      lockTtlMs: 1_000,
    });
    const lockKey = "2026-03:carbon";

    const first = await service.acquire(lockKey);
    expect(first).not.toBeNull();

    const lockPath = getReconciliationLockFilePath(dir, lockKey);
    await writeFile(
      lockPath,
      JSON.stringify(
        {
          lockKey,
          token: "expired-token",
          pid: 123,
          acquiredAt: "2000-01-01T00:00:00.000Z",
          expiresAt: "2000-01-01T00:00:01.000Z",
        },
        null,
        2
      ),
      "utf8"
    );

    const second = await service.acquire(lockKey);
    expect(second).not.toBeNull();

    await first?.release();

    const blocked = await service.acquire(lockKey);
    expect(blocked).toBeNull();

    await second?.release();
  });
});
