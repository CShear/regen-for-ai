import { getRetirement } from "../services/indexer.js";

export async function getRetirementCertificate(retirementId: string) {
  try {
    const retirement = await getRetirement(retirementId);

    if (!retirement) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No retirement certificate found for ID: ${retirementId}\n\nRetirement IDs can be found on the Regen Network block explorer or from previous retirement transactions.`,
          },
        ],
      };
    }

    const text = [
      `## Retirement Certificate`,
      ``,
      `| Field | Value |`,
      `|-------|-------|`,
      `| Certificate ID | ${retirement.nodeId} |`,
      `| Credits Retired | ${retirement.amount} |`,
      `| Credit Batch | ${retirement.batchDenom} |`,
      `| Beneficiary | ${retirement.owner} |`,
      `| Jurisdiction | ${retirement.jurisdiction} |`,
      `| Reason | ${retirement.reason || "Ecological regeneration"} |`,
      `| Timestamp | ${retirement.timestamp} |`,
      `| Transaction Hash | ${retirement.txHash} |`,
      ``,
      `**On-chain verification**: This retirement is permanently recorded on Regen Ledger and cannot be altered or reversed.`,
    ].join("\n");

    return { content: [{ type: "text" as const, text }] };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return {
      content: [
        {
          type: "text" as const,
          text: `Error retrieving certificate: ${message}`,
        },
      ],
      isError: true,
    };
  }
}
