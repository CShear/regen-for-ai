import {
  listCreditClasses,
  listSellOrders,
  listProjects,
} from "../services/ledger.js";
import { getRecentOrders } from "../services/indexer.js";

// Map credit type abbreviations to human-readable names
const CREDIT_TYPE_NAMES: Record<string, string> = {
  C: "Carbon",
  BT: "Biodiversity (Terrasos)",
  KSH: "Kilo-Sheep-Hour",
  MBS: "Marine Biodiversity Stewardship",
  USS: "Umbrella Species Stewardship",
};

export async function browseAvailableCredits(
  creditType: string,
  maxResults: number
) {
  try {
    const [classes, sellOrders, projects, recentOrders] = await Promise.all([
      listCreditClasses(),
      listSellOrders().catch(() => []),
      listProjects(),
      getRecentOrders(5).catch(() => []),
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

    // Aggregate sell order data by credit type
    const classLookup = new Map(classes.map((c) => [c.id, c]));
    const sellOrdersByType = new Map<string, { quantity: number; count: number }>();
    for (const order of sellOrders) {
      // batch_denom format: C01-001-... → class is the prefix before first dash-digit
      const classId = order.batch_denom.replace(/-\d.*$/, "");
      const cls = classLookup.get(classId);
      const typeAbbrev = cls?.credit_type_abbrev || "Other";
      const existing = sellOrdersByType.get(typeAbbrev) || { quantity: 0, count: 0 };
      existing.quantity += parseFloat(order.quantity) || 0;
      existing.count += 1;
      sellOrdersByType.set(typeAbbrev, existing);
    }

    const lines: string[] = [
      `## Available Ecocredits on Regen Network`,
      ``,
      `Regen Marketplace currently offers credits across ${filteredClasses.length} credit classes.`,
      `Purchase with credit card at [app.regen.network](https://app.regen.network/projects/1?buying_options_filters=credit_card) — no crypto wallet needed.`,
      ``,
    ];

    // Live marketplace snapshot from sell orders
    if (sellOrdersByType.size > 0) {
      lines.push(`### Marketplace Snapshot (Live)`);
      lines.push(`| Credit Type | Available Credits | Sell Orders |`);
      lines.push(`|-------------|-------------------|-------------|`);
      for (const [abbrev, stats] of sellOrdersByType) {
        const name = CREDIT_TYPE_NAMES[abbrev] || abbrev;
        lines.push(`| ${name} | ${stats.quantity.toLocaleString(undefined, { maximumFractionDigits: 1 })} | ${stats.count} |`);
      }
      lines.push(``);
    }

    // Recent marketplace activity from the indexer
    if (recentOrders.length > 0) {
      lines.push(`### Recent Marketplace Orders`);
      lines.push(`| Project | Credits | Total Price | Retired? |`);
      lines.push(`|---------|---------|-------------|----------|`);
      for (const order of recentOrders) {
        const price = order.totalPrice
          ? `${order.totalPrice} ${order.askDenom}`
          : "N/A";
        lines.push(
          `| ${order.projectId} | ${order.creditsAmount} | ${price} | ${order.retiredCredits ? "Yes" : "No"} |`
        );
      }
      lines.push(``);
    }

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
        `*Sell order data is available on the marketplace web app at [app.regen.network](https://app.regen.network/projects/1?buying_options_filters=credit_card).*`
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
          text: `Error fetching credits: ${message}\n\nYou can browse credits directly at https://app.regen.network/projects/1?buying_options_filters=credit_card`,
        },
      ],
      isError: true,
    };
  }
}
