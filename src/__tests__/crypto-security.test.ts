import { describe, it, expect } from "vitest";
import { toUsdCents } from "../services/crypto-price.js";
import { verifyPayment } from "../services/crypto-verify.js";

/**
 * Regression tests for the crypto payment attack surface.
 *
 * These lock in two of the security fixes from the July 2026 review:
 *  - C2: a token whose on-chain symbol() spoofs "USDC" must NOT be valued at $1.
 *        verifyEvmTx now returns unknown tokens as "chain:0xcontract", so the
 *        pricing layer never applies the stablecoin shortcut to them.
 *  - L3: transaction hashes are validated before ever reaching an external API.
 */

describe("toUsdCents — stablecoin shortcut is name-gated (C2)", () => {
  it("values genuine USDC/USDT/xDAI at $1 per unit", async () => {
    expect(await toUsdCents("USDC", "100")).toBe(10000);
    expect(await toUsdCents("USDT", "12.5")).toBe(1250);
    expect(await toUsdCents("xDAI", "1")).toBe(100);
  });

  it("does NOT value an unknown token at $1 just because it exists", async () => {
    // A spoofed token arrives from the verifier as "chain:0xcontract" (never the
    // attacker-controlled symbol string). With no contract-price lookup available,
    // it must be un-priceable rather than defaulting to $1/unit.
    await expect(
      toUsdCents("base:0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef", "1000000000")
    ).rejects.toThrow(/No price available/i);
  });

  it("rejects negative or non-numeric amounts", async () => {
    await expect(toUsdCents("USDC", "-5")).rejects.toThrow(/Invalid amount/i);
    await expect(toUsdCents("USDC", "abc")).rejects.toThrow(/Invalid amount/i);
  });
});

describe("verifyPayment — tx hash validation (L3)", () => {
  it("rejects a malformed EVM tx hash before any network call", async () => {
    await expect(verifyPayment("ethereum", "not-a-hash")).rejects.toThrow(
      /Invalid ethereum transaction hash/i
    );
    await expect(
      verifyPayment("base", "0x123") // too short
    ).rejects.toThrow(/Invalid base transaction hash/i);
  });

  it("rejects path-injection characters in a tx hash", async () => {
    await expect(
      verifyPayment("bitcoin", "../../etc/passwd")
    ).rejects.toThrow(/Invalid bitcoin transaction hash/i);
    await expect(
      verifyPayment("tron", "abc/events?x=1")
    ).rejects.toThrow(/Invalid tron transaction hash/i);
  });

  it("rejects an unknown chain", async () => {
    await expect(
      verifyPayment("dogechain", "0x" + "a".repeat(64))
    ).rejects.toThrow(/Unknown chain/i);
  });
});
