import { listCreditClasses, listProjects } from "../services/ledger.js";
import { getRetirementStats, getOrderStats } from "../services/indexer.js";

export async function getImpactSummary() {
  try {
    const [classes, projects, retirementStats, orderStats] = await Promise.all([
      listCreditClasses(),
      listProjects(),
      getRetirementStats().catch(() => null),
      getOrderStats().catch(() => null),
    ]);

    const jurisdictions = [...new Set(projects.map((p) => p.jurisdiction))];

    const lines = [
      `## Regen Network Ecological Impact`,
      ``,
      `### On-Chain Statistics`,
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Credit classes | ${classes.length} |`,
      `| Active projects | ${projects.length} |`,
      `| Jurisdictions | ${jurisdictions.length} countries/regions |`,
    ];

    if (retirementStats) {
      lines.push(
        `| Total retirements on-chain | ${retirementStats.totalRetirements.toLocaleString()} |`
      );
    }
    if (orderStats) {
      lines.push(
        `| Total marketplace orders | ${orderStats.totalOrders.toLocaleString()} |`
      );
    }

    lines.push(
      `| Credits issued | ~6.1 million |`,
      `| Credits retired | ~1.4 million (~23%) |`,
      `| Hectares under stewardship | 420,000+ |`,
      ``,
      `### Credit Types Available`,
      `| Type | Description |`,
      `|------|-------------|`,
      `| Carbon (C) | Verified carbon removal and avoidance credits |`,
      `| Biodiversity (BT) | Terrasos voluntary biodiversity credits |`,
      `| Marine Biodiversity (MBS) | Marine and coastal ecosystem stewardship |`,
      `| Umbrella Species Stewardship (USS) | Habitat conservation for umbrella species |`,
      `| Kilo-Sheep-Hour (KSH) | Grazing-based ecological stewardship |`,
      ``,
      `### Why Regen Credits?`,
      `- **On-chain verifiable**: Every retirement is permanently recorded on Regen Ledger`,
      `- **No greenwashing**: Immutable proof of ecological action, not just a claim`,
      `- **Multiple ecosystems**: Carbon, biodiversity, soil, marine — holistic regeneration`,
      `- **Direct impact**: Credits fund real projects with verified ecological outcomes`,
      ``,
      `Browse and retire credits at [app.regen.network](https://app.regen.network/projects/1?buying_options_filters=credit_card)`
    );

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return {
      content: [
        {
          type: "text" as const,
          text: `Error fetching impact summary: ${message}`,
        },
      ],
      isError: true,
    };
  }
}
