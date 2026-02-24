import { randomUUID } from "node:crypto";
import { loadConfig, isWalletConfigured } from "../../config.js";
import { waitForRetirement } from "../indexer.js";
import { signAndBroadcast, initWallet } from "../wallet.js";
import { PoolAccountingService } from "../pool-accounting/service.js";
import { buildContributorAttributions } from "./attribution.js";
import { calculateProtocolFee } from "./fee.js";
import { selectOrdersForBudget } from "./planner.js";
import {
  createRegenAcquisitionProvider,
  type RegenAcquisitionProvider,
} from "../regen-acquisition/provider.js";
import {
  createRegenBurnProvider,
  type RegenBurnProvider,
} from "../regen-burn/provider.js";
import { JsonFileBatchExecutionStore } from "./store.js";
import type {
  BatchExecutionRecord,
  BatchExecutionStore,
  BudgetOrderSelection,
  RunMonthlyBatchInput,
  RunMonthlyBatchResult,
} from "./types.js";

const MONTH_REGEX = /^\d{4}-\d{2}$/;

export interface MonthlyBatchExecutorDeps {
  poolAccounting: Pick<PoolAccountingService, "getMonthlySummary">;
  executionStore: BatchExecutionStore;
  selectOrdersForBudget: typeof selectOrdersForBudget;
  isWalletConfigured: typeof isWalletConfigured;
  initWallet: typeof initWallet;
  signAndBroadcast: typeof signAndBroadcast;
  waitForRetirement: typeof waitForRetirement;
  loadConfig: typeof loadConfig;
  regenAcquisitionProvider: RegenAcquisitionProvider;
  regenBurnProvider: RegenBurnProvider;
}

function usdToCents(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("maxBudgetUsd must be a positive number");
  }
  return Math.round(value * 100);
}

function toBudgetMicro(paymentDenom: "USDC" | "uusdc", usdCents: number): bigint {
  if (paymentDenom === "USDC" || paymentDenom === "uusdc") {
    // 1 USD = 1,000,000 micro USDC = 100 cents * 10,000
    return BigInt(usdCents) * 10_000n;
  }
  throw new Error(`Unsupported payment denom for batch retirement: ${paymentDenom}`);
}

function buildExecutionRecord(
  status: "success" | "failed" | "dry_run",
  input: {
    month: string;
    creditType?: "carbon" | "biodiversity";
    reason: string;
    budgetUsdCents: number;
    selection: BudgetOrderSelection;
    protocolFee?: BatchExecutionRecord["protocolFee"];
    regenAcquisition?: BatchExecutionRecord["regenAcquisition"];
    regenBurn?: BatchExecutionRecord["regenBurn"];
    attributions?: BatchExecutionRecord["attributions"];
    txHash?: string;
    blockHeight?: number;
    retirementId?: string;
    error?: string;
    dryRun: boolean;
  }
): BatchExecutionRecord {
  return {
    id: `batch_${randomUUID()}`,
    month: input.month,
    creditType: input.creditType,
    dryRun: input.dryRun,
    status,
    reason: input.reason,
    budgetUsdCents: input.budgetUsdCents,
    spentMicro: input.selection.totalCostMicro.toString(),
    spentDenom: input.selection.paymentDenom,
    retiredQuantity: input.selection.totalQuantity,
    protocolFee: input.protocolFee,
    regenAcquisition: input.regenAcquisition,
    regenBurn: input.regenBurn,
    attributions: input.attributions,
    txHash: input.txHash,
    blockHeight: input.blockHeight,
    retirementId: input.retirementId,
    error: input.error,
    executedAt: new Date().toISOString(),
  };
}

export class MonthlyBatchRetirementExecutor {
  private readonly deps: MonthlyBatchExecutorDeps;

  constructor(deps?: Partial<MonthlyBatchExecutorDeps>) {
    const loadConfigDep = deps?.loadConfig || loadConfig;
    const configForDeps = loadConfigDep();

    this.deps = {
      poolAccounting: deps?.poolAccounting || new PoolAccountingService(),
      executionStore: deps?.executionStore || new JsonFileBatchExecutionStore(),
      selectOrdersForBudget: deps?.selectOrdersForBudget || selectOrdersForBudget,
      isWalletConfigured: deps?.isWalletConfigured || isWalletConfigured,
      initWallet: deps?.initWallet || initWallet,
      signAndBroadcast: deps?.signAndBroadcast || signAndBroadcast,
      waitForRetirement: deps?.waitForRetirement || waitForRetirement,
      loadConfig: loadConfigDep,
      regenAcquisitionProvider:
        deps?.regenAcquisitionProvider ||
        createRegenAcquisitionProvider({
          provider: configForDeps.regenAcquisitionProvider,
          simulatedRateUregenPerUsdc:
            configForDeps.regenAcquisitionRateUregenPerUsdc,
        }),
      regenBurnProvider:
        deps?.regenBurnProvider ||
        createRegenBurnProvider({
          provider: configForDeps.regenBurnProvider,
          burnAddress: configForDeps.regenBurnAddress,
        }),
    };
  }

  private async hasSuccessfulExecution(
    month: string,
    creditType?: "carbon" | "biodiversity"
  ): Promise<boolean> {
    const state = await this.deps.executionStore.readState();
    return state.executions.some(
      (item) =>
        item.status === "success" &&
        item.month === month &&
        item.creditType === creditType
    );
  }

  private async appendExecution(record: BatchExecutionRecord): Promise<void> {
    const state = await this.deps.executionStore.readState();
    state.executions.push(record);
    state.executions.sort((a, b) => a.executedAt.localeCompare(b.executedAt));
    await this.deps.executionStore.writeState(state);
  }

  async runMonthlyBatch(input: RunMonthlyBatchInput): Promise<RunMonthlyBatchResult> {
    if (!MONTH_REGEX.test(input.month)) {
      throw new Error("month must be in YYYY-MM format");
    }

    if (!input.force) {
      const alreadyExecuted = await this.hasSuccessfulExecution(
        input.month,
        input.creditType
      );
      if (alreadyExecuted) {
        return {
          status: "already_executed",
          month: input.month,
          creditType: input.creditType,
          budgetUsdCents: 0,
          plannedQuantity: "0.000000",
          plannedCostMicro: 0n,
          plannedCostDenom: input.paymentDenom || "USDC",
          message:
            "A successful monthly batch retirement already exists for this month and credit type. Use force=true to re-run.",
        };
      }
    }

    const monthlySummary = await this.deps.poolAccounting.getMonthlySummary(
      input.month
    );
    if (monthlySummary.contributionCount === 0 || monthlySummary.totalUsdCents <= 0) {
      return {
        status: "no_contributions",
        month: input.month,
        creditType: input.creditType,
        budgetUsdCents: 0,
        plannedQuantity: "0.000000",
        plannedCostMicro: 0n,
        plannedCostDenom: input.paymentDenom || "USDC",
        message: `No pool contributions found for ${input.month}.`,
      };
    }

    const totalBudgetUsdCents = input.maxBudgetUsd
      ? Math.min(monthlySummary.totalUsdCents, usdToCents(input.maxBudgetUsd))
      : monthlySummary.totalUsdCents;

    const config = this.deps.loadConfig();
    const retireReason =
      input.reason || `Monthly subscription pool retirement (${input.month})`;
    const paymentDenom = input.paymentDenom || "USDC";
    const protocolFee = calculateProtocolFee({
      grossBudgetUsdCents: totalBudgetUsdCents,
      protocolFeeBps: config.protocolFeeBps,
      paymentDenom,
    });

    const plannedRegenAcquisition =
      protocolFee.protocolFeeUsdCents > 0
        ? await this.deps.regenAcquisitionProvider.planAcquisition({
            month: input.month,
            spendMicro: BigInt(protocolFee.protocolFeeMicro),
            spendDenom: protocolFee.protocolFeeDenom,
          })
        : undefined;

    const plannedRegenBurn =
      plannedRegenAcquisition &&
      BigInt(plannedRegenAcquisition.estimatedRegenMicro) > 0n
        ? await this.deps.regenBurnProvider.planBurn({
            month: input.month,
            amountMicro: BigInt(plannedRegenAcquisition.estimatedRegenMicro),
          })
        : plannedRegenAcquisition
          ? {
              provider: this.deps.regenBurnProvider.name,
              status: "skipped" as const,
              amountMicro: "0",
              denom: "uregen" as const,
              message: `Skipped REGEN burn because acquisition is ${plannedRegenAcquisition.status}.`,
            }
          : undefined;

    const budgetMicro = toBudgetMicro(paymentDenom, protocolFee.creditBudgetUsdCents);

    if (protocolFee.creditBudgetUsdCents <= 0) {
      return {
        status: "no_orders",
        month: input.month,
        creditType: input.creditType,
        budgetUsdCents: totalBudgetUsdCents,
        plannedQuantity: "0.000000",
        plannedCostMicro: 0n,
        plannedCostDenom: paymentDenom,
        protocolFee,
        regenAcquisition: plannedRegenAcquisition,
        regenBurn: plannedRegenBurn,
        message:
          "No credit purchase budget remains after applying protocol fee to this monthly pool.",
      };
    }

    const selection = await this.deps.selectOrdersForBudget(
      input.creditType,
      budgetMicro,
      paymentDenom
    );

    if (selection.orders.length === 0) {
      return {
        status: "no_orders",
        month: input.month,
        creditType: input.creditType,
        budgetUsdCents: totalBudgetUsdCents,
        plannedQuantity: selection.totalQuantity,
        plannedCostMicro: selection.totalCostMicro,
        plannedCostDenom: selection.paymentDenom,
        protocolFee,
        regenAcquisition: plannedRegenAcquisition,
        regenBurn: plannedRegenBurn,
        message:
          "No eligible sell orders were found for the configured budget and filters.",
      };
    }

    const attributions = buildContributorAttributions({
      contributors: monthlySummary.contributors,
      totalContributionUsdCents: monthlySummary.totalUsdCents,
      appliedBudgetUsdCents: protocolFee.creditBudgetUsdCents,
      totalCostMicro: selection.totalCostMicro,
      retiredQuantity: selection.totalQuantity,
      paymentDenom: selection.paymentDenom,
    });

    const retireJurisdiction = input.jurisdiction || config.defaultJurisdiction;

    if (input.dryRun !== false) {
      const record = buildExecutionRecord("dry_run", {
        month: input.month,
        creditType: input.creditType,
        reason: retireReason,
        budgetUsdCents: totalBudgetUsdCents,
        selection,
        protocolFee,
        regenAcquisition: plannedRegenAcquisition,
        regenBurn: plannedRegenBurn,
        attributions,
        dryRun: true,
      });
      await this.appendExecution(record);
      return {
        status: "dry_run",
        month: input.month,
        creditType: input.creditType,
        budgetUsdCents: totalBudgetUsdCents,
        plannedQuantity: selection.totalQuantity,
        plannedCostMicro: selection.totalCostMicro,
        plannedCostDenom: selection.paymentDenom,
        protocolFee,
        regenAcquisition: plannedRegenAcquisition,
        regenBurn: plannedRegenBurn,
        attributions,
        message: "Dry run complete. No on-chain transaction was broadcast.",
        executionRecord: record,
      };
    }

    if (!this.deps.isWalletConfigured()) {
      return {
        status: "wallet_not_configured",
        month: input.month,
        creditType: input.creditType,
        budgetUsdCents: totalBudgetUsdCents,
        plannedQuantity: selection.totalQuantity,
        plannedCostMicro: selection.totalCostMicro,
        plannedCostDenom: selection.paymentDenom,
        protocolFee,
        regenAcquisition: plannedRegenAcquisition,
        regenBurn: plannedRegenBurn,
        attributions,
        message:
          "Wallet is not configured. Set REGEN_WALLET_MNEMONIC before executing monthly batch retirements.",
      };
    }

    try {
      const { address } = await this.deps.initWallet();
      const orders = selection.orders.map((order) => ({
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

      const txResult = await this.deps.signAndBroadcast([
        {
          typeUrl: "/regen.ecocredit.marketplace.v1.MsgBuyDirect",
          value: {
            buyer: address,
            orders,
          },
        },
      ]);

      if (txResult.code !== 0) {
        const record = buildExecutionRecord("failed", {
          month: input.month,
          creditType: input.creditType,
          reason: retireReason,
          budgetUsdCents: totalBudgetUsdCents,
          selection,
          protocolFee,
          regenAcquisition: plannedRegenAcquisition
            ? {
                ...plannedRegenAcquisition,
                status: "skipped",
                message:
                  "Skipped REGEN acquisition because the retirement transaction was rejected.",
              }
            : undefined,
          regenBurn: plannedRegenBurn
            ? {
                ...plannedRegenBurn,
                status: "skipped",
                message:
                  "Skipped REGEN burn because the retirement transaction was rejected.",
              }
            : undefined,
          attributions,
          error: `Transaction rejected (code ${txResult.code}): ${
            txResult.rawLog || "unknown error"
          }`,
          dryRun: false,
        });
        await this.appendExecution(record);

        return {
          status: "failed",
          month: input.month,
          creditType: input.creditType,
          budgetUsdCents: totalBudgetUsdCents,
          plannedQuantity: selection.totalQuantity,
          plannedCostMicro: selection.totalCostMicro,
          plannedCostDenom: selection.paymentDenom,
          protocolFee,
          regenAcquisition: record.regenAcquisition,
          regenBurn: record.regenBurn,
          attributions,
          message: record.error || "Monthly batch transaction failed.",
          executionRecord: record,
        };
      }

      const retirement = await this.deps.waitForRetirement(txResult.transactionHash);

      let regenAcquisition = plannedRegenAcquisition;
      if (plannedRegenAcquisition && plannedRegenAcquisition.status !== "skipped") {
        try {
          regenAcquisition = await this.deps.regenAcquisitionProvider.executeAcquisition(
            {
              month: input.month,
              spendMicro: BigInt(protocolFee.protocolFeeMicro),
              spendDenom: protocolFee.protocolFeeDenom,
            }
          );
        } catch (error) {
          const errMsg =
            error instanceof Error
              ? error.message
              : "Unknown REGEN acquisition error";
          regenAcquisition = {
            ...plannedRegenAcquisition,
            status: "failed",
            message: `REGEN acquisition failed: ${errMsg}`,
          };
        }
      }

      let regenBurn = plannedRegenBurn;
      if (regenAcquisition) {
        if (regenAcquisition.status === "executed") {
          const burnAmountMicro = BigInt(
            regenAcquisition.acquiredRegenMicro ||
              regenAcquisition.estimatedRegenMicro
          );
          if (burnAmountMicro > 0n) {
            try {
              regenBurn = await this.deps.regenBurnProvider.executeBurn({
                month: input.month,
                amountMicro: burnAmountMicro,
              });
            } catch (error) {
              const errMsg =
                error instanceof Error ? error.message : "Unknown REGEN burn error";
              regenBurn = {
                provider: this.deps.regenBurnProvider.name,
                status: "failed",
                amountMicro: burnAmountMicro.toString(),
                denom: "uregen",
                message: `REGEN burn failed: ${errMsg}`,
              };
            }
          } else {
            regenBurn = {
              provider: this.deps.regenBurnProvider.name,
              status: "skipped",
              amountMicro: "0",
              denom: "uregen",
              message: "Skipped REGEN burn because acquisition amount was zero.",
            };
          }
        } else {
          regenBurn = {
            provider: this.deps.regenBurnProvider.name,
            status: "skipped",
            amountMicro: "0",
            denom: "uregen",
            message: `Skipped REGEN burn because acquisition status is ${regenAcquisition.status}.`,
          };
        }
      }

      const record = buildExecutionRecord("success", {
        month: input.month,
        creditType: input.creditType,
        reason: retireReason,
        budgetUsdCents: totalBudgetUsdCents,
        selection,
        protocolFee,
        regenAcquisition,
        regenBurn,
        attributions,
        txHash: txResult.transactionHash,
        blockHeight: txResult.height,
        retirementId: retirement?.nodeId,
        dryRun: false,
      });
      await this.appendExecution(record);

      return {
        status: "success",
        month: input.month,
        creditType: input.creditType,
        budgetUsdCents: totalBudgetUsdCents,
        plannedQuantity: selection.totalQuantity,
        plannedCostMicro: selection.totalCostMicro,
        plannedCostDenom: selection.paymentDenom,
        protocolFee,
        regenAcquisition,
        regenBurn,
        attributions,
        txHash: txResult.transactionHash,
        blockHeight: txResult.height,
        retirementId: retirement?.nodeId,
        message:
          regenAcquisition?.status === "failed"
            ? "Monthly batch retirement completed, but REGEN acquisition failed."
            : regenBurn?.status === "failed"
              ? "Monthly batch retirement completed, but REGEN burn failed."
            : "Monthly batch retirement completed successfully.",
        executionRecord: record,
      };
    } catch (error) {
      const errMsg =
        error instanceof Error ? error.message : "Unknown batch execution error";
      const record = buildExecutionRecord("failed", {
        month: input.month,
        creditType: input.creditType,
        reason: retireReason,
        budgetUsdCents: totalBudgetUsdCents,
        selection,
        protocolFee,
        regenAcquisition: plannedRegenAcquisition
          ? {
              ...plannedRegenAcquisition,
              status: "skipped",
              message:
                "Skipped REGEN acquisition because monthly retirement execution failed.",
            }
          : undefined,
        regenBurn: plannedRegenBurn
          ? {
              ...plannedRegenBurn,
              status: "skipped",
              message:
                "Skipped REGEN burn because monthly retirement execution failed.",
            }
          : undefined,
        attributions,
        error: errMsg,
        dryRun: false,
      });
      await this.appendExecution(record);

      return {
        status: "failed",
        month: input.month,
        creditType: input.creditType,
        budgetUsdCents: totalBudgetUsdCents,
        plannedQuantity: selection.totalQuantity,
        plannedCostMicro: selection.totalCostMicro,
        plannedCostDenom: selection.paymentDenom,
        protocolFee,
        regenAcquisition: record.regenAcquisition,
        regenBurn: record.regenBurn,
        attributions,
        message: errMsg,
        executionRecord: record,
      };
    }
  }
}
