/**
 * Monthly pool retirement service.
 *
 * Aggregates subscription revenue, applies 85/10/5 revenue split
 * (credits/REGEN burn/operations), allocates credit budget across
 * credit types (50/30/20), executes on-chain retirements via MsgBuyDirect,
 * burns REGEN tokens, and records per-subscriber fractional attributions.
 */

import type Database from "better-sqlite3";
import { selectBestOrders, type OrderSelection } from "./order-selector.js";
import { initWallet, signAndBroadcast } from "./wallet.js";
import { loadConfig } from "../config.js";
import {
  getDb,
  getActiveSubscribers,
  createPoolRun,
  updatePoolRun,
  createAttribution,
  updateAttribution,
  type Subscriber,
  type PoolRun,
} from "../server/db.js";
import { sendMonthlyEmails } from "./email.js";
import { executeBurn, type BurnResult, formatBurnResult } from "./burn.js";

export interface PoolRunResult {
  poolRunId: number;
  status: "completed" | "partial" | "failed" | "no_subscribers";
  dryRun: boolean;
  subscriberCount: number;
  totalRevenueCents: number;
  creditsBudgetCents: number;
  totalSpentCents: number;
  carryForwardCents: number;
  carbon: CreditTypeResult;
  biodiversity: CreditTypeResult;
  uss: CreditTypeResult;
  burn: BurnResult;
  opsAllocationCents: number;
  errors: string[];
}

export interface CreditTypeResult {
  budgetCents: number;
  spentCents: number;
  creditsRetired: number;
  txHash: string | null;
  error: string | null;
}

/** Revenue split: 85% credit purchases / 10% REGEN burn / 5% operations */
const REVENUE_SPLIT = {
  credits: 0.85,
  burn: 0.10,
  operations: 0.05,
} as const;

/** Allocation percentages for each credit type (within the credits budget) */
const ALLOCATIONS = {
  carbon: 0.5,
  biodiversity: 0.3,
  uss: 0.2,
} as const;

/** Credit type abbreviation filters for order-selector */
const CREDIT_ABBREVS: Record<string, string[]> = {
  carbon: ["C"],
  biodiversity: ["BT"],
  uss: ["MBS", "USS", "KSH"],
};

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
      carbon: emptyCreditResult(),
      biodiversity: emptyCreditResult(),
      uss: emptyCreditResult(),
      burn: emptyBurnResult(),
      opsAllocationCents: 0,
      errors: ["No active subscribers found"],
    };
  }

  // 2. Sum contributions
  const totalRevenueCents = subscribers.reduce((sum, s) => sum + s.amount_cents, 0);

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
        carbon: emptyCreditResult(),
        biodiversity: emptyCreditResult(),
        uss: emptyCreditResult(),
        burn: emptyBurnResult(),
        opsAllocationCents: 0,
        errors,
      };
    }
  }

  // 5. Apply 85/10/5 revenue split
  const creditsBudgetCents = Math.floor(totalRevenueCents * REVENUE_SPLIT.credits);
  const burnBudgetCents = Math.floor(totalRevenueCents * REVENUE_SPLIT.burn);
  const opsAllocationCents = totalRevenueCents - creditsBudgetCents - burnBudgetCents;

  // 5b. Calculate budgets per credit type (within credits budget)
  const carbonBudget = Math.floor(creditsBudgetCents * ALLOCATIONS.carbon);
  const biodiversityBudget = Math.floor(creditsBudgetCents * ALLOCATIONS.biodiversity);
  const ussBudget = creditsBudgetCents - carbonBudget - biodiversityBudget;

  // 6. Execute purchases for each credit type
  const carbonResult = await purchaseCreditType(
    "carbon", carbonBudget, walletAddress, options.dryRun, errors
  );
  const biodiversityResult = await purchaseCreditType(
    "biodiversity", biodiversityBudget, walletAddress, options.dryRun, errors
  );
  const ussResult = await purchaseCreditType(
    "uss", ussBudget, walletAddress, options.dryRun, errors
  );

  // 7. Execute REGEN burn
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

  // 8. Calculate totals
  const totalSpentCents = carbonResult.spentCents + biodiversityResult.spentCents + ussResult.spentCents;
  const carryForwardCents = creditsBudgetCents - totalSpentCents;

  // 9. Determine overall status
  const anySuccess = carbonResult.creditsRetired > 0 || biodiversityResult.creditsRetired > 0 || ussResult.creditsRetired > 0;
  const allSuccess = carbonResult.error === null && biodiversityResult.error === null && ussResult.error === null;
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

  // 10. Update pool_run record
  updatePoolRun(db, poolRun.id, {
    status,
    total_spent_cents: totalSpentCents,
    carbon_credits_retired: carbonResult.creditsRetired,
    carbon_tx_hash: carbonResult.txHash,
    biodiversity_credits_retired: biodiversityResult.creditsRetired,
    biodiversity_tx_hash: biodiversityResult.txHash,
    uss_credits_retired: ussResult.creditsRetired,
    uss_tx_hash: ussResult.txHash,
    burn_allocation_cents: burnBudgetCents,
    burn_tx_hash: burnResult.txHash,
    ops_allocation_cents: opsAllocationCents,
    carry_forward_cents: carryForwardCents,
    error_log: errors.length > 0 ? JSON.stringify(errors) : null,
    completed_at: new Date().toISOString(),
  });

  // 11. Calculate and record per-subscriber attributions
  recordAttributions(db, poolRun.id, subscribers, totalRevenueCents, carbonResult, biodiversityResult, ussResult);

  const result: PoolRunResult = {
    poolRunId: poolRun.id,
    status,
    dryRun: options.dryRun,
    subscriberCount: subscribers.length,
    totalRevenueCents,
    creditsBudgetCents,
    totalSpentCents,
    carryForwardCents,
    carbon: carbonResult,
    biodiversity: biodiversityResult,
    uss: ussResult,
    burn: burnResult,
    opsAllocationCents,
    errors,
  };

  // 12. Send monthly certificate emails (non-blocking)
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

async function purchaseCreditType(
  creditType: keyof typeof CREDIT_ABBREVS,
  budgetCents: number,
  walletAddress: string | undefined,
  dryRun: boolean,
  errors: string[]
): Promise<CreditTypeResult> {
  const result = emptyCreditResult();
  result.budgetCents = budgetCents;

  if (budgetCents <= 0) {
    return result;
  }

  try {
    // Estimate quantity from budget: first find cheapest sell orders to get pricing
    // Start with a large quantity estimate, then trim based on actual cost
    const abbrevs = CREDIT_ABBREVS[creditType];
    const probe = await selectBestOrders(undefined, 1000, undefined, abbrevs);

    if (probe.orders.length === 0) {
      result.error = `No sell orders available for ${creditType}`;
      errors.push(result.error);
      return result;
    }

    // Calculate how many credits we can afford within budget
    // Budget is in cents, cost is in micro-units of payment denom
    // Convert budget cents to micro-units: cents * 10^(exponent-2)
    const budgetMicro = BigInt(budgetCents) * BigInt(10 ** Math.max(probe.exponent - 2, 0));

    // Find cheapest price per credit to estimate max quantity
    const cheapestAsk = BigInt(probe.orders[0].askAmount);
    if (cheapestAsk <= 0n) {
      result.error = `Invalid ask amount for ${creditType}`;
      errors.push(result.error);
      return result;
    }

    // Estimate quantity we can afford (conservative: use cheapest price)
    const estimatedQuantity = Number(budgetMicro / cheapestAsk);
    if (estimatedQuantity < 0.000001) {
      result.error = `Budget too small for any ${creditType} credits ($${(budgetCents / 100).toFixed(2)})`;
      errors.push(result.error);
      return result;
    }

    // Now select actual orders up to our affordable quantity
    const selection = await selectBestOrders(undefined, estimatedQuantity, undefined, abbrevs);

    if (selection.orders.length === 0) {
      result.error = `No orders filled for ${creditType}`;
      errors.push(result.error);
      return result;
    }

    // Verify total cost is within budget
    let finalSelection = selection;
    if (selection.totalCostMicro > budgetMicro) {
      // Trim to fit budget — reduce quantity
      const ratio = Number(budgetMicro) / Number(selection.totalCostMicro);
      const adjustedQuantity = Math.max(estimatedQuantity * ratio * 0.99, 0.000001); // 1% safety margin
      finalSelection = await selectBestOrders(undefined, adjustedQuantity, undefined, abbrevs);
      if (finalSelection.orders.length === 0 || finalSelection.totalCostMicro > budgetMicro) {
        result.error = `Cannot fit ${creditType} purchase within budget after adjustment`;
        errors.push(result.error);
        return result;
      }
    }

    result.creditsRetired = parseFloat(finalSelection.totalQuantity);
    result.spentCents = Number(finalSelection.totalCostMicro / BigInt(10 ** Math.max(finalSelection.exponent - 2, 0)));

    if (dryRun) {
      return result;
    }

    // Build and broadcast MsgBuyDirect
    const config = loadConfig();
    const buyOrders = finalSelection.orders.map((order) => ({
      sellOrderId: BigInt(order.sellOrderId),
      quantity: order.quantity,
      bidPrice: {
        denom: order.askDenom,
        amount: order.askAmount,
      },
      disableAutoRetire: false,
      retirementJurisdiction: config.defaultJurisdiction,
      retirementReason: `Monthly pool retirement — Regen for AI`,
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
      result.error = `Transaction failed (code ${txResult.code}): ${txResult.rawLog || "unknown"}`;
      result.creditsRetired = 0;
      result.spentCents = 0;
      errors.push(result.error);
      return result;
    }

    result.txHash = txResult.transactionHash;
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.error = `${creditType} purchase failed: ${msg}`;
    result.creditsRetired = 0;
    result.spentCents = 0;
    errors.push(result.error);
    return result;
  }
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
  if (totalRevenueCents <= 0) return;

  const txn = db.transaction(() => {
    for (const sub of subscribers) {
      const fraction = sub.amount_cents / totalRevenueCents;
      const attr = createAttribution(db, poolRunId, sub.id, sub.amount_cents);
      updateAttribution(db, attr.id, {
        carbon_credits: carbon.creditsRetired * fraction,
        biodiversity_credits: biodiversity.creditsRetired * fraction,
        uss_credits: uss.creditsRetired * fraction,
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
    `  Credits (85%): $${(result.creditsBudgetCents / 100).toFixed(2)}`,
    `  Burn (10%): $${(result.burn.allocationCents / 100).toFixed(2)}`,
    `  Operations (5%): $${(result.opsAllocationCents / 100).toFixed(2)}`,
    `Credits Spent: $${(result.totalSpentCents / 100).toFixed(2)}`,
    `Carry Forward: $${(result.carryForwardCents / 100).toFixed(2)}`,
    ``,
    `--- Carbon (50% of credits) ---`,
    `  Budget: $${(result.carbon.budgetCents / 100).toFixed(2)}`,
    `  Spent: $${(result.carbon.spentCents / 100).toFixed(2)}`,
    `  Credits Retired: ${result.carbon.creditsRetired.toFixed(6)}`,
    ...(result.carbon.txHash ? [`  Tx: ${result.carbon.txHash}`] : []),
    ...(result.carbon.error ? [`  Error: ${result.carbon.error}`] : []),
    ``,
    `--- Biodiversity (30% of credits) ---`,
    `  Budget: $${(result.biodiversity.budgetCents / 100).toFixed(2)}`,
    `  Spent: $${(result.biodiversity.spentCents / 100).toFixed(2)}`,
    `  Credits Retired: ${result.biodiversity.creditsRetired.toFixed(6)}`,
    ...(result.biodiversity.txHash ? [`  Tx: ${result.biodiversity.txHash}`] : []),
    ...(result.biodiversity.error ? [`  Error: ${result.biodiversity.error}`] : []),
    ``,
    `--- USS/Marine (20% of credits) ---`,
    `  Budget: $${(result.uss.budgetCents / 100).toFixed(2)}`,
    `  Spent: $${(result.uss.spentCents / 100).toFixed(2)}`,
    `  Credits Retired: ${result.uss.creditsRetired.toFixed(6)}`,
    ...(result.uss.txHash ? [`  Tx: ${result.uss.txHash}`] : []),
    ...(result.uss.error ? [`  Error: ${result.uss.error}`] : []),
    ``,
    formatBurnResult(result.burn),
  ];

  if (result.errors.length > 0) {
    lines.push(``, `--- Errors ---`);
    for (const err of result.errors) {
      lines.push(`  - ${err}`);
    }
  }

  return lines.join("\n");
}
