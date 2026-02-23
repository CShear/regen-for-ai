/**
 * Centralized configuration for Regen Compute Credits.
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

  // ecoBridge integration (Phase 1.5)
  ecoBridgeApiUrl: string;
  ecoBridgeEnabled: boolean;
  ecoBridgeCacheTtlMs: number;
}

let _config: Config | undefined;

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

    ecoBridgeApiUrl:
      process.env.ECOBRIDGE_API_URL || "https://api.bridge.eco",
    ecoBridgeEnabled: process.env.ECOBRIDGE_ENABLED !== "false",
    ecoBridgeCacheTtlMs: parseInt(
      process.env.ECOBRIDGE_CACHE_TTL_MS || "60000",
      10
    ),
  };

  return _config;
}

export function isWalletConfigured(): boolean {
  const config = loadConfig();
  return !!config.walletMnemonic;
}
