/**
 * Best-price sell order routing.
 *
 * Finds the cheapest sell orders that match criteria and fills
 * greedily across multiple orders if needed.
 */

import { listSellOrders, listCreditClasses, listBatches, getAllowedDenoms } from "./ledger.js";
import type { SellOrder, CreditClass, AllowedDenom } from "./ledger.js";

export interface OrderSelection {
  orders: SelectedOrder[];
  totalQuantity: string;
  totalCostMicro: bigint;
  paymentDenom: string;
  displayDenom: string;
  exponent: number;
  insufficientSupply: boolean;
}

export interface SelectedOrder {
  sellOrderId: string;
  batchDenom: string;
  quantity: string;
  askAmount: string;
  askDenom: string;
  costMicro: bigint;
}

export async function selectBestOrders(
  creditType: string | undefined,
  quantity: number,
  preferredDenom?: string,
  creditTypeAbbrevs?: string[]
): Promise<OrderSelection> {
  const [sellOrders, classes, allowedDenoms] = await Promise.all([
    listSellOrders(),
    listCreditClasses(),
    getAllowedDenoms(),
  ]);

  // Build class ID → credit type abbreviation map
  const classTypeMap = new Map<string, string>();
  for (const cls of classes) {
    classTypeMap.set(cls.id, cls.credit_type_abbrev);
  }

  // Determine preferred payment denom
  const denomInfo = pickDenom(allowedDenoms, preferredDenom);

  // Filter eligible sell orders:
  // - auto-retire enabled (disable_auto_retire === false)
  // - matching credit type (if specified)
  // - matching payment denom
  // - not expired
  const eligible = sellOrders.filter((order) => {
    if (order.disable_auto_retire) return false;
    if (order.ask_denom !== denomInfo.bankDenom) return false;

    if (creditType || creditTypeAbbrevs) {
      // Extract class ID from batch denom (e.g., "C01-001-..." → "C01")
      const classId = order.batch_denom.split("-").slice(0, 1).join("");
      // Match on credit type abbreviation
      const abbrev = classTypeMap.get(classId);
      if (!abbrev) return false;

      if (creditTypeAbbrevs) {
        // Explicit abbreviation filter takes precedence
        if (!creditTypeAbbrevs.includes(abbrev)) return false;
      } else if (creditType) {
        if (creditType === "carbon" && abbrev !== "C") return false;
        if (creditType === "biodiversity" && abbrev === "C") return false;
      }
    }

    if (order.expiration) {
      const expDate = new Date(order.expiration);
      if (expDate <= new Date()) return false;
    }

    return true;
  });

  // Sort by ask_amount ascending (cheapest first)
  eligible.sort((a, b) => {
    const aPrice = BigInt(a.ask_amount);
    const bPrice = BigInt(b.ask_amount);
    if (aPrice < bPrice) return -1;
    if (aPrice > bPrice) return 1;
    return 0;
  });

  // Greedy fill
  let remaining = quantity;
  const selected: SelectedOrder[] = [];
  let totalCostMicro = 0n;
  let insufficientSupply = false;

  for (const order of eligible) {
    if (remaining <= 0) break;

    const available = parseFloat(order.quantity);
    if (available <= 0) continue;

    const take = Math.min(remaining, available);
    const pricePerCredit = BigInt(order.ask_amount);
    // Cost = quantity * price_per_credit (ask_amount is in micro-units)
    // Since quantity can be fractional, compute cost carefully
    const costMicro = (pricePerCredit * BigInt(Math.ceil(take * 1_000_000))) / 1_000_000n;

    selected.push({
      sellOrderId: order.id,
      batchDenom: order.batch_denom,
      quantity: take.toFixed(6),
      askAmount: order.ask_amount,
      askDenom: order.ask_denom,
      costMicro,
    });

    totalCostMicro += costMicro;
    remaining -= take;
  }

  if (remaining > 0.000001) {
    insufficientSupply = true;
  }

  const actualQuantity = quantity - Math.max(remaining, 0);

  return {
    orders: selected,
    totalQuantity: actualQuantity.toFixed(6),
    totalCostMicro,
    paymentDenom: denomInfo.bankDenom,
    displayDenom: denomInfo.displayDenom,
    exponent: denomInfo.exponent,
    insufficientSupply,
  };
}

function pickDenom(
  allowedDenoms: AllowedDenom[],
  preferred?: string
): { bankDenom: string; displayDenom: string; exponent: number } {
  if (preferred) {
    const match = allowedDenoms.find(
      (d) => d.bank_denom === preferred || d.display_denom === preferred
    );
    if (match) {
      return {
        bankDenom: match.bank_denom,
        displayDenom: match.display_denom,
        exponent: match.exponent,
      };
    }
  }

  // Default: prefer uregen, then first available
  const regen = allowedDenoms.find((d) => d.display_denom === "REGEN" || d.bank_denom === "uregen");
  if (regen) {
    return {
      bankDenom: regen.bank_denom,
      displayDenom: regen.display_denom,
      exponent: regen.exponent,
    };
  }

  if (allowedDenoms.length > 0) {
    const first = allowedDenoms[0];
    return {
      bankDenom: first.bank_denom,
      displayDenom: first.display_denom,
      exponent: first.exponent,
    };
  }

  // Fallback
  return { bankDenom: "uregen", displayDenom: "REGEN", exponent: 6 };
}
