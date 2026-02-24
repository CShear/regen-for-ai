import { randomUUID } from "node:crypto";
import { getSubscriptionTier } from "../subscription/tiers.js";
import {
  JsonFilePoolAccountingStore,
} from "./store.js";
import type {
  ContributionInput,
  ContributionReceipt,
  ContributionRecord,
  MonthlyPoolSummary,
  PoolAccountingState,
  PoolAccountingStore,
  UserContributionSummary,
} from "./types.js";

const MONTH_REGEX = /^\d{4}-\d{2}$/;

function normalize(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeEmail(email?: string): string | undefined {
  const value = normalize(email);
  return value ? value.toLowerCase() : undefined;
}

function toIsoTimestamp(value?: string): string {
  const input = normalize(value);
  if (!input) return new Date().toISOString();

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid contributedAt timestamp");
  }
  return parsed.toISOString();
}

function toMonth(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 7);
}

function resolveAmountUsdCents(input: ContributionInput): number {
  if (typeof input.amountUsdCents === "number") {
    if (!Number.isInteger(input.amountUsdCents) || input.amountUsdCents <= 0) {
      throw new Error("amountUsdCents must be a positive integer");
    }
    return input.amountUsdCents;
  }

  if (typeof input.amountUsd === "number") {
    if (!Number.isFinite(input.amountUsd) || input.amountUsd <= 0) {
      throw new Error("amountUsd must be a positive number");
    }
    return Math.round(input.amountUsd * 100);
  }

  if (input.tierId) {
    const tier = getSubscriptionTier(input.tierId);
    if (!tier) {
      throw new Error(`Unknown tier '${input.tierId}'`);
    }
    return tier.monthlyUsd * 100;
  }

  throw new Error(
    "Provide one of amountUsdCents, amountUsd, or tierId to determine contribution amount"
  );
}

function resolveUserId(input: ContributionInput): string {
  const userId = normalize(input.userId);
  if (userId) return userId;

  const customerId = normalize(input.customerId);
  if (customerId) return `customer:${customerId}`;

  const email = normalizeEmail(input.email);
  if (email) return `email:${email}`;

  throw new Error("Contribution requires at least one identifier: userId, customerId, or email");
}

function toUsd(cents: number): number {
  return cents / 100;
}

function summarizeUserRecords(
  userId: string,
  records: ContributionRecord[]
): UserContributionSummary {
  const sorted = [...records].sort((a, b) =>
    a.contributedAt.localeCompare(b.contributedAt)
  );
  const totalUsdCents = sorted.reduce((sum, record) => sum + record.amountUsdCents, 0);

  const byMonthMap = new Map<
    string,
    { month: string; contributionCount: number; totalUsdCents: number }
  >();
  for (const record of sorted) {
    const existing = byMonthMap.get(record.month) || {
      month: record.month,
      contributionCount: 0,
      totalUsdCents: 0,
    };
    existing.contributionCount += 1;
    existing.totalUsdCents += record.amountUsdCents;
    byMonthMap.set(record.month, existing);
  }

  const byMonth = [...byMonthMap.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((entry) => ({
      month: entry.month,
      contributionCount: entry.contributionCount,
      totalUsdCents: entry.totalUsdCents,
      totalUsd: toUsd(entry.totalUsdCents),
    }));

  const mostRecent = sorted[sorted.length - 1];

  return {
    userId,
    email: mostRecent?.email,
    customerId: mostRecent?.customerId,
    contributionCount: sorted.length,
    totalUsdCents,
    totalUsd: toUsd(totalUsdCents),
    lastContributionAt: mostRecent?.contributedAt,
    byMonth,
  };
}

function summarizeMonth(
  month: string,
  records: ContributionRecord[]
): MonthlyPoolSummary {
  const filtered = records.filter((record) => record.month === month);
  const contributorMap = new Map<
    string,
    {
      userId: string;
      email?: string;
      customerId?: string;
      contributionCount: number;
      totalUsdCents: number;
    }
  >();

  let totalUsdCents = 0;
  let lastContributionAt: string | undefined;
  for (const record of filtered) {
    totalUsdCents += record.amountUsdCents;
    if (
      !lastContributionAt ||
      record.contributedAt.localeCompare(lastContributionAt) > 0
    ) {
      lastContributionAt = record.contributedAt;
    }
    const existing = contributorMap.get(record.userId) || {
      userId: record.userId,
      email: record.email,
      customerId: record.customerId,
      contributionCount: 0,
      totalUsdCents: 0,
    };
    existing.contributionCount += 1;
    existing.totalUsdCents += record.amountUsdCents;
    contributorMap.set(record.userId, existing);
  }

  const contributors = [...contributorMap.values()]
    .sort((a, b) => b.totalUsdCents - a.totalUsdCents)
    .map((entry) => ({
      userId: entry.userId,
      email: entry.email,
      customerId: entry.customerId,
      contributionCount: entry.contributionCount,
      totalUsdCents: entry.totalUsdCents,
      totalUsd: toUsd(entry.totalUsdCents),
    }));

  return {
    month,
    contributionCount: filtered.length,
    uniqueContributors: contributors.length,
    totalUsdCents,
    totalUsd: toUsd(totalUsdCents),
    lastContributionAt,
    contributors,
  };
}

export class PoolAccountingService {
  constructor(
    private readonly store: PoolAccountingStore = new JsonFilePoolAccountingStore()
  ) {}

  private async mutateState<T>(
    updater: (state: PoolAccountingState) => T | Promise<T>
  ): Promise<T> {
    if (this.store.withExclusiveState) {
      return this.store.withExclusiveState(updater);
    }

    const state = await this.store.readState();
    const result = await updater(state);
    await this.store.writeState(state);
    return result;
  }

  async recordContribution(input: ContributionInput): Promise<ContributionReceipt> {
    return this.mutateState((state) => {
      const externalEventId = normalize(input.externalEventId);

      if (externalEventId) {
        const existing = state.contributions.find(
          (item) => item.externalEventId === externalEventId
        );
        if (existing) {
          const userRecords = state.contributions.filter(
            (item) => item.userId === existing.userId
          );
          return {
            record: existing,
            duplicate: true,
            userSummary: summarizeUserRecords(existing.userId, userRecords),
            monthSummary: summarizeMonth(existing.month, state.contributions),
          };
        }
      }

      const userId = resolveUserId(input);
      const contributedAt = toIsoTimestamp(input.contributedAt);
      const month = toMonth(contributedAt);
      const amountUsdCents = resolveAmountUsdCents(input);

      const record: ContributionRecord = {
        id: `contrib_${randomUUID()}`,
        userId,
        email: normalizeEmail(input.email),
        customerId: normalize(input.customerId),
        subscriptionId: normalize(input.subscriptionId),
        externalEventId,
        tierId: input.tierId,
        amountUsdCents,
        contributedAt,
        month,
        source: input.source || "subscription",
        metadata: input.metadata && Object.keys(input.metadata).length > 0
          ? input.metadata
          : undefined,
      };

      state.contributions.push(record);
      state.contributions.sort((a, b) =>
        a.contributedAt.localeCompare(b.contributedAt)
      );

      const userRecords = state.contributions.filter((item) => item.userId === userId);
      return {
        record,
        duplicate: false,
        userSummary: summarizeUserRecords(userId, userRecords),
        monthSummary: summarizeMonth(month, state.contributions),
      };
    });
  }

  async getUserSummary(
    identifier: { userId?: string; email?: string; customerId?: string }
  ): Promise<UserContributionSummary | null> {
    const state = await this.store.readState();

    let records: ContributionRecord[] = [];
    let resolvedUserId: string | undefined;

    const explicitUserId = normalize(identifier.userId);
    const customerId = normalize(identifier.customerId);
    const email = normalizeEmail(identifier.email);

    if (explicitUserId) {
      resolvedUserId = explicitUserId;
      records = state.contributions.filter((item) => item.userId === explicitUserId);
    } else if (customerId) {
      records = state.contributions.filter((item) => item.customerId === customerId);
      resolvedUserId = records[0]?.userId;
    } else if (email) {
      records = state.contributions.filter((item) => item.email === email);
      resolvedUserId = records[0]?.userId;
    } else {
      throw new Error("Provide one identifier: userId, customerId, or email");
    }

    if (!records.length || !resolvedUserId) {
      return null;
    }

    return summarizeUserRecords(resolvedUserId, records);
  }

  async getMonthlySummary(month: string): Promise<MonthlyPoolSummary> {
    if (!MONTH_REGEX.test(month)) {
      throw new Error("month must be in YYYY-MM format");
    }

    const state = await this.store.readState();
    return summarizeMonth(month, state.contributions);
  }

  async listAvailableMonths(): Promise<string[]> {
    const state = await this.store.readState();
    return [...new Set(state.contributions.map((item) => item.month))]
      .sort((a, b) => b.localeCompare(a));
  }
}
