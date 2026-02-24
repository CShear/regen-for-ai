import { MonthlyBatchRetirementExecutor } from "../services/batch-retirement/executor.js";

const executor = new MonthlyBatchRetirementExecutor();

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatMicroAmount(amount: bigint, denom: string, exponent: number): string {
  const divisor = 10n ** BigInt(exponent);
  const whole = amount / divisor;
  const frac = amount % divisor;
  const fracStr = frac.toString().padStart(exponent, "0").replace(/0+$/, "");
  return fracStr ? `${whole.toString()}.${fracStr} ${denom}` : `${whole.toString()} ${denom}`;
}

function denomExponent(denom: string): number {
  return denom.toLowerCase() === "uusdc" ? 6 : 6;
}

function formatRegenMicro(value: string): string {
  const amount = BigInt(value);
  return formatMicroAmount(amount, "REGEN", 6);
}

export async function runMonthlyBatchRetirementTool(
  month: string,
  creditType?: "carbon" | "biodiversity",
  maxBudgetUsd?: number,
  dryRun?: boolean,
  force?: boolean,
  reason?: string,
  jurisdiction?: string
) {
  try {
    const result = await executor.runMonthlyBatch({
      month,
      creditType,
      maxBudgetUsd,
      dryRun,
      force,
      reason,
      jurisdiction,
      paymentDenom: "USDC",
    });

    const lines: string[] = [
      `## Monthly Batch Retirement`,
      ``,
      `| Field | Value |`,
      `|-------|-------|`,
      `| Status | ${result.status} |`,
      `| Month | ${result.month} |`,
      `| Credit Type | ${result.creditType || "all"} |`,
      `| Gross Budget | ${formatUsd(result.budgetUsdCents)} |`,
      `| Planned Quantity | ${result.plannedQuantity} |`,
      `| Planned Cost | ${formatMicroAmount(result.plannedCostMicro, result.plannedCostDenom, denomExponent(result.plannedCostDenom))} |`,
    ];

    if (result.protocolFee) {
      const pct = (result.protocolFee.protocolFeeBps / 100).toFixed(2);
      lines.splice(
        7,
        0,
        `| Protocol Fee | ${formatUsd(result.protocolFee.protocolFeeUsdCents)} (${pct}%) |`,
        `| Credit Purchase Budget | ${formatUsd(result.protocolFee.creditBudgetUsdCents)} |`
      );
    }

    if (result.creditMix) {
      lines.push(
        `| Credit Mix Policy | ${result.creditMix.policy} |`,
        `| Credit Mix Strategy | ${result.creditMix.strategy} |`
      );
    }

    if (result.regenAcquisition) {
      lines.push(
        `| REGEN Acquisition Status | ${result.regenAcquisition.status} (${result.regenAcquisition.provider}) |`,
        `| REGEN Acquisition Spend | ${formatMicroAmount(BigInt(result.regenAcquisition.spendMicro), result.regenAcquisition.spendDenom, denomExponent(result.regenAcquisition.spendDenom))} |`,
        `| Estimated REGEN | ${formatRegenMicro(result.regenAcquisition.estimatedRegenMicro)} |`
      );

      if (result.regenAcquisition.acquiredRegenMicro) {
        lines.push(
          `| Acquired REGEN | ${formatRegenMicro(result.regenAcquisition.acquiredRegenMicro)} |`
        );
      }
      if (result.regenAcquisition.txHash) {
        lines.push(
          `| REGEN Acquisition Tx | \`${result.regenAcquisition.txHash}\` |`
        );
      }
    }

    if (result.regenBurn) {
      lines.push(
        `| REGEN Burn Status | ${result.regenBurn.status} (${result.regenBurn.provider}) |`,
        `| REGEN Burn Amount | ${formatMicroAmount(BigInt(result.regenBurn.amountMicro), "REGEN", 6)} |`
      );
      if (result.regenBurn.burnAddress) {
        lines.push(`| REGEN Burn Address | \`${result.regenBurn.burnAddress}\` |`);
      }
      if (result.regenBurn.txHash) {
        lines.push(`| REGEN Burn Tx | \`${result.regenBurn.txHash}\` |`);
      }
    }

    if (result.txHash) {
      lines.push(`| Transaction Hash | \`${result.txHash}\` |`);
    }
    if (typeof result.blockHeight === "number") {
      lines.push(`| Block Height | ${result.blockHeight} |`);
    }
    if (result.retirementId) {
      lines.push(`| Retirement ID | ${result.retirementId} |`);
    }

    if (result.attributions && result.attributions.length > 0) {
      lines.push(
        "",
        "### Fractional Attribution",
        "",
        "| User ID | Share | Attributed Budget | Attributed Quantity |",
        "|---------|-------|-------------------|---------------------|",
        ...result.attributions.slice(0, 25).map((item) => {
          const share = `${(item.sharePpm / 10_000).toFixed(2)}%`;
          return `| ${item.userId} | ${share} | ${formatUsd(item.attributedBudgetUsdCents)} | ${item.attributedQuantity} |`;
        })
      );

      if (result.attributions.length > 25) {
        lines.push(
          "",
          `Showing 25 of ${result.attributions.length} attribution rows.`
        );
      }
    }

    if (result.creditMix) {
      lines.push(
        "",
        "### Credit Mix Allocation",
        "",
        "| Credit Type | Budget | Spent | Quantity | Orders |",
        "|-------------|--------|-------|----------|--------|",
        ...result.creditMix.allocations.map(
          (item) =>
            `| ${item.creditType} | ${formatMicroAmount(BigInt(item.budgetMicro), result.plannedCostDenom, denomExponent(result.plannedCostDenom))} | ${formatMicroAmount(BigInt(item.spentMicro), result.plannedCostDenom, denomExponent(result.plannedCostDenom))} | ${item.selectedQuantity} | ${item.orderCount} |`
        )
      );
    }

    lines.push("", result.message);
    if (result.regenAcquisition) {
      lines.push(`REGEN acquisition: ${result.regenAcquisition.message}`);
    }
    if (result.regenBurn) {
      lines.push(`REGEN burn: ${result.regenBurn.message}`);
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown monthly batch error";
    return {
      content: [
        {
          type: "text" as const,
          text: `Monthly batch retirement failed: ${message}`,
        },
      ],
      isError: true,
    };
  }
}
