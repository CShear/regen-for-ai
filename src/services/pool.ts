/**
 * Monthly pool retirement service.
 *
 * Aggregates subscription revenue, applies per-subscriber revenue split
 * (monthly: 75/20/5, yearly: 85/10/5 — credits/ops/burn), then distributes
 * the credit budget equally across all eligible batches on the marketplace.
 *
 * Selection logic:
 *   1. Fetch all sell orders from Regen Ledger (excluded classes filtered by ledger.ts)
 *   2. Group by batch_denom to find unique batches with active sell orders
 *   3. Exclude any additionally excluded batches (EXCLUDED_BATCHES)
 *   4. Divide total credit budget equally by number of eligible batches
 *   5. For each batch, buy as much as the per-batch budget allows (cheapest order first)
 *
 * Burns REGEN tokens and records per-subscriber fractional attributions.
 */

import type Database from "better-sqlite3";
import { listSellOrders, listCreditClasses, getAllowedDenoms } from "./ledger.js";
import type { SellOrder } from "./ledger.js";
import { initWallet, signAndBroadcast } from "./wallet.js";
import { loadConfig } from "../config.js";
import {
  getDb,
  getActiveSubscribers,
  createPoolRun,
  updatePoolRun,
  createAttribution,
  updateAttribution,
  createPoolRunBatch,
  updatePoolRunBatch,
  type Subscriber,
  type PoolRun,
} from "../server/db.js";
import { sendMonthlyEmails } from "./email.js";
import { executeBurn, type BurnResult, formatBurnResult } from "./burn.js";
import { allocateProportional, creditsToMicro, microToCredits } from "./attribution.js";

export interface PoolRunResult {
  poolRunId: number;
  status: "completed" | "partial" | "failed" | "no_subscribers";
  dryRun: boolean;
  subscriberCount: number;
  totalRevenueCents: number;
  creditsBudgetCents: number;
  totalSpentCents: number;
  carryForwardCents: number;
  /** Per-batch results (the primary detailed view) */
  batches: BatchResult[];
  /** Backward-compatible aggregates by credit type category */
  carbon: CreditTypeResult;
  biodiversity: CreditTypeResult;
  uss: CreditTypeResult;
  burn: BurnResult;
  opsAllocationCents: number;
  errors: string[];
}

export interface BatchResult {
  batchDenom: string;
  creditClassId: string;
  creditTypeAbbrev: string;
  budgetCents: number;
  spentCents: number;
  creditsRetired: number;
  sellOrderId: string | null;
  txHash: string | null;
  error: string | null;
}

export interface CreditTypeResult {
  budgetCents: number;
  spentCents: number;
  creditsRetired: number;
  txHash: string | null;
  error: string | null;
}

/**
 * Revenue splits differ by billing interval:
 * - Monthly: 75/20/5 (credits/ops/burn) — higher ops margin funds the business
 * - Yearly:  85/10/5 (credits/ops/burn) — more goes to ecology as reward for commitment
 */
const REVENUE_SPLIT_MONTHLY = {
  credits: 0.75,
  burn: 0.05,
  operations: 0.20,
} as const;

const REVENUE_SPLIT_YEARLY = {
  credits: 0.85,
  burn: 0.05,
  operations: 0.10,
} as const;

/**
 * Batches to exclude beyond the class-level exclusions in ledger.ts.
 * Add specific batch denoms here to skip them during pool runs.
 *
 * Note: Credit classes C01 and C03 (Verra/VCS) are already excluded at the
 * ledger.ts level — listSellOrders() filters them before they reach the pool.
 * This set is for additional per-batch exclusions within otherwise eligible classes.
 */
const EXCLUDED_BATCHES = new Set<string>([
  // Example: "C02-001-20210101-20211231-001"
]);

/** Map credit type abbreviations to the 3 backward-compatible categories */
function creditTypeCategory(abbrev: string): "carbon" | "biodiversity" | "uss" {
  if (abbrev === "C") return "carbon";
  if (abbrev === "BT") return "biodiversity";
  return "uss"; // MBS, USS, KSH, CFC, etc.
}

export async function executePoolRun(options: {
  dryRun: boolean;
  dbPath?: string;
}): Promise<PoolRunResult> {
  const db = getDb(options.dbPath);
  const errors: string[] = [];

  // 1. Query active subscribers
  const subscribers = getActiveSubscribers(db);
  if (subscribers.length === 0) {
    return {
      poolRunId: 0,
      status: "no_subscribers",
      dryRun: options.dryRun,
      subscriberCount: 0,
      totalRevenueCents: 0,
      creditsBudgetCents: 0,
      totalSpentCents: 0,
      carryForwardCents: 0,
      batches: [],
      carbon: emptyCreditResult(),
      biodiversity: emptyCreditResult(),
      uss: emptyCreditResult(),
      burn: emptyBurnResult(),
      opsAllocationCents: 0,
      errors: ["No active subscribers found"],
    };
  }

  // 2. Sum contributions (applying per-subscriber revenue split by billing interval)
  const totalRevenueCents = subscribers.reduce((sum, s) => sum + s.amount_cents, 0);

  let creditsBudgetCents = 0;
  let burnBudgetCents = 0;
  for (const s of subscribers) {
    const split = s.billing_interval === "yearly" ? REVENUE_SPLIT_YEARLY : REVENUE_SPLIT_MONTHLY;
    creditsBudgetCents += Math.floor(s.amount_cents * split.credits);
    burnBudgetCents += Math.floor(s.amount_cents * split.burn);
  }
  const opsAllocationCents = totalRevenueCents - creditsBudgetCents - burnBudgetCents;

  // 3. Create pool_run record
  const poolRun = createPoolRun(db, options.dryRun);
  updatePoolRun(db, poolRun.id, {
    total_revenue_cents: totalRevenueCents,
    subscriber_count: subscribers.length,
  });

  // 4. Verify wallet is available (unless dry run)
  let walletAddress: string | undefined;
  if (!options.dryRun) {
    try {
      const { address } = await initWallet();
      walletAddress = address;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Wallet init failed: ${msg}`);
      updatePoolRun(db, poolRun.id, {
        status: "failed",
        error_log: JSON.stringify(errors),
        completed_at: new Date().toISOString(),
      });
      return {
        poolRunId: poolRun.id,
        status: "failed",
        dryRun: options.dryRun,
        subscriberCount: subscribers.length,
        totalRevenueCents,
        creditsBudgetCents: 0,
        totalSpentCents: 0,
        carryForwardCents: totalRevenueCents,
        batches: [],
        carbon: emptyCreditResult(),
        biodiversity: emptyCreditResult(),
        uss: emptyCreditResult(),
        burn: emptyBurnResult(),
        opsAllocationCents: 0,
        errors,
      };
    }
  }

  // 5. Fetch all eligible sell orders and group by batch
  const [sellOrders, classes, allowedDenoms] = await Promise.all([
    listSellOrders(),
    listCreditClasses(),
    getAllowedDenoms(),
  ]);

  // Build class ID → credit type abbreviation map
  const classTypeMap = new Map<string, string>();
  for (const cls of classes) {
    classTypeMap.set(cls.id, cls.credit_type_abbrev);
  }

  // Filter out expired orders and excluded batches
  const now = new Date();
  const eligibleOrders = sellOrders.filter((order) => {
    if (EXCLUDED_BATCHES.has(order.batch_denom)) return false;
    if (order.expiration) {
      const expDate = new Date(order.expiration);
      if (expDate <= now) return false;
    }
    if (parseFloat(order.quantity) <= 0) return false;
    return true;
  });

  // Group by batch_denom
  const batchOrdersMap = new Map<string, SellOrder[]>();
  for (const order of eligibleOrders) {
    const existing = batchOrdersMap.get(order.batch_denom) ?? [];
    existing.push(order);
    batchOrdersMap.set(order.batch_denom, existing);
  }

  const batchDenoms = Array.from(batchOrdersMap.keys()).sort();
  const numBatches = batchDenoms.length;

  if (numBatches === 0) {
    errors.push("No eligible sell orders found on marketplace");
    updatePoolRun(db, poolRun.id, {
      status: "failed",
      error_log: JSON.stringify(errors),
      completed_at: new Date().toISOString(),
    });
    return {
      poolRunId: poolRun.id,
      status: "failed",
      dryRun: options.dryRun,
      subscriberCount: subscribers.length,
      totalRevenueCents,
      creditsBudgetCents,
      totalSpentCents: 0,
      carryForwardCents: creditsBudgetCents,
      batches: [],
      carbon: emptyCreditResult(),
      biodiversity: emptyCreditResult(),
      uss: emptyCreditResult(),
      burn: emptyBurnResult(),
      opsAllocationCents,
      errors,
    };
  }

  // 6. Divide budget equally across all eligible batches
  const perBatchBudgetCents = Math.floor(creditsBudgetCents / numBatches);
  const budgetRemainder = creditsBudgetCents - (perBatchBudgetCents * numBatches);

  // Determine payment denom (prefer USDC, fall back to REGEN)
  const usdcDenom = allowedDenoms.find(
    (d) => d.display_denom === "USDC" || d.display_denom === "eUSDC" ||
           d.bank_denom.includes("usdc") || d.bank_denom.includes("erc20")
  );
  const regenDenom = allowedDenoms.find(
    (d) => d.display_denom === "REGEN" || d.bank_denom === "uregen"
  );
  const paymentDenom = usdcDenom ?? regenDenom ?? allowedDenoms[0];
  const denomExponent = paymentDenom?.exponent ?? 6;
  const denomBankDenom = paymentDenom?.bank_denom ?? "uregen";

  // 7. Purchase from each batch
  const batchResults: BatchResult[] = [];
  const config = loadConfig();

  for (let i = 0; i < batchDenoms.length; i++) {
    const batchDenom = batchDenoms[i];
    const orders = batchOrdersMap.get(batchDenom)!;
    const classId = batchDenom.replace(/-\d.*$/, "");
    const typeAbbrev = classTypeMap.get(classId) ?? "?";

    // Give any remainder cents to the first batch
    const thisBudgetCents = perBatchBudgetCents + (i === 0 ? budgetRemainder : 0);

    const batchResult: BatchResult = {
      batchDenom,
      creditClassId: classId,
      creditTypeAbbrev: typeAbbrev,
      budgetCents: thisBudgetCents,
      spentCents: 0,
      creditsRetired: 0,
      sellOrderId: null,
      txHash: null,
      error: null,
    };

    // Record in DB
    const dbBatch = createPoolRunBatch(db, poolRun.id, batchDenom, classId, typeAbbrev, thisBudgetCents);

    if (thisBudgetCents <= 0) {
      batchResult.error = "No budget allocated";
      updatePoolRunBatch(db, dbBatch.id, { error: batchResult.error });
      batchResults.push(batchResult);
      continue;
    }

    try {
      // Filter orders for this batch that match our payment denom
      let batchOrders = orders.filter((o) => o.ask_denom === denomBankDenom);
      if (batchOrders.length === 0) {
        // Fall back to any denom if no orders in preferred denom
        batchOrders = orders;
      }

      // Sort by ask_amount ascending (cheapest first within this batch)
      batchOrders.sort((a, b) => {
        const aPrice = BigInt(a.ask_amount);
        const bPrice = BigInt(b.ask_amount);
        if (aPrice < bPrice) return -1;
        if (aPrice > bPrice) return 1;
        return 0;
      });

      // Convert budget to micro-units
      const budgetMicro = BigInt(thisBudgetCents) * BigInt(10 ** Math.max(denomExponent - 2, 0));

      // Fill from cheapest available order
      let remainingBudget = budgetMicro;
      let totalCredits = 0;
      let totalCostMicro = 0n;
      const selectedOrders: { order: SellOrder; quantity: string; costMicro: bigint }[] = [];

      for (const order of batchOrders) {
        if (remainingBudget <= 0n) break;
        const available = parseFloat(order.quantity);
        if (available <= 0) continue;

        const pricePerCredit = BigInt(order.ask_amount);
        if (pricePerCredit <= 0n) continue;

        // Max credits we can afford from this order
        const maxAffordable = Number(remainingBudget) / Number(pricePerCredit);
        const take = Math.min(maxAffordable, available);
        if (take < 0.000001) continue;

        const costMicro = (pricePerCredit * BigInt(Math.ceil(take * 1_000_000))) / 1_000_000n;

        selectedOrders.push({ order, quantity: take.toFixed(6), costMicro });
        totalCredits += take;
        totalCostMicro += costMicro;
        remainingBudget -= costMicro;
      }

      if (selectedOrders.length === 0) {
        batchResult.error = `No affordable orders for batch ${batchDenom}`;
        errors.push(batchResult.error);
        updatePoolRunBatch(db, dbBatch.id, { error: batchResult.error });
        batchResults.push(batchResult);
        continue;
      }

      batchResult.creditsRetired = totalCredits;
      batchResult.spentCents = Number(totalCostMicro / BigInt(10 ** Math.max(denomExponent - 2, 0)));
      batchResult.sellOrderId = selectedOrders.map((s) => s.order.id).join(",");

      if (options.dryRun) {
        updatePoolRunBatch(db, dbBatch.id, {
          spent_cents: batchResult.spentCents,
          credits_retired: batchResult.creditsRetired,
          sell_order_id: batchResult.sellOrderId,
        });
        batchResults.push(batchResult);
        continue;
      }

      // Build and broadcast MsgBuyDirect
      const buyOrders = selectedOrders.map((s) => ({
        sellOrderId: BigInt(s.order.id),
        quantity: s.quantity,
        bidPrice: {
          denom: s.order.ask_denom,
          amount: s.order.ask_amount,
        },
        disableAutoRetire: false,
        retirementJurisdiction: config.defaultJurisdiction,
        retirementReason: `Monthly pool retirement — Regen Compute`,
      }));

      const msg = {
        typeUrl: "/regen.ecocredit.marketplace.v1.MsgBuyDirect",
        value: {
          buyer: walletAddress,
          orders: buyOrders,
        },
      };

      const txResult = await signAndBroadcast([msg]);

      if (txResult.code !== 0) {
        batchResult.error = `Tx failed (code ${txResult.code}): ${txResult.rawLog || "unknown"}`;
        batchResult.creditsRetired = 0;
        batchResult.spentCents = 0;
        errors.push(`${batchDenom}: ${batchResult.error}`);
        updatePoolRunBatch(db, dbBatch.id, { error: batchResult.error });
      } else {
        batchResult.txHash = txResult.transactionHash;
        updatePoolRunBatch(db, dbBatch.id, {
          spent_cents: batchResult.spentCents,
          credits_retired: batchResult.creditsRetired,
          sell_order_id: batchResult.sellOrderId,
          tx_hash: batchResult.txHash,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      batchResult.error = `${batchDenom}: ${msg}`;
      batchResult.creditsRetired = 0;
      batchResult.spentCents = 0;
      errors.push(batchResult.error);
      updatePoolRunBatch(db, dbBatch.id, { error: batchResult.error });
    }

    batchResults.push(batchResult);
  }

  // 8. Aggregate into backward-compatible category results
  const carbon = aggregateByCategory(batchResults, "carbon");
  const biodiversity = aggregateByCategory(batchResults, "biodiversity");
  const uss = aggregateByCategory(batchResults, "uss");

  // 9. Execute REGEN burn
  let burnResult: BurnResult;
  try {
    burnResult = await executeBurn({
      allocationCents: burnBudgetCents,
      poolRunId: poolRun.id,
      dryRun: options.dryRun,
      dbPath: options.dbPath,
    });
    if (burnResult.error) {
      errors.push(`Burn: ${burnResult.error}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Burn failed: ${msg}`);
    burnResult = emptyBurnResult();
    burnResult.allocationCents = burnBudgetCents;
    burnResult.error = msg;
  }

  // 10. Calculate totals
  const totalSpentCents = batchResults.reduce((sum, b) => sum + b.spentCents, 0);
  const carryForwardCents = creditsBudgetCents - totalSpentCents;

  // 11. Determine overall status
  const anySuccess = batchResults.some((b) => b.creditsRetired > 0);
  const allSuccess = batchResults.every((b) => b.error === null);
  let status: "completed" | "partial" | "failed";
  if (options.dryRun) {
    status = "completed";
  } else if (allSuccess && anySuccess) {
    status = "completed";
  } else if (anySuccess) {
    status = "partial";
  } else {
    status = "failed";
  }

  // 12. Update pool_run record (backward-compatible columns)
  updatePoolRun(db, poolRun.id, {
    status,
    total_spent_cents: totalSpentCents,
    carbon_credits_retired: carbon.creditsRetired,
    carbon_tx_hash: carbon.txHash,
    biodiversity_credits_retired: biodiversity.creditsRetired,
    biodiversity_tx_hash: biodiversity.txHash,
    uss_credits_retired: uss.creditsRetired,
    uss_tx_hash: uss.txHash,
    burn_allocation_cents: burnBudgetCents,
    burn_tx_hash: burnResult.txHash,
    ops_allocation_cents: opsAllocationCents,
    carry_forward_cents: carryForwardCents,
    error_log: errors.length > 0 ? JSON.stringify(errors) : null,
    completed_at: new Date().toISOString(),
  });

  // 13. Calculate and record per-subscriber attributions
  recordAttributions(db, poolRun.id, subscribers, totalRevenueCents, carbon, biodiversity, uss);

  const result: PoolRunResult = {
    poolRunId: poolRun.id,
    status,
    dryRun: options.dryRun,
    subscriberCount: subscribers.length,
    totalRevenueCents,
    creditsBudgetCents,
    totalSpentCents,
    carryForwardCents,
    batches: batchResults,
    carbon,
    biodiversity,
    uss,
    burn: burnResult,
    opsAllocationCents,
    errors,
  };

  // 14. Send monthly certificate emails (non-blocking)
  if (!options.dryRun && (status === "completed" || status === "partial")) {
    try {
      await sendMonthlyEmails(poolRun.id, subscribers, db, result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Email sending failed: ${msg}`);
    }
  }

  return result;
}

/** Aggregate batch results into a backward-compatible category result */
function aggregateByCategory(
  batches: BatchResult[],
  category: "carbon" | "biodiversity" | "uss"
): CreditTypeResult {
  const matching = batches.filter((b) => creditTypeCategory(b.creditTypeAbbrev) === category);
  const txHashes = matching.map((b) => b.txHash).filter(Boolean) as string[];
  const errs = matching.map((b) => b.error).filter(Boolean) as string[];

  return {
    budgetCents: matching.reduce((sum, b) => sum + b.budgetCents, 0),
    spentCents: matching.reduce((sum, b) => sum + b.spentCents, 0),
    creditsRetired: matching.reduce((sum, b) => sum + b.creditsRetired, 0),
    txHash: txHashes.length > 0 ? txHashes.join(",") : null,
    error: errs.length > 0 ? errs.join("; ") : null,
  };
}

function recordAttributions(
  db: Database.Database,
  poolRunId: number,
  subscribers: Subscriber[],
  totalRevenueCents: number,
  carbon: CreditTypeResult,
  biodiversity: CreditTypeResult,
  uss: CreditTypeResult
): void {
  if (totalRevenueCents <= 0 || subscribers.length === 0) return;

  // Audit C1: previously this used `sub.amount_cents / totalRevenueCents` then
  // multiplied each retired total by that float fraction. Per-subscriber shares
  // could drift such that their sum was not exactly the retired total. Now
  // computed in bigint micro-credits via Hamilton's largest-remainder method,
  // which guarantees the shares sum exactly to creditsToMicro(creditsRetired).
  const weights = subscribers.map((s) => BigInt(s.amount_cents));
  const carbonShares = allocateProportional(creditsToMicro(carbon.creditsRetired), weights);
  const biodiversityShares = allocateProportional(creditsToMicro(biodiversity.creditsRetired), weights);
  const ussShares = allocateProportional(creditsToMicro(uss.creditsRetired), weights);

  const txn = db.transaction(() => {
    for (let i = 0; i < subscribers.length; i++) {
      const sub = subscribers[i];
      const attr = createAttribution(db, poolRunId, sub.id, sub.amount_cents);
      updateAttribution(db, attr.id, {
        carbon_credits: microToCredits(carbonShares[i]),
        biodiversity_credits: microToCredits(biodiversityShares[i]),
        uss_credits: microToCredits(ussShares[i]),
      });
    }
  });
  txn();
}

function emptyCreditResult(): CreditTypeResult {
  return {
    budgetCents: 0,
    spentCents: 0,
    creditsRetired: 0,
    txHash: null,
    error: null,
  };
}

function emptyBurnResult(): BurnResult {
  return {
    burnId: 0,
    status: "skipped",
    amountUregen: "0",
    amountRegen: 0,
    allocationCents: 0,
    regenPriceUsd: null,
    txHash: null,
    error: null,
  };
}

/** Format pool run result as a human-readable summary */
export function formatPoolRunResult(result: PoolRunResult): string {
  const lines: string[] = [
    `=== Pool Run #${result.poolRunId} ===`,
    `Status: ${result.status}${result.dryRun ? " (DRY RUN)" : ""}`,
    `Subscribers: ${result.subscriberCount}`,
    `Total Revenue: $${(result.totalRevenueCents / 100).toFixed(2)}`,
    `  Credits: $${(result.creditsBudgetCents / 100).toFixed(2)} (${result.totalRevenueCents ? Math.round(result.creditsBudgetCents / result.totalRevenueCents * 100) : 0}%)`,
    `  Burn: $${(result.burn.allocationCents / 100).toFixed(2)} (5%)`,
    `  Operations: $${(result.opsAllocationCents / 100).toFixed(2)} (${result.totalRevenueCents ? Math.round(result.opsAllocationCents / result.totalRevenueCents * 100) : 0}%)`,
    `Credits Spent: $${(result.totalSpentCents / 100).toFixed(2)}`,
    `Carry Forward: $${(result.carryForwardCents / 100).toFixed(2)}`,
    ``,
    `--- Per-Batch Breakdown (${result.batches.length} batches, equal $ allocation) ---`,
  ];

  for (const batch of result.batches) {
    const status = batch.error ? `ERROR: ${batch.error}` : `${batch.creditsRetired.toFixed(6)} credits`;
    lines.push(
      `  ${batch.batchDenom} [${batch.creditTypeAbbrev}]`,
      `    Budget: $${(batch.budgetCents / 100).toFixed(2)} | Spent: $${(batch.spentCents / 100).toFixed(2)} | ${status}`,
      ...(batch.txHash ? [`    Tx: ${batch.txHash}`] : []),
    );
  }

  lines.push(
    ``,
    `--- Aggregated by Type ---`,
    `  Carbon (C): ${result.carbon.creditsRetired.toFixed(6)} credits ($${(result.carbon.spentCents / 100).toFixed(2)})`,
    `  Biodiversity (BT): ${result.biodiversity.creditsRetired.toFixed(6)} credits ($${(result.biodiversity.spentCents / 100).toFixed(2)})`,
    `  Other (MBS/USS/KSH/CFC): ${result.uss.creditsRetired.toFixed(6)} credits ($${(result.uss.spentCents / 100).toFixed(2)})`,
    ``,
    formatBurnResult(result.burn),
  );

  if (result.errors.length > 0) {
    lines.push(``, `--- Errors ---`);
    for (const err of result.errors) {
      lines.push(`  - ${err}`);
    }
  }

  return lines.join("\n");
}
