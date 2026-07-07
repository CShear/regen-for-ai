/**
 * Cryptocurrency price service
 *
 * Fetches USD prices from CoinGecko's free API with a 60-second cache.
 * Used to convert crypto payment amounts to USD cents for accounting.
 */

// --- Cache ---

let cache: { prices: Record<string, number>; fetchedAt: number } | null = null;

const CACHE_TTL_MS = 60_000;

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin,solana,tron,avalanche-2,binancecoin,matic-network,mantle,celo,fantom&vs_currencies=usd";

const ID_TO_SYMBOL: Record<string, string> = {
  ethereum: "ETH",
  bitcoin: "BTC",
  solana: "SOL",
  tron: "TRX",
  "avalanche-2": "AVAX",
  binancecoin: "BNB",
  "matic-network": "POL",
  mantle: "MNT",
  celo: "CELO",
  fantom: "FTM",
};

// --- Token contract price cache ---

let tokenPriceCache: Record<string, { price: number; fetchedAt: number }> = {};

// --- Price fetching ---

export async function getUsdPrices(): Promise<Record<string, number>> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.prices;
  }

  const res = await fetch(COINGECKO_URL);
  if (!res.ok) {
    // If we have stale cache, return it rather than failing
    if (cache) return cache.prices;
    throw new Error(
      `CoinGecko API error: ${res.status} ${res.statusText}`,
    );
  }

  const data = (await res.json()) as Record<
    string,
    { usd?: number }
  >;

  const prices: Record<string, number> = {
    USDC: 1,
    USDT: 1,
    xDAI: 1, // Gnosis chain native token is a stablecoin
  };

  for (const [id, symbol] of Object.entries(ID_TO_SYMBOL)) {
    const price = data[id]?.usd;
    if (price != null) {
      prices[symbol] = price;
    }
  }

  cache = { prices, fetchedAt: now };
  return prices;
}

// --- Token price by contract address ---

export async function getTokenPriceByContract(
  coingeckoPlatformId: string,
  contractAddress: string,
): Promise<number | null> {
  const cacheKey = `${coingeckoPlatformId}:${contractAddress.toLowerCase()}`;
  const now = Date.now();
  const cached = tokenPriceCache[cacheKey];
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.price;
  }

  const addr = contractAddress.toLowerCase();
  const url = `https://api.coingecko.com/api/v3/simple/token_price/${coingeckoPlatformId}?contract_addresses=${addr}&vs_currencies=usd`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      // Return cached value if available
      if (cached) return cached.price;
      return null;
    }

    const data = (await res.json()) as Record<string, { usd?: number }>;
    const price = data[addr]?.usd;

    if (price == null) {
      return null;
    }

    tokenPriceCache[cacheKey] = { price, fetchedAt: now };
    return price;
  } catch {
    // Return cached value if available
    if (cached) return cached.price;
    return null;
  }
}

// --- USD conversion ---

export async function toUsdCents(
  token: string,
  amount: string,
  contractAddress?: string,
  coingeckoPlatformId?: string,
): Promise<number> {
  const normalizedToken = token.toUpperCase().trim();
  const parsedAmount = parseFloat(amount);

  if (isNaN(parsedAmount) || parsedAmount < 0) {
    throw new Error(`Invalid amount: "${amount}"`);
  }

  // Stablecoins valued at $1/unit. SECURITY: this shortcut is only safe because
  // crypto-verify.ts only ever returns the symbol "USDC"/"USDT"/"xDAI" for tokens
  // it validated against a per-chain allowlist (or a known native/mint). Unknown
  // ERC-20s — including ones that spoof symbol()="USDC" — arrive here as a
  // "chain:0xcontract" token string and fall through to the contract-price lookup.
  if (normalizedToken === "USDC" || normalizedToken === "USDT" || normalizedToken === "XDAI") {
    return Math.round(parsedAmount * 100);
  }
  // AZUSD (Azos) — partner stablecoin, not on CoinGecko, valued at $0.995
  if (normalizedToken === "AZUSD") {
    return Math.round(parsedAmount * 0.995 * 100);
  }

  // Try known symbols first (native tokens)
  const prices = await getUsdPrices();
  const price = prices[normalizedToken] ?? prices[token]; // try exact case too (e.g. "xDAI")

  if (price != null) {
    const usd = parsedAmount * price;
    return Math.round(usd * 100);
  }

  // Try contract address lookup via CoinGecko
  if (contractAddress && coingeckoPlatformId) {
    const contractPrice = await getTokenPriceByContract(coingeckoPlatformId, contractAddress);
    if (contractPrice != null) {
      const usd = parsedAmount * contractPrice;
      return Math.round(usd * 100);
    }
  }

  throw new Error(
    `No price available for token "${token}"${contractAddress ? ` (contract: ${contractAddress})` : ""}. ` +
    `Supported symbols: ${Object.values(ID_TO_SYMBOL).join(", ")}, USDC, USDT. ` +
    `For other tokens, provide contractAddress and coingeckoPlatformId.`,
  );
}
