import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock config
vi.mock("../config.js", () => ({
  loadConfig: vi.fn(() => ({
    ecoBridgeApiUrl: "https://api.bridge.eco",
    ecoBridgeCacheTtlMs: 60000,
  })),
}));

// Sample registry data matching the two API formats
const SAMPLE_REGISTRY_CHAINS_FORMAT = {
  chains: [
    {
      id: "base",
      name: "Base",
      logoUrl: "https://example.com/base.png",
      tokens: [
        {
          symbol: "USDC",
          name: "USD Coin",
          address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          decimals: 6,
          priceUsd: 1.0,
        },
        {
          symbol: "ETH",
          name: "Ether",
          address: null,
          decimals: 18,
          priceUsd: 3200.5,
        },
      ],
    },
    {
      id: "ethereum",
      name: "Ethereum",
      tokens: [
        {
          symbol: "USDC",
          name: "USD Coin",
          address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          decimals: 6,
          price: 1.0,
        },
      ],
    },
  ],
  projects: [
    {
      id: "1",
      name: "Wilmot Carbon Project",
      description: "Biochar soil carbon",
      creditClass: "C02",
      registryUrl: "https://app.regen.network/project/C02-001",
      evmWallet: "0xProjectWallet1",
      price: 25.0,
      unit: "tCO2e",
      location: "US",
      type: "carbon",
    },
    {
      id: "2",
      name: "Terrasos Biodiversity",
      description: "Voluntary biodiversity credits",
      credit_class: "BT01",
      registry_url: "https://app.regen.network/project/BT01-001",
      evmWallet: "0xProjectWallet2",
      price: 15.0,
      unit: "BT",
      location: "CO",
      type: "biodiversity",
    },
  ],
};

const SAMPLE_REGISTRY_SUPPORTED_TOKENS_FORMAT = {
  supportedTokens: {
    base: [
      { symbol: "USDC", decimals: 6, priceUsd: 1.0 },
      { symbol: "ETH", decimals: 18, priceUsd: 3200.5 },
    ],
    polygon: [{ symbol: "MATIC", decimals: 18, priceUsd: 0.45 }],
  },
  projects: [],
};

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("ecobridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module-level cache by re-importing fresh
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function importFresh() {
    return import("../services/ecobridge.js");
  }

  function mockRegistryResponse(data: unknown) {
    mockFetch.mockImplementation((url: string) => {
      if (url.endsWith("/registry/version")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ version: "v1", lastUpdated: "2026-01-01" }),
        });
      }
      if (url.endsWith("/registry")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(data),
        });
      }
      return Promise.resolve({ ok: false, status: 404, statusText: "Not Found" });
    });
  }

  describe("fetchRegistry — chains array format", () => {
    it("parses chains with nested tokens", async () => {
      mockRegistryResponse(SAMPLE_REGISTRY_CHAINS_FORMAT);
      const mod = await importFresh();
      const registry = await mod.fetchRegistry();

      expect(registry.chains).toHaveLength(2);
      expect(registry.chains[0].id).toBe("base");
      expect(registry.chains[0].name).toBe("Base");
      expect(registry.chains[0].tokens).toHaveLength(2);
      expect(registry.chains[0].tokens[0].symbol).toBe("USDC");
      expect(registry.chains[0].tokens[0].priceUsd).toBe(1.0);
      expect(registry.chains[0].tokens[1].symbol).toBe("ETH");
      expect(registry.chains[0].tokens[1].priceUsd).toBe(3200.5);
    });

    it("parses projects with both camelCase and snake_case fields", async () => {
      mockRegistryResponse(SAMPLE_REGISTRY_CHAINS_FORMAT);
      const mod = await importFresh();
      const registry = await mod.fetchRegistry();

      expect(registry.projects).toHaveLength(2);
      // camelCase source
      expect(registry.projects[0].creditClass).toBe("C02");
      expect(registry.projects[0].registryUrl).toBe(
        "https://app.regen.network/project/C02-001"
      );
      // snake_case source
      expect(registry.projects[1].creditClass).toBe("BT01");
      expect(registry.projects[1].registryUrl).toBe(
        "https://app.regen.network/project/BT01-001"
      );
    });

    it("handles price field alias (price → priceUsd)", async () => {
      mockRegistryResponse(SAMPLE_REGISTRY_CHAINS_FORMAT);
      const mod = await importFresh();
      const registry = await mod.fetchRegistry();

      // Ethereum chain's USDC uses `price` instead of `priceUsd`
      const ethChain = registry.chains.find((c) => c.id === "ethereum");
      expect(ethChain?.tokens[0].priceUsd).toBe(1.0);
    });
  });

  describe("fetchRegistry — supportedTokens object format", () => {
    it("parses supportedTokens keyed by chain name", async () => {
      mockRegistryResponse(SAMPLE_REGISTRY_SUPPORTED_TOKENS_FORMAT);
      const mod = await importFresh();
      const registry = await mod.fetchRegistry();

      expect(registry.chains).toHaveLength(2);
      const baseChain = registry.chains.find((c) => c.id === "base");
      expect(baseChain).toBeDefined();
      expect(baseChain!.name).toBe("Base");
      expect(baseChain!.tokens).toHaveLength(2);

      const polygonChain = registry.chains.find((c) => c.id === "polygon");
      expect(polygonChain).toBeDefined();
      expect(polygonChain!.tokens[0].symbol).toBe("MATIC");
    });
  });

  describe("fetchRegistry — empty/malformed data", () => {
    it("returns empty arrays for completely empty response", async () => {
      mockRegistryResponse({});
      const mod = await importFresh();
      const registry = await mod.fetchRegistry();

      expect(registry.chains).toHaveLength(0);
      expect(registry.projects).toHaveLength(0);
    });
  });

  describe("getSupportedTokens", () => {
    it("returns all tokens when no filter", async () => {
      mockRegistryResponse(SAMPLE_REGISTRY_CHAINS_FORMAT);
      const mod = await importFresh();
      const tokens = await mod.getSupportedTokens();

      // 2 from Base + 1 from Ethereum
      expect(tokens).toHaveLength(3);
      expect(tokens.every((t) => t.chainId)).toBe(true);
      expect(tokens.every((t) => t.chainName)).toBe(true);
    });

    it("filters by chain name", async () => {
      mockRegistryResponse(SAMPLE_REGISTRY_CHAINS_FORMAT);
      const mod = await importFresh();
      const tokens = await mod.getSupportedTokens("base");

      expect(tokens).toHaveLength(2);
      expect(tokens.every((t) => t.chainId === "base")).toBe(true);
    });

    it("filters case-insensitively", async () => {
      mockRegistryResponse(SAMPLE_REGISTRY_CHAINS_FORMAT);
      const mod = await importFresh();
      const tokens = await mod.getSupportedTokens("BASE");

      expect(tokens).toHaveLength(2);
    });

    it("returns empty for non-existent chain", async () => {
      mockRegistryResponse(SAMPLE_REGISTRY_CHAINS_FORMAT);
      const mod = await importFresh();
      const tokens = await mod.getSupportedTokens("solana");

      expect(tokens).toHaveLength(0);
    });
  });

  describe("getTokenPrice", () => {
    it("returns price for a known token", async () => {
      mockRegistryResponse(SAMPLE_REGISTRY_CHAINS_FORMAT);
      const mod = await importFresh();
      const price = await mod.getTokenPrice("ETH", "base");

      expect(price).toBe(3200.5);
    });

    it("returns null for unknown token", async () => {
      mockRegistryResponse(SAMPLE_REGISTRY_CHAINS_FORMAT);
      const mod = await importFresh();
      const price = await mod.getTokenPrice("DOGE", "base");

      expect(price).toBeNull();
    });
  });

  describe("getProject", () => {
    it("finds project by numeric ID", async () => {
      mockRegistryResponse(SAMPLE_REGISTRY_CHAINS_FORMAT);
      const mod = await importFresh();
      const project = await mod.getProject(1);

      expect(project).not.toBeNull();
      expect(project!.name).toBe("Wilmot Carbon Project");
    });

    it("finds project by string ID", async () => {
      mockRegistryResponse(SAMPLE_REGISTRY_CHAINS_FORMAT);
      const mod = await importFresh();
      const project = await mod.getProject("2");

      expect(project).not.toBeNull();
      expect(project!.name).toBe("Terrasos Biodiversity");
    });

    it("finds project by partial name match", async () => {
      mockRegistryResponse(SAMPLE_REGISTRY_CHAINS_FORMAT);
      const mod = await importFresh();
      const project = await mod.getProject("Wilmot");

      expect(project).not.toBeNull();
      expect(project!.id).toBe("1");
    });

    it("returns null for non-existent project", async () => {
      mockRegistryResponse(SAMPLE_REGISTRY_CHAINS_FORMAT);
      const mod = await importFresh();
      const project = await mod.getProject("nonexistent-project-xyz");

      expect(project).toBeNull();
    });
  });

  describe("buildRetirementUrl", () => {
    it("builds base URL from API URL", async () => {
      const mod = await importFresh();
      const url = mod.buildRetirementUrl({});

      expect(url).toContain("bridge.eco");
      expect(url).toContain("tab=impact");
      // Should strip "api." prefix
      expect(url).not.toContain("api.bridge.eco");
    });

    it("includes chain and token params", async () => {
      const mod = await importFresh();
      const url = mod.buildRetirementUrl({
        chain: "base",
        token: "USDC",
      });

      expect(url).toContain("chain=base");
      expect(url).toContain("token=USDC");
    });

    it("includes project and amount params", async () => {
      const mod = await importFresh();
      const url = mod.buildRetirementUrl({
        projectId: "project-123",
        amount: 50,
      });

      expect(url).toContain("project=project-123");
      expect(url).toContain("amount=50");
    });

    it("omits undefined params", async () => {
      const mod = await importFresh();
      const url = mod.buildRetirementUrl({
        chain: "base",
      });

      expect(url).toContain("chain=base");
      expect(url).not.toContain("token=");
      expect(url).not.toContain("project=");
      expect(url).not.toContain("amount=");
    });
  });

  describe("pollTransaction", () => {
    it("returns immediately on terminal state", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            status: "RETIRED",
            blockchain: "base",
            amount: 10,
            tokenSymbol: "USDC",
            projectName: "Test Project",
          }),
      });

      const mod = await importFresh();
      const tx = await mod.pollTransaction("0xabc123", 3, 10);

      expect(tx.status).toBe("RETIRED");
      expect(tx.txHash).toBe("0xabc123");
      expect(tx.blockchain).toBe("base");
      expect(tx.amount).toBe(10);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("polls until terminal state", async () => {
      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        const status = callCount < 3 ? "PENDING" : "RWI_MINTED";
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              status,
              blockchain: "base",
            }),
        });
      });

      const mod = await importFresh();
      const tx = await mod.pollTransaction("0xabc123", 5, 10);

      expect(tx.status).toBe("RWI_MINTED");
      expect(callCount).toBe(3);
    });

    it("throws after max attempts", async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: "PENDING" }),
        })
      );

      const mod = await importFresh();
      await expect(
        mod.pollTransaction("0xabc123", 3, 10)
      ).rejects.toThrow(/did not reach terminal state/);
    });

    it("handles FAILED status as terminal", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: "FAILED", blockchain: "base" }),
      });

      const mod = await importFresh();
      const tx = await mod.pollTransaction("0xabc123", 3, 10);
      expect(tx.status).toBe("FAILED");
    });
  });

  describe("fetchRegistryVersion", () => {
    it("fetches and returns version info", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ version: "v42", lastUpdated: "2026-02-28" }),
      });

      const mod = await importFresh();
      const version = await mod.fetchRegistryVersion();

      expect(version.version).toBe("v42");
      expect(version.lastUpdated).toBe("2026-02-28");
    });

    it("throws on API error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      const mod = await importFresh();
      await expect(mod.fetchRegistryVersion()).rejects.toThrow(
        /ecoBridge API error: 500/
      );
    });
  });

  describe("caching", () => {
    it("caches registry data within TTL", async () => {
      mockRegistryResponse(SAMPLE_REGISTRY_CHAINS_FORMAT);
      const mod = await importFresh();

      await mod.fetchRegistry();
      await mod.fetchRegistry();

      // /registry should only be fetched once (plus version calls)
      const registryCalls = mockFetch.mock.calls.filter(
        (call) => String(call[0]).endsWith("/registry")
      );
      expect(registryCalls).toHaveLength(1);
    });
  });
});
