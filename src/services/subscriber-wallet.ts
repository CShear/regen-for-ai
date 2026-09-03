/**
 * HD wallet derivation and signing for subscriber Regen addresses.
 *
 * Each subscriber gets a deterministic Regen address derived from the
 * master wallet mnemonic using HD path m/44'/118'/0'/0/{subscriberId}.
 *
 * For tradable sell orders, credits are sent-and-retired to subscriber
 * addresses by the master wallet via MsgSend.
 *
 * For retire-only sell orders, the subscriber wallet signs MsgBuyDirect
 * directly — credits auto-retire to the subscriber's address on purchase.
 * This requires the subscriber wallet to hold payment tokens (USDC.axl)
 * and a small REGEN balance for gas.
 */

import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { SigningStargateClient, type DeliverTxResponse } from "@cosmjs/stargate";
import { stringToPath } from "@cosmjs/crypto";
import { loadConfig } from "../config.js";
import { buildRegenSigningOptions, initWallet, signAndBroadcast } from "./wallet.js";
import type { EncodeObject } from "@cosmjs/proto-signing";

/** Minimum uregen balance to maintain in subscriber wallets for gas */
const MIN_GAS_UREGEN = 100_000n; // 0.1 REGEN

/** Cache derived addresses to avoid repeated HD derivation */
const addressCache = new Map<number, string>();

/** Cache signing clients per subscriber */
const clientCache = new Map<number, { address: string; client: SigningStargateClient }>();

/**
 * Derive a subscriber's Regen address from the master mnemonic.
 * Uses HD path m/44'/118'/0'/0/{subscriberId} for deterministic derivation.
 */
export async function deriveSubscriberAddress(subscriberId: number): Promise<string> {
  const cached = addressCache.get(subscriberId);
  if (cached) return cached;

  const config = loadConfig();
  if (!config.walletMnemonic) {
    throw new Error("REGEN_WALLET_MNEMONIC is not configured — cannot derive subscriber addresses");
  }

  const hdPath = stringToPath(`m/44'/118'/0'/0/${subscriberId}`);
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(config.walletMnemonic, {
    prefix: "regen",
    hdPaths: [hdPath],
  });

  const [account] = await wallet.getAccounts();
  addressCache.set(subscriberId, account.address);
  return account.address;
}

/**
 * Initialize a signing client for a subscriber wallet.
 * Used when the subscriber wallet needs to sign transactions directly
 * (e.g., buying from retire-only sell orders).
 */
export async function initSubscriberWallet(subscriberId: number): Promise<{ address: string; client: SigningStargateClient }> {
  const cached = clientCache.get(subscriberId);
  if (cached) return cached;

  const config = loadConfig();
  if (!config.walletMnemonic) {
    throw new Error("REGEN_WALLET_MNEMONIC is not configured — cannot init subscriber wallet");
  }

  const hdPath = stringToPath(`m/44'/118'/0'/0/${subscriberId}`);
  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(config.walletMnemonic, {
    prefix: "regen",
    hdPaths: [hdPath],
  });

  const [account] = await wallet.getAccounts();
  const address = account.address;
  addressCache.set(subscriberId, address);

  const client = await SigningStargateClient.connectWithSigner(
    config.rpcUrl,
    wallet,
    buildRegenSigningOptions(),
  );

  const entry = { address, client };
  clientCache.set(subscriberId, entry);
  return entry;
}

/**
 * Sign and broadcast a transaction from a subscriber wallet.
 */
export async function signAndBroadcastAsSubscriber(
  subscriberId: number,
  messages: EncodeObject[],
): Promise<DeliverTxResponse> {
  const { address, client } = await initSubscriberWallet(subscriberId);
  return client.signAndBroadcast(address, messages, "auto");
}

/**
 * Query all non-zero balances for a given address via LCD REST.
 */
export async function getAddressBalances(address: string): Promise<Map<string, bigint>> {
  const config = loadConfig();
  const balances = new Map<string, bigint>();

  try {
    const res = await fetch(`${config.lcdUrl}/cosmos/bank/v1beta1/balances/${address}`);
    const data = await res.json() as { balances: { denom: string; amount: string }[] };
    for (const b of data.balances) {
      const amount = BigInt(b.amount);
      if (amount > 0n) {
        balances.set(b.denom, amount);
      }
    }
  } catch (err) {
    console.warn(`Failed to fetch balances for ${address}:`, err instanceof Error ? err.message : err);
  }

  return balances;
}

/**
 * Calculate the funding needed for a subscriber wallet to execute a retire-only purchase.
 * Returns the amounts to transfer from master → subscriber.
 */
export function calculateFundingNeeded(
  subscriberBalances: Map<string, bigint>,
  purchaseCostDenom: string,
  purchaseCostAmount: bigint,
): { transfers: { denom: string; amount: bigint }[] } {
  const transfers: { denom: string; amount: bigint }[] = [];

  // Payment token shortfall
  const currentPayment = subscriberBalances.get(purchaseCostDenom) ?? 0n;
  if (purchaseCostAmount > currentPayment) {
    transfers.push({
      denom: purchaseCostDenom,
      amount: purchaseCostAmount - currentPayment,
    });
  }

  // Gas token top-up (maintain 0.1 REGEN minimum)
  const currentGas = subscriberBalances.get("uregen") ?? 0n;
  if (currentGas < MIN_GAS_UREGEN) {
    transfers.push({
      denom: "uregen",
      amount: MIN_GAS_UREGEN - currentGas,
    });
  }

  // Merge same-denom entries and sort by denom: when the purchase cost denom is
  // uregen (REGEN-priced sell order), the payment shortfall and the gas top-up
  // would otherwise produce two uregen coins in one MsgSend, which the chain
  // rejects as "invalid coins" (caused every C02-004 leg failure Aug 5–22, 2026).
  const merged = new Map<string, bigint>();
  for (const t of transfers) {
    merged.set(t.denom, (merged.get(t.denom) ?? 0n) + t.amount);
  }
  const mergedTransfers = [...merged.entries()]
    .map(([denom, amount]) => ({ denom, amount }))
    .sort((a, b) => (a.denom < b.denom ? -1 : a.denom > b.denom ? 1 : 0));

  return { transfers: mergedTransfers };
}

/**
 * Transfer funds from master wallet to subscriber wallet.
 * Used to pre-fund subscriber wallets before retire-only purchases.
 * Returns the tx hash, or null if no transfer was needed.
 */
export async function fundSubscriberWallet(
  subscriberAddress: string,
  transfers: { denom: string; amount: bigint }[],
): Promise<string | null> {
  if (transfers.length === 0) return null;

  const { address: masterAddress } = await initWallet();

  const msgs: EncodeObject[] = [{
    typeUrl: "/cosmos.bank.v1beta1.MsgSend",
    value: {
      fromAddress: masterAddress,
      toAddress: subscriberAddress,
      amount: transfers.map((t) => ({
        denom: t.denom,
        amount: t.amount.toString(),
      })),
    },
  }];

  const result = await signAndBroadcast(msgs);
  if (result.code !== 0) {
    throw new Error(`Fund transfer failed (code ${result.code}): ${result.rawLog || "unknown"}`);
  }

  return result.transactionHash;
}

/**
 * Sweep all remaining funds from a subscriber wallet back to the master wallet.
 * Called when a subscription is cancelled (final cleanup).
 *
 * If the subscriber wallet has no uregen for gas, sends a small amount
 * from master first to cover the sweep tx gas cost.
 */
export async function sweepSubscriberFunds(
  subscriberId: number,
): Promise<{ swept: { denom: string; amount: string }[]; txHash: string | null }> {
  const { address: subscriberAddress, client } = await initSubscriberWallet(subscriberId);
  const { address: masterAddress } = await initWallet();

  const balances = await getAddressBalances(subscriberAddress);
  if (balances.size === 0) {
    return { swept: [], txHash: null };
  }

  // Ensure subscriber has enough gas for the sweep tx
  const currentGas = balances.get("uregen") ?? 0n;
  const sweepGasNeeded = 50_000n; // ~0.05 REGEN, plenty for a bank MsgSend

  if (currentGas < sweepGasNeeded) {
    // Fund gas from master so the sweep can execute
    await fundSubscriberWallet(subscriberAddress, [{
      denom: "uregen",
      amount: sweepGasNeeded - currentGas,
    }]);
    // Refresh balances after funding
    const updatedBalances = await getAddressBalances(subscriberAddress);
    balances.clear();
    for (const [k, v] of updatedBalances) balances.set(k, v);
  }

  // Build sweep amounts — send everything except a tiny gas reserve for the tx itself
  const sweepAmounts: { denom: string; amount: string }[] = [];
  for (const [denom, amount] of balances) {
    if (denom === "uregen") {
      // Reserve gas for this sweep tx, send the rest
      const sendable = amount - sweepGasNeeded;
      if (sendable > 0n) {
        sweepAmounts.push({ denom, amount: sendable.toString() });
      }
    } else {
      sweepAmounts.push({ denom, amount: amount.toString() });
    }
  }

  if (sweepAmounts.length === 0) {
    return { swept: [], txHash: null };
  }

  const msgs: EncodeObject[] = [{
    typeUrl: "/cosmos.bank.v1beta1.MsgSend",
    value: {
      fromAddress: subscriberAddress,
      toAddress: masterAddress,
      amount: sweepAmounts,
    },
  }];

  const result = await client.signAndBroadcast(subscriberAddress, msgs, "auto");
  if (result.code !== 0) {
    throw new Error(`Sweep failed (code ${result.code}): ${result.rawLog || "unknown"}`);
  }

  console.log(
    `Swept subscriber ${subscriberId} funds to master: ${sweepAmounts.map((a) => `${a.amount} ${a.denom}`).join(", ")} tx=${result.transactionHash}`
  );

  return { swept: sweepAmounts, txHash: result.transactionHash };
}

/** Clear the address and client caches (useful for testing). */
export function clearWalletCaches(): void {
  addressCache.clear();
  clientCache.clear();
}

// Backwards-compatible alias
export const clearAddressCache = clearWalletCaches;
