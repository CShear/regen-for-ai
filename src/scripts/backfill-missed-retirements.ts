/**
 * Backfill retirements missed during the Aug 2026 wallet-drain incident.
 *
 * Targets subscriber_retirements rows where total_spent_cents < credits_budget_cents,
 * excluding:
 *   - subscribers with a prepaid over-retirement balance (already over-delivered
 *     by the runaway; their cycles are covered by the prepaid ledger),
 *   - non-active subscribers (e.g. the cancelled phantom from the Aug 6
 *     double-processing incident),
 *   - rows without a payment_id (no idempotency anchor).
 *
 * For each row it re-runs retireForSubscriber with the ORIGINAL payment_id,
 * gross, and net amounts: the engine's per-payment idempotency retries only the
 * missing batches with the remaining budget. Purchases use the CURRENT month's
 * credit selection (original orders may no longer exist).
 *
 * The daily spend cap applies — run with e.g. DAILY_SPEND_CAP_CENTS=15000 for
 * a backfill day.
 *
 * Usage: node dist/scripts/backfill-missed-retirements.js [--apply]
 *   (dry-run by default: lists what would be retried, executes nothing)
 */

import { retireForSubscriber } from "../services/retire-subscriber.js";
import { getDb } from "../server/db.js";

const APPLY = process.argv.includes("--apply");

interface Row {
  id: number;
  subscriber_id: number;
  payment_id: string;
  gross_amount_cents: number;
  net_amount_cents: number;
  credits_budget_cents: number;
  total_spent_cents: number;
  billing_interval: string;
  email: string | null;
}

async function main() {
  console.log(`=== Backfill missed retirements (${APPLY ? "APPLY" : "dry-run"}) ===\n`);
  const db = getDb();

  const rows = db.prepare(`
    SELECT sr.id, sr.subscriber_id, sr.payment_id, sr.gross_amount_cents,
           sr.net_amount_cents, sr.credits_budget_cents, sr.total_spent_cents,
           s.billing_interval, u.email
    FROM subscriber_retirements sr
    JOIN subscribers s ON s.id = sr.subscriber_id
    LEFT JOIN users u ON u.id = s.user_id
    WHERE sr.total_spent_cents < sr.credits_budget_cents
      AND sr.payment_id IS NOT NULL
      AND s.status = 'active'
      AND s.prepaid_credits_cents = 0
    ORDER BY sr.id
  `).all() as Row[];

  const totalOwed = rows.reduce((a, r) => a + (r.credits_budget_cents - r.total_spent_cents), 0);
  console.log(`${rows.length} row(s), $${(totalOwed / 100).toFixed(2)} of missed credit budget\n`);

  let filled = 0, failed = 0;
  for (const row of rows) {
    const missing = row.credits_budget_cents - row.total_spent_cents;
    console.log(
      `retirement=${row.id} subscriber=${row.subscriber_id} (${row.email ?? "?"}) ` +
      `payment=${row.payment_id} missing=$${(missing / 100).toFixed(2)}`
    );
    if (!APPLY) continue;

    try {
      const result = await retireForSubscriber({
        subscriberId: row.subscriber_id,
        grossAmountCents: row.gross_amount_cents,
        billingInterval: row.billing_interval === "yearly" ? "yearly" : "monthly",
        precomputedNetCents: row.net_amount_cents,
        paymentId: row.payment_id,
      });
      const newBatches = result.batches.filter((b) => b.buyTxHash !== null);
      console.log(
        `  -> status=${result.status} credits=${result.totalCreditsRetired.toFixed(6)} ` +
        `spent=$${(result.totalSpentCents / 100).toFixed(2)} ` +
        `txs=${[...new Set(newBatches.map((b) => b.buyTxHash))].join(",") || "none"}` +
        (result.errors.length ? ` errors=${JSON.stringify(result.errors)}` : "")
      );
      if (result.status === "success") filled++; else failed++;
    } catch (err) {
      failed++;
      console.error(`  -> threw: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (APPLY) console.log(`\nDone: ${filled} fully filled, ${failed} still incomplete.`);
  else console.log("\nDry run — nothing executed (use --apply).");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
