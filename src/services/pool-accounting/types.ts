import type { SubscriptionTierId } from "../subscription/types.js";

export type ContributionSource =
  | "subscription"
  | "manual"
  | "adjustment";

export interface ContributionInput {
  userId?: string;
  email?: string;
  customerId?: string;
  subscriptionId?: string;
  externalEventId?: string;
  tierId?: SubscriptionTierId;
  amountUsd?: number;
  amountUsdCents?: number;
  contributedAt?: string;
  source?: ContributionSource;
  metadata?: Record<string, string>;
}

export interface ContributionRecord {
  id: string;
  userId: string;
  email?: string;
  customerId?: string;
  subscriptionId?: string;
  externalEventId?: string;
  tierId?: SubscriptionTierId;
  amountUsdCents: number;
  contributedAt: string;
  month: string;
  source: ContributionSource;
  metadata?: Record<string, string>;
}

export interface UserMonthlyContribution {
  month: string;
  contributionCount: number;
  totalUsdCents: number;
  totalUsd: number;
}

export interface UserContributionSummary {
  userId: string;
  email?: string;
  customerId?: string;
  contributionCount: number;
  totalUsdCents: number;
  totalUsd: number;
  lastContributionAt?: string;
  byMonth: UserMonthlyContribution[];
}

export interface MonthlyContributorAggregate {
  userId: string;
  email?: string;
  customerId?: string;
  contributionCount: number;
  totalUsdCents: number;
  totalUsd: number;
}

export interface MonthlyPoolSummary {
  month: string;
  contributionCount: number;
  uniqueContributors: number;
  totalUsdCents: number;
  totalUsd: number;
  lastContributionAt?: string;
  contributors: MonthlyContributorAggregate[];
}

export interface PoolAccountingState {
  version: 1;
  contributions: ContributionRecord[];
}

export interface PoolAccountingStore {
  readState(): Promise<PoolAccountingState>;
  writeState(state: PoolAccountingState): Promise<void>;
  withExclusiveState?<T>(
    updater: (state: PoolAccountingState) => T | Promise<T>
  ): Promise<T>;
}

export interface ContributionReceipt {
  record: ContributionRecord;
  duplicate: boolean;
  userSummary: UserContributionSummary;
  monthSummary: MonthlyPoolSummary;
}
