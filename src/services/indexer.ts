/**
 * Regen Indexer GraphQL client
 *
 * Queries retirement certificates, marketplace orders, and aggregate statistics
 * from the Regen Network indexer at api.regen.network/indexer/v1/graphql.
 *
 * Schema discovered via introspection on 2026-02-18.
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

// --- Retirement types and queries ---

export interface Retirement {
  nodeId: string;
  type: string;
  amount: string;
  batchDenom: string;
  jurisdiction: string;
  owner: string;
  reason: string;
  timestamp: string | null;
  txHash: string;
  blockHeight: string;
  chainNum: number;
}

export async function getRetirementById(
  id: string
): Promise<Retirement | null> {
  // If it looks like a base64 nodeId, look up directly
  if (id.startsWith("Wy")) {
    try {
      const query = `
        query GetRetirementByNodeId($id: ID!) {
          retirement(nodeId: $id) {
            nodeId type amount batchDenom jurisdiction
            owner reason timestamp txHash blockHeight chainNum
          }
        }
      `;
      const data = await queryGraphQL<{ retirement: Retirement | null }>(
        query,
        { id }
      );
      return data.retirement;
    } catch {
      return null;
    }
  }

  // Otherwise treat as tx hash — query allRetirements with condition
  try {
    const query = `
      query GetRetirementByTxHash($hash: String!) {
        allRetirements(condition: { txHash: $hash }, first: 1) {
          nodes {
            nodeId type amount batchDenom jurisdiction
            owner reason timestamp txHash blockHeight chainNum
          }
        }
      }
    `;
    const data = await queryGraphQL<{
      allRetirements: { nodes: Retirement[] };
    }>(query, { hash: id.toLowerCase() });
    return data.allRetirements.nodes[0] ?? null;
  } catch {
    return null;
  }
}

export async function getRecentRetirements(
  count: number = 5
): Promise<Retirement[]> {
  const query = `
    query RecentRetirements($count: Int!) {
      allRetirements(first: $count, orderBy: BLOCK_HEIGHT_DESC) {
        nodes {
          nodeId
          type
          amount
          batchDenom
          jurisdiction
          owner
          reason
          timestamp
          txHash
          blockHeight
          chainNum
        }
      }
    }
  `;

  const data = await queryGraphQL<{
    allRetirements: { nodes: Retirement[] };
  }>(query, { count });
  return data.allRetirements.nodes;
}

export interface RetirementStats {
  totalRetirements: number;
}

export async function getRetirementStats(): Promise<RetirementStats> {
  const query = `
    query RetirementStats {
      allRetirements(first: 0) {
        totalCount
      }
    }
  `;

  const data = await queryGraphQL<{
    allRetirements: { totalCount: number };
  }>(query);

  return {
    totalRetirements: data.allRetirements.totalCount,
  };
}

// --- Order (marketplace purchase) types and queries ---

export interface MarketplaceOrder {
  nodeId: string;
  type: string;
  creditsAmount: string;
  projectId: string;
  buyerAddress: string;
  totalPrice: string;
  askDenom: string;
  retiredCredits: boolean;
  retirementReason: string | null;
  retirementJurisdiction: string | null;
  txHash: string;
  timestamp: string | null;
  blockHeight: string;
}

export async function getRecentOrders(
  count: number = 10
): Promise<MarketplaceOrder[]> {
  const query = `
    query RecentOrders($count: Int!) {
      allOrders(first: $count, orderBy: BLOCK_HEIGHT_DESC) {
        nodes {
          nodeId
          type
          creditsAmount
          projectId
          buyerAddress
          totalPrice
          askDenom
          retiredCredits
          retirementReason
          retirementJurisdiction
          txHash
          timestamp
          blockHeight
        }
      }
    }
  `;

  const data = await queryGraphQL<{
    allOrders: { nodes: MarketplaceOrder[] };
  }>(query, { count });
  return data.allOrders.nodes;
}

/**
 * Poll the indexer until the retirement from a given tx hash is indexed.
 * Returns the retirement record or null if it doesn't appear within the timeout.
 */
export async function waitForRetirement(
  txHash: string,
  maxAttempts: number = 10,
  intervalMs: number = 3000
): Promise<Retirement | null> {
  for (let i = 0; i < maxAttempts; i++) {
    const retirement = await getRetirementById(txHash);
    if (retirement) return retirement;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

export interface NetworkStats {
  totalRetirements: number;
  totalOrders: number;
}

export async function getNetworkStats(): Promise<NetworkStats> {
  const [retirements, orders] = await Promise.all([
    getRetirementStats(),
    getOrderStats(),
  ]);
  return {
    totalRetirements: retirements.totalRetirements,
    totalOrders: orders.totalOrders,
  };
}

export async function getOrderStats(): Promise<{ totalOrders: number }> {
  const query = `
    query OrderStats {
      allOrders(first: 0) {
        totalCount
      }
    }
  `;

  const data = await queryGraphQL<{
    allOrders: { totalCount: number };
  }>(query);

  return { totalOrders: data.allOrders.totalCount };
}
