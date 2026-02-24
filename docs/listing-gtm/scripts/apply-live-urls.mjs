import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--landing") out.landing = argv[i + 1];
    if (arg === "--proof") out.proof = argv[i + 1];
    if (arg === "--rules") out.rules = argv[i + 1];
  }
  return out;
}

function usage() {
  return [
    "Usage:",
    "  node docs/listing-gtm/scripts/apply-live-urls.mjs \\",
    "    --landing https://.../listing-landing.html \\",
    "    --proof https://.../proof-page.html \\",
    "    --rules https://.../supporter-opt-in.html#campaign-rules",
    "",
    "This replaces template tokens: {{LANDING_URL}}, {{PROOF_URL}}, {{RULES_URL}}",
  ].join("\n");
}

const args = parseArgs(process.argv.slice(2));
if (!args.landing || !args.proof || !args.rules) {
  console.error(usage());
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const templatesDir = path.resolve(__dirname, "../templates");

const targetFiles = [
  "telegram-pinned-message.txt",
  "telegram-daily-update.md",
  "telegram-mod-quick-replies.md",
  "telegram-14-day-posting-pack.md",
];

function patchTemplateTokens(filePath) {
  let content = readFileSync(filePath, "utf8");
  content = content
    .replaceAll("{{LANDING_URL}}", args.landing)
    .replaceAll("{{PROOF_URL}}", args.proof)
    .replaceAll("{{RULES_URL}}", args.rules);
  writeFileSync(filePath, content, "utf8");
}

for (const filename of targetFiles) {
  patchTemplateTokens(path.join(templatesDir, filename));
}

const linkValuesPath = path.join(templatesDir, "telegram-link-values.md");
let linkValues = readFileSync(linkValuesPath, "utf8");
linkValues = linkValues
  .replace(
    /3\. `LANDING_URL`: `.*`/g,
    `3. \`LANDING_URL\`: \`${args.landing}\``
  )
  .replace(
    /4\. `PROOF_URL`: `.*`/g,
    `4. \`PROOF_URL\`: \`${args.proof}\``
  )
  .replace(
    /5\. `RULES_URL`: `.*`/g,
    `5. \`RULES_URL\`: \`${args.rules}\``
  );
writeFileSync(linkValuesPath, linkValues, "utf8");

console.log("Applied live URLs to listing GTM Telegram templates.");
