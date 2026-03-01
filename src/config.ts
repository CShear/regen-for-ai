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

  // ecoBridge integration (Phase 1.5)
  ecoBridgeApiUrl: string;
  ecoBridgeEnabled: boolean;
  ecoBridgeCacheTtlMs: number;

  // ecoBridge EVM wallet (for sending tokens on Base/Ethereum/etc.)
  ecoBridgeEvmMnemonic: string | undefined;
  ecoBridgeEvmDerivationPath: string;

  // Prepaid balance (credit card top-up via Stripe)
  balanceApiKey: string | undefined;
  balanceUrl: string | undefined;

  // Stripe Payment Links (subscription tiers)
  stripePaymentLinkSeedling: string;
  stripePaymentLinkGrove: string;
  stripePaymentLinkForest: string;

  // Email (Postmark)
  postmarkServerToken: string | undefined;
  emailFromAddress: string;
  emailEnabled: boolean;

  // REGEN buy-and-burn
  burnEnabled: boolean;
  regenPriceApiUrl: string;
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

    ecoBridgeEvmMnemonic: process.env.ECOBRIDGE_EVM_MNEMONIC || undefined,
    ecoBridgeEvmDerivationPath:
      process.env.ECOBRIDGE_EVM_DERIVATION_PATH || "m/44'/60'/0'/0/0",

    balanceApiKey: process.env.REGEN_API_KEY || undefined,
    balanceUrl: process.env.REGEN_BALANCE_URL || undefined,

    stripePaymentLinkSeedling: process.env.STRIPE_PAYMENT_LINK_SEEDLING || "#",
    stripePaymentLinkGrove: process.env.STRIPE_PAYMENT_LINK_GROVE || "#",
    stripePaymentLinkForest: process.env.STRIPE_PAYMENT_LINK_FOREST || "#",

    postmarkServerToken: process.env.POSTMARK_SERVER_TOKEN || undefined,
    emailFromAddress: process.env.EMAIL_FROM_ADDRESS || "impact@regen-for-ai.com",
    emailEnabled: process.env.EMAIL_ENABLED !== "false",

    burnEnabled: process.env.REGEN_BURN_ENABLED === "true",
    regenPriceApiUrl:
      process.env.REGEN_PRICE_API_URL ||
      "https://api.coingecko.com/api/v3/simple/price?ids=regen&vs_currencies=usd",
  };

  return _config;
}

export function isWalletConfigured(): boolean {
  const config = loadConfig();
  return !!config.walletMnemonic;
}
