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
const { getEvmAddress, isEvmWalletConfigured, sendUsdc, __evmWalletInternals } = await import(
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

    it("accepts a string amount and passes the exact base units to transfer", async () => {
      mockBalanceOf.mockResolvedValueOnce(BigInt(1_000_000_000));
      mockWait.mockResolvedValueOnce({ hash: "0xdef" });
      mockTransfer.mockResolvedValueOnce({ wait: mockWait });

      await sendUsdc("base", "0x1234567890abcdef1234567890abcdef12345678", "12.345678");

      expect(mockTransfer).toHaveBeenCalledWith(
        "0x1234567890abcdef1234567890abcdef12345678",
        BigInt(12_345_678),
      );
    });
  });

  describe("usdcToBaseUnits (audit C1)", () => {
    const { usdcToBaseUnits } = __evmWalletInternals;

    it("converts integer USDC amounts exactly", () => {
      expect(usdcToBaseUnits(1)).toBe(1_000_000n);
      expect(usdcToBaseUnits(100)).toBe(100_000_000n);
    });

    it("converts decimal string amounts exactly", () => {
      expect(usdcToBaseUnits("0.000001")).toBe(1n);
      expect(usdcToBaseUnits("12.345678")).toBe(12_345_678n);
    });

    it("REGRESSION: 0.1 USDC must be exactly 100_000 base units", () => {
      // Old code: BigInt(Math.round(0.1 * 1_000_000))
      //   0.1 * 1_000_000 = 100000.00000000001 (float artifact)
      //   Math.round → 100000n (correct here, but the spurious bit
      //   showed up at other scales). The new code goes through
      //   ethers.parseUnits which is decimal-string exact.
      expect(usdcToBaseUnits(0.1)).toBe(100_000n);
      expect(usdcToBaseUnits("0.1")).toBe(100_000n);
    });

    it("clamps numbers beyond USDC's 6 decimals to representable precision", () => {
      // (0.1234567).toFixed(6) === "0.123457" — toFixed rounds half-up.
      // The chain can't represent sub-cent fractions, so this is the right
      // behavior for a JS-number caller. A precision-sensitive caller should
      // pass a string instead.
      expect(usdcToBaseUnits(0.1234567)).toBe(123_457n);
    });

    it("rejects strings with more than 6 decimals (caller responsibility)", () => {
      // ethers.parseUnits enforces this. The thrown error is informative
      // — surfaces the precision mismatch loudly rather than silently
      // truncating money.
      expect(() => usdcToBaseUnits("0.1234567")).toThrow();
    });
  });
});
