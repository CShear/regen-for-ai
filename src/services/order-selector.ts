/**
 * Best-price sell order routing.
 *
 * Finds the cheapest sell orders that match criteria and fills
 * across multiple orders if needed.
 *
 * All quantity arithmetic is done in bigint micro-credits (1 credit =
 * 1_000_000 micro-credits) — the same scale used by the chain. parseFloat()
 * was removed from the greedy fill loop (audit C1): float subtraction
 * accumulated rounding errors across iterations, and float-multiply-before-
 * BigInt produced spurious sub-micro digits like 100000.00000000001.
 */

import { listSellOrders, listCreditClasses, listBatches, getAllowedDenoms } from "./ledger.js";
import type { SellOrder, CreditClass, AllowedDenom } from "./ledger.js";

/** Internal scale for credit quantities. The chain reports balances at this exponent. */
const QUANTITY_EXPONENT = 6;
const QUANTITY_SCALE = 10n ** BigInt(QUANTITY_EXPONENT); // 1_000_000n

/**
 * Parse a decimal credit quantity string ("10.5", "0.000001") into bigint
 * micro-credits. Throws on malformed input. Truncates at the 6th decimal
 * place — anything beyond that is sub-micro and cannot be represented.
 */
function parseQuantityToMicro(decimal: string): bigint {
  const trimmed = decimal.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid decimal quantity: ${JSON.stringify(decimal)}`);
  }
  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1) : trimmed;
  const [whole, frac = ""] = body.split(".");
  const fracPadded = (frac + "0".repeat(QUANTITY_EXPONENT)).slice(0, QUANTITY_EXPONENT);
  const micro = BigInt(whole) * QUANTITY_SCALE + BigInt(fracPadded || "0");
  return negative ? -micro : micro;
}

/**
 * Render a bigint micro-credit count back to a fixed-precision decimal string
 * (e.g. 10500000n → "10.500000"). Always shows QUANTITY_EXPONENT decimals so
 * the output round-trips through parseQuantityToMicro.
 */
function formatMicroToQuantity(micro: bigint): string {
  const negative = micro < 0n;
  const abs = negative ? -micro : micro;
  const whole = abs / QUANTITY_SCALE;
  const frac = abs % QUANTITY_SCALE;
  const fracStr = frac.toString().padStart(QUANTITY_EXPONENT, "0");
  return `${negative ? "-" : ""}${whole}.${fracStr}`;
}

/** Convert a JS number quantity (from MCP/REST callers) to bigint micro-credits. */
function numberToMicro(quantity: number): bigint {
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error(`Invalid numeric quantity: ${quantity}`);
  }
  // Single float touch: round to the nearest micro-credit. Bounded error of 0.5
  // micro is the unavoidable cost of accepting a JS `number` from the caller.
  return BigInt(Math.round(quantity * Number(QUANTITY_SCALE)));
}

/** Test-only exports — these helpers are pure and worth covering directly. */
export const __orderSelectorInternals = {
  parseQuantityToMicro,
  formatMicroToQuantity,
  numberToMicro,
  QUANTITY_SCALE,
};

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
  disableAutoRetire: boolean;
}

export async function selectBestOrders(
  creditType: string | undefined,
  quantity: number,
  preferredDenom?: string,
  creditTypeAbbrevs?: string[],
  creditClassId?: string
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

  // Filter eligible sell orders by credit type/class and expiration (allow disable_auto_retire orders — handled in retirement.ts)
  const typeFiltered = sellOrders.filter((order) => {
    const classId = order.batch_denom.split("-").slice(0, 1).join("");

    // If a specific credit class ID is requested, match exactly
    if (creditClassId) {
      if (classId !== creditClassId) return false;
    } else if (creditType || creditTypeAbbrevs) {
      const abbrev = classTypeMap.get(classId);
      if (!abbrev) return false;

      if (creditTypeAbbrevs) {
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

  // Determine payment denom: try preferred first, fall back to most common among eligible orders
  let denomInfo = pickDenom(allowedDenoms, preferredDenom);
  let eligible = typeFiltered.filter((order) => order.ask_denom === denomInfo.bankDenom);

  if (eligible.length === 0 && typeFiltered.length > 0) {
    // No orders match the preferred denom — pick the most common denom among eligible orders
    const denomCounts = new Map<string, number>();
    for (const order of typeFiltered) {
      denomCounts.set(order.ask_denom, (denomCounts.get(order.ask_denom) || 0) + 1);
    }
    let bestDenom = "";
    let bestCount = 0;
    for (const [denom, count] of denomCounts) {
      if (count > bestCount) {
        bestDenom = denom;
        bestCount = count;
      }
    }
    const fallbackDenom = allowedDenoms.find((d) => d.bank_denom === bestDenom);
    if (fallbackDenom) {
      denomInfo = {
        bankDenom: fallbackDenom.bank_denom,
        displayDenom: fallbackDenom.display_denom,
        exponent: fallbackDenom.exponent,
      };
      eligible = typeFiltered.filter((order) => order.ask_denom === denomInfo.bankDenom);
    }
  }

  // Sort by ask_amount ascending (cheapest first)
  eligible.sort((a, b) => {
    const aPrice = BigInt(a.ask_amount);
    const bPrice = BigInt(b.ask_amount);
    if (aPrice < bPrice) return -1;
    if (aPrice > bPrice) return 1;
    return 0;
  });

  // Fill from cheapest available orders. All arithmetic is bigint micro-credits.
  // Cost formula: cost_micro = ask_amount * quantity_micro / QUANTITY_SCALE
  // (ask_amount is per-credit in micro-payment-units; dividing by QUANTITY_SCALE
  // converts micro-credits → credits in the multiplication.) We round UP on the
  // division so partial sub-micro costs are charged to the buyer, not absorbed.
  const requestedMicro = numberToMicro(quantity);
  let remainingMicro = requestedMicro;
  const selected: SelectedOrder[] = [];
  let totalCostMicro = 0n;
  let insufficientSupply = false;

  for (const order of eligible) {
    if (remainingMicro <= 0n) break;

    let availableMicro: bigint;
    try {
      availableMicro = parseQuantityToMicro(order.quantity);
    } catch {
      continue; // Skip malformed quantities rather than fail the whole selection.
    }
    if (availableMicro <= 0n) continue;

    const takeMicro = remainingMicro < availableMicro ? remainingMicro : availableMicro;
    const pricePerCredit = BigInt(order.ask_amount);

    // Ceiling division: (a + b - 1) / b
    const numer = pricePerCredit * takeMicro;
    const costMicro = (numer + QUANTITY_SCALE - 1n) / QUANTITY_SCALE;

    selected.push({
      sellOrderId: order.id,
      batchDenom: order.batch_denom,
      quantity: formatMicroToQuantity(takeMicro),
      askAmount: order.ask_amount,
      askDenom: order.ask_denom,
      costMicro,
      disableAutoRetire: order.disable_auto_retire,
    });

    totalCostMicro += costMicro;
    remainingMicro -= takeMicro;
  }

  // Insufficient if more than one micro-credit short.
  if (remainingMicro > 1n) {
    insufficientSupply = true;
  }

  const actualMicro = requestedMicro - (remainingMicro > 0n ? remainingMicro : 0n);

  return {
    orders: selected,
    totalQuantity: formatMicroToQuantity(actualMicro),
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
