import { describe, it, expect, vi } from "vitest";

vi.mock("../services/ledger.js", () => ({
  listSellOrders: vi.fn(),
  listCreditClasses: vi.fn(),
  listBatches: vi.fn(),
  getAllowedDenoms: vi.fn(),
}));

import { selectBestOrders, __orderSelectorInternals } from "../services/order-selector.js";
import * as ledger from "../services/ledger.js";

const { parseQuantityToMicro, formatMicroToQuantity, numberToMicro, QUANTITY_SCALE } =
  __orderSelectorInternals;

describe("quantity micro conversion", () => {
  it("parses integer quantities", () => {
    expect(parseQuantityToMicro("0")).toBe(0n);
    expect(parseQuantityToMicro("1")).toBe(1_000_000n);
    expect(parseQuantityToMicro("1234")).toBe(1_234_000_000n);
  });

  it("parses fractional quantities exactly", () => {
    expect(parseQuantityToMicro("0.5")).toBe(500_000n);
    expect(parseQuantityToMicro("0.000001")).toBe(1n);
    expect(parseQuantityToMicro("10.500000")).toBe(10_500_000n);
    // 0.1 + 0.2 in float = 0.30000000000000004; in our parser it's exact:
    expect(parseQuantityToMicro("0.1") + parseQuantityToMicro("0.2")).toBe(parseQuantityToMicro("0.3"));
  });

  it("truncates beyond 6 decimal places (sub-micro is not representable)", () => {
    expect(parseQuantityToMicro("0.1234567")).toBe(123_456n);
    expect(parseQuantityToMicro("1.99999999")).toBe(1_999_999n);
  });

  it("rejects malformed input", () => {
    expect(() => parseQuantityToMicro("abc")).toThrow();
    expect(() => parseQuantityToMicro("1.2.3")).toThrow();
    expect(() => parseQuantityToMicro("")).toThrow();
  });

  it("formatMicroToQuantity round-trips", () => {
    for (const s of ["0.000000", "1.000000", "10.500000", "0.000001", "999.999999"]) {
      expect(formatMicroToQuantity(parseQuantityToMicro(s))).toBe(s);
    }
  });

  it("numberToMicro rounds half to nearest", () => {
    expect(numberToMicro(1)).toBe(1_000_000n);
    expect(numberToMicro(0.5)).toBe(500_000n);
    expect(numberToMicro(0.0000005)).toBe(1n); // 0.5 micro rounds up
    expect(numberToMicro(0.0000004)).toBe(0n);
  });

  it("QUANTITY_SCALE is 1_000_000n", () => {
    expect(QUANTITY_SCALE).toBe(1_000_000n);
  });
});

const allowedDenoms = [
  { bank_denom: "uregen", display_denom: "REGEN", exponent: 6 },
];
const carbonClass = { id: "C01", credit_type_abbrev: "C" };

function setup(orders: ledger.SellOrder[]) {
  vi.mocked(ledger.listSellOrders).mockResolvedValue(orders);
  vi.mocked(ledger.listCreditClasses).mockResolvedValue([carbonClass as ledger.CreditClass]);
  vi.mocked(ledger.getAllowedDenoms).mockResolvedValue(allowedDenoms as ledger.AllowedDenom[]);
}

function order(over: Partial<ledger.SellOrder> = {}): ledger.SellOrder {
  return {
    id: "1",
    seller: "regen1...",
    batch_denom: "C01-001-20240101-20241231-001",
    quantity: "100.000000",
    ask_denom: "uregen",
    ask_amount: "1000000", // 1 REGEN per credit
    disable_auto_retire: false,
    expiration: null,
    ...over,
  };
}

describe("selectBestOrders greedy fill (audit C1)", () => {
  it("fills exactly when supply matches request", async () => {
    setup([order({ quantity: "5.000000" })]);
    const sel = await selectBestOrders("carbon", 5);
    expect(sel.orders).toHaveLength(1);
    expect(sel.orders[0].quantity).toBe("5.000000");
    expect(sel.totalQuantity).toBe("5.000000");
    expect(sel.totalCostMicro).toBe(5_000_000n); // 5 credits × 1 REGEN
    expect(sel.insufficientSupply).toBe(false);
  });

  it("walks across multiple orders cheapest-first", async () => {
    setup([
      order({ id: "a", ask_amount: "2000000", quantity: "10.000000" }),
      order({ id: "b", ask_amount: "1000000", quantity: "3.000000" }),
      order({ id: "c", ask_amount: "1500000", quantity: "5.000000" }),
    ]);
    // Want 7 credits. Cheapest-first: 3 from b (@1), 5→remaining 4 from c (@1.5),
    // total_cost = 3*1 + 4*1.5 = 9 REGEN = 9_000_000 uregen.
    const sel = await selectBestOrders("carbon", 7);
    expect(sel.orders.map((o) => o.sellOrderId)).toEqual(["b", "c"]);
    expect(sel.orders[0].quantity).toBe("3.000000");
    expect(sel.orders[1].quantity).toBe("4.000000");
    expect(sel.totalQuantity).toBe("7.000000");
    expect(sel.totalCostMicro).toBe(9_000_000n);
    expect(sel.insufficientSupply).toBe(false);
  });

  it("flags insufficient supply when total available < request", async () => {
    setup([order({ quantity: "2.000000" })]);
    const sel = await selectBestOrders("carbon", 5);
    expect(sel.insufficientSupply).toBe(true);
    expect(sel.totalQuantity).toBe("2.000000");
  });

  it("skips orders with malformed quantity rather than blowing up", async () => {
    setup([
      order({ id: "good", quantity: "5.000000" }),
      order({ id: "bad", quantity: "not-a-number" }),
    ]);
    const sel = await selectBestOrders("carbon", 5);
    expect(sel.orders.map((o) => o.sellOrderId)).toEqual(["good"]);
    expect(sel.insufficientSupply).toBe(false);
  });

  it("does not accumulate float error across the greedy fill (audit C1)", async () => {
    // 10 orders of 0.1 each, request 1.0. With float arithmetic this used to
    // leave 1.0 - 10*0.1 = 0.0000000000000001 and could trigger spurious
    // insufficientSupply or off-by-one micro-cost. With bigint micro it
    // sums exactly.
    setup(
      Array.from({ length: 10 }, (_, i) =>
        order({ id: String(i), quantity: "0.100000", ask_amount: "1000000" })
      )
    );
    const sel = await selectBestOrders("carbon", 1.0);
    expect(sel.totalQuantity).toBe("1.000000");
    expect(sel.totalCostMicro).toBe(1_000_000n);
    expect(sel.insufficientSupply).toBe(false);
  });

  it("computes exact cost with fractional take and high-precision price", async () => {
    setup([order({ quantity: "10.000000", ask_amount: "1234567" })]);
    // Take 0.5 credits at 1.234567 REGEN/credit.
    // Exact micro = 1234567 * 500000 / 1000000 = 617283.5 → ceil → 617284
    const sel = await selectBestOrders("carbon", 0.5);
    expect(sel.orders[0].quantity).toBe("0.500000");
    expect(sel.orders[0].costMicro).toBe(617284n);
    expect(sel.totalCostMicro).toBe(617284n);
  });

  it("rounds cost UP so the buyer covers the sub-micro remainder", async () => {
    // Pick numbers where the exact micro division is non-integer.
    setup([order({ quantity: "10.000000", ask_amount: "3" })]);
    const sel = await selectBestOrders("carbon", 0.000001);
    // Exact = 3 * 1 / 1_000_000 = 3e-6 → ceil to 1
    expect(sel.orders[0].costMicro).toBe(1n);
  });
});
