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
 * - processed_webhook_events: Stripe webhook event deduplication
 */

import Database from "better-sqlite3";
import { randomBytes } from "crypto";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";

let _db: Database.Database | undefined;

/**
 * Run a destructive table-rebuild migration (CREATE new + copy + DROP + RENAME)
 * atomically. Without a transaction, a crash between DROP and RENAME loses the
 * table's rows with no rollback — for the `transactions`/`subscribers` tables that
 * would mean losing the money audit trail. Foreign keys are toggled off for the
 * duration per SQLite's recommended table-redefine procedure (a PRAGMA that is a
 * no-op inside a transaction, so it must wrap the transaction, not sit inside it).
 */
function rebuildInTransaction(db: Database.Database, sql: string): void {
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => db.exec(sql))();
  } finally {
    db.pragma("foreign_keys = ON");
  }
}

export function getDb(dbPath = "data/regen-compute.db"): Database.Database {
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
      type TEXT NOT NULL CHECK(type IN ('topup', 'subscription', 'retirement')),
      amount_cents INTEGER NOT NULL,
      description TEXT,
      stripe_session_id TEXT,
      stripe_subscription_id TEXT,
      billing_interval TEXT CHECK(billing_interval IN ('monthly', 'yearly')),
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
      plan TEXT NOT NULL CHECK(plan IN ('seedling', 'grove', 'forest', 'dabbler', 'builder', 'agent')),
      amount_cents INTEGER NOT NULL,
      billing_interval TEXT NOT NULL DEFAULT 'monthly' CHECK(billing_interval IN ('monthly', 'yearly')),
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

    CREATE TABLE IF NOT EXISTS pool_run_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pool_run_id INTEGER NOT NULL REFERENCES pool_runs(id),
      batch_denom TEXT NOT NULL,
      credit_class_id TEXT NOT NULL,
      credit_type_abbrev TEXT NOT NULL,
      budget_cents INTEGER NOT NULL DEFAULT 0,
      spent_cents INTEGER NOT NULL DEFAULT 0,
      credits_retired REAL NOT NULL DEFAULT 0,
      sell_order_id TEXT,
      tx_hash TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_pool_run_batches_run ON pool_run_batches(pool_run_id);

    CREATE TABLE IF NOT EXISTS api_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      endpoint TEXT NOT NULL,
      method TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      response_time_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_api_usage_user_id ON api_usage(user_id);
    CREATE INDEX IF NOT EXISTS idx_api_usage_created_at ON api_usage(created_at);

    CREATE TABLE IF NOT EXISTS magic_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_magic_links_token ON magic_links(token);

    CREATE TABLE IF NOT EXISTS beta_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      message TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'comment' CHECK(category IN ('bug', 'suggestion', 'comment')),
      page TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS subscriber_retirements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscriber_id INTEGER NOT NULL REFERENCES subscribers(id),
      regen_address TEXT NOT NULL,
      gross_amount_cents INTEGER NOT NULL,
      net_amount_cents INTEGER NOT NULL,
      credits_budget_cents INTEGER NOT NULL,
      burn_budget_cents INTEGER NOT NULL,
      ops_budget_cents INTEGER NOT NULL,
      total_credits_retired REAL NOT NULL DEFAULT 0,
      total_spent_cents INTEGER NOT NULL DEFAULT 0,
      payment_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sub_retirements_subscriber ON subscriber_retirements(subscriber_id);
    CREATE INDEX IF NOT EXISTS idx_sub_retirements_created ON subscriber_retirements(created_at);

    CREATE TABLE IF NOT EXISTS subscriber_retirement_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      retirement_id INTEGER NOT NULL REFERENCES subscriber_retirements(id),
      batch_denom TEXT NOT NULL,
      credit_class_id TEXT NOT NULL,
      credit_type_abbrev TEXT NOT NULL,
      budget_cents INTEGER NOT NULL DEFAULT 0,
      spent_cents INTEGER NOT NULL DEFAULT 0,
      credits_retired REAL NOT NULL DEFAULT 0,
      buy_tx_hash TEXT,
      send_retire_tx_hash TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sub_ret_batches_retirement ON subscriber_retirement_batches(retirement_id);

    CREATE TABLE IF NOT EXISTS scheduled_retirements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscriber_id INTEGER NOT NULL REFERENCES subscribers(id),
      gross_amount_cents INTEGER NOT NULL,
      net_amount_cents INTEGER NOT NULL DEFAULT 0,
      billing_interval TEXT NOT NULL DEFAULT 'yearly',
      scheduled_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'partial', 'failed')),
      retirement_id INTEGER REFERENCES subscriber_retirements(id),
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      executed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_scheduled_retirements_subscriber ON scheduled_retirements(subscriber_id);
    CREATE INDEX IF NOT EXISTS idx_scheduled_retirements_status ON scheduled_retirements(status);
    CREATE INDEX IF NOT EXISTS idx_scheduled_retirements_date ON scheduled_retirements(scheduled_date);

    CREATE TABLE IF NOT EXISTS monthly_credit_selection (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month TEXT NOT NULL UNIQUE,
      batch1_denom TEXT NOT NULL,
      batch1_name TEXT NOT NULL,
      batch2_denom TEXT NOT NULL,
      batch2_name TEXT NOT NULL,
      batch3_denom TEXT NOT NULL,
      batch3_name TEXT NOT NULL,
      featured_batch INTEGER NOT NULL DEFAULT 3 CHECK(featured_batch IN (1, 2, 3)),
      confirmed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_monthly_credits_month ON monthly_credit_selection(month);

    CREATE TABLE IF NOT EXISTS burn_accumulator (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount_cents INTEGER NOT NULL,
      executed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_burn_accumulator_executed ON burn_accumulator(executed);

    CREATE TABLE IF NOT EXISTS community_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_label TEXT NOT NULL,
      goal_credits REAL NOT NULL,
      goal_deadline TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS referral_rewards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_user_id INTEGER NOT NULL REFERENCES users(id),
      referred_user_id INTEGER NOT NULL REFERENCES users(id),
      reward_type TEXT NOT NULL DEFAULT 'extra_credit_retirement',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'fulfilled', 'expired', 'held')),
      retirement_tx_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      fulfilled_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer ON referral_rewards(referrer_user_id);
    CREATE INDEX IF NOT EXISTS idx_referral_rewards_status ON referral_rewards(status);

    CREATE TABLE IF NOT EXISTS processed_webhook_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS crypto_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chain TEXT NOT NULL,
      tx_hash TEXT UNIQUE NOT NULL,
      from_address TEXT,
      token TEXT NOT NULL,
      amount TEXT NOT NULL,
      usd_value_cents INTEGER NOT NULL,
      subscriber_id INTEGER REFERENCES subscribers(id),
      user_id INTEGER REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed', 'provisioned', 'failed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_crypto_payments_tx_hash ON crypto_payments(tx_hash);
    CREATE INDEX IF NOT EXISTS idx_crypto_payments_subscriber ON crypto_payments(subscriber_id);

    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      contact_email TEXT NOT NULL,
      full_time_devs INTEGER NOT NULL DEFAULT 0,
      autonomous_agents INTEGER NOT NULL DEFAULT 0,
      part_time_users INTEGER NOT NULL DEFAULT 0,
      suggested_cents INTEGER NOT NULL,
      publicity_opt_in INTEGER NOT NULL DEFAULT 0,
      logo_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_organizations_contact_email ON organizations(contact_email);
  `);

  // Migrations for existing DBs — add billing_interval to subscribers table
  const subCols = (_db.pragma("table_info(subscribers)") as Array<{ name: string }>).map((c) => c.name);
  if (!subCols.includes("billing_interval")) {
    _db.exec(`ALTER TABLE subscribers ADD COLUMN billing_interval TEXT NOT NULL DEFAULT 'monthly'`);
    console.log("Migration: added billing_interval column to subscribers");
  }

  // Migrations for existing DBs — add referral columns to users table
  const existingCols = (_db.pragma("table_info(users)") as Array<{ name: string }>).map((c) => c.name);

  if (!existingCols.includes("referral_code")) {
    _db.exec(`ALTER TABLE users ADD COLUMN referral_code TEXT`);
    console.log("Migration: added referral_code column");
  }

  _db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)`);

  if (!existingCols.includes("referred_by")) {
    _db.exec(`ALTER TABLE users ADD COLUMN referred_by INTEGER`);
    console.log("Migration: added referred_by column");
  }

  // Migration: update subscribers CHECK constraint to include new plan names
  const subSchema = (_db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='subscribers'").get() as { sql: string } | undefined)?.sql ?? "";
  if (subSchema.includes("plan IN ('seedling', 'grove', 'forest')") && !subSchema.includes("'dabbler'")) {
    rebuildInTransaction(_db, `
      CREATE TABLE subscribers_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        stripe_subscription_id TEXT UNIQUE NOT NULL,
        plan TEXT NOT NULL CHECK(plan IN ('seedling', 'grove', 'forest', 'dabbler', 'builder', 'agent')),
        amount_cents INTEGER NOT NULL,
        billing_interval TEXT NOT NULL DEFAULT 'monthly' CHECK(billing_interval IN ('monthly', 'yearly')),
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'cancelled')),
        current_period_start TEXT,
        current_period_end TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO subscribers_new SELECT id, user_id, stripe_subscription_id, plan, amount_cents, billing_interval, status, current_period_start, current_period_end, created_at, updated_at FROM subscribers;
      DROP TABLE subscribers;
      ALTER TABLE subscribers_new RENAME TO subscribers;
      CREATE INDEX IF NOT EXISTS idx_subscribers_user_id ON subscribers(user_id);
      CREATE INDEX IF NOT EXISTS idx_subscribers_status ON subscribers(status);
      CREATE INDEX IF NOT EXISTS idx_subscribers_stripe_id ON subscribers(stripe_subscription_id);
    `);
    console.log("Migration: updated subscribers CHECK constraint to include dabbler/builder/agent plans");
  }

  // Migration: add regen_address to subscribers
  if (!subCols.includes("regen_address")) {
    _db.exec(`ALTER TABLE subscribers ADD COLUMN regen_address TEXT`);
    console.log("Migration: added regen_address column to subscribers");
  }

  // Migration: add display_name to users
  if (!existingCols.includes("display_name")) {
    _db.exec(`ALTER TABLE users ADD COLUMN display_name TEXT`);
    console.log("Migration: added display_name column to users");
  }

  // Migration: add payment_id to subscriber_retirements
  const retCols = (_db.pragma("table_info(subscriber_retirements)") as Array<{ name: string }>).map((c) => c.name);
  if (retCols.length > 0 && !retCols.includes("payment_id")) {
    _db.exec(`ALTER TABLE subscriber_retirements ADD COLUMN payment_id TEXT`);
    console.log("Migration: added payment_id column to subscriber_retirements");
  }
  // Always ensure the index exists (covers both new and migrated DBs)
  if (retCols.length > 0) {
    _db.exec(`CREATE INDEX IF NOT EXISTS idx_sub_retirements_payment ON subscriber_retirements(payment_id)`);
  }

  // Migration: update scheduled_retirements CHECK constraint to include 'partial'
  const schedSchema = (_db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scheduled_retirements'").get() as { sql: string } | undefined)?.sql ?? "";
  if (schedSchema && !schedSchema.includes("partial")) {
    rebuildInTransaction(_db, `
      CREATE TABLE IF NOT EXISTS scheduled_retirements_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subscriber_id INTEGER NOT NULL REFERENCES subscribers(id),
        gross_amount_cents INTEGER NOT NULL,
        net_amount_cents INTEGER NOT NULL DEFAULT 0,
        billing_interval TEXT NOT NULL DEFAULT 'yearly',
        scheduled_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'partial', 'failed')),
        retirement_id INTEGER REFERENCES subscriber_retirements(id),
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        executed_at TEXT
      );
      INSERT INTO scheduled_retirements_new (id, subscriber_id, gross_amount_cents, billing_interval, scheduled_date, status, retirement_id, error, created_at, executed_at)
        SELECT id, subscriber_id, gross_amount_cents, billing_interval, scheduled_date, status, retirement_id, error, created_at, executed_at FROM scheduled_retirements;
      DROP TABLE scheduled_retirements;
      ALTER TABLE scheduled_retirements_new RENAME TO scheduled_retirements;
      CREATE INDEX IF NOT EXISTS idx_scheduled_retirements_subscriber ON scheduled_retirements(subscriber_id);
      CREATE INDEX IF NOT EXISTS idx_scheduled_retirements_status ON scheduled_retirements(status);
    `);
    console.log("Migration: updated scheduled_retirements CHECK constraint to include 'partial'");
  }

  // Migration: add retry_count column to scheduled_retirements
  try {
    _db.prepare("ALTER TABLE scheduled_retirements ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0").run();
    console.log("Migration: added retry_count column to scheduled_retirements");
  } catch (e) {
    // Column already exists
  }

  // Migration: prepaid over-retirement balance (Aug 2026 runaway compensation).
  // While positive, recurring cycles consume this instead of retiring on-chain.
  try {
    _db.prepare("ALTER TABLE subscribers ADD COLUMN prepaid_credits_cents INTEGER NOT NULL DEFAULT 0").run();
    console.log("Migration: added prepaid_credits_cents column to subscribers");
  } catch (e) {
    // Column already exists
  }

  // Migration: wallet spend log — feeds the daily on-chain spend cap guard.
  _db.exec(`CREATE TABLE IF NOT EXISTS wallet_spend_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cents INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  // Backfill referral codes for users that don't have one
  const usersWithoutCodes = _db.prepare(
    "SELECT id FROM users WHERE referral_code IS NULL"
  ).all() as { id: number }[];
  for (const u of usersWithoutCodes) {
    _db.prepare("UPDATE users SET referral_code = ? WHERE id = ?").run(
      generateReferralCode(),
      u.id
    );
  }
  if (usersWithoutCodes.length > 0) {
    console.log(`Migration: backfilled ${usersWithoutCodes.length} referral codes`);
  }

  // Migration: add 'subscription' to transactions type CHECK constraint
  // SQLite CHECK constraints can't be altered, so recreate the table if needed
  const tableInfo = _db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='transactions'").get() as { sql: string } | undefined;
  if (tableInfo && !tableInfo.sql.includes("subscription")) {
    rebuildInTransaction(_db, `
      CREATE TABLE transactions_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        type TEXT NOT NULL CHECK(type IN ('topup', 'subscription', 'retirement')),
        amount_cents INTEGER NOT NULL,
        description TEXT,
        stripe_session_id TEXT,
        retirement_tx_hash TEXT,
        credit_class TEXT,
        credits_retired REAL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO transactions_new SELECT * FROM transactions;
      DROP TABLE transactions;
      ALTER TABLE transactions_new RENAME TO transactions;
      CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
    `);
    // Reclassify existing topup rows that came from subscriptions
    _db.prepare(
      "UPDATE transactions SET type = 'subscription', description = REPLACE(description, 'Stripe top-up', 'Subscription payment') WHERE type = 'topup' AND description LIKE 'Stripe top-up%'"
    ).run();
    console.log("Migration: added 'subscription' type to transactions, reclassified existing rows");
  }

  // Migration: add billing_interval and stripe_subscription_id to transactions
  const txnCols = (_db.pragma("table_info(transactions)") as Array<{ name: string }>).map((c) => c.name);
  if (!txnCols.includes("billing_interval")) {
    _db.exec(`ALTER TABLE transactions ADD COLUMN billing_interval TEXT CHECK(billing_interval IN ('monthly', 'yearly'))`);
    console.log("Migration: added billing_interval column to transactions");
  }
  if (!txnCols.includes("stripe_subscription_id")) {
    _db.exec(`ALTER TABLE transactions ADD COLUMN stripe_subscription_id TEXT`);
    console.log("Migration: added stripe_subscription_id column to transactions");
  }

  // Backfill billing_interval on existing transactions from their subscriber records
  _db.prepare(`
    UPDATE transactions SET
      billing_interval = (
        SELECT s.billing_interval FROM subscribers s
        WHERE s.user_id = transactions.user_id
        AND transactions.type = 'subscription'
        LIMIT 1
      ),
      stripe_subscription_id = (
        SELECT s.stripe_subscription_id FROM subscribers s
        WHERE s.user_id = transactions.user_id
        AND transactions.type = 'subscription'
        LIMIT 1
      )
    WHERE type = 'subscription' AND billing_interval IS NULL
  `).run();

  // Migration: add source_type and subscriber_id to burn_accumulator for audit trail (#77)
  const burnCols = (_db.pragma("table_info(burn_accumulator)") as Array<{ name: string }>).map((c) => c.name);
  if (!burnCols.includes("source_type")) {
    _db.exec(`ALTER TABLE burn_accumulator ADD COLUMN source_type TEXT`);
    console.log("Migration: added source_type column to burn_accumulator");
  }
  if (!burnCols.includes("subscriber_id")) {
    _db.exec(`ALTER TABLE burn_accumulator ADD COLUMN subscriber_id INTEGER`);
    console.log("Migration: added subscriber_id column to burn_accumulator");
  }

  // Migration: add org_id to subscribers for organization subscriptions (#55)
  if (!subCols.includes("org_id")) {
    _db.exec(`ALTER TABLE subscribers ADD COLUMN org_id INTEGER REFERENCES organizations(id)`);
    console.log("Migration: added org_id column to subscribers");
  }

  // Migration: add 'referral_bonus' to transactions type CHECK constraint
  if (tableInfo && !tableInfo.sql.includes("referral_bonus")) {
    rebuildInTransaction(_db, `
      CREATE TABLE transactions_v3 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        type TEXT NOT NULL CHECK(type IN ('topup', 'subscription', 'retirement', 'referral_bonus')),
        amount_cents INTEGER NOT NULL,
        description TEXT,
        stripe_session_id TEXT,
        retirement_tx_hash TEXT,
        credit_class TEXT,
        credits_retired REAL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        billing_interval TEXT CHECK(billing_interval IN ('monthly', 'yearly')),
        stripe_subscription_id TEXT
      );
      INSERT INTO transactions_v3 SELECT * FROM transactions;
      DROP TABLE transactions;
      ALTER TABLE transactions_v3 RENAME TO transactions;
      CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
    `);
    console.log("Migration: added 'referral_bonus' type to transactions CHECK constraint");
  }

  // Migration: add 'held' status to referral_rewards CHECK constraint
  const rrCheckInfo = _db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='referral_rewards'").get() as { sql: string } | undefined;
  if (rrCheckInfo?.sql && !rrCheckInfo.sql.includes("held")) {
    rebuildInTransaction(_db, `
      CREATE TABLE referral_rewards_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        referrer_user_id INTEGER NOT NULL REFERENCES users(id),
        referred_user_id INTEGER NOT NULL REFERENCES users(id),
        reward_type TEXT NOT NULL DEFAULT 'extra_credit_retirement',
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'fulfilled', 'expired', 'held')),
        retirement_tx_hash TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        fulfilled_at TEXT
      );
      INSERT INTO referral_rewards_new SELECT * FROM referral_rewards;
      DROP TABLE referral_rewards;
      ALTER TABLE referral_rewards_new RENAME TO referral_rewards;
      CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer ON referral_rewards(referrer_user_id);
      CREATE INDEX IF NOT EXISTS idx_referral_rewards_status ON referral_rewards(status);
    `);
    console.log("Migration: added 'held' status to referral_rewards CHECK constraint");
  }

  // Migration: add renewal_reminders_sent to subscribers (tracks which crypto renewal emails sent)
  if (!subCols.includes("renewal_reminders_sent")) {
    _db.exec(`ALTER TABLE subscribers ADD COLUMN renewal_reminders_sent TEXT`);
    console.log("Migration: added renewal_reminders_sent column to subscribers");
  }

  // Migration: add badge_token to users (read-only token for dynamic usage badge — safe to embed in HTML)
  const userCols = (_db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map(c => c.name);
  if (!userCols.includes("badge_token")) {
    _db.exec(`ALTER TABLE users ADD COLUMN badge_token TEXT`);
    _db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_badge_token ON users(badge_token)`);
    console.log("Migration: added badge_token column to users");
  }
  // Backfill badge tokens for users that don't have one
  const usersWithoutBadgeToken = _db.prepare("SELECT id FROM users WHERE badge_token IS NULL").all() as { id: number }[];
  for (const u of usersWithoutBadgeToken) {
    _db.prepare("UPDATE users SET badge_token = ? WHERE id = ?").run(generateBadgeToken(), u.id);
  }
  if (usersWithoutBadgeToken.length > 0) {
    console.log(`Migration: backfilled ${usersWithoutBadgeToken.length} badge tokens`);
  }

  // Migration: add optional sell order IDs to monthly_credit_selection
  const mcsCols = (_db.prepare("PRAGMA table_info(monthly_credit_selection)").all() as { name: string }[]).map(c => c.name);
  if (!mcsCols.includes("batch1_sell_order_id")) {
    _db.exec(`ALTER TABLE monthly_credit_selection ADD COLUMN batch1_sell_order_id TEXT`);
    _db.exec(`ALTER TABLE monthly_credit_selection ADD COLUMN batch2_sell_order_id TEXT`);
    _db.exec(`ALTER TABLE monthly_credit_selection ADD COLUMN batch3_sell_order_id TEXT`);
    console.log("Migration: added sell order ID columns to monthly_credit_selection");
  }

  return _db;
}

export function generateApiKey(): string {
  return "rfa_" + randomBytes(24).toString("hex");
}

export function generateReferralCode(): string {
  return "ref_" + randomBytes(8).toString("hex");
}

export function generateBadgeToken(): string {
  return "rbt_" + randomBytes(16).toString("hex");
}

export interface User {
  id: number;
  api_key: string;
  badge_token: string | null;
  email: string | null;
  display_name: string | null;
  balance_cents: number;
  stripe_customer_id: string | null;
  referral_code: string;
  referred_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: number;
  user_id: number;
  type: "topup" | "subscription" | "retirement" | "referral_bonus";
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

export function getUserByBadgeToken(db: Database.Database, badgeToken: string): User | undefined {
  return db.prepare("SELECT * FROM users WHERE badge_token = ?").get(badgeToken) as User | undefined;
}

export function getUserByEmail(db: Database.Database, email: string): User | undefined {
  return db.prepare("SELECT * FROM users WHERE LOWER(email) = LOWER(?)").get(email) as User | undefined;
}

export function createUser(
  db: Database.Database,
  email: string | null,
  stripeCustomerId: string | null,
  referredByUserId?: number
): User {
  const apiKey = generateApiKey();
  const badgeToken = generateBadgeToken();
  const referralCode = generateReferralCode();
  const normalizedEmail = email ? email.toLowerCase() : null;
  const stmt = db.prepare(
    "INSERT INTO users (api_key, badge_token, email, stripe_customer_id, referral_code, referred_by) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const result = stmt.run(apiKey, badgeToken, normalizedEmail, stripeCustomerId, referralCode, referredByUserId ?? null);
  return db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid) as User;
}

export function setUserDisplayName(db: Database.Database, userId: number, displayName: string | null): void {
  db.prepare("UPDATE users SET display_name = ?, updated_at = datetime('now') WHERE id = ?").run(displayName, userId);
}

export function getUserDisplayNameBySubscriberId(db: Database.Database, subscriberId: number): string | null {
  const row = db.prepare(
    "SELECT u.display_name FROM users u JOIN subscribers s ON s.user_id = u.id WHERE s.id = ?"
  ).get(subscriberId) as { display_name: string | null } | undefined;
  return row?.display_name ?? null;
}

export function creditBalance(
  db: Database.Database,
  userId: number,
  amountCents: number,
  stripeSessionId: string,
  description: string,
  type: "topup" | "subscription" = "topup",
  billingInterval?: "monthly" | "yearly",
  stripeSubscriptionId?: string
): void {
  const txn = db.transaction(() => {
    // Prevent duplicate transactions from the same Stripe session
    // (checkout.session.completed and invoice.paid can both fire for initial subscription payment)
    const existing = db.prepare(
      "SELECT id FROM transactions WHERE stripe_session_id = ? AND user_id = ?"
    ).get(stripeSessionId, userId) as { id: number } | undefined;
    if (existing) {
      console.log(`Skipping duplicate transaction: session=${stripeSessionId} user=${userId} (already recorded as txn #${existing.id})`);
      return;
    }

    db.prepare(
      "UPDATE users SET balance_cents = balance_cents + ?, updated_at = datetime('now') WHERE id = ?"
    ).run(amountCents, userId);

    db.prepare(
      "INSERT INTO transactions (user_id, type, amount_cents, description, stripe_session_id, stripe_subscription_id, billing_interval) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(userId, type, amountCents, description, stripeSessionId, stripeSubscriptionId ?? null, billingInterval ?? null);
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

export function insertReferralBonusTransaction(
  db: Database.Database,
  userId: number,
  amountCents: number,
  retirementTxHash: string | null,
  creditsRetired: number | null,
  description: string = "Referral bonus retirement",
): void {
  db.prepare(
    "INSERT INTO transactions (user_id, type, amount_cents, description, retirement_tx_hash, credits_retired) VALUES (?, 'referral_bonus', ?, ?, ?, ?)"
  ).run(userId, amountCents, description, retirementTxHash, creditsRetired);
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
  plan: "seedling" | "grove" | "forest" | "dabbler" | "builder" | "agent";
  amount_cents: number;
  billing_interval: "monthly" | "yearly";
  status: "active" | "paused" | "cancelled";
  regen_address: string | null;
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
  periodEnd?: string,
  billingInterval: "monthly" | "yearly" = "monthly"
): Subscriber {
  db.prepare(
    "INSERT INTO subscribers (user_id, stripe_subscription_id, plan, amount_cents, billing_interval, current_period_start, current_period_end) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(userId, stripeSubId, plan, amountCents, billingInterval, periodStart ?? null, periodEnd ?? null);
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
  updates: { plan?: string; amount_cents?: number; billing_interval?: string; status?: string; current_period_start?: string; current_period_end?: string }
): void {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.plan !== undefined) { sets.push("plan = ?"); values.push(updates.plan); }
  if (updates.amount_cents !== undefined) { sets.push("amount_cents = ?"); values.push(updates.amount_cents); }
  if (updates.billing_interval !== undefined) { sets.push("billing_interval = ?"); values.push(updates.billing_interval); }
  if (updates.status !== undefined) { sets.push("status = ?"); values.push(updates.status); }
  if (updates.current_period_start !== undefined) { sets.push("current_period_start = ?"); values.push(updates.current_period_start); }
  if (updates.current_period_end !== undefined) { sets.push("current_period_end = ?"); values.push(updates.current_period_end); }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  values.push(stripeSubId);
  db.prepare(`UPDATE subscribers SET ${sets.join(", ")} WHERE stripe_subscription_id = ?`).run(...values);
}

export function setSubscriberRegenAddress(db: Database.Database, subscriberId: number, regenAddress: string): void {
  db.prepare(
    "UPDATE subscribers SET regen_address = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(regenAddress, subscriberId);
}

// --- Subscriber retirement types and helpers ---

export interface SubscriberRetirement {
  id: number;
  subscriber_id: number;
  regen_address: string;
  gross_amount_cents: number;
  net_amount_cents: number;
  credits_budget_cents: number;
  burn_budget_cents: number;
  ops_budget_cents: number;
  total_credits_retired: number;
  total_spent_cents: number;
  created_at: string;
}

export function getSubscriberRetirements(db: Database.Database, subscriberId: number): SubscriberRetirement[] {
  return db.prepare(
    "SELECT * FROM subscriber_retirements WHERE subscriber_id = ? ORDER BY created_at DESC"
  ).all(subscriberId) as SubscriberRetirement[];
}

export function getCumulativeSubscriberRetirements(db: Database.Database, subscriberId: number): {
  total_credits_retired: number;
  total_spent_cents: number;
  total_gross_cents: number;
  retirement_count: number;
} {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(total_credits_retired), 0) AS total_credits_retired,
      COALESCE(SUM(total_spent_cents), 0) AS total_spent_cents,
      COALESCE(SUM(gross_amount_cents), 0) AS total_gross_cents,
      COUNT(*) AS retirement_count
    FROM subscriber_retirements
    WHERE subscriber_id = ?
  `).get(subscriberId) as { total_credits_retired: number; total_spent_cents: number; total_gross_cents: number; retirement_count: number } | undefined;
  return row ?? { total_credits_retired: 0, total_spent_cents: 0, total_gross_cents: 0, retirement_count: 0 };
}

/** Get per-batch retirement totals for one or more subscribers (for project cards) */
export function getSubscriberBatchTotals(db: Database.Database, subscriberIds: number | number[]): Array<{
  batch_denom: string;
  credit_class_id: string;
  credit_type_abbrev: string;
  total_credits: number;
  total_spent_cents: number;
  latest_tx_hash: string | null;
  retirement_count: number;
}> {
  const ids = Array.isArray(subscriberIds) ? subscriberIds : [subscriberIds];
  const placeholders = ids.map(() => "?").join(",");
  return db.prepare(`
    SELECT
      srb.batch_denom,
      srb.credit_class_id,
      srb.credit_type_abbrev,
      SUM(srb.credits_retired) AS total_credits,
      SUM(srb.spent_cents) AS total_spent_cents,
      MAX(srb.buy_tx_hash) AS latest_tx_hash,
      COUNT(*) AS retirement_count
    FROM subscriber_retirement_batches srb
    JOIN subscriber_retirements sr ON sr.id = srb.retirement_id
    WHERE sr.subscriber_id IN (${placeholders}) AND srb.credits_retired > 0
    GROUP BY srb.batch_denom
    ORDER BY total_credits DESC
  `).all(...ids) as Array<{
    batch_denom: string;
    credit_class_id: string;
    credit_type_abbrev: string;
    total_credits: number;
    total_spent_cents: number;
    latest_tx_hash: string | null;
    retirement_count: number;
  }>;
}

// --- Monthly credit selection types and helpers ---

export interface MonthlyCreditSelection {
  id: number;
  month: string;
  batch1_denom: string;
  batch1_name: string;
  batch2_denom: string;
  batch2_name: string;
  batch3_denom: string;
  batch3_name: string;
  /** Optional target sell order IDs — when set, buy from this specific order */
  batch1_sell_order_id: string | null;
  batch2_sell_order_id: string | null;
  batch3_sell_order_id: string | null;
  featured_batch: 1 | 2 | 3;
  confirmed: number;
  created_at: string;
  updated_at: string;
}

/**
 * Get the credit selection for a given month.
 * Falls back to the most recent previous month if no selection exists.
 */
export function getMonthlyCreditSelection(db: Database.Database, month: string): MonthlyCreditSelection | undefined {
  // Try exact month first
  const exact = db.prepare(
    "SELECT * FROM monthly_credit_selection WHERE month = ?"
  ).get(month) as MonthlyCreditSelection | undefined;
  if (exact) return exact;

  // Fall back to most recent previous month
  return db.prepare(
    "SELECT * FROM monthly_credit_selection WHERE month < ? ORDER BY month DESC LIMIT 1"
  ).get(month) as MonthlyCreditSelection | undefined;
}

export function getAllMonthlyCreditSelections(db: Database.Database): MonthlyCreditSelection[] {
  return db.prepare(
    "SELECT * FROM monthly_credit_selection ORDER BY month ASC"
  ).all() as MonthlyCreditSelection[];
}

export function upsertMonthlyCreditSelection(
  db: Database.Database,
  month: string,
  batch1Denom: string, batch1Name: string,
  batch2Denom: string, batch2Name: string,
  batch3Denom: string, batch3Name: string,
  featuredBatch: 1 | 2 | 3 = 3,
  sellOrderIds?: { batch1?: string; batch2?: string; batch3?: string },
): MonthlyCreditSelection {
  db.prepare(`
    INSERT INTO monthly_credit_selection (month, batch1_denom, batch1_name, batch2_denom, batch2_name, batch3_denom, batch3_name, featured_batch, batch1_sell_order_id, batch2_sell_order_id, batch3_sell_order_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(month) DO UPDATE SET
      batch1_denom = excluded.batch1_denom, batch1_name = excluded.batch1_name,
      batch2_denom = excluded.batch2_denom, batch2_name = excluded.batch2_name,
      batch3_denom = excluded.batch3_denom, batch3_name = excluded.batch3_name,
      featured_batch = excluded.featured_batch,
      batch1_sell_order_id = excluded.batch1_sell_order_id,
      batch2_sell_order_id = excluded.batch2_sell_order_id,
      batch3_sell_order_id = excluded.batch3_sell_order_id,
      updated_at = datetime('now')
  `).run(
    month, batch1Denom, batch1Name, batch2Denom, batch2Name, batch3Denom, batch3Name, featuredBatch,
    sellOrderIds?.batch1 ?? null, sellOrderIds?.batch2 ?? null, sellOrderIds?.batch3 ?? null,
  );
  return db.prepare("SELECT * FROM monthly_credit_selection WHERE month = ?").get(month) as MonthlyCreditSelection;
}

export function confirmMonthlyCreditSelection(db: Database.Database, month: string): void {
  db.prepare(
    "UPDATE monthly_credit_selection SET confirmed = 1, updated_at = datetime('now') WHERE month = ?"
  ).run(month);
}

// --- Community goals ---

export interface CommunityGoal {
  id: number;
  goal_label: string;
  goal_credits: number;
  goal_deadline: string | null;
  active: number;
  created_at: string;
}

export function getActiveCommunityGoal(db: Database.Database): CommunityGoal | undefined {
  return db.prepare(
    "SELECT * FROM community_goals WHERE active = 1 ORDER BY id DESC LIMIT 1"
  ).get() as CommunityGoal | undefined;
}

export function createCommunityGoal(
  db: Database.Database,
  goalLabel: string,
  goalCredits: number,
  goalDeadline?: string
): void {
  // Deactivate all existing goals
  db.prepare("UPDATE community_goals SET active = 0").run();
  db.prepare(
    "INSERT INTO community_goals (goal_label, goal_credits, goal_deadline) VALUES (?, ?, ?)"
  ).run(goalLabel, goalCredits, goalDeadline ?? null);
}

export function getCommunityTotalCreditsRetired(db: Database.Database): number {
  const row = db.prepare(
    "SELECT COALESCE(SUM(total_credits_retired), 0) AS total FROM subscriber_retirements"
  ).get() as { total: number } | undefined;
  return row?.total ?? 0;
}

export function getCommunitySubscriberCount(db: Database.Database): number {
  const row = db.prepare(
    "SELECT COUNT(*) AS count FROM subscribers WHERE status = 'active'"
  ).get() as { count: number } | undefined;
  return row?.count ?? 0;
}

// --- Scheduled retirement types and helpers ---

export interface ScheduledRetirement {
  id: number;
  subscriber_id: number;
  gross_amount_cents: number;
  net_amount_cents: number;
  billing_interval: "monthly" | "yearly";
  scheduled_date: string;
  status: "pending" | "running" | "completed" | "partial" | "failed";
  retirement_id: number | null;
  error: string | null;
  retry_count: number;
  created_at: string;
  executed_at: string | null;
}

export function createScheduledRetirement(
  db: Database.Database,
  subscriberId: number,
  grossAmountCents: number,
  netAmountCents: number,
  scheduledDate: string,
  billingInterval: "monthly" | "yearly" = "yearly"
): ScheduledRetirement {
  const result = db.prepare(
    "INSERT INTO scheduled_retirements (subscriber_id, gross_amount_cents, net_amount_cents, billing_interval, scheduled_date) VALUES (?, ?, ?, ?, ?)"
  ).run(subscriberId, grossAmountCents, netAmountCents, billingInterval, scheduledDate);
  return db.prepare("SELECT * FROM scheduled_retirements WHERE id = ?").get(result.lastInsertRowid) as ScheduledRetirement;
}

export function getDueScheduledRetirements(db: Database.Database): ScheduledRetirement[] {
  return db.prepare(
    "SELECT sr.* FROM scheduled_retirements sr JOIN subscribers s ON sr.subscriber_id = s.id WHERE (sr.status = 'pending' OR (sr.status IN ('partial', 'failed') AND sr.retry_count < 3)) AND sr.scheduled_date <= datetime('now') AND s.status = 'active' ORDER BY sr.scheduled_date ASC"
  ).all() as ScheduledRetirement[];
}

export function updateScheduledRetirement(
  db: Database.Database,
  id: number,
  updates: Partial<Pick<ScheduledRetirement, "status" | "retirement_id" | "error" | "executed_at">>
): void {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, val] of Object.entries(updates)) {
    if (val !== undefined) { sets.push(`${key} = ?`); values.push(val); }
  }
  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE scheduled_retirements SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function cancelScheduledRetirements(db: Database.Database, subscriberId: number): number {
  const result = db.prepare(
    "UPDATE scheduled_retirements SET status = 'failed', error = 'subscription_cancelled' WHERE subscriber_id = ? AND status = 'pending'"
  ).run(subscriberId);
  return result.changes;
}

export function getScheduledRetirementsBySubscriber(db: Database.Database, subscriberId: number): ScheduledRetirement[] {
  return db.prepare(
    "SELECT * FROM scheduled_retirements WHERE subscriber_id = ? ORDER BY scheduled_date ASC"
  ).all(subscriberId) as ScheduledRetirement[];
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

// --- Pool run batch helpers ---

export interface PoolRunBatch {
  id: number;
  pool_run_id: number;
  batch_denom: string;
  credit_class_id: string;
  credit_type_abbrev: string;
  budget_cents: number;
  spent_cents: number;
  credits_retired: number;
  sell_order_id: string | null;
  tx_hash: string | null;
  error: string | null;
  created_at: string;
}

export function createPoolRunBatch(
  db: Database.Database,
  poolRunId: number,
  batchDenom: string,
  creditClassId: string,
  creditTypeAbbrev: string,
  budgetCents: number
): PoolRunBatch {
  const result = db.prepare(
    "INSERT INTO pool_run_batches (pool_run_id, batch_denom, credit_class_id, credit_type_abbrev, budget_cents) VALUES (?, ?, ?, ?, ?)"
  ).run(poolRunId, batchDenom, creditClassId, creditTypeAbbrev, budgetCents);
  return db.prepare("SELECT * FROM pool_run_batches WHERE id = ?").get(result.lastInsertRowid) as PoolRunBatch;
}

export function updatePoolRunBatch(
  db: Database.Database,
  id: number,
  updates: Partial<Pick<PoolRunBatch, "spent_cents" | "credits_retired" | "sell_order_id" | "tx_hash" | "error">>
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
  db.prepare(`UPDATE pool_run_batches SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export function getPoolRunBatches(db: Database.Database, poolRunId: number): PoolRunBatch[] {
  return db.prepare("SELECT * FROM pool_run_batches WHERE pool_run_id = ? ORDER BY credit_type_abbrev, batch_denom").all(poolRunId) as PoolRunBatch[];
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

export function getCumulativeAttribution(db: Database.Database, subscriberIds: number | number[]): CumulativeAttribution {
  const ids = Array.isArray(subscriberIds) ? subscriberIds : [subscriberIds];
  const placeholders = ids.map(() => "?").join(",");
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(carbon_credits), 0) AS total_carbon,
      COALESCE(SUM(biodiversity_credits), 0) AS total_biodiversity,
      COALESCE(SUM(uss_credits), 0) AS total_uss,
      COALESCE(SUM(contribution_cents), 0) AS total_contribution_cents,
      COUNT(DISTINCT pool_run_id) AS months_active
    FROM attributions
    WHERE subscriber_id IN (${placeholders})
  `).get(...ids) as CumulativeAttribution | undefined;

  return row ?? {
    total_carbon: 0,
    total_biodiversity: 0,
    total_uss: 0,
    total_contribution_cents: 0,
    months_active: 0,
  };
}

// --- Community stats helpers ---

export interface CommunityStats {
  total_credits: number;
  total_carbon: number;
  total_biodiversity: number;
  total_uss: number;
  member_count: number;
}

export function getCommunityStats(db: Database.Database): CommunityStats {
  const credits = db.prepare(`
    SELECT
      COALESCE(SUM(carbon_credits), 0) AS total_carbon,
      COALESCE(SUM(biodiversity_credits), 0) AS total_biodiversity,
      COALESCE(SUM(uss_credits), 0) AS total_uss
    FROM attributions
  `).get() as { total_carbon: number; total_biodiversity: number; total_uss: number } | undefined;

  const members = db.prepare(`
    SELECT COUNT(*) AS member_count FROM subscribers WHERE status = 'active'
  `).get() as { member_count: number } | undefined;

  const tc = credits?.total_carbon ?? 0;
  const tb = credits?.total_biodiversity ?? 0;
  const tu = credits?.total_uss ?? 0;

  return {
    total_credits: tc + tb + tu,
    total_carbon: tc,
    total_biodiversity: tb,
    total_uss: tu,
    member_count: members?.member_count ?? 0,
  };
}

// --- API usage tracking ---

export function recordApiUsage(
  db: Database.Database,
  userId: number,
  endpoint: string,
  method: string,
  statusCode: number,
  responseTimeMs?: number
): void {
  db.prepare(
    "INSERT INTO api_usage (user_id, endpoint, method, status_code, response_time_ms) VALUES (?, ?, ?, ?, ?)"
  ).run(userId, endpoint, method, statusCode, responseTimeMs ?? null);
}

// --- Dashboard helpers ---

export function getSubscriberByUserId(db: Database.Database, userId: number): Subscriber | undefined {
  return db.prepare(
    "SELECT * FROM subscribers WHERE user_id = ? ORDER BY created_at DESC LIMIT 1"
  ).get(userId) as Subscriber | undefined;
}

/** Get ALL active subscribers for a user (for multi-subscription dashboards) */
export function getAllSubscribersByUserId(db: Database.Database, userId: number): Subscriber[] {
  return db.prepare(
    "SELECT * FROM subscribers WHERE user_id = ? AND status = 'active' ORDER BY created_at ASC"
  ).all(userId) as Subscriber[];
}

export interface MonthlyAttribution {
  run_date: string;
  carbon_credits: number;
  biodiversity_credits: number;
  uss_credits: number;
  contribution_cents: number;
  carbon_tx_hash: string | null;
  biodiversity_tx_hash: string | null;
  uss_tx_hash: string | null;
}

export function getMonthlyAttributions(db: Database.Database, subscriberIds: number | number[]): MonthlyAttribution[] {
  const ids = Array.isArray(subscriberIds) ? subscriberIds : [subscriberIds];
  const placeholders = ids.map(() => "?").join(",");
  return db.prepare(`
    SELECT
      pr.run_date,
      SUM(a.carbon_credits) AS carbon_credits,
      SUM(a.biodiversity_credits) AS biodiversity_credits,
      SUM(a.uss_credits) AS uss_credits,
      SUM(a.contribution_cents) AS contribution_cents,
      pr.carbon_tx_hash,
      pr.biodiversity_tx_hash,
      pr.uss_tx_hash
    FROM attributions a
    JOIN pool_runs pr ON a.pool_run_id = pr.id
    WHERE a.subscriber_id IN (${placeholders})
    GROUP BY pr.run_date
    ORDER BY pr.run_date ASC
  `).all(...ids) as MonthlyAttribution[];
}

// --- Referral helpers ---

export function getUserByReferralCode(db: Database.Database, code: string): User | undefined {
  return db.prepare("SELECT * FROM users WHERE referral_code = ?").get(code) as User | undefined;
}

export function setUserReferredBy(db: Database.Database, userId: number, referrerUserId: number): void {
  db.prepare(
    "UPDATE users SET referred_by = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(referrerUserId, userId);
}

export interface ReferralReward {
  id: number;
  referrer_user_id: number;
  referred_user_id: number;
  reward_type: string;
  status: "pending" | "fulfilled" | "expired";
  retirement_tx_hash: string | null;
  created_at: string;
  fulfilled_at: string | null;
}

export function createReferralReward(
  db: Database.Database,
  referrerUserId: number,
  referredUserId: number,
  rewardType: string = "extra_credit_retirement"
): ReferralReward {
  const result = db.prepare(
    "INSERT INTO referral_rewards (referrer_user_id, referred_user_id, reward_type) VALUES (?, ?, ?)"
  ).run(referrerUserId, referredUserId, rewardType);
  return db.prepare("SELECT * FROM referral_rewards WHERE id = ?").get(result.lastInsertRowid) as ReferralReward;
}

export function fulfillReferralReward(
  db: Database.Database,
  rewardId: number,
  retirementTxHash: string
): void {
  db.prepare(
    "UPDATE referral_rewards SET status = 'fulfilled', retirement_tx_hash = ?, fulfilled_at = datetime('now') WHERE id = ?"
  ).run(retirementTxHash, rewardId);
}

export function getPendingReferralRewardForReferred(db: Database.Database, referredUserId: number): ReferralReward | undefined {
  return db.prepare(
    "SELECT * FROM referral_rewards WHERE referred_user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1"
  ).get(referredUserId) as ReferralReward | undefined;
}

export function getTodayReferralCount(db: Database.Database): number {
  const row = db.prepare(
    "SELECT COUNT(*) AS count FROM referral_rewards WHERE created_at >= date('now')"
  ).get() as { count: number } | undefined;
  return row?.count ?? 0;
}

export function holdReferralReward(db: Database.Database, rewardId: number): void {
  db.prepare(
    "UPDATE referral_rewards SET status = 'held' WHERE id = ?"
  ).run(rewardId);
}

export function getHeldReferralRewards(db: Database.Database): ReferralReward[] {
  return db.prepare(
    "SELECT * FROM referral_rewards WHERE status = 'held' ORDER BY created_at"
  ).all() as ReferralReward[];
}

export function approveReferralReward(db: Database.Database, rewardId: number): void {
  db.prepare(
    "UPDATE referral_rewards SET status = 'pending' WHERE id = ? AND status = 'held'"
  ).run(rewardId);
}

export function getReferralCount(db: Database.Database, userId: number): number {
  const row = db.prepare(
    "SELECT COUNT(*) AS count FROM users WHERE referred_by = ?"
  ).get(userId) as { count: number } | undefined;
  return row?.count ?? 0;
}

export function getMedianReferralCount(db: Database.Database): number {
  // Get all referrer counts (only users who have at least 1 referral)
  const rows = db.prepare(
    "SELECT COUNT(*) AS cnt FROM users WHERE referred_by IS NOT NULL GROUP BY referred_by ORDER BY cnt"
  ).all() as { cnt: number }[];
  if (rows.length === 0) return 0;
  const mid = Math.floor(rows.length / 2);
  return rows.length % 2 === 0
    ? Math.floor((rows[mid - 1].cnt + rows[mid].cnt) / 2)
    : rows[mid].cnt;
}

export function getFulfilledReferralRewardsForUser(db: Database.Database, userId: number): ReferralReward[] {
  return db.prepare(
    "SELECT * FROM referral_rewards WHERE referrer_user_id = ? AND status = 'fulfilled' ORDER BY fulfilled_at DESC"
  ).all(userId) as ReferralReward[];
}

// --- Magic link helpers ---

export function createMagicLinkToken(db: Database.Database, email: string, ttlMinutes: number): string {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  db.prepare(
    "INSERT INTO magic_links (token, email, expires_at) VALUES (?, ?, ?)"
  ).run(token, email, expiresAt);
  return token;
}

export function verifyMagicLinkToken(db: Database.Database, token: string): string | null {
  // Atomic update + fetch in one query — prevents TOCTOU race
  const row = db.prepare(
    "UPDATE magic_links SET used = 1 WHERE token = ? AND used = 0 AND expires_at > datetime('now') RETURNING email"
  ).get(token) as { email: string } | undefined;

  return row?.email ?? null;
}

// --- Webhook idempotency ---

export function isEventProcessed(db: Database.Database, eventId: string): boolean {
  return !!db.prepare("SELECT 1 FROM processed_webhook_events WHERE event_id = ?").get(eventId);
}

export function markEventProcessed(db: Database.Database, eventId: string, eventType: string): void {
  db.prepare("INSERT OR IGNORE INTO processed_webhook_events (event_id, event_type) VALUES (?, ?)").run(eventId, eventType);
}

// --- Organization helpers (#55) ---

export interface Organization {
  id: number;
  name: string;
  contact_email: string;
  full_time_devs: number;
  autonomous_agents: number;
  part_time_users: number;
  suggested_cents: number;
  publicity_opt_in: number;
  logo_url: string | null;
  created_at: string;
  updated_at: string;
}

export function createOrganization(
  db: Database.Database,
  org: { name: string; contact_email: string; full_time_devs: number; autonomous_agents: number; part_time_users: number; suggested_cents: number },
): Organization {
  const result = db.prepare(
    `INSERT INTO organizations (name, contact_email, full_time_devs, autonomous_agents, part_time_users, suggested_cents) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(org.name, org.contact_email, org.full_time_devs, org.autonomous_agents, org.part_time_users, org.suggested_cents);
  return db.prepare("SELECT * FROM organizations WHERE id = ?").get(result.lastInsertRowid) as Organization;
}

export function getOrganizationById(db: Database.Database, id: number): Organization | undefined {
  return db.prepare("SELECT * FROM organizations WHERE id = ?").get(id) as Organization | undefined;
}

export function getOrganizationBySubscriberId(db: Database.Database, subscriberId: number): Organization | undefined {
  return db.prepare(
    "SELECT o.* FROM organizations o JOIN subscribers s ON s.org_id = o.id WHERE s.id = ?"
  ).get(subscriberId) as Organization | undefined;
}

export function updateOrganizationPublicity(db: Database.Database, orgId: number, optIn: boolean): void {
  db.prepare("UPDATE organizations SET publicity_opt_in = ?, updated_at = datetime('now') WHERE id = ?").run(optIn ? 1 : 0, orgId);
}

export function linkSubscriberToOrg(db: Database.Database, subscriberId: number, orgId: number): void {
  db.prepare("UPDATE subscribers SET org_id = ? WHERE id = ?").run(orgId, subscriberId);
}

export function getPublicOrganizations(db: Database.Database): Organization[] {
  return db.prepare(
    "SELECT o.* FROM organizations o JOIN subscribers s ON s.org_id = o.id WHERE o.publicity_opt_in = 1 AND s.status = 'active' ORDER BY o.created_at ASC"
  ).all() as Organization[];
}

// --- Crypto payment helpers (#99) ---

export interface CryptoPayment {
  id: number;
  chain: string;
  tx_hash: string;
  from_address: string | null;
  token: string;
  amount: string;
  usd_value_cents: number;
  subscriber_id: number | null;
  user_id: number | null;
  status: string;
  created_at: string;
}

export function getCryptoPaymentByTxHash(db: Database.Database, txHash: string): CryptoPayment | undefined {
  return db.prepare("SELECT * FROM crypto_payments WHERE tx_hash = ?").get(txHash) as CryptoPayment | undefined;
}

export function createCryptoPayment(
  db: Database.Database,
  payment: { chain: string; tx_hash: string; from_address: string | null; token: string; amount: string; usd_value_cents: number; user_id?: number; subscriber_id?: number },
): CryptoPayment {
  const result = db.prepare(
    `INSERT INTO crypto_payments (chain, tx_hash, from_address, token, amount, usd_value_cents, user_id, subscriber_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`
  ).run(payment.chain, payment.tx_hash, payment.from_address, payment.token, payment.amount, payment.usd_value_cents, payment.user_id ?? null, payment.subscriber_id ?? null);
  return db.prepare("SELECT * FROM crypto_payments WHERE id = ?").get(result.lastInsertRowid) as CryptoPayment;
}

export function updateCryptoPaymentStatus(db: Database.Database, id: number, status: string, subscriberId?: number, userId?: number): void {
  db.prepare("UPDATE crypto_payments SET status = ?, subscriber_id = COALESCE(?, subscriber_id), user_id = COALESCE(?, user_id) WHERE id = ?")
    .run(status, subscriberId ?? null, userId ?? null, id);
}

// --- Crypto renewal reminder helpers ---

export type RenewalLevel = "30d" | "14d" | "5d" | "expired";

/** Get subscribers needing renewal reminders: crypto subs (always) + cancelled Stripe subs.
 *  Never reminds active Stripe subs (auto-renew — reminding them may prompt cancellation). */
export function getSubscribersNeedingRenewal(db: Database.Database, level: RenewalLevel, cutoffDate: string): Array<Subscriber & { email: string }> {
  const rows = db.prepare(`
    SELECT s.*, u.email FROM subscribers s
    JOIN users u ON u.id = s.user_id
    WHERE s.current_period_end IS NOT NULL
      AND s.current_period_end <= ?
      AND u.email IS NOT NULL
      AND (s.renewal_reminders_sent IS NULL OR s.renewal_reminders_sent NOT LIKE ?)
      AND (
        (s.stripe_subscription_id LIKE 'crypto_%' AND s.status = 'active')
        OR
        (s.stripe_subscription_id NOT LIKE 'crypto_%' AND s.status = 'cancelled')
      )
  `).all(cutoffDate, `%${level}%`) as Array<Subscriber & { email: string }>;
  return rows;
}

/** Mark a reminder level as sent for a subscriber */
export function markRenewalReminderSent(db: Database.Database, subscriberId: number, level: RenewalLevel): void {
  const current = (db.prepare("SELECT renewal_reminders_sent FROM subscribers WHERE id = ?").get(subscriberId) as { renewal_reminders_sent: string | null })?.renewal_reminders_sent ?? "";
  const updated = current ? `${current},${level}` : level;
  db.prepare("UPDATE subscribers SET renewal_reminders_sent = ? WHERE id = ?").run(updated, subscriberId);
}

/** Clear renewal reminders (called when subscription is extended) */
export function clearRenewalReminders(db: Database.Database, subscriberId: number): void {
  db.prepare("UPDATE subscribers SET renewal_reminders_sent = NULL WHERE id = ?").run(subscriberId);
}

/** Get all active crypto subscribers for a user (for dashboard display) */
export function getExpiringCryptoSubscribers(db: Database.Database, userId: number): Subscriber[] {
  return db.prepare(`
    SELECT * FROM subscribers
    WHERE user_id = ? AND status = 'active' AND stripe_subscription_id LIKE 'crypto_%'
    ORDER BY current_period_end ASC
  `).all(userId) as Subscriber[];
}

// --- Developer API usage helpers ---

export interface ApiUsageSummary {
  endpoint: string;
  method: string;
  total_calls: number;
  success_calls: number;
  error_calls: number;
  avg_response_ms: number | null;
  last_called_at: string | null;
}

export interface ApiUsageRow {
  id: number;
  endpoint: string;
  method: string;
  status_code: number;
  response_time_ms: number | null;
  created_at: string;
}

/** Aggregate API usage by endpoint for a user */
export function getApiUsageSummary(db: Database.Database, userId: number, days = 30): ApiUsageSummary[] {
  return db.prepare(`
    SELECT
      endpoint,
      method,
      COUNT(*) AS total_calls,
      SUM(CASE WHEN status_code < 400 THEN 1 ELSE 0 END) AS success_calls,
      SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS error_calls,
      AVG(response_time_ms) AS avg_response_ms,
      MAX(created_at) AS last_called_at
    FROM api_usage
    WHERE user_id = ?
      AND created_at >= datetime('now', ? || ' days')
    GROUP BY endpoint, method
    ORDER BY total_calls DESC
  `).all(userId, `-${days}`) as ApiUsageSummary[];
}

/** Total API calls for a user in the last N days */
export function getApiUsageTotal(db: Database.Database, userId: number, days = 30): number {
  const row = db.prepare(`
    SELECT COUNT(*) AS total FROM api_usage
    WHERE user_id = ? AND created_at >= datetime('now', ? || ' days')
  `).get(userId, `-${days}`) as { total: number };
  return row.total;
}

/** Recent individual API calls for a user */
export function getRecentApiCalls(db: Database.Database, userId: number, limit = 20): ApiUsageRow[] {
  return db.prepare(`
    SELECT id, endpoint, method, status_code, response_time_ms, created_at
    FROM api_usage
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, limit) as ApiUsageRow[];
}

/** API calls per day for a user — for sparkline/chart */
export interface ApiUsageDay {
  day: string;
  calls: number;
  errors: number;
}
export function getApiUsageByDay(db: Database.Database, userId: number, days = 14): ApiUsageDay[] {
  return db.prepare(`
    SELECT
      date(created_at) AS day,
      COUNT(*) AS calls,
      SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS errors
    FROM api_usage
    WHERE user_id = ? AND created_at >= datetime('now', ? || ' days')
    GROUP BY date(created_at)
    ORDER BY day ASC
  `).all(userId, `-${days}`) as ApiUsageDay[];
}
