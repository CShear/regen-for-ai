/**
 * Crypto payment provider.
 *
 * "Authorization" = balance check (can the wallet afford this?).
 * "Capture" = no-op (funds are spent during signAndBroadcast).
 * "Refund" = no-op (if tx fails, funds were never spent).
 */

import type {
  PaymentProvider,
  PaymentAuthorization,
  PaymentReceipt,
} from "./types.js";
import { getBalance } from "../wallet.js";

export class CryptoPaymentProvider implements PaymentProvider {
  name = "crypto";

  async authorizePayment(
    amountMicro: bigint,
    denom: string,
    _metadata?: Record<string, string>
  ): Promise<PaymentAuthorization> {
    const balance = await getBalance(denom);

    if (balance < amountMicro) {
      return {
        id: `crypto-${Date.now()}`,
        provider: this.name,
        amountMicro,
        denom,
        status: "failed",
        message:
          `Insufficient balance: have ${balance.toString()} ${denom}, ` +
          `need ${amountMicro.toString()} ${denom}`,
      };
    }

    return {
      id: `crypto-${Date.now()}`,
      provider: this.name,
      amountMicro,
      denom,
      status: "authorized",
    };
  }

  async capturePayment(authorizationId: string): Promise<PaymentReceipt> {
    // No-op for crypto — funds were spent in the on-chain transaction
    return {
      id: authorizationId,
      provider: this.name,
      amountMicro: 0n,
      denom: "",
      status: "captured",
    };
  }

  async refundPayment(_authorizationId: string): Promise<void> {
    // No-op for crypto — if the tx failed, funds were never spent
  }
}
