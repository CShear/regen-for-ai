/**
 * REGEN buy-back-and-burn pipeline.
 *
 * Executes the 5% burn allocation from the revenue split:
 * 1. Swap USDC (or OSMO) → REGEN on Osmosis DEX
 * 2. IBC transfer REGEN from Osmosis → Regen Network
 * 3. Burn the REGEN on Regen Network (existing burn service)
 *
 * Prerequisites:
 * - Same HD mnemonic derives both regen1... and osmo1... addresses
 * - Osmosis wallet must be funded with USDC/OSMO for swaps + gas
 * - Regen wallet needs uregen for gas (burn tx + IBC receive is free)
 *
 * Osmosis SQS router (https://sqs.osmosis.zone) provides optimal
 * swap routes. No API key required.
 */

import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { SigningStargateClient, GasPrice, calculateFee } from "@cosmjs/stargate";
import { Registry } from "@cosmjs/proto-signing";
import {
  getSigningOsmosisClientOptions,
  osmosis,
  ibc as ibcOsmojs,
} from "osmojs";
import { loadConfig } from "../config.js";
import { getRegenPrice } from "./burn.js";
import { initWallet, signAndBroadcast } from "./wallet.js";
import type { EncodeObject } from "@cosmjs/proto-signing";

// --- Constants ---

const OSMOSIS_RPC = process.env.OSMOSIS_RPC_URL || "https://rpc.osmosis.zone";
const OSMOSIS_CHAIN_ID = "osmosis-1";
const OSMOSIS_GAS_PRICE = "0.035uosmo"; // base fee is dynamic (~0.03); 0.035 gives headroom

// IBC channels
const OSMOSIS_TO_REGEN_CHANNEL = "channel-8";    // Osmosis → Regen
const REGEN_TO_OSMOSIS_CHANNEL = "channel-1";     // Regen → Osmosis (for reference)

// Denoms on Osmosis
const REGEN_ON_OSMOSIS = "ibc/1DCC8A6CB5689018431323953344A9F6CC4D0BFB261E88C9F7777372C10CD076";
const USDC_AXL_ON_OSMOSIS = "ibc/D189335C6E4A68B513C10AB227BF1C1D38C746766278BA3EEB4FB14124F1D858";
const UOSMO = "uosmo";
const ATOM_ON_OSMOSIS = "ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2";

// SQS router for optimal swap routing
const SQS_ROUTER_URL = "https://sqs.osmosis.zone";

// IBC timeout: 10 minutes from now
const IBC_TIMEOUT_SECONDS = 600;

// --- Types ---

export interface SwapAndBurnResult {
  status: "completed" | "partial" | "failed";
  allocationCents: number;
  regenPriceUsd: number | null;
  targetRegenAmount: number;

  // Step 1: Swap
  swapTxHash: string | null;
  swapAmountIn: string;
  swapDenomIn: string;
  swapAmountOut: string;

  // Step 2: IBC transfer
  ibcTxHash: string | null;
  ibcAmountUregen: string;

  // Step 3: Burn
  burnTxHash: string | null;
  burnAmountUregen: string;

  errors: string[];
}

// --- Osmosis wallet (singleton) ---

let _osmoWallet: DirectSecp256k1HdWallet | undefined;
let _osmoClient: SigningStargateClient | undefined;
let _osmoAddress: string | undefined;

async function initOsmosisWallet(): Promise<{
  address: string;
  client: SigningStargateClient;
}> {
  if (_osmoWallet && _osmoClient && _osmoAddress) {
    return { address: _osmoAddress, client: _osmoClient };
  }

  const config = loadConfig();
  if (!config.walletMnemonic) {
    throw new Error("REGEN_WALLET_MNEMONIC is not configured");
  }

  _osmoWallet = await DirectSecp256k1HdWallet.fromMnemonic(
    config.walletMnemonic,
    { prefix: "osmo" }
  );

  const [account] = await _osmoWallet.getAccounts();
  _osmoAddress = account.address;

  // Build signing client with Osmosis proto registry
  // Use 'as any' to bridge osmojs's bundled @cosmjs types with ours
  const clientOptions = getSigningOsmosisClientOptions();
  _osmoClient = await SigningStargateClient.connectWithSigner(
    OSMOSIS_RPC,
    _osmoWallet,
    {
      registry: clientOptions.registry as any,
      aminoTypes: clientOptions.aminoTypes as any,
      gasPrice: GasPrice.fromString(OSMOSIS_GAS_PRICE),
    }
  );

  return { address: _osmoAddress, client: _osmoClient };
}

// --- SQS Router ---

interface SQSRoute {
  amount_in: { denom: string; amount: string };
  amount_out: string;
  route: Array<{
    pools: Array<{
      id: number;
      type: number;
      token_out_denom: string;
    }>;
  }>;
}

/** Get optimal swap route from Osmosis SQS router. */
async function getSwapRoute(
  tokenInDenom: string,
  tokenInAmount: string,
  tokenOutDenom: string
): Promise<SQSRoute> {
  const url = `${SQS_ROUTER_URL}/router/quote?tokenIn=${tokenInAmount}${tokenInDenom}&tokenOutDenom=${tokenOutDenom}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SQS router error (${res.status}): ${text}`);
  }
  return (await res.json()) as SQSRoute;
}

// --- Core pipeline ---

/**
 * Execute the full swap-and-burn pipeline.
 *
 * @param allocationCents - Dollar amount (in cents) allocated to burn
 * @param dryRun - If true, log what would happen without executing
 * @param swapDenom - Which denom to swap from on Osmosis ("usdc", "osmo", or "atom")
 */
export async function swapAndBurn(options: {
  allocationCents: number;
  dryRun?: boolean;
  swapDenom?: "usdc" | "osmo" | "atom";
}): Promise<SwapAndBurnResult> {
  const { allocationCents, dryRun = false, swapDenom = "usdc" } = options;

  const result: SwapAndBurnResult = {
    status: "failed",
    allocationCents,
    regenPriceUsd: null,
    targetRegenAmount: 0,
    swapTxHash: null,
    swapAmountIn: "0",
    swapDenomIn: swapDenom === "usdc" ? USDC_AXL_ON_OSMOSIS : swapDenom === "atom" ? ATOM_ON_OSMOSIS : UOSMO,
    swapAmountOut: "0",
    ibcTxHash: null,
    ibcAmountUregen: "0",
    burnTxHash: null,
    burnAmountUregen: "0",
    errors: [],
  };

  // --- Preflight ---

  // Get REGEN price for target calculation
  let regenPriceUsd: number;
  try {
    regenPriceUsd = await getRegenPrice();
    result.regenPriceUsd = regenPriceUsd;
  } catch (err) {
    result.errors.push(`Price fetch failed: ${err instanceof Error ? err.message : err}`);
    return result;
  }

  const allocationUsd = allocationCents / 100;
  const targetRegen = allocationUsd / regenPriceUsd;
  result.targetRegenAmount = targetRegen;

  console.log(
    `Swap-and-burn: $${allocationUsd.toFixed(2)} allocation → ` +
    `~${targetRegen.toFixed(2)} REGEN target (at $${regenPriceUsd.toFixed(6)}/REGEN)`
  );

  // Init Osmosis wallet
  const { address: osmoAddress, client: osmoClient } = await initOsmosisWallet();
  console.log(`Osmosis wallet: ${osmoAddress}`);

  // Check OSMO balance for gas
  const osmoBalance = await osmoClient.getBalance(osmoAddress, UOSMO);
  const osmoAmount = Number(osmoBalance.amount) / 1_000_000;
  console.log(`OSMO balance: ${osmoAmount.toFixed(6)} OSMO`);

  if (osmoAmount < 0.05 && !dryRun) {
    result.errors.push(
      `Insufficient OSMO for gas: have ${osmoAmount.toFixed(6)} OSMO, need at least 0.05. ` +
      `Fund ${osmoAddress} with OSMO.`
    );
    return result;
  }

  // Determine swap input amount
  const inputDenom = swapDenom === "usdc" ? USDC_AXL_ON_OSMOSIS : swapDenom === "atom" ? ATOM_ON_OSMOSIS : UOSMO;
  let swapInputAmount: string;

  if (swapDenom === "usdc") {
    // USDC: 6 decimals, amount = allocation in dollars
    swapInputAmount = Math.floor(allocationUsd * 1_000_000).toString();
    const usdcBalance = await osmoClient.getBalance(osmoAddress, USDC_AXL_ON_OSMOSIS);
    const usdcAmount = Number(usdcBalance.amount) / 1_000_000;
    console.log(`USDC.axl balance: ${usdcAmount.toFixed(6)} USDC`);
    if (Number(usdcBalance.amount) < Number(swapInputAmount) && !dryRun) {
      result.errors.push(
        `Insufficient USDC.axl: have ${usdcAmount.toFixed(6)}, need ${allocationUsd.toFixed(6)}. ` +
        `Fund ${osmoAddress} with USDC.axl on Osmosis.`
      );
      return result;
    }
  } else if (swapDenom === "atom") {
    // ATOM: 6 decimals — get ATOM price via SQS (quote ATOM→USDC) then calculate amount needed
    const atomBalance = await osmoClient.getBalance(osmoAddress, ATOM_ON_OSMOSIS);
    const atomAmount = Number(atomBalance.amount) / 1_000_000;
    console.log(`ATOM balance: ${atomAmount.toFixed(6)} ATOM`);

    // Get ATOM/USD price by quoting 1 ATOM → USDC
    try {
      const priceQuote = await getSwapRoute(ATOM_ON_OSMOSIS, "1000000", USDC_AXL_ON_OSMOSIS);
      const atomPriceUsd = Number(priceQuote.amount_out) / 1_000_000;
      console.log(`ATOM price: ~$${atomPriceUsd.toFixed(2)}`);
      const atomNeeded = allocationUsd / atomPriceUsd;
      swapInputAmount = Math.floor(atomNeeded * 1_000_000).toString();

      if (atomAmount < atomNeeded && !dryRun) {
        result.errors.push(
          `Insufficient ATOM: have ${atomAmount.toFixed(6)}, need ~${atomNeeded.toFixed(6)}. ` +
          `Fund ${osmoAddress} with ATOM on Osmosis.`
        );
        return result;
      }
    } catch (err) {
      result.errors.push(`ATOM price quote failed: ${err instanceof Error ? err.message : err}`);
      return result;
    }
  } else {
    // OSMO: quote OSMO→USDC to get the REAL OSMO price, then size the swap from it.
    // (Previously this divided the dollar allocation by the wallet's OSMO *balance*,
    // which is dimensionally wrong and produced an arbitrary amount.)
    try {
      const priceQuote = await getSwapRoute(UOSMO, "1000000", USDC_AXL_ON_OSMOSIS);
      const osmoPriceUsd = Number(priceQuote.amount_out) / 1_000_000;
      if (!(osmoPriceUsd > 0)) {
        result.errors.push("OSMO price quote returned a non-positive price");
        return result;
      }
      console.log(`OSMO price: ~$${osmoPriceUsd.toFixed(4)}`);
      const osmoNeeded = allocationUsd / osmoPriceUsd;
      swapInputAmount = Math.floor(osmoNeeded * 1_000_000).toString();

      // Keep a gas reserve — never swap the OSMO we need to pay swap/IBC fees.
      const GAS_RESERVE_OSMO = 0.05;
      if (osmoAmount < osmoNeeded + GAS_RESERVE_OSMO && !dryRun) {
        result.errors.push(
          `Insufficient OSMO: need ~${osmoNeeded.toFixed(6)} to swap + ${GAS_RESERVE_OSMO} for gas, ` +
          `have ${osmoAmount.toFixed(6)}. Fund ${osmoAddress} with OSMO.`
        );
        return result;
      }
    } catch (err) {
      result.errors.push(`OSMO price quote failed: ${err instanceof Error ? err.message : err}`);
      return result;
    }
  }

  result.swapAmountIn = swapInputAmount;

  // --- Step 1: Get swap route and execute ---

  const denomLabel = swapDenom === "usdc" ? "uusdc" : swapDenom === "atom" ? "uatom" : "uosmo";
  console.log(`\nStep 1: Swap ${swapInputAmount} ${denomLabel} → REGEN on Osmosis...`);

  let swapRoute: SQSRoute;
  try {
    swapRoute = await getSwapRoute(inputDenom, swapInputAmount, REGEN_ON_OSMOSIS);
    result.swapAmountOut = swapRoute.amount_out;
    const expectedRegen = Number(swapRoute.amount_out) / 1_000_000;
    console.log(`  Route: ${swapRoute.route.length} route(s), expected output: ${expectedRegen.toFixed(2)} REGEN`);
  } catch (err) {
    result.errors.push(`Swap route failed: ${err instanceof Error ? err.message : err}`);
    return result;
  }

  // The swap INPUT is always bounded to the dollar allocation (USDC/ATOM are sized
  // directly from it; OSMO is now sized from the real OSMO price above), so an
  // inflated quote just means a favorable price — it can't cause overspend. Log it
  // for visibility but do NOT lower amount_out: the tokenOutMinAmount below already
  // floors slippage protection at 80% of target, so weakening it here would only
  // reduce protection.
  const quotedRegen = Number(swapRoute.amount_out) / 1_000_000;
  if (quotedRegen > targetRegen * 2) {
    console.warn(
      `SQS quote is ${(quotedRegen / targetRegen).toFixed(1)}x the target ` +
      `(${quotedRegen.toFixed(2)} vs ${targetRegen.toFixed(2)} REGEN) — proceeding with ` +
      `dollar-bounded input; min-out floor still applies.`
    );
  }

  // Build swap message using poolmanager
  const routes = swapRoute.route[0].pools.map((pool) => ({
    poolId: BigInt(pool.id),
    tokenOutDenom: pool.token_out_denom,
  }));

  // Use the lower of: 97% of quote OR 80% of target
  // This prevents inflated quotes from setting an unreachable minAmountOut
  const quoteBased = BigInt(swapRoute.amount_out) * 97n / 100n;
  const targetBased = BigInt(Math.floor(targetRegen * 0.8 * 1_000_000));
  const minAmountOut = (quoteBased < targetBased ? quoteBased : targetBased).toString();

  const swapMsg = osmosis.poolmanager.v1beta1.MessageComposer.withTypeUrl.swapExactAmountIn({
    sender: osmoAddress,
    routes,
    tokenIn: { denom: inputDenom, amount: swapInputAmount },
    tokenOutMinAmount: minAmountOut,
  });

  if (dryRun) {
    console.log(`  [DRY RUN] Would swap ${Number(swapInputAmount) / 1e6} ${swapDenom.toUpperCase()} → ~${Number(swapRoute.amount_out) / 1e6} REGEN`);
  } else {
    try {
      const swapGas = await osmoClient.simulate(osmoAddress, [swapMsg as EncodeObject], undefined);
      const swapFee = calculateFee(Math.ceil(swapGas * 1.5), GasPrice.fromString(OSMOSIS_GAS_PRICE));
      const swapTx = await osmoClient.signAndBroadcast(osmoAddress, [swapMsg as EncodeObject], swapFee);
      if (swapTx.code !== 0) {
        result.errors.push(`Swap tx failed (code ${swapTx.code}): ${swapTx.rawLog || "unknown"}`);
        return result;
      }
      result.swapTxHash = swapTx.transactionHash;
      console.log(`  Swap tx: ${swapTx.transactionHash}`);
    } catch (err) {
      result.errors.push(`Swap failed: ${err instanceof Error ? err.message : err}`);
      return result;
    }
  }

  // --- Step 2: IBC transfer REGEN from Osmosis → Regen ---

  // Check actual REGEN balance on Osmosis after swap
  let ibcAmount: string;
  if (dryRun) {
    ibcAmount = swapRoute.amount_out;
  } else {
    // Small delay for state to propagate
    await new Promise((r) => setTimeout(r, 3000));
    const regenOnOsmo = await osmoClient.getBalance(osmoAddress, REGEN_ON_OSMOSIS);
    ibcAmount = regenOnOsmo.amount;
    console.log(`\n  REGEN balance on Osmosis after swap: ${Number(ibcAmount) / 1e6} REGEN`);
  }

  result.ibcAmountUregen = ibcAmount;

  const { address: regenAddress } = await initWallet();
  const timeoutTimestamp = BigInt((Date.now() + IBC_TIMEOUT_SECONDS * 1000) * 1_000_000); // nanoseconds

  const ibcMsg = ibcOsmojs.applications.transfer.v1.MessageComposer.withTypeUrl.transfer({
    sourcePort: "transfer",
    sourceChannel: OSMOSIS_TO_REGEN_CHANNEL,
    token: { denom: REGEN_ON_OSMOSIS, amount: ibcAmount },
    sender: osmoAddress,
    receiver: regenAddress,
    timeoutHeight: { revisionNumber: BigInt(0), revisionHeight: BigInt(0) },
    timeoutTimestamp,
    memo: "Regen Compute — REGEN buy-back-and-burn",
  });

  console.log(`\nStep 2: IBC transfer ${Number(ibcAmount) / 1e6} REGEN → ${regenAddress}...`);

  if (dryRun) {
    console.log(`  [DRY RUN] Would IBC transfer ${Number(ibcAmount) / 1e6} REGEN to Regen Network`);
  } else {
    try {
      const ibcGas = await osmoClient.simulate(osmoAddress, [ibcMsg as EncodeObject], undefined);
      const ibcFee = calculateFee(Math.ceil(ibcGas * 1.5), GasPrice.fromString(OSMOSIS_GAS_PRICE));
      const ibcTx = await osmoClient.signAndBroadcast(osmoAddress, [ibcMsg as EncodeObject], ibcFee);
      if (ibcTx.code !== 0) {
        result.errors.push(`IBC transfer failed (code ${ibcTx.code}): ${ibcTx.rawLog || "unknown"}`);
        result.status = "partial"; // swap succeeded but IBC failed
        return result;
      }
      result.ibcTxHash = ibcTx.transactionHash;
      console.log(`  IBC tx: ${ibcTx.transactionHash}`);
    } catch (err) {
      result.errors.push(`IBC transfer failed: ${err instanceof Error ? err.message : err}`);
      result.status = "partial";
      return result;
    }
  }

  // --- Step 3: Wait for IBC and burn on Regen ---

  console.log(`\nStep 3: Burn REGEN on Regen Network...`);

  if (dryRun) {
    console.log(`  [DRY RUN] Would burn ${Number(ibcAmount) / 1e6} REGEN`);
    result.burnAmountUregen = ibcAmount;
    result.status = "completed";
    return result;
  }

  // Wait for IBC packet to arrive (typically 30-60 seconds)
  console.log(`  Waiting for IBC packet to arrive on Regen (up to 120s)...`);
  const burnAmount = await waitForRegenArrival(regenAddress, ibcAmount);

  if (!burnAmount) {
    result.errors.push(
      "IBC transfer sent but REGEN hasn't arrived on Regen after 120s. " +
      "The burn can be executed manually once the IBC packet completes."
    );
    result.status = "partial";
    return result;
  }

  // Execute burn
  try {
    const burnMsg = {
      typeUrl: "/regen.ecocredit.v1.MsgBurnRegen",
      value: {
        burner: regenAddress,
        amount: burnAmount,
        reason: `Buy-back-and-burn — Regen Compute ($${allocationUsd.toFixed(2)} allocation, ${Number(burnAmount) / 1e6} REGEN at $${regenPriceUsd.toFixed(6)})`,
      },
    };

    const burnTx = await signAndBroadcast([burnMsg]);
    if (burnTx.code !== 0) {
      result.errors.push(`Burn tx failed (code ${burnTx.code}): ${burnTx.rawLog || "unknown"}`);
      result.status = "partial";
      return result;
    }

    result.burnTxHash = burnTx.transactionHash;
    result.burnAmountUregen = burnAmount;
    result.status = "completed";
    console.log(`  Burn tx: ${burnTx.transactionHash}`);
    console.log(`  Burned: ${Number(burnAmount) / 1e6} REGEN`);
  } catch (err) {
    result.errors.push(`Burn failed: ${err instanceof Error ? err.message : err}`);
    result.status = "partial";
    return result;
  }

  return result;
}

/**
 * Wait for REGEN to arrive on Regen Network after IBC transfer.
 * Polls balance every 10 seconds for up to 120 seconds.
 * Returns the amount of new REGEN received, or null if timed out.
 */
async function waitForRegenArrival(
  regenAddress: string,
  expectedUregen: string
): Promise<string | null> {
  const { client } = await initWallet();
  const beforeBalance = await client.getBalance(regenAddress, "uregen");
  const beforeAmount = BigInt(beforeBalance.amount);

  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    const currentBalance = await client.getBalance(regenAddress, "uregen");
    const currentAmount = BigInt(currentBalance.amount);
    const received = currentAmount - beforeAmount;

    if (received > 0n) {
      console.log(`  Received ${Number(received) / 1e6} REGEN on Regen Network`);
      // Burn what we received (may differ slightly from expected due to IBC)
      return received.toString();
    }
  }

  return null;
}

/** Format a swap-and-burn result for logging. */
export function formatSwapAndBurnResult(result: SwapAndBurnResult): string {
  const lines: string[] = [
    `=== REGEN Buy-Back-and-Burn ===`,
    `  Allocation: $${(result.allocationCents / 100).toFixed(2)}`,
  ];

  if (result.regenPriceUsd !== null) {
    lines.push(`  REGEN Price: $${result.regenPriceUsd.toFixed(6)}`);
    lines.push(`  Target: ~${result.targetRegenAmount.toFixed(2)} REGEN`);
  }

  if (result.swapTxHash) {
    lines.push(`  Swap Tx (Osmosis): ${result.swapTxHash}`);
    const denomDisplay = result.swapDenomIn === UOSMO ? "OSMO" : result.swapDenomIn === ATOM_ON_OSMOSIS ? "ATOM" : "USDC";
    lines.push(`    In: ${Number(result.swapAmountIn) / 1e6} ${denomDisplay}`);
    lines.push(`    Out: ${Number(result.swapAmountOut) / 1e6} REGEN`);
  }

  if (result.ibcTxHash) {
    lines.push(`  IBC Tx (Osmosis→Regen): ${result.ibcTxHash}`);
  }

  if (result.burnTxHash) {
    lines.push(`  Burn Tx (Regen): ${result.burnTxHash}`);
    lines.push(`    Burned: ${Number(result.burnAmountUregen) / 1e6} REGEN`);
  }

  lines.push(`  Status: ${result.status}`);

  if (result.errors.length > 0) {
    lines.push(`  Errors:`);
    for (const e of result.errors) {
      lines.push(`    - ${e}`);
    }
  }

  return lines.join("\n");
}

/**
 * Check Osmosis wallet balances and readiness for swap-and-burn.
 */
export async function checkOsmosisReadiness(): Promise<{
  osmoAddress: string;
  osmoBalance: number;
  usdcBalance: number;
  atomBalance: number;
  regenOnOsmosisBalance: number;
  ready: boolean;
  issues: string[];
}> {
  const config = loadConfig();
  if (!config.walletMnemonic) {
    return {
      osmoAddress: "",
      osmoBalance: 0,
      usdcBalance: 0,
      atomBalance: 0,
      regenOnOsmosisBalance: 0,
      ready: false,
      issues: ["REGEN_WALLET_MNEMONIC not configured"],
    };
  }

  const { address, client } = await initOsmosisWallet();
  const issues: string[] = [];

  const osmoBalance = await client.getBalance(address, UOSMO);
  const usdcBalance = await client.getBalance(address, USDC_AXL_ON_OSMOSIS);
  const atomBalance = await client.getBalance(address, ATOM_ON_OSMOSIS);
  const regenBalance = await client.getBalance(address, REGEN_ON_OSMOSIS);

  const osmoAmount = Number(osmoBalance.amount) / 1_000_000;
  const usdcAmount = Number(usdcBalance.amount) / 1_000_000;
  const atomAmount = Number(atomBalance.amount) / 1_000_000;
  const regenAmount = Number(regenBalance.amount) / 1_000_000;

  if (osmoAmount < 0.05) {
    issues.push(`Need OSMO for gas: have ${osmoAmount.toFixed(6)}, need at least 0.05`);
  }
  if (usdcAmount < 0.01 && atomAmount < 0.01 && regenAmount < 1) {
    issues.push("No USDC, ATOM, or REGEN on Osmosis to swap");
  }

  return {
    osmoAddress: address,
    osmoBalance: osmoAmount,
    usdcBalance: usdcAmount,
    atomBalance: atomAmount,
    regenOnOsmosisBalance: regenAmount,
    ready: issues.length === 0,
    issues,
  };
}
