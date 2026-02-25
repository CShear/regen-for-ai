import { afterEach, describe, expect, it, vi } from "vitest";

const originalFetch = globalThis.fetch;

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => payload,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  globalThis.fetch = originalFetch;
});

describe("ecobridge service", () => {
  it("parses supportedTokens object shape from registry", async () => {
    vi.doMock("../src/config.js", () => ({
      loadConfig: () => ({
        ecoBridgeApiUrl: "https://api.bridge.eco",
        ecoBridgeCacheTtlMs: 60_000,
      }),
    }));

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/registry/version")) {
        return jsonResponse({ version: "1", lastUpdated: "2026-02-25T00:00:00Z" });
      }
      return jsonResponse({
        supportedTokens: {
          ethereum: [
            { symbol: "USDC", name: "USD Coin", decimals: 6, priceUsd: 1 },
          ],
          polygon: [
            { symbol: "ETH", name: "Ether", decimals: 18, price: 3200 },
          ],
        },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { getSupportedTokens } = await import("../src/services/ecobridge.js");
    const tokens = await getSupportedTokens();

    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toMatchObject({
      chainId: "ethereum",
      symbol: "USDC",
      priceUsd: 1,
    });
    expect(tokens[1]).toMatchObject({
      chainId: "polygon",
      symbol: "ETH",
      priceUsd: 3200,
    });
  });

  it("builds widget URL from api host and includes deep-link params", async () => {
    vi.doMock("../src/config.js", () => ({
      loadConfig: () => ({
        ecoBridgeApiUrl: "https://api.bridge.eco",
        ecoBridgeCacheTtlMs: 60_000,
      }),
    }));

    const { buildRetirementUrl } = await import("../src/services/ecobridge.js");
    const url = buildRetirementUrl({
      chain: "base",
      token: "USDC",
      projectId: "regen",
      amount: 1.5,
    });
    const parsed = new URL(url);

    expect(parsed.origin).toBe("https://bridge.eco");
    expect(parsed.searchParams.get("tab")).toBe("impact");
    expect(parsed.searchParams.get("chain")).toBe("base");
    expect(parsed.searchParams.get("token")).toBe("USDC");
    expect(parsed.searchParams.get("project")).toBe("regen");
    expect(parsed.searchParams.get("amount")).toBe("1.5");
  });
});
