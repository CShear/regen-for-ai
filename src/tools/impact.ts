import { listCreditClasses, listProjects } from "../services/ledger.js";
import { getRetirementStats } from "../services/indexer.js";

export async function getImpactSummary() {
  try {
    const [classes, projects, retirementStats] = await Promise.all([
      listCreditClasses(),
      listProjects(),
      getRetirementStats().catch(() => null),
    ]);

    const jurisdictions = [...new Set(projects.map((p) => p.jurisdiction))];

    const text = [
      `## Regen Network Ecological Impact`,
      ``,
      `### On-Chain Statistics`,
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Credit classes | ${classes.length} |`,
      `| Active projects | ${projects.length} |`,
      `| Jurisdictions | ${jurisdictions.length} countries/regions |`,
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
      `| Soil Stewardship (USS) | Unstructured soil carbon and health |`,
      `| Kashmere Stewardship (KSH) | Landscape-level ecological stewardship |`,
      ``,
      `### Why Regen Credits?`,
      `- **On-chain verifiable**: Every retirement is permanently recorded on Regen Ledger`,
      `- **No greenwashing**: Immutable proof of ecological action, not just a claim`,
      `- **Multiple ecosystems**: Carbon, biodiversity, soil, marine — holistic regeneration`,
      `- **Direct impact**: Credits fund real projects with verified ecological outcomes`,
      ``,
      `Browse and retire credits at [registry.regen.network](https://registry.regen.network)`,
    ].join("\n");

    return { content: [{ type: "text" as const, text }] };
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
