/**
 * MCP tool: get_retirement_reason
 *
 * Documents the retirement reason format from services/retirement-reason.ts.
 * Shows developers exactly what gets written on-chain for any retirement.
 */

import { buildRetirementReason } from "../services/retirement-reason.js";

export async function getRetirementReasonTool(
  source?: "mcp_tool" | "subscription",
  note?: string,
  subscriberId?: number,
  period?: string,
): Promise<{
  content: Array<{ type: "text"; text: string }>;
}> {
  try {
    // Build example reasons for each source type
    const mcpExample = buildRetirementReason({ source: "mcp_tool" });
    const subExample = buildRetirementReason({
      displayName: "Jane Example",
      period: period || new Date().toISOString().slice(0, 7),
      source: "subscription",
    });

    // Build a custom one if source or note was specified
    let customExample: string | null = null;
    if (source || note) {
      customExample = buildRetirementReason({ note, period, source });
    }

    const lines: string[] = [
      `## Retirement Reason Format`,
      ``,
      `Every credit retirement on Regen Network includes a \`reason\` field written on-chain.`,
      `The reason is a plain-language, buyer-facing sentence — it appears verbatim on`,
      `Regen Marketplace retirement certificates ("Reason" / "Motivo de la retirada"),`,
      `localized to the subscriber's language and stamped with the billing period.`,
      ``,
      `### Structure`,
      ``,
      `\`<contribution sentence> via <tool brand> (<YYYY-MM period, subscriptions only>)\``,
      ``,
      `| Component | Description |`,
      `|-----------|-------------|`,
      `| contribution sentence | "Regenerative contribution" (direct) or "Monthly ecological contribution [by <name>]" (subscription), localized |`,
      `| tool brand | The retiring platform (e.g. \`Regen Compute\`) — machine-greppable attribution |`,
      `| period | Billing period \`YYYY-MM\` for subscription retirements |`,
      ``,
      `### Example: MCP Tool Retirement`,
      ``,
      "```",
      mcpExample,
      "```",
      ``,
      `### Example: Subscription Retirement`,
      ``,
      "```",
      subExample,
      "```",
    ];

    if (customExample) {
      lines.push(
        ``,
        `### Your Custom Reason`,
        ``,
        "```",
        customExample,
        "```",
      );
    }

    lines.push(
      ``,
      `### How It Works`,
      ``,
      `1. The \`reason\` string is passed to \`MsgRetire\` or \`MsgSend\` (retiredAmount) on Regen Ledger`,
      `2. It is stored permanently on-chain in the retirement record`,
      `3. Certificates on Regen Marketplace and this platform display it verbatim`,
      `4. Indexers can attribute retirements by matching the tool brand in the sentence`,
      ``,
      `Note: retirements made before September 2026 carried JSON-LD metadata in this field`,
      `(methodology Luccioni et al. 2023 + IEA 2024, 10x uncertainty range). Those legacy`,
      `reasons are cleaned for display on this platform's certificate pages, but remain`,
      `immutable on-chain and on Regen Marketplace certificates.`,
    );

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      content: [{ type: "text" as const, text: `Error building retirement reason: ${message}` }],
    };
  }
}
