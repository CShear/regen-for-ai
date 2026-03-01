/**
 * REGEN token buy-and-burn service.
 *
 * Burns REGEN tokens from the wallet as part of the monthly pool run.
 * The 85/10/5 revenue split allocates 10% for REGEN burns, which
 * drives the flywheel: retirements → REGEN burns → token scarcity
 * → increased demand → more retirements.
 *
 * Phase A: Burns REGEN already in the wallet (manual funding).
 * Phase B (future): Automated USDC → REGEN swap via Osmosis DEX.
 *
 * Uses MsgBurnRegen from regen.ecocredit.v1 (already in proto registry).
 */

import { loadConfig } from "../config.js";
import { initWallet, getBalance, signAndBroadcast } from "./wallet.js";
import {
  getDb,
  createBurn,
  updateBurn,
  type Burn,
} from "../server/db.js";

export interface BurnResult {
  burnId: number;
  status: "completed" | "skipped" | "failed";
  amountUregen: string;
  amountRegen: number;
  allocationCents: number;
  regenPriceUsd: number | null;
  txHash: string | null;
  error: string | null;
}

/** Fetch current REGEN/USD price from CoinGecko (or configured API). */
export async function getRegenPrice(): Promise<number> {
  const config = loadConfig();
  const response = await fetch(config.regenPriceApiUrl);
  if (!response.ok) {
    throw new Error(`Price API error: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as { regen?: { usd?: number } };
  const price = data?.regen?.usd;
  if (typeof price !== "number" || price <= 0) {
    throw new Error(`Invalid REGEN price from API: ${JSON.stringify(data)}`);
  }
  return price;
}

/**
 * Execute a REGEN burn as part of a pool run.
 *
 * 1. Gets current REGEN/USD price
 * 2. Calculates how much REGEN the allocation can buy
 * 3. Checks wallet balance for available REGEN
 * 4. Burns the minimum of (affordable amount, available balance)
 * 5. Records everything in the burns table
 */
export async function executeBurn(options: {
  allocationCents: number;
  poolRunId: number;
  dryRun: boolean;
  dbPath?: string;
}): Promise<BurnResult> {
  const db = getDb(options.dbPath);
  const config = loadConfig();

  // Create burn record
  const burn = createBurn(db, options.poolRunId, options.allocationCents);

  const result: BurnResult = {
    burnId: burn.id,
    status: "skipped",
    amountUregen: "0",
    amountRegen: 0,
    allocationCents: options.allocationCents,
    regenPriceUsd: null,
    txHash: null,
    error: null,
  };

  // Gate: burn must be enabled
  if (!config.burnEnabled) {
    result.error = "REGEN burn disabled (set REGEN_BURN_ENABLED=true to enable)";
    updateBurn(db, burn.id, { status: "skipped", error: result.error });
    return result;
  }

  // Gate: need a budget
  if (options.allocationCents <= 0) {
    result.error = "No burn allocation";
    updateBurn(db, burn.id, { status: "skipped", error: result.error });
    return result;
  }

  // 1. Get REGEN price
  let regenPriceUsd: number;
  try {
    regenPriceUsd = await getRegenPrice();
    result.regenPriceUsd = regenPriceUsd;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.error = `Price fetch failed: ${msg}`;
    result.status = "skipped";
    updateBurn(db, burn.id, { status: "skipped", error: result.error });
    return result;
  }

  // 2. Calculate target burn amount
  const allocationUsd = options.allocationCents / 100;
  const targetRegen = allocationUsd / regenPriceUsd;
  // uregen = REGEN * 10^6
  const targetUregen = BigInt(Math.floor(targetRegen * 1_000_000));

  if (targetUregen <= 0n) {
    result.error = `Allocation too small for any REGEN at $${regenPriceUsd}/REGEN`;
    updateBurn(db, burn.id, {
      status: "skipped",
      regen_price_usd: regenPriceUsd,
      error: result.error,
    });
    return result;
  }

  // 3. Check wallet balance (unless dry run)
  let availableUregen: bigint;
  if (options.dryRun) {
    // In dry run, assume we have enough
    availableUregen = targetUregen;
  } else {
    try {
      availableUregen = await getBalance("uregen");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.error = `Balance check failed: ${msg}`;
      result.status = "failed";
      updateBurn(db, burn.id, {
        status: "failed",
        regen_price_usd: regenPriceUsd,
        error: result.error,
      });
      return result;
    }
  }

  // 4. Determine burn amount (min of target and available)
  // Reserve a small amount for gas (0.1 REGEN = 100000 uregen)
  const GAS_RESERVE = 100_000n;
  const spendableUregen = availableUregen > GAS_RESERVE
    ? availableUregen - GAS_RESERVE
    : 0n;

  const burnUregen = spendableUregen < targetUregen ? spendableUregen : targetUregen;

  if (burnUregen <= 0n) {
    const availableRegen = Number(availableUregen) / 1_000_000;
    result.error = `Insufficient REGEN balance: have ${availableRegen.toFixed(6)} REGEN, need ${targetRegen.toFixed(6)} REGEN (+ gas reserve). Fund wallet with REGEN to enable burns.`;
    result.status = "skipped";
    updateBurn(db, burn.id, {
      status: "skipped",
      regen_price_usd: regenPriceUsd,
      error: result.error,
    });
    return result;
  }

  const burnRegen = Number(burnUregen) / 1_000_000;
  result.amountUregen = burnUregen.toString();
  result.amountRegen = burnRegen;

  // 5. Dry run — report what would be burned
  if (options.dryRun) {
    result.status = "completed";
    updateBurn(db, burn.id, {
      status: "completed",
      amount_uregen: burnUregen.toString(),
      amount_regen: burnRegen,
      regen_price_usd: regenPriceUsd,
    });
    return result;
  }

  // 6. Execute burn transaction
  try {
    const { address } = await initWallet();

    const msg = {
      typeUrl: "/regen.ecocredit.v1.MsgBurnRegen",
      value: {
        burner: address,
        amount: burnUregen.toString(),
        reason: `Monthly pool burn — Regen for AI (pool run #${options.poolRunId})`,
      },
    };

    const txResult = await signAndBroadcast([msg]);

    if (txResult.code !== 0) {
      result.error = `Burn tx failed (code ${txResult.code}): ${txResult.rawLog || "unknown"}`;
      result.status = "failed";
      result.amountUregen = "0";
      result.amountRegen = 0;
      updateBurn(db, burn.id, {
        status: "failed",
        regen_price_usd: regenPriceUsd,
        error: result.error,
      });
      return result;
    }

    result.txHash = txResult.transactionHash;
    result.status = "completed";
    updateBurn(db, burn.id, {
      status: "completed",
      amount_uregen: burnUregen.toString(),
      amount_regen: burnRegen,
      regen_price_usd: regenPriceUsd,
      tx_hash: txResult.transactionHash,
    });

    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.error = `Burn failed: ${msg}`;
    result.status = "failed";
    result.amountUregen = "0";
    result.amountRegen = 0;
    updateBurn(db, burn.id, {
      status: "failed",
      regen_price_usd: regenPriceUsd,
      error: result.error,
    });
    return result;
  }
}

/** Format a burn result for human-readable output. */
export function formatBurnResult(result: BurnResult): string {
  const lines: string[] = [
    `--- REGEN Burn (10%) ---`,
    `  Allocation: $${(result.allocationCents / 100).toFixed(2)}`,
  ];

  if (result.regenPriceUsd !== null) {
    lines.push(`  REGEN Price: $${result.regenPriceUsd.toFixed(4)}`);
  }

  lines.push(
    `  REGEN Burned: ${result.amountRegen.toFixed(6)}`,
    `  Status: ${result.status}`,
  );

  if (result.txHash) {
    lines.push(`  Tx: ${result.txHash}`);
  }
  if (result.error) {
    lines.push(`  Note: ${result.error}`);
  }

  return lines.join("\n");
}
