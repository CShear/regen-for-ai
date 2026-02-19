/**
 * Stripe payment provider stub.
 *
 * Placeholder for the Regen team to implement. Returns a clear
 * "not implemented" error so users know the capability exists
 * but isn't wired up yet.
 */

import type {
  PaymentProvider,
  PaymentAuthorization,
  PaymentReceipt,
} from "./types.js";

export class StripePaymentProvider implements PaymentProvider {
  name = "stripe";

  async authorizePayment(
    _amountMicro: bigint,
    _denom: string,
    _metadata?: Record<string, string>
  ): Promise<PaymentAuthorization> {
    return {
      id: "stripe-not-implemented",
      provider: this.name,
      amountMicro: _amountMicro,
      denom: _denom,
      status: "failed",
      message:
        "Stripe payment is not yet implemented. " +
        "The Regen team will wire up Stripe PaymentIntents here. " +
        "For now, use a funded REGEN/USDC wallet (crypto provider) " +
        "or purchase via the marketplace link.",
    };
  }

  async capturePayment(_authorizationId: string): Promise<PaymentReceipt> {
    throw new Error("Stripe capturePayment not implemented");
  }

  async refundPayment(_authorizationId: string): Promise<void> {
    throw new Error("Stripe refundPayment not implemented");
  }
}
