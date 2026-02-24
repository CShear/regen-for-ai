import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gtmRoot = path.resolve(__dirname, "..");

const strictUrls = process.argv.includes("--strict-urls");

const requiredFiles = [
  "README.md",
  "PR_DRAFT_COINSTORE_GTM.md",
  "fastlane-single-owner.md",
  "unit-2-listing-landing-page.md",
  "unit-3-proof-page.md",
  "unit-4-campaign-buy-participate-proof.md",
  "unit-5-telegram-ops-kit.md",
  "unit-6-exchange-mm-runbook.md",
  "unit-7-kpi-dashboard-spec.md",
  "web/listing-landing.html",
  "web/supporter-opt-in.html",
  "web/proof-page.html",
  "web/proof-feed.json",
  "web/assets/regen-campaign.css",
  "web/assets/regen-campaign.js",
  "templates/telegram-pinned-message.txt",
  "templates/telegram-daily-update.md",
  "templates/telegram-mod-quick-replies.md",
  "templates/telegram-link-values.md",
  "templates/telegram-14-day-posting-pack.md",
];

function loadFile(relativePath) {
  return readFileSync(path.join(gtmRoot, relativePath), "utf8");
}

const errors = [];
const warnings = [];

for (const rel of requiredFiles) {
  const full = path.join(gtmRoot, rel);
  if (!existsSync(full)) {
    errors.push(`Missing required file: ${rel}`);
  }
}

function assertIncludes(relativePath, token) {
  const content = loadFile(relativePath);
  if (!content.includes(token)) {
    errors.push(`Expected token "${token}" in ${relativePath}`);
  }
}

assertIncludes("web/listing-landing.html", "./supporter-opt-in.html");
assertIncludes("web/listing-landing.html", "./proof-page.html");
assertIncludes("web/listing-landing.html", "data-brand-text=\"stackName\"");
assertIncludes("web/listing-landing.html", "window.RegenCampaign.applyBrand()");
assertIncludes("web/supporter-opt-in.html", "#campaign-rules");
assertIncludes("web/supporter-opt-in.html", "Non-holder supporter");
assertIncludes("web/supporter-opt-in.html", "window.RegenCampaign.applyBrand()");
assertIncludes("web/proof-page.html", "./proof-feed.json");
assertIncludes("web/proof-page.html", "window.RegenCampaign.applyBrand()");

try {
  const proofFeed = JSON.parse(loadFile("web/proof-feed.json"));
  if (!proofFeed.updated_at) errors.push("proof-feed.json missing updated_at");
  if (!proofFeed.totals) errors.push("proof-feed.json missing totals");
  if (!Array.isArray(proofFeed.recent_retirements)) {
    errors.push("proof-feed.json recent_retirements must be an array");
  }
  if (typeof proofFeed?.totals?.retirements !== "number") {
    errors.push("proof-feed.json totals.retirements must be a number");
  }
  if (typeof proofFeed?.totals?.credits_retired !== "string") {
    errors.push("proof-feed.json totals.credits_retired must be a string");
  }
} catch (error) {
  errors.push(`proof-feed.json parse failed: ${error instanceof Error ? error.message : "unknown error"}`);
}

const urlTokenChecks = [
  "templates/telegram-pinned-message.txt",
  "templates/telegram-daily-update.md",
  "templates/telegram-mod-quick-replies.md",
  "templates/telegram-14-day-posting-pack.md",
];

for (const rel of urlTokenChecks) {
  const content = loadFile(rel);
  const unresolvedCount =
    (content.match(/\{\{LANDING_URL\}\}/g) || []).length +
    (content.match(/\{\{PROOF_URL\}\}/g) || []).length +
    (content.match(/\{\{RULES_URL\}\}/g) || []).length;

  if (unresolvedCount > 0) {
    const msg = `${rel} has ${unresolvedCount} unresolved URL token(s)`;
    if (strictUrls) {
      errors.push(msg);
    } else {
      warnings.push(msg);
    }
  }
}

function printGroup(title, items) {
  if (!items.length) return;
  console.log(`\n${title}`);
  for (const item of items) {
    console.log(`- ${item}`);
  }
}

console.log("Listing GTM preflight summary:");
printGroup("Warnings", warnings);
printGroup("Errors", errors);

if (!warnings.length && !errors.length) {
  console.log("\n- All checks passed.");
}

process.exit(errors.length ? 1 : 0);
