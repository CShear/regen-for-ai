/**
 * Shareable retirement certificate page.
 *
 * Routes:
 *   GET /impact/:nodeId          — Full certificate HTML page
 *   GET /impact/:nodeId/badge.svg — Embeddable SVG badge
 *
 * Data is fetched from the Regen Indexer GraphQL API via getRetirementById().
 */

import { Router, Request, Response } from "express";
import { getRetirementById, type Retirement } from "../services/indexer.js";

// --- Credit type visual themes ---

interface CreditTheme {
  name: string;
  accent: string;
  accentLight: string;
  gradientFrom: string;
  gradientTo: string;
  icon: string; // SVG path for badge
  label: string; // e.g. "Carbon Credit"
}

const CREDIT_THEMES: Record<string, CreditTheme> = {
  C: {
    name: "Carbon",
    accent: "#2d6a4f",
    accentLight: "#d8f3dc",
    gradientFrom: "#2d6a4f",
    gradientTo: "#52b788",
    icon: `<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15l-1-1c-2.5-2.4-4-3.9-4-5.5C6 8.6 7.6 7 9.5 7c1.1 0 2.1.5 2.5 1.3.4-.8 1.4-1.3 2.5-1.3C16.4 7 18 8.6 18 10.5c0 1.6-1.5 3.1-4 5.5l-1 1h-2z" fill="currentColor"/>`,
    label: "Carbon Credit",
  },
  BT: {
    name: "Biodiversity",
    accent: "#1e5fa8",
    accentLight: "#dbeafe",
    gradientFrom: "#1e5fa8",
    gradientTo: "#60a5fa",
    icon: `<path d="M12 2C8 2 4 4 4 8c0 3 2 5 4 6.5V22l4-2 4 2v-7.5c2-1.5 4-3.5 4-6.5 0-4-4-6-8-6zm0 2c2.5 0 5 1.5 5 4s-2 4-5 5c-3-1-5-2.5-5-5s2.5-4 5-4z" fill="currentColor"/>`,
    label: "Biodiversity Credit",
  },
  MBS: {
    name: "Marine Biodiversity",
    accent: "#0e8482",
    accentLight: "#ccfbf1",
    gradientFrom: "#0e8482",
    gradientTo: "#5eead4",
    icon: `<path d="M12 3c-2 0-6 3-6 7 0 3 2 6 6 8 4-2 6-5 6-8 0-4-4-7-6-7zm0 3c1.5 0 3 1.5 3 4s-1.5 4-3 4-3-1.5-3-4 1.5-4 3-4z" fill="currentColor"/>`,
    label: "Marine Biodiversity Credit",
  },
  KSH: {
    name: "Kilo-Sheep-Hour",
    accent: "#7b6b3a",
    accentLight: "#fef3c7",
    gradientFrom: "#7b6b3a",
    gradientTo: "#d4a853",
    icon: `<path d="M12 4c-3 0-5 2-5 4 0 1.5 1 3 3 4v6c0 1 1 2 2 2s2-1 2-2v-6c2-1 3-2.5 3-4 0-2-2-4-5-4zm0 2c1.5 0 3 1 3 2s-1.5 2-3 2-3-1-3-2 1.5-2 3-2z" fill="currentColor"/>`,
    label: "Kilo-Sheep-Hour Credit",
  },
  USS: {
    name: "Umbrella Species",
    accent: "#b5651d",
    accentLight: "#ffedd5",
    gradientFrom: "#b5651d",
    gradientTo: "#f59e0b",
    icon: `<path d="M12 2L8 6v4l-4 4h4v4l4 4 4-4v-4h4l-4-4V6l-4-4zm0 4l2 2v3h3l-2 2h-3v3l-2-2v-3H7l2-2V8l3-2z" fill="currentColor"/>`,
    label: "Umbrella Species Credit",
  },
};

const DEFAULT_THEME: CreditTheme = {
  name: "Ecological",
  accent: "#2d6a4f",
  accentLight: "#d8f3dc",
  gradientFrom: "#2d6a4f",
  gradientTo: "#52b788",
  icon: `<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 6v12M6 12h12" stroke="currentColor" stroke-width="2"/>`,
  label: "Ecological Credit",
};

/** Map credit type abbreviation from batchDenom or retirement.type field. */
function getCreditTypeAbbrev(retirement: Retirement): string {
  // batchDenom like "C03-004-..." → first segment before digits gives class prefix
  const match = retirement.batchDenom.match(/^([A-Z]+)/);
  return match?.[1] ?? "C";
}

function getTheme(retirement: Retirement): CreditTheme {
  const abbrev = getCreditTypeAbbrev(retirement);
  return CREDIT_THEMES[abbrev] ?? DEFAULT_THEME;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(timestamp: string | null): string {
  if (!timestamp) return "N/A";
  try {
    const d = new Date(timestamp);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return timestamp;
  }
}

function truncateHash(hash: string): string {
  if (hash.length <= 16) return hash;
  return hash.slice(0, 8) + "..." + hash.slice(-8);
}

function explorerTxUrl(txHash: string): string {
  return `https://www.mintscan.io/regen/tx/${txHash}`;
}

// --- HTML rendering ---

function renderCertificatePage(
  retirement: Retirement,
  baseUrl: string
): string {
  const theme = getTheme(retirement);
  const abbrev = getCreditTypeAbbrev(retirement);
  const date = formatDate(retirement.timestamp);
  const explorerUrl = explorerTxUrl(retirement.txHash);
  const certUrl = `${baseUrl}/impact/${encodeURIComponent(retirement.nodeId)}`;
  const badgeUrl = `${certUrl}/badge.svg`;
  const amount = parseFloat(retirement.amount).toLocaleString("en-US", {
    maximumFractionDigits: 6,
  });

  const description = `${amount} ${theme.name.toLowerCase()} credits retired on Regen Network — funding verified ecological regeneration`;

  const embedSnippet = escapeHtml(
    `<a href="${certUrl}">\n  <img src="${badgeUrl}"\n       alt="${amount} ${theme.name.toLowerCase()} credits retired via Regenerative AI"\n       width="320" height="80" />\n</a>`
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${theme.label} — Regen for AI</title>

  <meta property="og:title" content="Ecological Regeneration Certificate" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${escapeHtml(certUrl)}" />
  <meta property="og:image" content="${escapeHtml(badgeUrl)}" />
  <meta property="og:site_name" content="Regen for AI" />

  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="Ecological Regeneration Certificate" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(badgeUrl)}" />

  <style>
    :root {
      --accent: ${theme.accent};
      --accent-light: ${theme.accentLight};
      --gradient-from: ${theme.gradientFrom};
      --gradient-to: ${theme.gradientTo};
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1a1a1a;
      line-height: 1.6;
      background: linear-gradient(135deg, var(--accent-light) 0%, #fafafa 40%, #fafafa 100%);
      min-height: 100vh;
      padding: 40px 16px;
    }

    .container {
      max-width: 640px;
      margin: 0 auto;
    }

    .header {
      text-align: center;
      margin-bottom: 32px;
    }

    .header-brand {
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--accent);
      margin-bottom: 4px;
    }

    .card {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04);
      overflow: hidden;
    }

    .card-top {
      background: linear-gradient(135deg, var(--gradient-from), var(--gradient-to));
      color: #fff;
      padding: 32px 32px 28px;
      text-align: center;
    }

    .card-top-label {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      opacity: 0.85;
      margin-bottom: 8px;
    }

    .card-top-title {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.01em;
      margin-bottom: 16px;
    }

    .credit-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(255,255,255,0.2);
      border-radius: 24px;
      padding: 6px 16px 6px 10px;
      font-size: 14px;
      font-weight: 600;
    }

    .credit-badge svg {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }

    .amount-hero {
      font-size: 40px;
      font-weight: 800;
      letter-spacing: -0.02em;
      margin: 16px 0 4px;
    }

    .amount-label {
      font-size: 14px;
      opacity: 0.85;
    }

    .card-body {
      padding: 28px 32px;
    }

    .details-table {
      width: 100%;
      border-collapse: collapse;
    }

    .details-table tr {
      border-bottom: 1px solid #f3f4f6;
    }

    .details-table tr:last-child {
      border-bottom: none;
    }

    .details-table td {
      padding: 12px 0;
      vertical-align: top;
    }

    .details-table .label {
      font-size: 13px;
      font-weight: 600;
      color: #6b7280;
      width: 140px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .details-table .value {
      font-size: 14px;
      color: #1a1a1a;
      word-break: break-all;
    }

    .proof-section {
      margin-top: 24px;
      padding: 16px 20px;
      background: #f9fafb;
      border-radius: 10px;
      border: 1px solid #e5e7eb;
    }

    .proof-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #6b7280;
      margin-bottom: 10px;
    }

    .proof-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 13px;
      margin-bottom: 6px;
    }

    .proof-row:last-child { margin-bottom: 0; }

    .proof-label {
      color: #6b7280;
      font-weight: 500;
    }

    .proof-value {
      font-family: "SF Mono", "Cascadia Code", "Fira Code", Consolas, monospace;
      font-size: 12px;
      color: #1a1a1a;
    }

    .proof-value a {
      color: var(--accent);
      text-decoration: none;
    }

    .proof-value a:hover {
      text-decoration: underline;
    }

    .embed-section {
      margin-top: 32px;
    }

    .embed-title {
      font-size: 14px;
      font-weight: 700;
      color: #374151;
      margin-bottom: 8px;
    }

    .embed-desc {
      font-size: 13px;
      color: #6b7280;
      margin-bottom: 12px;
    }

    .embed-preview {
      text-align: center;
      margin-bottom: 12px;
    }

    .embed-code {
      display: block;
      width: 100%;
      min-height: 80px;
      font-family: "SF Mono", "Cascadia Code", "Fira Code", Consolas, monospace;
      font-size: 11px;
      line-height: 1.5;
      padding: 12px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #f9fafb;
      color: #374151;
      resize: vertical;
    }

    .footer {
      text-align: center;
      margin-top: 32px;
      padding: 0 16px;
    }

    .footer-brand {
      font-size: 13px;
      color: #6b7280;
      margin-bottom: 8px;
    }

    .footer-brand a {
      color: var(--accent);
      text-decoration: none;
      font-weight: 600;
    }

    .footer-brand a:hover {
      text-decoration: underline;
    }

    .footer-install {
      font-family: "SF Mono", "Cascadia Code", "Fira Code", Consolas, monospace;
      font-size: 11px;
      color: #9ca3af;
      background: #f3f4f6;
      border-radius: 6px;
      padding: 8px 12px;
      display: inline-block;
      margin-top: 4px;
    }

    .footer-note {
      font-size: 12px;
      color: #9ca3af;
      margin-top: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-brand">Regen for AI</div>
    </div>

    <div class="card">
      <div class="card-top">
        <div class="card-top-label">Ecological Regeneration Certificate</div>
        <div class="card-top-title">Verified Credit Retirement</div>
        <div class="credit-badge">
          <svg viewBox="0 0 24 24" fill="none">${theme.icon}</svg>
          ${escapeHtml(theme.label)} (${escapeHtml(abbrev)})
        </div>
        <div class="amount-hero">${escapeHtml(amount)}</div>
        <div class="amount-label">credits permanently retired</div>
      </div>

      <div class="card-body">
        <table class="details-table">
          <tr>
            <td class="label">Credit Batch</td>
            <td class="value">${escapeHtml(retirement.batchDenom)}</td>
          </tr>
          <tr>
            <td class="label">Beneficiary</td>
            <td class="value">${escapeHtml(retirement.owner)}</td>
          </tr>
          <tr>
            <td class="label">Jurisdiction</td>
            <td class="value">${escapeHtml(retirement.jurisdiction || "N/A")}</td>
          </tr>
          <tr>
            <td class="label">Reason</td>
            <td class="value">${escapeHtml(retirement.reason || "Ecological regeneration")}</td>
          </tr>
          <tr>
            <td class="label">Date</td>
            <td class="value">${escapeHtml(date)}</td>
          </tr>
        </table>

        <div class="proof-section">
          <div class="proof-title">On-Chain Proof</div>
          <div class="proof-row">
            <span class="proof-label">Transaction</span>
            <span class="proof-value">
              <a href="${escapeHtml(explorerUrl)}" target="_blank" rel="noopener">${escapeHtml(truncateHash(retirement.txHash))}</a>
            </span>
          </div>
          <div class="proof-row">
            <span class="proof-label">Block</span>
            <span class="proof-value">${escapeHtml(retirement.blockHeight)}</span>
          </div>
          <div class="proof-row">
            <span class="proof-label">Ledger</span>
            <span class="proof-value">Regen Network (regen-1)</span>
          </div>
        </div>

        <div class="embed-section">
          <div class="embed-title">Share this certificate</div>
          <div class="embed-desc">Add this badge to your README, website, or profile:</div>
          <div class="embed-preview">
            <a href="${escapeHtml(certUrl)}">
              <img src="${escapeHtml(badgeUrl)}" alt="${escapeHtml(amount)} ${escapeHtml(theme.name.toLowerCase())} credits retired via Regenerative AI" width="320" height="80" />
            </a>
          </div>
          <textarea class="embed-code" readonly onclick="this.select()">${embedSnippet}</textarea>
        </div>
      </div>
    </div>

    <div class="footer">
      <div class="footer-brand">
        Powered by <a href="https://regen.network" target="_blank" rel="noopener">Regen Network</a>
      </div>
      <div class="footer-install">claude mcp add -s user regen-for-ai -- npx regen-for-ai</div>
      <div class="footer-note">
        This retirement is permanently recorded on Regen Ledger and cannot be altered or reversed.
      </div>
    </div>
  </div>
</body>
</html>`;
}

// --- SVG badge rendering ---

function renderBadgeSvg(retirement: Retirement, baseUrl: string): string {
  const theme = getTheme(retirement);
  const amount = parseFloat(retirement.amount).toLocaleString("en-US", {
    maximumFractionDigits: 4,
  });
  const label = `${amount} ${theme.name}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="80" viewBox="0 0 320 80">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${theme.gradientFrom}"/>
      <stop offset="100%" stop-color="${theme.gradientTo}"/>
    </linearGradient>
  </defs>
  <rect width="320" height="80" rx="10" fill="url(#bg)"/>
  <g transform="translate(16, 16)" fill="#fff">
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none">
      ${theme.icon.replace(/currentColor/g, "#fff")}
    </svg>
  </g>
  <text x="52" y="32" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="16" font-weight="700" fill="#fff">${escapeHtml(label)}</text>
  <text x="52" y="50" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="11" fill="rgba(255,255,255,0.85)">credits retired on Regen Network</text>
  <text x="16" y="70" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="9" fill="rgba(255,255,255,0.65)">Powered by Regenerative AI</text>
</svg>`;
}

// --- Error page rendering ---

function renderErrorPage(status: number, message: string): string {
  const title = status === 404 ? "Certificate Not Found" : "Error";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Regen for AI</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      max-width: 640px;
      margin: 80px auto;
      padding: 0 20px;
      color: #1a1a1a;
      text-align: center;
    }
    h1 { color: #6b7280; font-size: 24px; margin-bottom: 12px; }
    p { color: #9ca3af; font-size: 15px; line-height: 1.6; }
    a { color: #2d6a4f; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(message)}</p>
  <p style="margin-top: 24px;">
    <a href="https://regen.network">Regen Network</a>
  </p>
</body>
</html>`;
}

// --- Express router ---

export function createCertificateRoutes(baseUrl: string): Router {
  const router = Router();

  router.get("/impact/:nodeId/badge.svg", async (req: Request, res: Response) => {
    try {
      const nodeId = Array.isArray(req.params.nodeId) ? req.params.nodeId[0] : req.params.nodeId;
      const retirement = await getRetirementById(nodeId);
      if (!retirement) {
        res.status(404).type("text/plain").send("Not found");
        return;
      }
      res.setHeader("Content-Type", "image/svg+xml");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.send(renderBadgeSvg(retirement, baseUrl));
    } catch {
      res.status(500).type("text/plain").send("Internal server error");
    }
  });

  router.get("/impact/:nodeId", async (req: Request, res: Response) => {
    try {
      const nodeId = Array.isArray(req.params.nodeId) ? req.params.nodeId[0] : req.params.nodeId;
      const retirement = await getRetirementById(nodeId);
      if (!retirement) {
        res.status(404).setHeader("Content-Type", "text/html");
        res.send(
          renderErrorPage(
            404,
            "This retirement ID was not found. It may be invalid or not yet indexed by the Regen Network indexer."
          )
        );
        return;
      }
      res.setHeader("Content-Type", "text/html");
      res.setHeader("Cache-Control", "public, max-age=300");
      res.send(renderCertificatePage(retirement, baseUrl));
    } catch {
      res.status(500).setHeader("Content-Type", "text/html");
      res.send(
        renderErrorPage(
          500,
          "Unable to retrieve certificate data from the Regen Network indexer. Please try again."
        )
      );
    }
  });

  return router;
}
