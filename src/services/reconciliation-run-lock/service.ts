import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";

const DEFAULT_RELATIVE_RECONCILIATION_LOCK_DIR =
  "data/monthly-reconciliation-locks";
const DEFAULT_RECONCILIATION_LOCK_TTL_MS = 30 * 60 * 1000;

interface ReconciliationLockMetadata {
  lockKey: string;
  token: string;
  acquiredAt: string;
  expiresAt: string;
  pid: number;
}

export interface ReconciliationRunLock {
  key: string;
  token: string;
  release(): Promise<void>;
}

export interface ReconciliationRunLockServiceOptions {
  lockDirectory?: string;
  lockTtlMs?: number;
}

export function getDefaultReconciliationLockDirectory(): string {
  const configured = process.env.REGEN_RECONCILIATION_LOCKS_DIR?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  return path.resolve(process.cwd(), DEFAULT_RELATIVE_RECONCILIATION_LOCK_DIR);
}

export function getDefaultReconciliationLockTtlMs(): number {
  const configured = process.env.REGEN_RECONCILIATION_LOCK_TTL_MS?.trim();
  if (!configured) {
    return DEFAULT_RECONCILIATION_LOCK_TTL_MS;
  }

  const parsed = Number.parseInt(configured, 10);
  if (!Number.isInteger(parsed) || parsed < 1000) {
    return DEFAULT_RECONCILIATION_LOCK_TTL_MS;
  }

  return parsed;
}

function lockFileNameForKey(lockKey: string): string {
  const digest = createHash("sha256").update(lockKey).digest("hex");
  return `${digest}.lock`;
}

export function getReconciliationLockFilePath(
  lockDirectory: string,
  lockKey: string
): string {
  return path.resolve(lockDirectory, lockFileNameForKey(lockKey));
}

function isMetadata(value: unknown): value is ReconciliationLockMetadata {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ReconciliationLockMetadata>;
  return (
    typeof candidate.lockKey === "string" &&
    typeof candidate.token === "string" &&
    typeof candidate.acquiredAt === "string" &&
    typeof candidate.expiresAt === "string" &&
    typeof candidate.pid === "number"
  );
}

export class ReconciliationRunLockService {
  private readonly lockDirectory: string;
  private readonly lockTtlMs: number;

  constructor(options: ReconciliationRunLockServiceOptions = {}) {
    this.lockDirectory =
      options.lockDirectory || getDefaultReconciliationLockDirectory();
    this.lockTtlMs = options.lockTtlMs || getDefaultReconciliationLockTtlMs();
  }

  private async readMetadata(
    lockPath: string
  ): Promise<ReconciliationLockMetadata | undefined> {
    try {
      const raw = await readFile(lockPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!isMetadata(parsed)) {
        return undefined;
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      return undefined;
    }
  }

  private isExpired(metadata: ReconciliationLockMetadata, nowMs: number): boolean {
    const expiresAtMs = Date.parse(metadata.expiresAt);
    if (Number.isFinite(expiresAtMs)) {
      return expiresAtMs <= nowMs;
    }

    const acquiredAtMs = Date.parse(metadata.acquiredAt);
    if (!Number.isFinite(acquiredAtMs)) {
      return true;
    }

    return acquiredAtMs + this.lockTtlMs <= nowMs;
  }

  private async clearLockFile(lockPath: string): Promise<void> {
    try {
      await unlink(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  private async tryWriteLock(
    lockPath: string,
    metadata: ReconciliationLockMetadata
  ): Promise<boolean> {
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(JSON.stringify(metadata, null, 2), "utf8");
      } finally {
        await handle.close();
      }
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return false;
      }
      throw error;
    }
  }

  private async release(lockPath: string, token: string): Promise<void> {
    const metadata = await this.readMetadata(lockPath);
    if (!metadata || metadata.token !== token) {
      return;
    }

    await this.clearLockFile(lockPath);
  }

  async acquire(lockKey: string): Promise<ReconciliationRunLock | null> {
    await mkdir(this.lockDirectory, { recursive: true });
    const lockPath = getReconciliationLockFilePath(this.lockDirectory, lockKey);

    for (let attempts = 0; attempts < 2; attempts += 1) {
      const token = randomUUID();
      const now = Date.now();
      const metadata: ReconciliationLockMetadata = {
        lockKey,
        token,
        pid: process.pid,
        acquiredAt: new Date(now).toISOString(),
        expiresAt: new Date(now + this.lockTtlMs).toISOString(),
      };

      const acquired = await this.tryWriteLock(lockPath, metadata);
      if (acquired) {
        let released = false;
        return {
          key: lockKey,
          token,
          release: async () => {
            if (released) {
              return;
            }
            released = true;
            await this.release(lockPath, token);
          },
        };
      }

      const existing = await this.readMetadata(lockPath);
      if (existing && !this.isExpired(existing, Date.now())) {
        return null;
      }

      await this.clearLockFile(lockPath);
    }

    return null;
  }
}
