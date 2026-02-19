/**
 * Cosmos wallet initialization and transaction signing.
 *
 * Singleton pattern: wallet and signing client are initialized once
 * and cached for the lifetime of the MCP server process.
 */

import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { SigningStargateClient, defaultRegistryTypes, GasPrice, type DeliverTxResponse } from "@cosmjs/stargate";
import { Registry } from "@cosmjs/proto-signing";
import { AminoTypes } from "@cosmjs/stargate";
import { regenProtoRegistry, regenAminoConverters } from "@regen-network/api";
import { loadConfig } from "../config.js";
import type { EncodeObject } from "@cosmjs/proto-signing";

let _wallet: DirectSecp256k1HdWallet | undefined;
let _client: SigningStargateClient | undefined;
let _address: string | undefined;

export async function initWallet(): Promise<{ address: string; client: SigningStargateClient }> {
  if (_wallet && _client && _address) {
    return { address: _address, client: _client };
  }

  const config = loadConfig();
  if (!config.walletMnemonic) {
    throw new Error("REGEN_WALLET_MNEMONIC is not configured");
  }

  _wallet = await DirectSecp256k1HdWallet.fromMnemonic(config.walletMnemonic, {
    prefix: "regen",
  });

  const [account] = await _wallet.getAccounts();
  _address = account.address;

  // Build registry with default Cosmos types + all Regen proto types
  const registry = new Registry([
    ...defaultRegistryTypes,
    ...(regenProtoRegistry as ReadonlyArray<[string, any]>),
  ]);
  const aminoTypes = new AminoTypes({ ...regenAminoConverters });

  _client = await SigningStargateClient.connectWithSigner(
    config.rpcUrl,
    _wallet,
    {
      registry,
      aminoTypes,
      gasPrice: GasPrice.fromString("0.025uregen"),
    }
  );

  return { address: _address, client: _client };
}

export async function getAddress(): Promise<string> {
  const { address } = await initWallet();
  return address;
}

export async function getBalance(denom: string): Promise<bigint> {
  const { address, client } = await initWallet();
  const coin = await client.getBalance(address, denom);
  return BigInt(coin.amount);
}

export async function signAndBroadcast(
  messages: EncodeObject[]
): Promise<DeliverTxResponse> {
  const { address, client } = await initWallet();
  return client.signAndBroadcast(address, messages, "auto");
}
