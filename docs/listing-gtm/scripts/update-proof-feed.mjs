import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function usage() {
  return [
    "Usage:",
    "  node docs/listing-gtm/scripts/update-proof-feed.mjs \\",
    "    --retirement-id Wy123 \\",
    "    --tx-hash ABCDEF \\",
    "    --certificate-url https://regen.network/certificate/xyz \\",
    "    --credits 1.250000 \\",
    "    --notes \"Listing day batch\"",
    "",
    "Optional:",
    "  --date YYYY-MM-DD         (default: today UTC date)",
    "  --supporters 42           (set totals.supporters_opted_in)",
    "  --feed /absolute/path.json (default: docs/listing-gtm/web/proof-feed.json)",
  ].join("\n");
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    out[key.slice(2)] = argv[i + 1];
  }
  return out;
}

function formatDateUtc(date) {
  return date.toISOString().slice(0, 10);
}

function formatCredits(value) {
  return Number(value).toFixed(6);
}

const args = parseArgs(process.argv.slice(2));
if (!args["retirement-id"] || !args["tx-hash"] || !args["certificate-url"]) {
  console.error(usage());
  process.exit(1);
}

const creditsToAdd = Number(args.credits || "0");
if (!Number.isFinite(creditsToAdd) || creditsToAdd < 0) {
  console.error("--credits must be a non-negative number");
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultFeedPath = path.resolve(__dirname, "../web/proof-feed.json");
const feedPath = args.feed ? path.resolve(process.cwd(), args.feed) : defaultFeedPath;

const raw = readFileSync(feedPath, "utf8");
const feed = JSON.parse(raw);

if (!feed.totals || !Array.isArray(feed.recent_retirements)) {
  throw new Error("Invalid proof feed schema");
}

const now = new Date();
const entry = {
  date: args.date || formatDateUtc(now),
  retirement_id: args["retirement-id"],
  tx_hash: args["tx-hash"],
  certificate_url: args["certificate-url"],
  notes: args.notes || "",
};

feed.updated_at = now.toISOString();
feed.recent_retirements = [entry, ...feed.recent_retirements].slice(0, 50);
feed.totals.retirements = Number(feed.totals.retirements || 0) + 1;

const currentCredits = Number(feed.totals.credits_retired || "0");
feed.totals.credits_retired = formatCredits(currentCredits + creditsToAdd);

if (args.supporters !== undefined) {
  const supporters = Number(args.supporters);
  if (!Number.isInteger(supporters) || supporters < 0) {
    throw new Error("--supporters must be a non-negative integer");
  }
  feed.totals.supporters_opted_in = supporters;
}

writeFileSync(feedPath, `${JSON.stringify(feed, null, 2)}\n`, "utf8");

console.log("Updated proof feed:");
console.log(`- feed: ${feedPath}`);
console.log(`- retirement_id: ${entry.retirement_id}`);
console.log(`- tx_hash: ${entry.tx_hash}`);
console.log(`- credits_retired_total: ${feed.totals.credits_retired}`);
console.log(`- retirements_total: ${feed.totals.retirements}`);
