export interface BudgetSelectedOrder {
  sellOrderId: string;
  batchDenom: string;
  quantity: string;
  askAmount: string;
  askDenom: string;
  costMicro: bigint;
}

export interface BudgetOrderSelection {
  orders: BudgetSelectedOrder[];
  totalQuantity: string;
  totalCostMicro: bigint;
  remainingBudgetMicro: bigint;
  paymentDenom: string;
  displayDenom: string;
  exponent: number;
  exhaustedBudget: boolean;
}

export interface ContributorAttribution {
  userId: string;
  email?: string;
  customerId?: string;
  sharePpm: number;
  contributionUsdCents: number;
  attributedBudgetUsdCents: number;
  attributedCostMicro: string;
  attributedQuantity: string;
  paymentDenom: string;
}

export interface ProtocolFeeBreakdown {
  protocolFeeBps: number;
  grossBudgetUsdCents: number;
  protocolFeeUsdCents: number;
  protocolFeeMicro: string;
  protocolFeeDenom: "USDC" | "uusdc";
  creditBudgetUsdCents: number;
}

export type BatchCreditMixPolicy = "off" | "balanced";

export interface CreditMixAllocation {
  creditType: "carbon" | "biodiversity";
  budgetMicro: string;
  spentMicro: string;
  selectedQuantity: string;
  orderCount: number;
}

export interface CreditMixSummary {
  policy: BatchCreditMixPolicy;
  strategy: string;
  allocations: CreditMixAllocation[];
}

export type RegenAcquisitionStatus =
  | "planned"
  | "executed"
  | "skipped"
  | "failed";

export interface RegenAcquisitionRecord {
  provider: string;
  status: RegenAcquisitionStatus;
  spendMicro: string;
  spendDenom: "USDC" | "uusdc";
  estimatedRegenMicro: string;
  acquiredRegenMicro?: string;
  txHash?: string;
  message: string;
}

export type RegenBurnStatus = "planned" | "executed" | "skipped" | "failed";

export interface RegenBurnRecord {
  provider: string;
  status: RegenBurnStatus;
  amountMicro: string;
  denom: "uregen";
  burnAddress?: string;
  txHash?: string;
  message: string;
}

export type BatchExecutionStatus =
  | "success"
  | "failed"
  | "dry_run";

export interface BatchExecutionRecord {
  id: string;
  month: string;
  creditType?: "carbon" | "biodiversity";
  dryRun: boolean;
  status: BatchExecutionStatus;
  reason: string;
  budgetUsdCents: number;
  spentMicro: string;
  spentDenom: string;
  retiredQuantity: string;
  creditMix?: CreditMixSummary;
  protocolFee?: ProtocolFeeBreakdown;
  regenAcquisition?: RegenAcquisitionRecord;
  regenBurn?: RegenBurnRecord;
  attributions?: ContributorAttribution[];
  txHash?: string;
  blockHeight?: number;
  retirementId?: string;
  error?: string;
  executedAt: string;
}

export interface BatchExecutionState {
  version: 1;
  executions: BatchExecutionRecord[];
}

export interface BatchExecutionStore {
  readState(): Promise<BatchExecutionState>;
  writeState(state: BatchExecutionState): Promise<void>;
  withExclusiveState?<T>(
    updater: (state: BatchExecutionState) => T | Promise<T>
  ): Promise<T>;
}

export interface BatchExecutionHistoryQuery {
  month?: string;
  status?: BatchExecutionStatus;
  creditType?: "carbon" | "biodiversity";
  dryRun?: boolean;
  limit?: number;
  newestFirst?: boolean;
}

export interface RunMonthlyBatchInput {
  month: string;
  creditType?: "carbon" | "biodiversity";
  paymentDenom?: "USDC" | "uusdc";
  maxBudgetUsd?: number;
  jurisdiction?: string;
  reason?: string;
  dryRun?: boolean;
  force?: boolean;
}

export interface RunMonthlyBatchResult {
  status:
    | "success"
    | "dry_run"
    | "no_contributions"
    | "no_orders"
    | "wallet_not_configured"
    | "already_executed"
    | "failed";
  month: string;
  creditType?: "carbon" | "biodiversity";
  budgetUsdCents: number;
  plannedQuantity: string;
  plannedCostMicro: bigint;
  plannedCostDenom: string;
  creditMix?: CreditMixSummary;
  protocolFee?: ProtocolFeeBreakdown;
  regenAcquisition?: RegenAcquisitionRecord;
  regenBurn?: RegenBurnRecord;
  attributions?: ContributorAttribution[];
  txHash?: string;
  blockHeight?: number;
  retirementId?: string;
  message: string;
  executionRecord?: BatchExecutionRecord;
}
