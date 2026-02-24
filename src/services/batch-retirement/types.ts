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
  protocolFee?: ProtocolFeeBreakdown;
  regenAcquisition?: RegenAcquisitionRecord;
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
  protocolFee?: ProtocolFeeBreakdown;
  regenAcquisition?: RegenAcquisitionRecord;
  attributions?: ContributorAttribution[];
  txHash?: string;
  blockHeight?: number;
  retirementId?: string;
  message: string;
  executionRecord?: BatchExecutionRecord;
}
