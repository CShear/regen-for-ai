import type {
  BatchCreditMixPolicy,
  BudgetOrderSelection,
  CreditMixSummary,
} from "./types.js";

function parseQuantityToMicro(quantity: string): bigint {
  const [wholePart, fracPart = ""] = quantity.split(".");
  const whole = BigInt(wholePart || "0");
  const frac = BigInt(fracPart.padEnd(6, "0").slice(0, 6) || "0");
  return whole * 1_000_000n + frac;
}

function emptySelection(paymentDenom: string): BudgetOrderSelection {
  return {
    orders: [],
    totalQuantity: "0.000000",
    totalCostMicro: 0n,
    remainingBudgetMicro: 0n,
    paymentDenom,
    displayDenom: paymentDenom.toUpperCase() === "USDC" ? "USDC" : paymentDenom,
    exponent: 6,
    exhaustedBudget: false,
  };
}

function mergeSelections(
  first: BudgetOrderSelection,
  second: BudgetOrderSelection
): BudgetOrderSelection {
  const totalQuantityMicro =
    parseQuantityToMicro(first.totalQuantity) + parseQuantityToMicro(second.totalQuantity);

  const whole = totalQuantityMicro / 1_000_000n;
  const frac = (totalQuantityMicro % 1_000_000n).toString().padStart(6, "0");

  return {
    orders: [...first.orders, ...second.orders],
    totalQuantity: `${whole.toString()}.${frac}`,
    totalCostMicro: first.totalCostMicro + second.totalCostMicro,
    remainingBudgetMicro: first.remainingBudgetMicro + second.remainingBudgetMicro,
    paymentDenom: first.paymentDenom || second.paymentDenom,
    displayDenom: first.displayDenom || second.displayDenom,
    exponent: first.exponent || second.exponent,
    exhaustedBudget: first.exhaustedBudget && second.exhaustedBudget,
  };
}

function avgMicroPerCredit(selection: BudgetOrderSelection): number | null {
  const quantityMicro = parseQuantityToMicro(selection.totalQuantity);
  if (quantityMicro <= 0n || selection.totalCostMicro <= 0n) return null;
  const microPerCredit =
    (Number(selection.totalCostMicro) * 1_000_000) / Number(quantityMicro);
  return Number.isFinite(microPerCredit) ? microPerCredit : null;
}

interface SelectOrdersWithPolicyInput {
  explicitCreditType?: "carbon" | "biodiversity";
  policy: BatchCreditMixPolicy;
  budgetMicro: bigint;
  paymentDenom: "USDC" | "uusdc";
  selectOrdersForBudget: (
    creditType: "carbon" | "biodiversity" | undefined,
    budgetMicro: bigint,
    preferredDenom?: string
  ) => Promise<BudgetOrderSelection>;
}

export async function selectOrdersWithPolicy(
  input: SelectOrdersWithPolicyInput
): Promise<{ selection: BudgetOrderSelection; creditMix?: CreditMixSummary }> {
  const { explicitCreditType, policy, budgetMicro, paymentDenom, selectOrdersForBudget } =
    input;

  if (explicitCreditType || policy === "off") {
    const selection = await selectOrdersForBudget(
      explicitCreditType,
      budgetMicro,
      paymentDenom
    );
    return { selection };
  }

  const [carbonProbe, biodiversityProbe] = await Promise.all([
    selectOrdersForBudget("carbon", budgetMicro, paymentDenom),
    selectOrdersForBudget("biodiversity", budgetMicro, paymentDenom),
  ]);

  const carbonAvailable = carbonProbe.orders.length > 0;
  const biodiversityAvailable = biodiversityProbe.orders.length > 0;

  let carbonShareBps = 5000;
  let strategy = "Balanced 50/50 split";

  if (!carbonAvailable && biodiversityAvailable) {
    carbonShareBps = 0;
    strategy = "100% biodiversity (carbon unavailable)";
  } else if (carbonAvailable && !biodiversityAvailable) {
    carbonShareBps = 10_000;
    strategy = "100% carbon (biodiversity unavailable)";
  } else if (!carbonAvailable && !biodiversityAvailable) {
    strategy = "No eligible carbon or biodiversity orders";
  } else {
    const carbonAvg = avgMicroPerCredit(carbonProbe);
    const biodiversityAvg = avgMicroPerCredit(biodiversityProbe);
    if (carbonAvg !== null && biodiversityAvg !== null) {
      if (carbonAvg < biodiversityAvg) {
        carbonShareBps = 7000;
        strategy = "70/30 toward carbon (cheaper average price)";
      } else if (biodiversityAvg < carbonAvg) {
        carbonShareBps = 3000;
        strategy = "70/30 toward biodiversity (cheaper average price)";
      }
    }
  }

  const carbonBudget = (budgetMicro * BigInt(carbonShareBps)) / 10_000n;
  const biodiversityBudget = budgetMicro - carbonBudget;

  const [carbonSelection, biodiversitySelection] = await Promise.all([
    carbonBudget > 0n
      ? selectOrdersForBudget("carbon", carbonBudget, paymentDenom)
      : Promise.resolve(emptySelection(paymentDenom)),
    biodiversityBudget > 0n
      ? selectOrdersForBudget("biodiversity", biodiversityBudget, paymentDenom)
      : Promise.resolve(emptySelection(paymentDenom)),
  ]);

  const selection = mergeSelections(carbonSelection, biodiversitySelection);
  const creditMix: CreditMixSummary = {
    policy,
    strategy,
    allocations: [
      {
        creditType: "carbon",
        budgetMicro: carbonBudget.toString(),
        spentMicro: carbonSelection.totalCostMicro.toString(),
        selectedQuantity: carbonSelection.totalQuantity,
        orderCount: carbonSelection.orders.length,
      },
      {
        creditType: "biodiversity",
        budgetMicro: biodiversityBudget.toString(),
        spentMicro: biodiversitySelection.totalCostMicro.toString(),
        selectedQuantity: biodiversitySelection.totalQuantity,
        orderCount: biodiversitySelection.orders.length,
      },
    ],
  };

  return { selection, creditMix };
}
