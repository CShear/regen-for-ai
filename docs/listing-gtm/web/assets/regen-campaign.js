const SUPPORTER_STORAGE_KEY = "regen_listing_supporter_profile_v1";
const PROOF_STORAGE_KEY = "regen_listing_local_proofs_v1";
const BRAND_STORAGE_KEY = "regen_listing_brand_mode_v1";

const BRAND_COPY = {
  regen: {
    stackName: "Regen AI Supporter Stack",
  },
  bridge: {
    stackName: "Bridge.eco Supporter Stack",
  },
};

function safeJsonParse(input, fallback) {
  try {
    return JSON.parse(input);
  } catch {
    return fallback;
  }
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeBrand(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return "regen";
  if (value === "bridge" || value === "bridge.eco" || value.startsWith("bridge")) {
    return "bridge";
  }
  return "regen";
}

function getStoredBrand() {
  try {
    return normalizeBrand(localStorage.getItem(BRAND_STORAGE_KEY));
  } catch {
    return "regen";
  }
}

function setStoredBrand(brand) {
  try {
    localStorage.setItem(BRAND_STORAGE_KEY, normalizeBrand(brand));
  } catch {
    // no-op
  }
}

function getBrandFromQuery() {
  try {
    const params = new URLSearchParams(window.location.search);
    const brand = params.get("brand");
    return brand ? normalizeBrand(brand) : null;
  } catch {
    return null;
  }
}

function detectBrand() {
  const fromQuery = getBrandFromQuery();
  if (fromQuery) {
    setStoredBrand(fromQuery);
    return fromQuery;
  }

  return getStoredBrand();
}

function applyBrandText(brand) {
  const copy = BRAND_COPY[normalizeBrand(brand)] || BRAND_COPY.regen;
  document.querySelectorAll("[data-brand-text]").forEach((node) => {
    const key = node.getAttribute("data-brand-text");
    if (!key || !copy[key]) return;
    node.textContent = copy[key];
  });
}

function decorateRelativeLinks(brand) {
  document.querySelectorAll("a[href]").forEach((link) => {
    const raw = link.getAttribute("href") || "";
    if (!raw.startsWith("./")) return;
    if (!raw.includes(".html")) return;
    if (raw.includes("brand=")) return;

    const [pathWithQuery, hashPart] = raw.split("#");
    const joiner = pathWithQuery.includes("?") ? "&" : "?";
    const next = `${pathWithQuery}${joiner}brand=${encodeURIComponent(brand)}${
      hashPart ? `#${hashPart}` : ""
    }`;
    link.setAttribute("href", next);
  });
}

function applyBrand() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return "regen";
  }

  const brand = detectBrand();
  document.body.setAttribute("data-brand", brand);
  applyBrandText(brand);
  decorateRelativeLinks(brand);
  return brand;
}

function makeSupporterId(name, identityRef) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const left = slug(name).slice(0, 10) || "supporter";
  const right = slug(identityRef).slice(0, 8) || "community";
  return `rg-${left}-${right}-${stamp}`;
}

function loadSupporterProfile() {
  const raw = localStorage.getItem(SUPPORTER_STORAGE_KEY);
  return raw ? safeJsonParse(raw, null) : null;
}

function saveSupporterProfile(profile) {
  localStorage.setItem(SUPPORTER_STORAGE_KEY, JSON.stringify(profile));
}

function loadLocalProofs() {
  const raw = localStorage.getItem(PROOF_STORAGE_KEY);
  const parsed = raw ? safeJsonParse(raw, []) : [];
  return Array.isArray(parsed) ? parsed : [];
}

function saveLocalProofs(items) {
  localStorage.setItem(PROOF_STORAGE_KEY, JSON.stringify(items));
}

function appendLocalProof(item) {
  const entries = loadLocalProofs();
  entries.unshift(item);
  saveLocalProofs(entries.slice(0, 50));
}

function formatIsoDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const helper = document.createElement("textarea");
  helper.value = text;
  document.body.appendChild(helper);
  helper.select();
  document.execCommand("copy");
  helper.remove();
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function buildSupporterPost(profile) {
  const focus = (profile.stewardshipFocus || []).join(", ") || "mixed";
  const walletRef = profile.walletReference || "none";
  const email = profile.contactEmail || "none";
  const telegram = profile.telegramHandle || "none";
  return [
    "#supporter-optin",
    `supporter_id: ${profile.supporterId}`,
    `participation_mode: ${profile.participationMode}`,
    `offset_path: ${profile.offsetPath}`,
    `telegram: ${telegram}`,
    `contact_email: ${email}`,
    `wallet_reference: ${walletRef}`,
    `horizon_months: ${profile.holdingHorizonMonths}`,
    `monthly_regen_usd: ${profile.monthlyRegenUsd}`,
    `ai_prompt_cadence: ${profile.aiPromptCadence}`,
    `local_ecosystem: ${profile.localEcosystem}`,
    `stewardship_focus: ${focus}`,
  ].join("\n");
}

function buildProofPost(entry, supporterId) {
  return [
    "#proof",
    `supporter_id: ${supporterId || "unknown"}`,
    `retirement_id: ${entry.retirementId}`,
    `tx_hash: ${entry.txHash}`,
    `certificate_url: ${entry.certificateUrl}`,
    `note: ${entry.note || "proof submission"}`,
  ].join("\n");
}

window.RegenCampaign = {
  applyBrand,
  makeSupporterId,
  loadSupporterProfile,
  saveSupporterProfile,
  loadLocalProofs,
  appendLocalProof,
  formatIsoDate,
  copyText,
  downloadJson,
  buildSupporterPost,
  buildProofPost,
};
