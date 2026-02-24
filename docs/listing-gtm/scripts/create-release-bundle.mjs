import { cpSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gtmRoot = path.resolve(__dirname, "..");

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function collectFiles(baseDir, acc = []) {
  const entries = readdirSync(baseDir);
  for (const entry of entries) {
    const full = path.join(baseDir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectFiles(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

const releaseRoot = path.join(gtmRoot, "release");
mkdirSync(releaseRoot, { recursive: true });
const bundleDir = path.join(releaseRoot, `coinstore-gtm-${timestamp()}`);
mkdirSync(bundleDir, { recursive: true });

const copyItems = [
  "README.md",
  "PR_DRAFT_COINSTORE_GTM.md",
  "fastlane-single-owner.md",
  "unit-2-listing-landing-page.md",
  "unit-3-proof-page.md",
  "unit-4-campaign-buy-participate-proof.md",
  "unit-5-telegram-ops-kit.md",
  "unit-6-exchange-mm-runbook.md",
  "unit-7-kpi-dashboard-spec.md",
  "templates",
  "web",
];

for (const rel of copyItems) {
  const src = path.join(gtmRoot, rel);
  const dest = path.join(bundleDir, rel);
  cpSync(src, dest, { recursive: true });
}

const files = collectFiles(bundleDir).map((file) => path.relative(bundleDir, file));
const manifest = {
  generated_at: new Date().toISOString(),
  bundle_path: bundleDir,
  file_count: files.length,
  files,
};

writeFileSync(
  path.join(bundleDir, "bundle-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8"
);

console.log(`Created release bundle: ${bundleDir}`);
console.log(`Files copied: ${files.length}`);
