/**
 * EVM wallet service for ecoBridge payments.
 *
 * Sends ERC-20 tokens (USDC, etc.) on Base or other EVM chains
 * to ecoBridge project wallets for credit retirement.
 */

import { ethers } from "ethers";
import { loadConfig } from "../config.js";

// Well-known USDC contract addresses per chain
const USDC_ADDRESSES: Record<string, string> = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  polygon: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  optimism: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  celo: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
};

// Public RPC endpoints per chain
const RPC_URLS: Record<string, string> = {
  base: "https://mainnet.base.org",
  ethereum: "https://eth.llamarpc.com",
  polygon: "https://polygon-rpc.com",
  arbitrum: "https://arb1.arbitrum.io/rpc",
  optimism: "https://mainnet.optimism.io",
  celo: "https://forno.celo.org",
};

// Minimal ERC-20 ABI for transfer + balanceOf
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

let _wallet: ethers.HDNodeWallet | null = null;

function getWallet(): ethers.HDNodeWallet {
  if (_wallet) return _wallet;
  const config = loadConfig();
  if (!config.ecoBridgeEvmMnemonic) {
    throw new Error(
      "ECOBRIDGE_EVM_MNEMONIC not configured. Set it in .env to enable cross-chain retirement."
    );
  }
  _wallet = ethers.HDNodeWallet.fromPhrase(
    config.ecoBridgeEvmMnemonic,
    "",
    config.ecoBridgeEvmDerivationPath
  );
  return _wallet;
}

export function getEvmAddress(): string {
  return getWallet().address;
}

export function isEvmWalletConfigured(): boolean {
  return !!loadConfig().ecoBridgeEvmMnemonic;
}

function getProvider(chain: string): ethers.JsonRpcProvider {
  const rpcUrl = RPC_URLS[chain.toLowerCase()];
  if (!rpcUrl) {
    throw new Error(
      `No RPC URL configured for chain "${chain}". Supported: ${Object.keys(RPC_URLS).join(", ")}`
    );
  }
  return new ethers.JsonRpcProvider(rpcUrl);
}

function getUsdcAddress(chain: string): string {
  const addr = USDC_ADDRESSES[chain.toLowerCase()];
  if (!addr) {
    throw new Error(
      `No USDC address known for chain "${chain}". Supported: ${Object.keys(USDC_ADDRESSES).join(", ")}`
    );
  }
  return addr;
}

export interface SendUsdcResult {
  txHash: string;
  from: string;
  to: string;
  amountUsdc: string;
  chain: string;
}

/** USDC has 6 decimals on every chain we support. */
const USDC_DECIMALS = 6;

/**
 * Convert a USDC amount to base units (raw bigint), accepting either a number
 * (typical from MCP tool callers) or a decimal string (preferred when the
 * caller has a precise source). Audit C1: the previous implementation used
 * `BigInt(Math.round(amountUsdc * 10 ** decimals))`, which does a float
 * multiply that produces spurious low bits for many decimal inputs (e.g.
 * `0.1 * 1_000_000 = 100000.00000000001`). This routes through ethers's
 * decimal-string parser, which is exact.
 */
function usdcToBaseUnits(amountUsdc: number | string): bigint {
  // Numbers are clamped to USDC_DECIMALS via toFixed before parsing — anything
  // beyond that is sub-cent dust the chain can't represent anyway.
  const asString =
    typeof amountUsdc === "string" ? amountUsdc : amountUsdc.toFixed(USDC_DECIMALS);
  return ethers.parseUnits(asString, USDC_DECIMALS);
}

/**
 * Send USDC to a recipient on the specified chain.
 * Returns the transaction hash once the tx is mined.
 */
export async function sendUsdc(
  chain: string,
  toAddress: string,
  amountUsdc: number | string
): Promise<SendUsdcResult> {
  const provider = getProvider(chain);
  const wallet = getWallet().connect(provider);
  const usdcAddress = getUsdcAddress(chain);

  const usdc = new ethers.Contract(usdcAddress, ERC20_ABI, wallet);

  const rawAmount = usdcToBaseUnits(amountUsdc);

  // Check balance first
  const balance: bigint = await usdc.balanceOf(wallet.address);
  if (balance < rawAmount) {
    const balanceUsdc = ethers.formatUnits(balance, USDC_DECIMALS);
    const requestedUsdc = ethers.formatUnits(rawAmount, USDC_DECIMALS);
    throw new Error(
      `Insufficient USDC balance on ${chain}. Have: ${balanceUsdc} USDC, need: ${requestedUsdc} USDC`
    );
  }

  // Send the transfer
  const tx = await usdc.transfer(toAddress, rawAmount);
  const receipt = await tx.wait();

  return {
    txHash: receipt.hash,
    from: wallet.address,
    to: toAddress,
    amountUsdc: typeof amountUsdc === "string" ? amountUsdc : amountUsdc.toString(),
    chain,
  };
}

/** Test-only export — pure helper, worth covering directly. */
export const __evmWalletInternals = { usdcToBaseUnits, USDC_DECIMALS };
