/**
 * Regen Indexer GraphQL client
 *
 * Queries retirement certificates and aggregate statistics
 * from the Regen Network indexer.
 */

const REGEN_INDEXER_URL =
  process.env.REGEN_INDEXER_URL ||
  "https://api.regen.network/indexer/v1/graphql";

interface GraphQLResponse<T> {
  data: T;
  errors?: Array<{ message: string }>;
}

async function queryGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const response = await fetch(REGEN_INDEXER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(
      `Indexer GraphQL error: ${response.status} ${response.statusText}`
    );
  }

  const result = (await response.json()) as GraphQLResponse<T>;
  if (result.errors?.length) {
    throw new Error(
      `GraphQL error: ${result.errors.map((e) => e.message).join(", ")}`
    );
  }

  return result.data;
}

export interface RetirementCertificate {
  nodeId: string;
  owner: string;
  amount: string;
  batchDenom: string;
  jurisdiction: string;
  reason: string;
  timestamp: string;
  txHash: string;
}

export async function getRetirement(
  retirementId: string
): Promise<RetirementCertificate | null> {
  // TODO: Refine query based on actual indexer schema
  const query = `
    query GetRetirement($id: String!) {
      retirementByNodeId(nodeId: $id) {
        nodeId
        owner
        amount
        batchDenom
        jurisdiction
        reason
        timestamp
        txHash
      }
    }
  `;

  const data = await queryGraphQL<{
    retirementByNodeId: RetirementCertificate | null;
  }>(query, { id: retirementId });
  return data.retirementByNodeId;
}

export interface RetirementStats {
  totalRetired: string;
  totalRetirements: number;
}

export async function getRetirementStats(): Promise<RetirementStats> {
  // TODO: Refine query based on actual indexer schema
  const query = `
    query RetirementStats {
      retirements {
        totalCount
      }
    }
  `;

  const data = await queryGraphQL<{
    retirements: { totalCount: number };
  }>(query);

  return {
    totalRetired: "1400000", // TODO: compute from actual aggregation
    totalRetirements: data.retirements.totalCount,
  };
}
