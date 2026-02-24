/**
 * Centralized configuration for Regen for AI.
 *
 * Reads all environment variables once and exports a typed config object.
 * The key gate is `isWalletConfigured()` — when true, the server can
 * execute on-chain retirements directly instead of returning marketplace links.
 */

export interface Config {
  // Existing (Phase 1)
  indexerUrl: string;
  lcdUrl: string;
  marketplaceUrl: string;

  // Direct retirement (Phase 1.5)
  rpcUrl: string;
  chainId: string;
  walletMnemonic: string | undefined;
  paymentProvider: "crypto" | "stripe";
  defaultJurisdiction: string;
  protocolFeeBps: number;

  // ecoBridge integration (Phase 1.5)
  ecoBridgeApiUrl: string;
  ecoBridgeEnabled: boolean;
  ecoBridgeCacheTtlMs: number;

  // ecoBridge EVM wallet (for sending tokens on Base/Ethereum/etc.)
  ecoBridgeEvmMnemonic: string | undefined;
  ecoBridgeEvmDerivationPath: string;
  regenAcquisitionProvider: "disabled" | "simulated";
  regenAcquisitionRateUregenPerUsdc: number;
}

let _config: Config | undefined;

const DEFAULT_PROTOCOL_FEE_BPS = 1000;
const MIN_PROTOCOL_FEE_BPS = 800;
const MAX_PROTOCOL_FEE_BPS = 1200;
const DEFAULT_REGEN_ACQUISITION_PROVIDER = "disabled" as const;
const DEFAULT_REGEN_ACQUISITION_RATE_UREGEN_PER_USDC = 2_000_000;

function parseProtocolFeeBps(rawValue: string | undefined): number {
  if (!rawValue) return DEFAULT_PROTOCOL_FEE_BPS;

  const parsed = Number(rawValue);
  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_PROTOCOL_FEE_BPS ||
    parsed > MAX_PROTOCOL_FEE_BPS
  ) {
    throw new Error(
      `REGEN_PROTOCOL_FEE_BPS must be an integer between ${MIN_PROTOCOL_FEE_BPS} and ${MAX_PROTOCOL_FEE_BPS}`
    );
  }

  return parsed;
}

function parseRegenAcquisitionProvider(
  rawValue: string | undefined
): "disabled" | "simulated" {
  if (!rawValue) return DEFAULT_REGEN_ACQUISITION_PROVIDER;

  const normalized = rawValue.trim().toLowerCase();
  if (normalized === "disabled") return "disabled";
  if (normalized === "simulated") return "simulated";

  throw new Error(
    "REGEN_ACQUISITION_PROVIDER must be one of: disabled, simulated"
  );
}

function parsePositiveInteger(
  rawValue: string | undefined,
  envName: string,
  defaultValue: number
): number {
  if (!rawValue) return defaultValue;

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${envName} must be a positive integer`);
  }

  return parsed;
}

export function loadConfig(): Config {
  if (_config) return _config;

  _config = {
    indexerUrl:
      process.env.REGEN_INDEXER_URL ||
      "https://api.regen.network/indexer/v1/graphql",
    lcdUrl: process.env.REGEN_LCD_URL || "https://lcd-regen.keplr.app",
    marketplaceUrl:
      process.env.REGEN_MARKETPLACE_URL || "https://app.regen.network",

    rpcUrl:
      process.env.REGEN_RPC_URL || "http://mainnet.regen.network:26657",
    chainId: process.env.REGEN_CHAIN_ID || "regen-1",
    walletMnemonic: process.env.REGEN_WALLET_MNEMONIC || undefined,
    paymentProvider:
      (process.env.REGEN_PAYMENT_PROVIDER as "crypto" | "stripe") || "crypto",
    defaultJurisdiction: process.env.REGEN_DEFAULT_JURISDICTION || "US",
    protocolFeeBps: parseProtocolFeeBps(process.env.REGEN_PROTOCOL_FEE_BPS),

    ecoBridgeApiUrl:
      process.env.ECOBRIDGE_API_URL || "https://api.bridge.eco",
    ecoBridgeEnabled: process.env.ECOBRIDGE_ENABLED !== "false",
    ecoBridgeCacheTtlMs: parseInt(
      process.env.ECOBRIDGE_CACHE_TTL_MS || "60000",
      10
    ),

    ecoBridgeEvmMnemonic: process.env.ECOBRIDGE_EVM_MNEMONIC || undefined,
    ecoBridgeEvmDerivationPath:
      process.env.ECOBRIDGE_EVM_DERIVATION_PATH || "m/44'/60'/0'/0/0",
    regenAcquisitionProvider: parseRegenAcquisitionProvider(
      process.env.REGEN_ACQUISITION_PROVIDER
    ),
    regenAcquisitionRateUregenPerUsdc: parsePositiveInteger(
      process.env.REGEN_ACQUISITION_RATE_UREGEN_PER_USDC,
      "REGEN_ACQUISITION_RATE_UREGEN_PER_USDC",
      DEFAULT_REGEN_ACQUISITION_RATE_UREGEN_PER_USDC
    ),
  };

  return _config;
}

export function isWalletConfigured(): boolean {
  const config = loadConfig();
  return !!config.walletMnemonic;
}
