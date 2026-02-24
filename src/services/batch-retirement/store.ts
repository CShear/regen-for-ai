import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
  BatchExecutionState,
  BatchExecutionStore,
} from "./types.js";

const DEFAULT_RELATIVE_EXECUTIONS_PATH = "data/monthly-batch-executions.json";
const DEFAULT_LOCK_WAIT_MS = 10_000;
const DEFAULT_LOCK_RETRY_MS = 25;
const DEFAULT_LOCK_STALE_MS = 60_000;

function getDefaultState(): BatchExecutionState {
  return { version: 1, executions: [] };
}

function isValidState(value: unknown): value is BatchExecutionState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BatchExecutionState>;
  return candidate.version === 1 && Array.isArray(candidate.executions);
}

export function getDefaultBatchExecutionsPath(): string {
  const configured = process.env.REGEN_BATCH_EXECUTIONS_PATH?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.resolve(process.cwd(), DEFAULT_RELATIVE_EXECUTIONS_PATH);
}

function resolvePositiveInteger(envName: string, fallback: number): number {
  const raw = process.env[envName]?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class JsonFileBatchExecutionStore implements BatchExecutionStore {
  constructor(
    private readonly filePath: string = getDefaultBatchExecutionsPath(),
    private readonly lockWaitMs: number = resolvePositiveInteger(
      "REGEN_BATCH_EXECUTIONS_LOCK_WAIT_MS",
      DEFAULT_LOCK_WAIT_MS
    ),
    private readonly lockRetryMs: number = resolvePositiveInteger(
      "REGEN_BATCH_EXECUTIONS_LOCK_RETRY_MS",
      DEFAULT_LOCK_RETRY_MS
    ),
    private readonly lockStaleMs: number = resolvePositiveInteger(
      "REGEN_BATCH_EXECUTIONS_LOCK_STALE_MS",
      DEFAULT_LOCK_STALE_MS
    )
  ) {}

  private lockFilePath(): string {
    return `${this.filePath}.lock`;
  }

  private async tryClearStaleLock(): Promise<boolean> {
    const lockPath = this.lockFilePath();

    try {
      const lockStat = await stat(lockPath);
      if (Date.now() - lockStat.mtimeMs < this.lockStaleMs) {
        return false;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return true;
      }
      return false;
    }

    try {
      await unlink(lockPath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return true;
      }
      return false;
    }
  }

  private async acquireLock(): Promise<void> {
    const lockPath = this.lockFilePath();
    const dir = path.dirname(this.filePath);
    await mkdir(dir, { recursive: true });
    const startedAt = Date.now();

    while (true) {
      try {
        const handle = await open(lockPath, "wx");
        try {
          await handle.writeFile(
            JSON.stringify(
              { pid: process.pid, acquiredAt: new Date().toISOString() },
              null,
              2
            ),
            "utf8"
          );
        } finally {
          await handle.close();
        }
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") {
          throw error;
        }
      }

      if (await this.tryClearStaleLock()) {
        continue;
      }

      if (Date.now() - startedAt >= this.lockWaitMs) {
        throw new Error(
          `Timed out acquiring batch execution store lock after ${this.lockWaitMs}ms`
        );
      }

      await wait(this.lockRetryMs);
    }
  }

  private async releaseLock(): Promise<void> {
    try {
      await unlink(this.lockFilePath());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  async readState(): Promise<BatchExecutionState> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!isValidState(parsed)) {
        throw new Error("Invalid monthly batch executions file format");
      }
      return parsed;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return getDefaultState();
      }
      throw err;
    }
  }

  async writeState(state: BatchExecutionState): Promise<void> {
    const dir = path.dirname(this.filePath);
    await mkdir(dir, { recursive: true });

    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, JSON.stringify(state, null, 2), "utf8");
    await rename(tempPath, this.filePath);
  }

  async withExclusiveState<T>(
    updater: (state: BatchExecutionState) => T | Promise<T>
  ): Promise<T> {
    await this.acquireLock();

    try {
      const state = await this.readState();
      const result = await updater(state);
      await this.writeState(state);
      return result;
    } finally {
      await this.releaseLock();
    }
  }
}
