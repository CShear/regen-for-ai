import {
  listCreditClasses,
  listSellOrders,
  listProjects,
} from "../services/ledger.js";

// Map credit type abbreviations to human-readable names
const CREDIT_TYPE_NAMES: Record<string, string> = {
  C: "Carbon",
  BT: "Biodiversity (Terrasos)",
  KSH: "Kashmere Stewardship",
  MBS: "Marine Biodiversity Stewardship",
  USS: "Unstructured Soil Stewardship",
};

export async function browseAvailableCredits(
  creditType: string,
  maxResults: number
) {
  try {
    const [classes, sellOrders, projects] = await Promise.all([
      listCreditClasses(),
      listSellOrders().catch(() => []), // Gracefully handle if marketplace API is down
      listProjects(),
    ]);

    // Filter classes by credit type if specified
    const filteredClasses =
      creditType === "all"
        ? classes
        : classes.filter((c) => {
            if (creditType === "carbon") return c.credit_type_abbrev === "C";
            if (creditType === "biodiversity")
              return ["BT", "MBS", "KSH", "USS"].includes(
                c.credit_type_abbrev
              );
            return true;
          });

    // Build project lookup
    const projectsByClass = new Map<string, typeof projects>();
    for (const project of projects) {
      const existing = projectsByClass.get(project.class_id) || [];
      existing.push(project);
      projectsByClass.set(project.class_id, existing);
    }

    const lines: string[] = [
      `## Available Ecocredits on Regen Network`,
      ``,
      `Regen Marketplace currently offers credits across ${filteredClasses.length} credit classes.`,
      `Purchase with credit card at [registry.regen.network](https://registry.regen.network) — no crypto wallet needed.`,
      ``,
    ];

    // Current marketplace snapshot
    lines.push(`### Marketplace Snapshot`);
    lines.push(`| Credit Type | Approx. Available | Approx. Price |`);
    lines.push(`|-------------|-------------------|---------------|`);
    lines.push(`| Carbon credits | ~2,000 | ~$40/credit |`);
    lines.push(`| Biodiversity credits | ~80,000 | ~$26/credit |`);
    lines.push(``);

    // List credit classes with project counts
    lines.push(`### Credit Classes`);
    for (const cls of filteredClasses.slice(0, maxResults)) {
      const typeName =
        CREDIT_TYPE_NAMES[cls.credit_type_abbrev] || cls.credit_type_abbrev;
      const classProjects = projectsByClass.get(cls.id) || [];
      const jurisdictions = [
        ...new Set(classProjects.map((p) => p.jurisdiction)),
      ];

      lines.push(`**${cls.id}** — ${typeName}`);
      lines.push(
        `  - ${classProjects.length} project(s) in ${jurisdictions.join(", ") || "N/A"}`
      );
      lines.push(``);
    }

    if (sellOrders.length > 0) {
      lines.push(`### Active Sell Orders`);
      for (const order of sellOrders.slice(0, maxResults)) {
        lines.push(
          `- **${order.batch_denom}**: ${order.quantity} credits at ${order.ask_amount} ${order.ask_denom}`
        );
      }
    } else {
      lines.push(
        `*Sell order data is available on the marketplace web app at [registry.regen.network](https://registry.regen.network).*`
      );
    }

    lines.push(``);
    lines.push(
      `Use the \`retire_credits\` tool to generate a purchase link for any credit class.`
    );

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return {
      content: [
        {
          type: "text" as const,
          text: `Error fetching credits: ${message}\n\nYou can browse credits directly at https://registry.regen.network`,
        },
      ],
      isError: true,
    };
  }
}
