import { describe, expect, it, vi } from "vitest";
import {
  selectOrdersWithPolicy,
} from "../src/services/batch-retirement/policy.js";
import type { BudgetOrderSelection } from "../src/services/batch-retirement/types.js";

function selection(
  input: Partial<BudgetOrderSelection> & { totalCostMicro: bigint; totalQuantity: string }
): BudgetOrderSelection {
  return {
    orders:
      input.orders ??
      [
        {
          sellOrderId: "1",
          batchDenom: "C01-001-2026",
          quantity: input.totalQuantity,
          askAmount: "1000000",
          askDenom: "uusdc",
          costMicro: input.totalCostMicro,
        },
      ],
    totalQuantity: input.totalQuantity,
    totalCostMicro: input.totalCostMicro,
    remainingBudgetMicro: input.remainingBudgetMicro ?? 0n,
    paymentDenom: input.paymentDenom ?? "uusdc",
    displayDenom: input.displayDenom ?? "USDC",
    exponent: input.exponent ?? 6,
    exhaustedBudget: input.exhaustedBudget ?? false,
  };
}

describe("selectOrdersWithPolicy", () => {
  it("delegates to direct selection when policy is off", async () => {
    const selectOrdersForBudget = vi
      .fn()
      .mockResolvedValue(selection({ totalCostMicro: 2_000_000n, totalQuantity: "1.000000" }));

    const result = await selectOrdersWithPolicy({
      explicitCreditType: undefined,
      policy: "off",
      budgetMicro: 2_000_000n,
      paymentDenom: "USDC",
      selectOrdersForBudget,
    });

    expect(result.creditMix).toBeUndefined();
    expect(selectOrdersForBudget).toHaveBeenCalledTimes(1);
    expect(selectOrdersForBudget).toHaveBeenCalledWith(undefined, 2_000_000n, "USDC");
  });

  it("uses a 70/30 split toward cheaper type under balanced policy", async () => {
    const selectOrdersForBudget = vi.fn(
      async (creditType: "carbon" | "biodiversity" | undefined, budget: bigint) => {
        if (creditType === "carbon" && budget === 10_000_000n) {
          return selection({ totalCostMicro: 10_000_000n, totalQuantity: "5.000000" });
        }
        if (creditType === "biodiversity" && budget === 10_000_000n) {
          return selection({
            totalCostMicro: 10_000_000n,
            totalQuantity: "3.333333",
            orders: [
              {
                sellOrderId: "2",
                batchDenom: "BT01-001-2026",
                quantity: "3.333333",
                askAmount: "3000000",
                askDenom: "uusdc",
                costMicro: 10_000_000n,
              },
            ],
          });
        }
        if (creditType === "carbon" && budget === 7_000_000n) {
          return selection({ totalCostMicro: 6_900_000n, totalQuantity: "3.450000" });
        }
        if (creditType === "biodiversity" && budget === 3_000_000n) {
          return selection({
            totalCostMicro: 2_700_000n,
            totalQuantity: "0.900000",
            orders: [
              {
                sellOrderId: "3",
                batchDenom: "BT01-001-2026",
                quantity: "0.900000",
                askAmount: "3000000",
                askDenom: "uusdc",
                costMicro: 2_700_000n,
              },
            ],
          });
        }
        return selection({ totalCostMicro: 0n, totalQuantity: "0.000000", orders: [] });
      }
    );

    const result = await selectOrdersWithPolicy({
      policy: "balanced",
      budgetMicro: 10_000_000n,
      paymentDenom: "USDC",
      selectOrdersForBudget,
    });

    expect(result.creditMix?.policy).toBe("balanced");
    expect(result.creditMix?.strategy).toContain("carbon");
    expect(result.creditMix?.allocations[0]?.budgetMicro).toBe("7000000");
    expect(result.creditMix?.allocations[1]?.budgetMicro).toBe("3000000");
    expect(result.selection.orders).toHaveLength(2);
    expect(result.selection.totalCostMicro).toBe(9_600_000n);
  });

  it("routes 100% to available type when the other has no inventory", async () => {
    const selectOrdersForBudget = vi.fn(
      async (creditType: "carbon" | "biodiversity" | undefined, budget: bigint) => {
        if (creditType === "carbon") {
          return selection({ totalCostMicro: 0n, totalQuantity: "0.000000", orders: [] });
        }
        if (creditType === "biodiversity" && budget === 8_000_000n) {
          return selection({
            totalCostMicro: 7_500_000n,
            totalQuantity: "2.500000",
            orders: [
              {
                sellOrderId: "9",
                batchDenom: "BT01-001-2026",
                quantity: "2.500000",
                askAmount: "3000000",
                askDenom: "uusdc",
                costMicro: 7_500_000n,
              },
            ],
          });
        }
        return selection({ totalCostMicro: 0n, totalQuantity: "0.000000", orders: [] });
      }
    );

    const result = await selectOrdersWithPolicy({
      policy: "balanced",
      budgetMicro: 8_000_000n,
      paymentDenom: "USDC",
      selectOrdersForBudget,
    });

    expect(result.creditMix?.strategy).toContain("biodiversity");
    expect(result.creditMix?.allocations[0]?.budgetMicro).toBe("0");
    expect(result.creditMix?.allocations[1]?.budgetMicro).toBe("8000000");
    expect(result.selection.orders).toHaveLength(1);
  });
});
