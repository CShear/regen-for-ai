const MARKETPLACE_URL =
  process.env.REGEN_MARKETPLACE_URL || "https://registry.regen.network";

export async function retireCredits(
  creditClass?: string,
  quantity?: number,
  beneficiaryName?: string
) {
  // Generate a marketplace link — Phase 1 routes to the existing web UI
  // Phase 2+ will handle purchase directly via subscription pool

  let url = MARKETPLACE_URL;
  const params: string[] = [];

  if (creditClass) {
    // Link to a specific project page if class is provided
    url = `${MARKETPLACE_URL}/credit-classes/${creditClass}`;
  }

  const lines: string[] = [
    `## Retire Ecocredits on Regen Network`,
    ``,
  ];

  if (creditClass) {
    lines.push(`**Credit class**: ${creditClass}`);
  }
  if (quantity) {
    lines.push(`**Quantity**: ${quantity} credits`);
  }
  if (beneficiaryName) {
    lines.push(`**Beneficiary**: ${beneficiaryName}`);
  }

  lines.push(``);
  lines.push(`### Purchase & Retire`);
  lines.push(``);
  lines.push(`Visit the Regen Marketplace to complete your credit retirement:`);
  lines.push(``);
  lines.push(`**[${url}](${url})**`);
  lines.push(``);
  lines.push(`**How it works:**`);
  lines.push(`1. Browse available credits on the marketplace`);
  lines.push(`2. Select credits and choose "Retire" at checkout`);
  lines.push(`3. Pay with credit card (no crypto wallet needed)`);
  lines.push(`4. Your name appears as beneficiary on the on-chain retirement certificate`);
  lines.push(`5. Credits are permanently retired — verifiable, immutable, non-reversible`);
  lines.push(``);
  lines.push(`### Current Pricing`);
  lines.push(`| Type | Price | Available |`);
  lines.push(`|------|-------|-----------|`);
  lines.push(`| Carbon credits | ~$40/credit | ~2,000 |`);
  lines.push(`| Biodiversity credits | ~$26/credit | ~80,000 |`);
  lines.push(``);
  lines.push(`After retiring, use \`get_retirement_certificate\` to retrieve your verifiable certificate.`);

  return { content: [{ type: "text" as const, text: lines.join("\n") }] };
}
