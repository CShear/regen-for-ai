import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock config before importing the module under test
vi.mock("../config.js", () => ({
  loadConfig: vi.fn(() => ({
    ecoBridgeEvmMnemonic:
      "test test test test test test test test test test test junk",
    ecoBridgeEvmDerivationPath: "m/44'/60'/0'/0/0",
  })),
}));

// Mock ethers — we don't want real RPC calls
const mockBalanceOf = vi.fn();
const mockTransfer = vi.fn();
const mockWait = vi.fn();

vi.mock("ethers", async () => {
  const actual = await vi.importActual<typeof import("ethers")>("ethers");

  // Real HDNodeWallet for deterministic address derivation
  const realWallet = actual.ethers.HDNodeWallet.fromPhrase(
    "test test test test test test test test test test test junk",
    "",
    "m/44'/60'/0'/0/0"
  );

  // Contract must be a class (used with `new`)
  class MockContract {
    balanceOf = mockBalanceOf;
    transfer = mockTransfer;
    decimals = vi.fn(async () => 6);
    symbol = vi.fn(async () => "USDC");
  }

  return {
    ethers: {
      ...actual.ethers,
      HDNodeWallet: {
        fromPhrase: vi.fn(() => ({
          address: realWallet.address,
          connect: vi.fn(() => ({
            address: realWallet.address,
          })),
        })),
      },
      JsonRpcProvider: vi.fn(),
      Contract: MockContract,
    },
  };
});

// Import after mocks are set up
const { getEvmAddress, isEvmWalletConfigured, sendUsdc } = await import(
  "../services/evm-wallet.js"
);

describe("evm-wallet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getEvmAddress", () => {
    it("returns a valid Ethereum address", () => {
      const address = getEvmAddress();
      expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    it("returns a deterministic address from the mnemonic", () => {
      const addr1 = getEvmAddress();
      const addr2 = getEvmAddress();
      expect(addr1).toBe(addr2);
    });
  });

  describe("isEvmWalletConfigured", () => {
    it("returns true when mnemonic is set", () => {
      expect(isEvmWalletConfigured()).toBe(true);
    });

    it("returns false when mnemonic is not set", async () => {
      const { loadConfig } = await import("../config.js");
      vi.mocked(loadConfig).mockReturnValueOnce({
        ecoBridgeEvmMnemonic: undefined,
      } as ReturnType<typeof loadConfig>);
      expect(isEvmWalletConfigured()).toBe(false);
    });
  });

  describe("sendUsdc", () => {
    it("throws on unsupported chain", async () => {
      await expect(
        sendUsdc("avalanche", "0x1234567890abcdef1234567890abcdef12345678", 10)
      ).rejects.toThrow(/No RPC URL configured for chain "avalanche"/);
    });

    it("throws on insufficient balance", async () => {
      mockBalanceOf.mockResolvedValueOnce(BigInt(5_000_000)); // 5 USDC
      await expect(
        sendUsdc("base", "0x1234567890abcdef1234567890abcdef12345678", 10)
      ).rejects.toThrow(/Insufficient USDC balance/);
    });

    it("sends USDC and returns tx result", async () => {
      mockBalanceOf.mockResolvedValueOnce(BigInt(100_000_000)); // 100 USDC
      mockWait.mockResolvedValueOnce({
        hash: "0xabc123",
      });
      mockTransfer.mockResolvedValueOnce({ wait: mockWait });

      const result = await sendUsdc(
        "base",
        "0x1234567890abcdef1234567890abcdef12345678",
        10
      );

      expect(result.txHash).toBe("0xabc123");
      expect(result.chain).toBe("base");
      expect(result.amountUsdc).toBe("10");
      expect(result.to).toBe("0x1234567890abcdef1234567890abcdef12345678");
      expect(mockTransfer).toHaveBeenCalledWith(
        "0x1234567890abcdef1234567890abcdef12345678",
        BigInt(10_000_000)
      );
    });
  });
});
