/**
 * Centralized configuration for Regen Compute.
 *
 * Reads all environment variables once and exports a typed config object.
 * The key gate is `isWalletConfigured()` — when true, the server can
 * execute on-chain retirements directly instead of returning marketplace links.
 */

import { randomBytes } from "crypto";

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

  // Stripe Payment Links (subscription tiers — fallback for no-JS)
  stripePaymentLinkSeedling: string;
  stripePaymentLinkGrove: string;
  stripePaymentLinkForest: string;

  // Stripe Price IDs — Monthly (for programmatic Checkout Sessions)
  stripePriceIdSeedling: string | undefined;
  stripePriceIdGrove: string | undefined;
  stripePriceIdForest: string | undefined;

  // Stripe Price IDs — Yearly
  stripePriceIdSeedlingYearly: string | undefined;
  stripePriceIdGroveYearly: string | undefined;
  stripePriceIdForestYearly: string | undefined;

  // Email (Postmark)
  postmarkServerToken: string | undefined;
  emailFromAddress: string;
  emailReplyToAddress: string | undefined;
  emailEnabled: boolean;

  // Stripe Customer Portal
  stripePortalReturnUrl: string | undefined;

  // REGEN buy-and-burn
  burnEnabled: boolean;
  regenPriceApiUrl: string;

  // Gas price
  gasPrice: string;

  // Developer API
  apiRateLimit: number;

  // Dashboard magic link auth
  magicLinkTtlMinutes: number;
  sessionSecret: string;

  // Admin API auth (separate from sessionSecret; falls back to it for back-compat)
  adminToken: string;
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

    stripePriceIdSeedling: process.env.STRIPE_PRICE_ID_SEEDLING || undefined,
    stripePriceIdGrove: process.env.STRIPE_PRICE_ID_GROVE || undefined,
    stripePriceIdForest: process.env.STRIPE_PRICE_ID_FOREST || undefined,

    stripePriceIdSeedlingYearly: process.env.STRIPE_PRICE_ID_SEEDLING_YEARLY || undefined,
    stripePriceIdGroveYearly: process.env.STRIPE_PRICE_ID_GROVE_YEARLY || undefined,
    stripePriceIdForestYearly: process.env.STRIPE_PRICE_ID_FOREST_YEARLY || undefined,

    stripePortalReturnUrl: process.env.STRIPE_PORTAL_RETURN_URL || undefined,

    postmarkServerToken: process.env.POSTMARK_SERVER_TOKEN || undefined,
    emailFromAddress: process.env.EMAIL_FROM_ADDRESS || "Regen Compute <impact@compute.regen.network>",
    emailReplyToAddress: process.env.EMAIL_REPLY_TO_ADDRESS || undefined,
    emailEnabled: process.env.EMAIL_ENABLED !== "false",

    gasPrice: process.env.REGEN_GAS_PRICE || "0.025uregen",

    burnEnabled: process.env.REGEN_BURN_ENABLED === "true",
    regenPriceApiUrl:
      process.env.REGEN_PRICE_API_URL ||
      "https://api.coingecko.com/api/v3/simple/price?ids=regen&vs_currencies=usd",

    apiRateLimit: parseInt(process.env.REGEN_API_RATE_LIMIT || "100", 10),

    magicLinkTtlMinutes: parseInt(process.env.MAGIC_LINK_TTL_MINUTES || "15", 10),
    sessionSecret: process.env.SESSION_SECRET || requireSessionSecret(),
    adminToken:
      process.env.ADMIN_TOKEN ||
      process.env.SESSION_SECRET ||
      requireSessionSecret(),
  };

  return _config;
}

/**
 * Resolve the session secret, failing closed in production.
 *
 * SESSION_SECRET signs dashboard/magic-link session cookies and (by fallback)
 * gates admin endpoints. Silently generating a random secret per boot would
 * invalidate every session on restart and rotate the admin token with no error,
 * so in production we refuse to start without it. In dev we allow an ephemeral
 * secret but warn loudly.
 */
let _ephemeralSecret: string | undefined;
function requireSessionSecret(): string {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET must be set in production. Refusing to start with an ephemeral secret."
    );
  }
  if (!_ephemeralSecret) {
    _ephemeralSecret = randomBytes(32).toString("hex");
    console.warn(
      "WARNING: SESSION_SECRET not set — using an ephemeral secret. " +
      "Sessions and admin auth will not survive a restart. Set SESSION_SECRET."
    );
  }
  return _ephemeralSecret;
}

export function isWalletConfigured(): boolean {
  const config = loadConfig();
  return !!config.walletMnemonic;
}
