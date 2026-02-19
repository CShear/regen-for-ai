/**
 * Payment provider interface for two-phase payment authorization.
 *
 * The authorize → capture pattern is critical for the future Stripe integration:
 * hold the card first, charge only after the on-chain transaction succeeds.
 * For crypto, authorize = balance check, capture = no-op (funds spent in tx).
 */

export interface PaymentAuthorization {
  id: string;
  provider: string;
  amountMicro: bigint;
  denom: string;
  status: "authorized" | "failed";
  message?: string;
}

export interface PaymentReceipt {
  id: string;
  provider: string;
  amountMicro: bigint;
  denom: string;
  status: "captured";
}

export interface PaymentProvider {
  name: string;

  /** Check that the payer can cover the amount. Returns an authorization hold. */
  authorizePayment(
    amountMicro: bigint,
    denom: string,
    metadata?: Record<string, string>
  ): Promise<PaymentAuthorization>;

  /** Finalize the charge after on-chain success. */
  capturePayment(authorizationId: string): Promise<PaymentReceipt>;

  /** Release the hold on failure (no-op for crypto). */
  refundPayment(authorizationId: string): Promise<void>;
}
