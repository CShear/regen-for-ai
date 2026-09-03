/**
 * One-off script: compute per-subscriber on-chain over-retirement from the
 * August 2026 retry runaway and store it as subscribers.prepaid_credits_cents.
 *
 * Background (diagnosed Sep 3, 2026):
 *   A record-replacement bug in recordSubscriberRetirement destroyed the DB
 *   record of previously-succeeded batches on each hourly scheduled-retirement
 *   retry, so already-retired batches were re-bought on-chain every other hour.
 *   Several yearly subscribers received 10–100x their entitled credits before
 *   the master wallet ran dry (~Aug 22).
 *
 * Overage model (conservative in the subscriber's favor):
 *   overage = USDC the subscriber's wallet received from the master wallet
 *             (on-chain, all-time — only Path B retire-only value)
 *           - SUM(credits_budget_cents) across all their subscriber_retirements
 *             (their full entitlement, including Path A value).
 *   Path A (master-direct) delivered value is NOT counted as received, so the
 *   stored prepaid balance slightly understates the true overage.
 *
 * While prepaid_credits_cents covers a cycle's credits budget, retireForSubscriber
 * consumes it instead of retiring on-chain; retirement resumes automatically
 * once the balance is exhausted.
 *
 * Usage: node dist/scripts/set-prepaid-overage.js [--apply]
 *   (dry-run by default; --apply writes prepaid_credits_cents)
 */

import { initWallet } from "../services/wallet.js";
import { loadConfig } from "../config.js";
import { getDb } from "../server/db.js";

const APPLY = process.argv.includes("--apply");
const USDC_DENOM = "ibc/334740505537E9894A64E8561030695016481830D7B36E6A9B6D13C608B55653";
/** Ignore overages below this (normal rounding / in-flight residue). */
const MIN_OVERAGE_CENTS = 100;

interface TxResponse {
  code: number;
  timestamp: string;
  events?: { type: string; attributes: { key: string; value: string }[] }[];
}

/** Sum USDC received by `addr` from `fromAddr` across all on-chain txs. */
async function usdcReceivedFrom(lcdUrl: string, addr: string, fromAddr: string): Promise<bigint> {
  let total = 0n;
  let page = 1;
  while (true) {
    const query = encodeURIComponent(`coin_received.receiver='${addr}'`);
    const url = `${lcdUrl}/cosmos/tx/v1beta1/txs?query=${query}&pagination.limit=100&page=${page}&order_by=ORDER_BY_ASC`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`LCD ${res.status} for ${addr}`);
    const data = await res.json() as { tx_responses?: TxResponse[]; total?: string };
    const txs = data.tx_responses ?? [];
    for (const tx of txs) {
      if (tx.code !== 0) continue;
      for (const ev of tx.events ?? []) {
        if (ev.type !== "transfer") continue;
        const attrs = Object.fromEntries(ev.attributes.map((a) => [a.key, a.value]));
        if (attrs.recipient !== addr || attrs.sender !== fromAddr) continue;
        for (const part of (attrs.amount ?? "").split(",")) {
          const m = part.match(/^(\d+)(.+)$/);
          if (m && m[2] === USDC_DENOM) total += BigInt(m[1]);
        }
      }
    }
    if (txs.length < 100) break;
    page++;
    if (page > 50) break; // safety
  }
  return total;
}

async function main() {
  console.log(`=== Set prepaid over-retirement balances (${APPLY ? "APPLY" : "dry-run"}) ===\n`);

  const db = getDb();
  const config = loadConfig();
  const { address: masterAddress } = await initWallet();
  console.log(`Master wallet: ${masterAddress}\n`);

  const subscribers = db.prepare(`
    SELECT s.id, s.regen_address, s.status, u.email
    FROM subscribers s LEFT JOIN users u ON u.id = s.user_id
    WHERE s.regen_address IS NOT NULL
    ORDER BY s.id
  `).all() as { id: number; regen_address: string; status: string; email: string | null }[];

  let totalOverage = 0;
  for (const sub of subscribers) {
    const receivedMicro = await usdcReceivedFrom(config.lcdUrl, sub.regen_address, masterAddress);
    const receivedCents = Number(receivedMicro / 10_000n); // 6-exp micro → cents

    const entitled = (db.prepare(
      "SELECT COALESCE(SUM(credits_budget_cents), 0) AS c FROM subscriber_retirements WHERE subscriber_id = ?"
    ).get(sub.id) as { c: number }).c;

    const overage = receivedCents - entitled;
    if (overage < MIN_OVERAGE_CENTS) continue;

    totalOverage += overage;
    console.log(
      `subscriber=${sub.id} (${sub.email ?? "?"}, ${sub.status}) ` +
      `received=$${(receivedCents / 100).toFixed(2)} entitled=$${(entitled / 100).toFixed(2)} ` +
      `→ prepaid $${(overage / 100).toFixed(2)}`
    );

    if (APPLY) {
      db.prepare("UPDATE subscribers SET prepaid_credits_cents = ? WHERE id = ?").run(overage, sub.id);
    }
  }

  console.log(
    `\nTotal prepaid: $${(totalOverage / 100).toFixed(2)}` +
    (APPLY ? " — written to subscribers.prepaid_credits_cents" : " — dry run, nothing written (use --apply)")
  );
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
