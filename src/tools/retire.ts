/**
 * Retire ecocredits on Regen Network.
 *
 * Two execution paths:
 *   Path A (no wallet configured): Return marketplace link (backward compatible)
 *   Path B (wallet configured): Execute on-chain MsgBuyDirect with auto-retire
 *
 * Every error in Path B returns a fallback marketplace link so the user is never stuck.
 */

import { loadConfig, isWalletConfigured } from "../config.js";
import { initWallet, signAndBroadcast } from "../services/wallet.js";
import { selectBestOrders } from "../services/order-selector.js";
import { waitForRetirement } from "../services/indexer.js";
import { CryptoPaymentProvider } from "../services/payment/crypto.js";
import { StripePaymentProvider } from "../services/payment/stripe-stub.js";
import type { PaymentProvider } from "../services/payment/types.js";

function getMarketplaceLink(): string {
  const config = loadConfig();
  return `${config.marketplaceUrl}/projects/1?buying_options_filters=credit_card`;
}

function marketplaceFallback(
  message: string,
  creditClass?: string,
  quantity?: number,
  beneficiaryName?: string
): { content: Array<{ type: "text"; text: string }> } {
  const url = getMarketplaceLink();
  const lines: string[] = [
    `## Retire Ecocredits on Regen Network`,
    ``,
  ];

  if (message) {
    lines.push(`> ${message}`, ``);
  }

  if (creditClass) lines.push(`**Credit class**: ${creditClass}`);
  if (quantity) lines.push(`**Quantity**: ${quantity} credits`);
  if (beneficiaryName) lines.push(`**Beneficiary**: ${beneficiaryName}`);

  lines.push(
    ``,
    `### Purchase & Retire`,
    ``,
    `Visit the Regen Marketplace to complete your credit retirement:`,
    ``,
    `**[app.regen.network](${url})**`,
    ``,
    `**How it works:**`,
    `1. Browse available credits on the marketplace`,
    `2. Select credits and choose "Retire" at checkout`,
    `3. Pay with credit card (no crypto wallet needed)`,
    `4. Your name appears as beneficiary on the on-chain retirement certificate`,
    `5. Credits are permanently retired — verifiable, immutable, non-reversible`,
    ``,
    `Use \`browse_available_credits\` to see current pricing and availability.`,
    ...(loadConfig().ecoBridgeEnabled
      ? [
          ``,
          `**Cross-chain option:** Use \`retire_via_ecobridge\` to pay with tokens from other chains`,
          `(USDC, USDT, ETH, etc. on Ethereum, Polygon, Arbitrum, Base, and more).`,
          `Use \`browse_ecobridge_tokens\` to see all supported chains and tokens.`,
        ]
      : []),
    ``,
    `After retiring, use \`get_retirement_certificate\` to retrieve your verifiable certificate.`
  );

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}

function getPaymentProvider(): PaymentProvider {
  const config = loadConfig();
  if (config.paymentProvider === "stripe") {
    return new StripePaymentProvider();
  }
  return new CryptoPaymentProvider();
}

export async function retireCredits(
  creditClass?: string,
  quantity?: number,
  beneficiaryName?: string,
  jurisdiction?: string,
  reason?: string
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  // Path A: No wallet → marketplace link (fully backward compatible)
  if (!isWalletConfigured()) {
    return marketplaceFallback("", creditClass, quantity, beneficiaryName);
  }

  // Path B: Direct on-chain retirement
  const config = loadConfig();
  const retireJurisdiction = jurisdiction || config.defaultJurisdiction;
  const retireReason =
    reason || "Regenerative contribution via Regen Compute Credits MCP server";
  const retireQuantity = quantity || 1;

  try {
    // 1. Initialize wallet
    const { address } = await initWallet();

    // 2. Find best-priced sell orders
    const selection = await selectBestOrders(
      creditClass ? (creditClass.startsWith("C") ? "carbon" : "biodiversity") : undefined,
      retireQuantity
    );

    if (selection.orders.length === 0) {
      return marketplaceFallback(
        "No matching sell orders found on-chain. Try the marketplace instead.",
        creditClass,
        quantity,
        beneficiaryName
      );
    }

    if (selection.insufficientSupply) {
      const available = parseFloat(selection.totalQuantity);
      return marketplaceFallback(
        `Only ${available.toFixed(4)} credits available on-chain (requested ${retireQuantity}). ` +
          `You can try a smaller quantity or use the marketplace.`,
        creditClass,
        quantity,
        beneficiaryName
      );
    }

    // 3. Authorize payment (balance check for crypto, hold for Stripe)
    const provider = getPaymentProvider();
    const auth = await provider.authorizePayment(
      selection.totalCostMicro,
      selection.paymentDenom,
      { buyer: address, creditClass: creditClass || "any" }
    );

    if (auth.status === "failed") {
      const displayCost = formatAmount(
        selection.totalCostMicro,
        selection.exponent,
        selection.displayDenom
      );
      return marketplaceFallback(
        auth.message ||
          `Insufficient wallet balance. Need ${displayCost} to purchase ${retireQuantity} credits.`,
        creditClass,
        quantity,
        beneficiaryName
      );
    }

    // 4. Build and broadcast MsgBuyDirect
    const buyOrders = selection.orders.map((order) => ({
      sellOrderId: BigInt(order.sellOrderId),
      quantity: order.quantity,
      bidPrice: {
        denom: order.askDenom,
        amount: order.askAmount,
      },
      disableAutoRetire: false,
      retirementJurisdiction: retireJurisdiction,
      retirementReason: retireReason,
    }));

    const msg = {
      typeUrl: "/regen.ecocredit.marketplace.v1.MsgBuyDirect",
      value: {
        buyer: address,
        orders: buyOrders,
      },
    };

    let txResult;
    try {
      txResult = await signAndBroadcast([msg]);
    } catch (err) {
      // Release payment hold on broadcast failure
      try {
        await provider.refundPayment(auth.id);
      } catch {
        // Ignore refund errors
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      return marketplaceFallback(
        `Transaction broadcast failed: ${errMsg}`,
        creditClass,
        quantity,
        beneficiaryName
      );
    }

    // Check tx result
    if (txResult.code !== 0) {
      try {
        await provider.refundPayment(auth.id);
      } catch {
        // Ignore refund errors
      }
      return marketplaceFallback(
        `Transaction rejected (code ${txResult.code}): ${txResult.rawLog || "unknown error"}`,
        creditClass,
        quantity,
        beneficiaryName
      );
    }

    // 5. Capture payment (no-op for crypto)
    await provider.capturePayment(auth.id);

    // 6. Poll indexer for retirement certificate
    const retirement = await waitForRetirement(txResult.transactionHash);

    // 7. Build success response
    const displayCost = formatAmount(
      selection.totalCostMicro,
      selection.exponent,
      selection.displayDenom
    );

    const lines: string[] = [
      `## Ecocredit Retirement Successful`,
      ``,
      `Credits have been permanently retired on Regen Ledger.`,
      ``,
      `| Field | Value |`,
      `|-------|-------|`,
      `| Credits Retired | ${selection.totalQuantity} |`,
      `| Cost | ${displayCost} |`,
      `| Jurisdiction | ${retireJurisdiction} |`,
      `| Reason | ${retireReason} |`,
      `| Transaction Hash | \`${txResult.transactionHash}\` |`,
      `| Block Height | ${txResult.height} |`,
    ];

    if (beneficiaryName) {
      lines.push(`| Beneficiary | ${beneficiaryName} |`);
    }

    if (retirement) {
      lines.push(`| Certificate ID | ${retirement.nodeId} |`);
      lines.push(
        ``,
        `### Retirement Certificate`,
        ``,
        `Use \`get_retirement_certificate\` with ID \`${retirement.nodeId}\` to retrieve the full certificate.`
      );
    } else {
      lines.push(
        ``,
        `> The indexer is still processing this retirement. `,
        `> Use \`get_retirement_certificate\` with tx hash \`${txResult.transactionHash}\` to check later.`
      );
    }

    lines.push(
      ``,
      `This retirement is permanently recorded on Regen Ledger and cannot be altered or reversed.`
    );

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return marketplaceFallback(
      `Direct retirement failed: ${errMsg}`,
      creditClass,
      quantity,
      beneficiaryName
    );
  }
}

function formatAmount(
  amountMicro: bigint,
  exponent: number,
  displayDenom: string
): string {
  const divisor = 10 ** exponent;
  const whole = amountMicro / BigInt(divisor);
  const frac = amountMicro % BigInt(divisor);
  const fracStr = frac.toString().padStart(exponent, "0").replace(/0+$/, "");
  if (fracStr) {
    return `${whole}.${fracStr} ${displayDenom}`;
  }
  return `${whole} ${displayDenom}`;
}
