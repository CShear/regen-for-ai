import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";

// Mock wallet — must be before pool.ts import
vi.mock("../services/wallet.js", () => ({
  initWallet: vi.fn(async () => ({ address: "regen1testaddr", client: {} })),
  signAndBroadcast: vi.fn(async () => ({
    code: 0,
    transactionHash: "AABB1122",
    height: 12345,
    rawLog: "",
  })),
}));

// Mock config
vi.mock("../config.js", () => ({
  loadConfig: vi.fn(() => ({
    defaultJurisdiction: "US",
    walletMnemonic: "test mnemonic",
    rpcUrl: "http://localhost:26657",
  })),
  isWalletConfigured: vi.fn(() => true),
}));

// Mock order-selector
vi.mock("../services/order-selector.js", () => ({
  selectBestOrders: vi.fn(async (_creditType: unknown, quantity: number, _denom: unknown, _abbrevs: unknown) => ({
    orders: [
      {
        sellOrderId: "1",
        batchDenom: "C01-001",
        quantity: String(Math.min(quantity, 10)),
        askAmount: "1000000",
        askDenom: "uregen",
        costMicro: BigInt(Math.ceil(Math.min(quantity, 10) * 1000000)),
      },
    ],
    totalQuantity: String(Math.min(quantity, 10).toFixed(6)),
    totalCostMicro: BigInt(Math.ceil(Math.min(quantity, 10) * 1000000)),
    paymentDenom: "uregen",
    displayDenom: "REGEN",
    exponent: 6,
    insufficientSupply: quantity > 10,
  })),
}));

// Mock getDb before importing pool.ts (which imports db.js at module level)
const mockGetDb = vi.fn();
vi.mock("../server/db.js", async () => {
  const actual = await vi.importActual<typeof import("../server/db.js")>("../server/db.js");
  return {
    ...actual,
    getDb: (...args: unknown[]) => mockGetDb(...args),
  };
});

import { executePoolRun, type PoolRunResult } from "../services/pool.js";
import { signAndBroadcast } from "../services/wallet.js";
import { selectBestOrders } from "../services/order-selector.js";

let db: Database.Database;

beforeEach(() => {
  // Use in-memory DB for isolation
  db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Create all schema tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key TEXT UNIQUE NOT NULL,
      email TEXT,
      balance_cents INTEGER NOT NULL DEFAULT 0,
      stripe_customer_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL CHECK(type IN ('topup', 'retirement')),
      amount_cents INTEGER NOT NULL,
      description TEXT,
      stripe_session_id TEXT,
      retirement_tx_hash TEXT,
      credit_class TEXT,
      credits_retired REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      stripe_subscription_id TEXT UNIQUE NOT NULL,
      plan TEXT NOT NULL CHECK(plan IN ('seedling', 'grove', 'forest')),
      amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'cancelled')),
      current_period_start TEXT,
      current_period_end TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS pool_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'partial', 'failed')),
      total_revenue_cents INTEGER NOT NULL DEFAULT 0,
      total_spent_cents INTEGER NOT NULL DEFAULT 0,
      carbon_credits_retired REAL DEFAULT 0,
      carbon_tx_hash TEXT,
      biodiversity_credits_retired REAL DEFAULT 0,
      biodiversity_tx_hash TEXT,
      uss_credits_retired REAL DEFAULT 0,
      uss_tx_hash TEXT,
      carry_forward_cents INTEGER NOT NULL DEFAULT 0,
      subscriber_count INTEGER NOT NULL DEFAULT 0,
      dry_run INTEGER NOT NULL DEFAULT 0,
      error_log TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS attributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pool_run_id INTEGER NOT NULL REFERENCES pool_runs(id),
      subscriber_id INTEGER NOT NULL REFERENCES subscribers(id),
      contribution_cents INTEGER NOT NULL,
      carbon_credits REAL DEFAULT 0,
      biodiversity_credits REAL DEFAULT 0,
      uss_credits REAL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Override getDb to return our in-memory DB
  mockGetDb.mockReturnValue(db);

  // Reset mocks
  vi.mocked(signAndBroadcast).mockResolvedValue({
    code: 0,
    transactionHash: "AABB1122",
    height: 12345,
    rawLog: "",
    events: [],
    msgResponses: [],
    gasUsed: 100000n,
    gasWanted: 200000n,
  } as any);
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

function addTestSubscribers(count: number, amountCents = 500): number[] {
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    const userResult = db.prepare(
      "INSERT INTO users (api_key, email) VALUES (?, ?)"
    ).run(`rfa_test_${i}`, `user${i}@test.com`);

    const subResult = db.prepare(
      "INSERT INTO subscribers (user_id, stripe_subscription_id, plan, amount_cents, status) VALUES (?, ?, ?, ?, 'active')"
    ).run(userResult.lastInsertRowid, `sub_test_${i}`, "grove", amountCents);

    ids.push(Number(subResult.lastInsertRowid));
  }
  return ids;
}

describe("Pool Service", () => {
  describe("executePoolRun", () => {
    it("returns no_subscribers when there are no active subscribers", async () => {
      const result = await executePoolRun({ dryRun: false });
      expect(result.status).toBe("no_subscribers");
      expect(result.subscriberCount).toBe(0);
      expect(result.errors).toContain("No active subscribers found");
    });

    it("calculates correct 50/30/20 budget allocation", async () => {
      addTestSubscribers(10, 1000); // 10 subs x $10 = $100 total

      const result = await executePoolRun({ dryRun: true });

      expect(result.totalRevenueCents).toBe(10000);
      expect(result.carbon.budgetCents).toBe(5000);      // 50%
      expect(result.biodiversity.budgetCents).toBe(3000); // 30%
      expect(result.uss.budgetCents).toBe(2000);          // 20%
    });

    it("handles dry run without broadcasting transactions", async () => {
      addTestSubscribers(3, 500);

      const result = await executePoolRun({ dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(result.status).toBe("completed");
      expect(result.subscriberCount).toBe(3);
      // signAndBroadcast should NOT have been called
      expect(signAndBroadcast).not.toHaveBeenCalled();
      // But credits should still be estimated
      expect(result.carbon.creditsRetired).toBeGreaterThan(0);
    });

    it("executes live run and broadcasts transactions", async () => {
      addTestSubscribers(2, 1000); // $20 total

      const result = await executePoolRun({ dryRun: false });

      expect(result.dryRun).toBe(false);
      // signAndBroadcast should have been called for each credit type
      expect(signAndBroadcast).toHaveBeenCalled();
      expect(result.carbon.txHash).toBe("AABB1122");
    });

    it("records per-subscriber fractional attributions", async () => {
      // 2 subscribers with different amounts
      const user1 = db.prepare("INSERT INTO users (api_key, email) VALUES (?, ?)").run("rfa_a", "a@test.com");
      const user2 = db.prepare("INSERT INTO users (api_key, email) VALUES (?, ?)").run("rfa_b", "b@test.com");

      db.prepare(
        "INSERT INTO subscribers (user_id, stripe_subscription_id, plan, amount_cents, status) VALUES (?, ?, ?, ?, 'active')"
      ).run(user1.lastInsertRowid, "sub_a", "seedling", 200); // $2

      db.prepare(
        "INSERT INTO subscribers (user_id, stripe_subscription_id, plan, amount_cents, status) VALUES (?, ?, ?, ?, 'active')"
      ).run(user2.lastInsertRowid, "sub_b", "forest", 1000); // $10

      const result = await executePoolRun({ dryRun: true });

      // Total = $12, subscriber A = 2/12 = 16.67%, subscriber B = 10/12 = 83.33%
      expect(result.subscriberCount).toBe(2);

      const attrs = db.prepare("SELECT * FROM attributions WHERE pool_run_id = ?").all(result.poolRunId) as any[];
      expect(attrs.length).toBe(2);

      const attrA = attrs.find((a: any) => a.contribution_cents === 200);
      const attrB = attrs.find((a: any) => a.contribution_cents === 1000);

      expect(attrA).toBeDefined();
      expect(attrB).toBeDefined();

      // B should have 5x the attribution of A
      if (attrA && attrB) {
        const ratio = attrB.carbon_credits / attrA.carbon_credits;
        expect(ratio).toBeCloseTo(5, 1);
      }
    });

    it("handles partial fill when one credit type fails", async () => {
      addTestSubscribers(1, 1000);

      // Make signAndBroadcast fail on second call
      let callCount = 0;
      vi.mocked(signAndBroadcast).mockImplementation(async () => {
        callCount++;
        if (callCount === 2) {
          throw new Error("broadcast failed for biodiversity");
        }
        return {
          code: 0,
          transactionHash: `TX${callCount}`,
          height: 12345,
          rawLog: "",
          events: [],
          msgResponses: [],
          gasUsed: 100000n,
          gasWanted: 200000n,
        } as any;
      });

      const result = await executePoolRun({ dryRun: false });

      expect(result.status).toBe("partial");
      expect(result.carbon.txHash).toBe("TX1");
      expect(result.biodiversity.error).toContain("broadcast failed");
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("excludes paused and cancelled subscribers", async () => {
      // Add 3 active, 1 paused, 1 cancelled
      addTestSubscribers(3, 500); // 3 active

      const user4 = db.prepare("INSERT INTO users (api_key, email) VALUES (?, ?)").run("rfa_paused", "paused@test.com");
      db.prepare(
        "INSERT INTO subscribers (user_id, stripe_subscription_id, plan, amount_cents, status) VALUES (?, ?, ?, ?, 'paused')"
      ).run(user4.lastInsertRowid, "sub_paused", "grove", 500);

      const user5 = db.prepare("INSERT INTO users (api_key, email) VALUES (?, ?)").run("rfa_cancelled", "cancel@test.com");
      db.prepare(
        "INSERT INTO subscribers (user_id, stripe_subscription_id, plan, amount_cents, status) VALUES (?, ?, ?, ?, 'cancelled')"
      ).run(user5.lastInsertRowid, "sub_cancelled", "grove", 500);

      const result = await executePoolRun({ dryRun: true });

      expect(result.subscriberCount).toBe(3); // Only active
      expect(result.totalRevenueCents).toBe(1500); // 3 * 500
    });
  });

  describe("Budget allocation rounding", () => {
    it("handles odd amounts without losing cents", async () => {
      addTestSubscribers(1, 333); // $3.33

      const result = await executePoolRun({ dryRun: true });

      const totalBudget = result.carbon.budgetCents + result.biodiversity.budgetCents + result.uss.budgetCents;
      expect(totalBudget).toBe(333); // No cents lost
    });

    it("handles single cent revenue", async () => {
      addTestSubscribers(1, 1);

      const result = await executePoolRun({ dryRun: true });

      // floor(1 * 0.5) = 0, floor(1 * 0.3) = 0, remainder = 1
      expect(result.carbon.budgetCents).toBe(0);
      expect(result.biodiversity.budgetCents).toBe(0);
      expect(result.uss.budgetCents).toBe(1);
    });
  });
});
