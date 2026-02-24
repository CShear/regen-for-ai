/**
 * ecoBridge API client
 *
 * Connects to bridge.eco to list supported tokens/chains and build
 * deep-linked retirement widget URLs. Enables payment for Regen Network
 * credit retirements using any token on any supported chain.
 *
 * API base: https://api.bridge.eco
 * Docs: https://docs.bridge.eco/docs/guides/integration/
 */

import { loadConfig } from "../config.js";

// --- Type definitions ---

export interface EcoBridgeToken {
  symbol: string;
  name: string;
  address: string | null;
  decimals: number;
  logoUrl: string | null;
  priceUsd: number | null;
}

export interface EcoBridgeChain {
  id: string;
  name: string;
  logoUrl: string | null;
  tokens: EcoBridgeToken[];
}

export interface EcoBridgeProject {
  id: string;
  name: string;
  description: string | null;
  creditClass: string | null;
  registryUrl: string | null;
}

export interface EcoBridgeRegistry {
  chains: EcoBridgeChain[];
  projects: EcoBridgeProject[];
}

export interface EcoBridgeRegistryVersion {
  version: string;
  lastUpdated: string;
}

// --- In-memory cache ---

interface CacheEntry {
  data: EcoBridgeRegistry;
  version: string;
  fetchedAt: number;
}

let _cache: CacheEntry | null = null;

function getApiUrl(): string {
  return loadConfig().ecoBridgeApiUrl;
}

function getCacheTtlMs(): number {
  return loadConfig().ecoBridgeCacheTtlMs;
}

async function fetchJSON<T>(path: string): Promise<T> {
  const response = await fetch(`${getApiUrl()}${path}`);
  if (!response.ok) {
    throw new Error(
      `ecoBridge API error: ${response.status} ${response.statusText}`
    );
  }
  return response.json() as Promise<T>;
}

/**
 * Fetch the current registry version without downloading the full registry.
 * Used for efficient cache invalidation.
 */
export async function fetchRegistryVersion(): Promise<EcoBridgeRegistryVersion> {
  return fetchJSON<EcoBridgeRegistryVersion>("/registry/version");
}

/**
 * Fetch the full ecoBridge registry (projects, chains, tokens, prices).
 * Results are cached in memory with a TTL matching bridge.eco's ~60s update cadence.
 */
export async function fetchRegistry(): Promise<EcoBridgeRegistry> {
  const now = Date.now();
  const ttl = getCacheTtlMs();

  // Return cached data if still fresh
  if (_cache && now - _cache.fetchedAt < ttl) {
    return _cache.data;
  }

  // Check version before re-fetching when cache exists but has expired
  if (_cache) {
    try {
      const versionInfo = await fetchRegistryVersion();
      if (versionInfo.version === _cache.version) {
        // Same version — extend TTL without re-fetching
        _cache.fetchedAt = now;
        return _cache.data;
      }
    } catch {
      // Version check failed — fall through to full fetch
    }
  }

  const raw = await fetchJSON<unknown>("/registry");
  const registry = parseRegistry(raw);

  _cache = {
    data: registry,
    version: await getVersionString(),
    fetchedAt: now,
  };

  return registry;
}

async function getVersionString(): Promise<string> {
  try {
    const v = await fetchRegistryVersion();
    return v.version;
  } catch {
    return String(Date.now());
  }
}

/**
 * Parse the raw API response into our typed EcoBridgeRegistry format.
 * The bridge.eco registry schema may evolve; we parse defensively.
 */
function parseRegistry(raw: unknown): EcoBridgeRegistry {
  const obj = raw as Record<string, unknown>;

  // Helper to parse an array of token objects
  function parseTokens(raw: unknown[]): EcoBridgeToken[] {
    return raw.map((t: unknown) => {
      const tok = t as Record<string, unknown>;
      return {
        symbol: String(tok.symbol ?? ""),
        name: String(tok.name ?? tok.symbol ?? ""),
        address: tok.address ? String(tok.address) : null,
        decimals: typeof tok.decimals === "number" ? tok.decimals : 18,
        logoUrl: tok.logoUrl ? String(tok.logoUrl) : null,
        priceUsd:
          typeof tok.priceUsd === "number"
            ? tok.priceUsd
            : typeof tok.price === "number"
              ? tok.price
              : null,
      };
    });
  }

  // Parse chains and their tokens.
  // The API may return either:
  //   - "chains": [...] (array of chain objects with nested tokens)
  //   - "supportedTokens": { chainName: [tokens...], ... } (object keyed by chain)
  let chains: EcoBridgeChain[];

  if (Array.isArray(obj.chains) && obj.chains.length > 0) {
    // Format: chains array with nested tokens
    chains = obj.chains.map((c: unknown) => {
      const chain = c as Record<string, unknown>;
      const tokensRaw = Array.isArray(chain.tokens) ? chain.tokens : [];
      return {
        id: String(chain.id ?? chain.chainId ?? ""),
        name: String(chain.name ?? chain.id ?? ""),
        logoUrl: chain.logoUrl ? String(chain.logoUrl) : null,
        tokens: parseTokens(tokensRaw),
      };
    });
  } else if (
    obj.supportedTokens &&
    typeof obj.supportedTokens === "object" &&
    !Array.isArray(obj.supportedTokens)
  ) {
    // Format: supportedTokens object keyed by chain name
    const st = obj.supportedTokens as Record<string, unknown>;
    chains = Object.entries(st).map(([chainName, tokensRaw]) => ({
      id: chainName,
      name: chainName.charAt(0).toUpperCase() + chainName.slice(1),
      logoUrl: null,
      tokens: Array.isArray(tokensRaw) ? parseTokens(tokensRaw) : [],
    }));
  } else {
    chains = [];
  }

  // Parse projects
  const projectsRaw = Array.isArray(obj.projects) ? obj.projects : [];
  const projects: EcoBridgeProject[] = projectsRaw.map((p: unknown) => {
    const proj = p as Record<string, unknown>;
    return {
      id: String(proj.id ?? ""),
      name: String(proj.name ?? proj.id ?? ""),
      description: proj.description ? String(proj.description) : null,
      creditClass: proj.creditClass
        ? String(proj.creditClass)
        : proj.credit_class
          ? String(proj.credit_class)
          : null,
      registryUrl: proj.registryUrl
        ? String(proj.registryUrl)
        : proj.registry_url
          ? String(proj.registry_url)
          : null,
    };
  });

  return { chains, projects };
}

/**
 * Return all supported chains from the registry.
 */
export async function getSupportedChains(): Promise<EcoBridgeChain[]> {
  const registry = await fetchRegistry();
  return registry.chains;
}

/**
 * Return supported tokens, optionally filtered by chain id or name.
 */
export async function getSupportedTokens(
  chainFilter?: string
): Promise<Array<EcoBridgeToken & { chainId: string; chainName: string }>> {
  const registry = await fetchRegistry();
  const result: Array<EcoBridgeToken & { chainId: string; chainName: string }> =
    [];

  for (const chain of registry.chains) {
    if (chainFilter) {
      const cf = chainFilter.toLowerCase();
      if (
        chain.id.toLowerCase() !== cf &&
        chain.name.toLowerCase() !== cf &&
        !chain.name.toLowerCase().includes(cf) &&
        !chain.id.toLowerCase().includes(cf)
      ) {
        continue;
      }
    }
    for (const token of chain.tokens) {
      result.push({ ...token, chainId: chain.id, chainName: chain.name });
    }
  }

  return result;
}

/**
 * Get the current USD price for a specific token on a specific chain.
 * Returns null if the token/chain is not found in the registry.
 */
export async function getTokenPrice(
  tokenSymbol: string,
  chainFilter: string
): Promise<number | null> {
  const tokens = await getSupportedTokens(chainFilter);
  const token = tokens.find(
    (t) => t.symbol.toLowerCase() === tokenSymbol.toLowerCase()
  );
  return token?.priceUsd ?? null;
}

/**
 * Build a deep-linked ecoBridge widget URL.
 *
 * See: https://docs.bridge.eco/docs/guides/deep-linking/
 */
export interface RetirementUrlParams {
  chain?: string;
  token?: string;
  projectId?: string;
  amount?: number;
  beneficiaryName?: string;
  retirementReason?: string;
  jurisdiction?: string;
}

export function buildRetirementUrl(params: RetirementUrlParams): string {
  const config = loadConfig();
  const apiUrl = config.ecoBridgeApiUrl;

  // Derive the widget (app) URL from the API URL.
  // Canonical: https://api.bridge.eco → https://app.bridge.eco
  // For custom deployments, fall back to the api URL itself.
  let widgetBase: string;
  try {
    const apiParsed = new URL(apiUrl);
    if (apiParsed.hostname.startsWith("api.")) {
      apiParsed.hostname = "app." + apiParsed.hostname.slice("api.".length);
    }
    widgetBase = apiParsed.toString().replace(/\/$/, "");
  } catch {
    widgetBase = apiUrl.replace(/\/$/, "");
  }

  let url: URL;
  try {
    url = new URL(widgetBase);
  } catch {
    throw new Error(
      `ecoBridge: could not build widget URL from configured API URL "${apiUrl}". ` +
        `Check ECOBRIDGE_API_URL in your environment.`
    );
  }

  // Deep-link query params per bridge.eco widget spec
  if (params.chain) url.searchParams.set("chain", params.chain);
  if (params.token) url.searchParams.set("token", params.token);
  if (params.projectId) url.searchParams.set("project", params.projectId);
  if (params.amount != null)
    url.searchParams.set("amount", String(params.amount));
  if (params.beneficiaryName)
    url.searchParams.set("beneficiary", params.beneficiaryName);
  if (params.retirementReason)
    url.searchParams.set("reason", params.retirementReason);
  if (params.jurisdiction)
    url.searchParams.set("jurisdiction", params.jurisdiction);

  return url.toString();
}
