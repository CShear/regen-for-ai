/**
 * SQLite database for prepaid balance tracking and pool accounting.
 *
 * Tables:
 * - users: API key, email, balance (in cents), Stripe customer ID
 * - transactions: top-ups and retirement debits with full audit trail
 * - subscribers: Stripe subscription state linked to users
 * - pool_runs: monthly batch retirement execution records
 * - attributions: per-subscriber fractional credit attribution per pool run
 * - burns: REGEN token burn records linked to pool runs
 */

import Database from "better-sqlite3";
import { randomBytes } from "crypto";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";

let _db: Database.Database | undefined;

export function getDb(dbPath = "data/regen-for-ai.db"): Database.Database {
  if (_db) return _db;

  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  _db.exec(`
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

    CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);

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

    CREATE INDEX IF NOT EXISTS idx_subscribers_user_id ON subscribers(user_id);
    CREATE INDEX IF NOT EXISTS idx_subscribers_status ON subscribers(status);
    CREATE INDEX IF NOT EXISTS idx_subscribers_stripe_id ON subscribers(stripe_subscription_id);

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
      burn_allocation_cents INTEGER NOT NULL DEFAULT 0,
      burn_tx_hash TEXT,
      ops_allocation_cents INTEGER NOT NULL DEFAULT 0,
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

    CREATE INDEX IF NOT EXISTS idx_attributions_pool_run ON attributions(pool_run_id);
    CREATE INDEX IF NOT EXISTS idx_attributions_subscriber ON attributions(subscriber_id);

    CREATE TABLE IF NOT EXISTS burns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pool_run_id INTEGER NOT NULL REFERENCES pool_runs(id),
      allocation_cents INTEGER NOT NULL,
      amount_uregen TEXT NOT NULL DEFAULT '0',
      amount_regen REAL NOT NULL DEFAULT 0,
      regen_price_usd REAL,
      tx_hash TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'skipped', 'failed')),
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_burns_pool_run ON burns(pool_run_id);
    CREATE INDEX IF NOT EXISTS idx_burns_status ON burns(status);
  `);

  return _db;
}

export function generateApiKey(): string {
  return "rfa_" + randomBytes(24).toString("hex");
}

export interface User {
  id: number;
  api_key: string;
  email: string | null;
  balance_cents: number;
  stripe_customer_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: number;
  user_id: number;
  type: "topup" | "retirement";
  amount_cents: number;
  description: string | null;
  stripe_session_id: string | null;
  retirement_tx_hash: string | null;
  credit_class: string | null;
  credits_retired: number | null;
  created_at: string;
}

export function getUserByApiKey(db: Database.Database, apiKey: string): User | undefined {
  return db.prepare("SELECT * FROM users WHERE api_key = ?").get(apiKey) as User | undefined;
}

export function getUserByEmail(db: Database.Database, email: string): User | undefined {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email) as User | undefined;
}

export function createUser(db: Database.Database, email: string | null, stripeCustomerId: string | null): User {
  const apiKey = generateApiKey();
  const stmt = db.prepare(
    "INSERT INTO users (api_key, email, stripe_customer_id) VALUES (?, ?, ?)"
  );
  const result = stmt.run(apiKey, email, stripeCustomerId);
  return db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid) as User;
}

export function creditBalance(
  db: Database.Database,
  userId: number,
  amountCents: number,
  stripeSessionId: string,
  description: string
): void {
  const txn = db.transaction(() => {
    db.prepare(
      "UPDATE users SET balance_cents = balance_cents + ?, updated_at = datetime('now') WHERE id = ?"
    ).run(amountCents, userId);

    db.prepare(
      "INSERT INTO transactions (user_id, type, amount_cents, description, stripe_session_id) VALUES (?, 'topup', ?, ?, ?)"
    ).run(userId, amountCents, description, stripeSessionId);
  });
  txn();
}

export function debitBalance(
  db: Database.Database,
  userId: number,
  amountCents: number,
  description: string,
  retirementTxHash?: string,
  creditClass?: string,
  creditsRetired?: number
): { success: boolean; balance_cents: number } {
  const result = { success: false, balance_cents: 0 };

  const txn = db.transaction(() => {
    const user = db.prepare("SELECT balance_cents FROM users WHERE id = ?").get(userId) as { balance_cents: number } | undefined;
    if (!user || user.balance_cents < amountCents) {
      result.balance_cents = user?.balance_cents ?? 0;
      return;
    }

    db.prepare(
      "UPDATE users SET balance_cents = balance_cents - ?, updated_at = datetime('now') WHERE id = ?"
    ).run(amountCents, userId);

    db.prepare(
      "INSERT INTO transactions (user_id, type, amount_cents, description, retirement_tx_hash, credit_class, credits_retired) VALUES (?, 'retirement', ?, ?, ?, ?, ?)"
    ).run(userId, amountCents, description, retirementTxHash ?? null, creditClass ?? null, creditsRetired ?? null);

    result.success = true;
    result.balance_cents = user.balance_cents - amountCents;
  });
  txn();

  return result;
}

export function getTransactions(db: Database.Database, userId: number, limit = 20): Transaction[] {
  return db.prepare(
    "SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?"
  ).all(userId, limit) as Transaction[];
}

// --- Subscriber types and helpers ---

export interface Subscriber {
  id: number;
  user_id: number;
  stripe_subscription_id: string;
  plan: "seedling" | "grove" | "forest";
  amount_cents: number;
  status: "active" | "paused" | "cancelled";
  current_period_start: string | null;
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
}

export function getActiveSubscribers(db: Database.Database): Subscriber[] {
  return db.prepare("SELECT * FROM subscribers WHERE status = 'active'").all() as Subscriber[];
}

export function getSubscriberByStripeId(db: Database.Database, stripeSubId: string): Subscriber | undefined {
  return db.prepare("SELECT * FROM subscribers WHERE stripe_subscription_id = ?").get(stripeSubId) as Subscriber | undefined;
}

export function createSubscriber(
  db: Database.Database,
  userId: number,
  stripeSubId: string,
  plan: string,
  amountCents: number,
  periodStart?: string,
  periodEnd?: string
): Subscriber {
  db.prepare(
    "INSERT INTO subscribers (user_id, stripe_subscription_id, plan, amount_cents, current_period_start, current_period_end) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(userId, stripeSubId, plan, amountCents, periodStart ?? null, periodEnd ?? null);
  return db.prepare("SELECT * FROM subscribers WHERE stripe_subscription_id = ?").get(stripeSubId) as Subscriber;
}

export function updateSubscriberStatus(db: Database.Database, stripeSubId: string, status: string): void {
  db.prepare(
    "UPDATE subscribers SET status = ?, updated_at = datetime('now') WHERE stripe_subscription_id = ?"
  ).run(status, stripeSubId);
}

export function updateSubscriber(
  db: Database.Database,
  stripeSubId: string,
  updates: { plan?: string; amount_cents?: number; status?: string; current_period_start?: string; current_period_end?: string }
): void {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.plan !== undefined) { sets.push("plan = ?"); values.push(updates.plan); }
  if (updates.amount_cents !== undefined) { sets.push("amount_cents = ?"); values.push(updates.amount_cents); }
  if (updates.status !== undefined) { sets.push("status = ?"); values.push(updates.status); }
  if (updates.current_period_start !== undefined) { sets.push("current_period_start = ?"); values.push(updates.current_period_start); }
  if (updates.current_period_end !== undefined) { sets.push("current_period_end = ?"); values.push(updates.current_period_end); }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  values.push(stripeSubId);
  db.prepare(`UPDATE subscribers SET ${sets.join(", ")} WHERE stripe_subscription_id = ?`).run(...values);
}

// --- Pool run types and helpers ---

export interface PoolRun {
  id: number;
  run_date: string;
  status: "pending" | "running" | "completed" | "partial" | "failed";
  total_revenue_cents: number;
  total_spent_cents: number;
  carbon_credits_retired: number;
  carbon_tx_hash: string | null;
  biodiversity_credits_retired: number;
  biodiversity_tx_hash: string | null;
  uss_credits_retired: number;
  uss_tx_hash: string | null;
  burn_allocation_cents: number;
  burn_tx_hash: string | null;
  ops_allocation_cents: number;
  carry_forward_cents: number;
  subscriber_count: number;
  dry_run: number;
  error_log: string | null;
  created_at: string;
  completed_at: string | null;
}

export function createPoolRun(db: Database.Database, dryRun: boolean): PoolRun {
  const runDate = new Date().toISOString().split("T")[0];
  db.prepare(
    "INSERT INTO pool_runs (run_date, status, dry_run) VALUES (?, 'running', ?)"
  ).run(runDate, dryRun ? 1 : 0);
  return db.prepare("SELECT * FROM pool_runs ORDER BY id DESC LIMIT 1").get() as PoolRun;
}

export function updatePoolRun(
  db: Database.Database,
  id: number,
  updates: Partial<Pick<PoolRun,
    "status" | "total_revenue_cents" | "total_spent_cents" |
    "carbon_credits_retired" | "carbon_tx_hash" |
    "biodiversity_credits_retired" | "biodiversity_tx_hash" |
    "uss_credits_retired" | "uss_tx_hash" |
    "burn_allocation_cents" | "burn_tx_hash" | "ops_allocation_cents" |
    "carry_forward_cents" | "subscriber_count" | "error_log" | "completed_at"
  >>
): void {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, val] of Object.entries(updates)) {
    if (val !== undefined) {
      sets.push(`${key} = ?`);
      values.push(val);
    }
  }
  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE pool_runs SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function getLastPoolRun(db: Database.Database): PoolRun | undefined {
  return db.prepare("SELECT * FROM pool_runs ORDER BY id DESC LIMIT 1").get() as PoolRun | undefined;
}

// --- Attribution types and helpers ---

export interface Attribution {
  id: number;
  pool_run_id: number;
  subscriber_id: number;
  contribution_cents: number;
  carbon_credits: number;
  biodiversity_credits: number;
  uss_credits: number;
  created_at: string;
}

export function createAttribution(
  db: Database.Database,
  poolRunId: number,
  subscriberId: number,
  contributionCents: number
): Attribution {
  const result = db.prepare(
    "INSERT INTO attributions (pool_run_id, subscriber_id, contribution_cents) VALUES (?, ?, ?)"
  ).run(poolRunId, subscriberId, contributionCents);
  return db.prepare("SELECT * FROM attributions WHERE id = ?").get(result.lastInsertRowid) as Attribution;
}

export function updateAttribution(
  db: Database.Database,
  id: number,
  credits: { carbon_credits?: number; biodiversity_credits?: number; uss_credits?: number }
): void {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (credits.carbon_credits !== undefined) { sets.push("carbon_credits = ?"); values.push(credits.carbon_credits); }
  if (credits.biodiversity_credits !== undefined) { sets.push("biodiversity_credits = ?"); values.push(credits.biodiversity_credits); }
  if (credits.uss_credits !== undefined) { sets.push("uss_credits = ?"); values.push(credits.uss_credits); }
  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE attributions SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function getAttributionsByRun(db: Database.Database, poolRunId: number): Attribution[] {
  return db.prepare("SELECT * FROM attributions WHERE pool_run_id = ?").all(poolRunId) as Attribution[];
}

export function getAttributionsBySubscriber(db: Database.Database, subscriberId: number): Attribution[] {
  return db.prepare(
    "SELECT * FROM attributions WHERE subscriber_id = ? ORDER BY created_at DESC"
  ).all(subscriberId) as Attribution[];
}

// --- Email helpers ---

export interface SubscriberWithEmail {
  subscriber_id: number;
  user_email: string;
  plan: string;
  amount_cents: number;
  stripe_subscription_id: string;
}

export function getSubscribersWithEmails(db: Database.Database, subscriberIds: number[]): SubscriberWithEmail[] {
  if (subscriberIds.length === 0) return [];
  const placeholders = subscriberIds.map(() => "?").join(", ");
  return db.prepare(`
    SELECT
      s.id AS subscriber_id,
      u.email AS user_email,
      s.plan,
      s.amount_cents,
      s.stripe_subscription_id
    FROM subscribers s
    JOIN users u ON s.user_id = u.id
    WHERE s.id IN (${placeholders}) AND u.email IS NOT NULL
  `).all(...subscriberIds) as SubscriberWithEmail[];
}

export interface CumulativeAttribution {
  total_carbon: number;
  total_biodiversity: number;
  total_uss: number;
  total_contribution_cents: number;
  months_active: number;
}

// --- Burn types and helpers ---

export interface Burn {
  id: number;
  pool_run_id: number;
  allocation_cents: number;
  amount_uregen: string;
  amount_regen: number;
  regen_price_usd: number | null;
  tx_hash: string | null;
  status: "pending" | "completed" | "skipped" | "failed";
  error: string | null;
  created_at: string;
}

export function createBurn(
  db: Database.Database,
  poolRunId: number,
  allocationCents: number
): Burn {
  const result = db.prepare(
    "INSERT INTO burns (pool_run_id, allocation_cents) VALUES (?, ?)"
  ).run(poolRunId, allocationCents);
  return db.prepare("SELECT * FROM burns WHERE id = ?").get(result.lastInsertRowid) as Burn;
}

export function updateBurn(
  db: Database.Database,
  id: number,
  updates: Partial<Pick<Burn, "amount_uregen" | "amount_regen" | "regen_price_usd" | "tx_hash" | "status" | "error">>
): void {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, val] of Object.entries(updates)) {
    if (val !== undefined) {
      sets.push(`${key} = ?`);
      values.push(val);
    }
  }
  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE burns SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function getBurnsByPoolRun(db: Database.Database, poolRunId: number): Burn[] {
  return db.prepare("SELECT * FROM burns WHERE pool_run_id = ?").all(poolRunId) as Burn[];
}

export function getTotalBurnedRegen(db: Database.Database): { total_regen: number; total_burns: number } {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(amount_regen), 0) AS total_regen,
      COUNT(*) AS total_burns
    FROM burns
    WHERE status = 'completed'
  `).get() as { total_regen: number; total_burns: number } | undefined;
  return row ?? { total_regen: 0, total_burns: 0 };
}

export function getCumulativeAttribution(db: Database.Database, subscriberId: number): CumulativeAttribution {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(carbon_credits), 0) AS total_carbon,
      COALESCE(SUM(biodiversity_credits), 0) AS total_biodiversity,
      COALESCE(SUM(uss_credits), 0) AS total_uss,
      COALESCE(SUM(contribution_cents), 0) AS total_contribution_cents,
      COUNT(DISTINCT pool_run_id) AS months_active
    FROM attributions
    WHERE subscriber_id = ?
  `).get(subscriberId) as CumulativeAttribution | undefined;

  return row ?? {
    total_carbon: 0,
    total_biodiversity: 0,
    total_uss: 0,
    total_contribution_cents: 0,
    months_active: 0,
  };
}
