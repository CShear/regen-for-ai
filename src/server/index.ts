/**
 * Regen Compute — Payment & Balance Server
 *
 * A small Express server that handles:
 * - Shareable retirement certificate pages (/impact/:nodeId)
 * - Stripe Checkout for prepaid balance top-ups
 * - Stripe webhooks for payment confirmation
 * - Balance checking and debiting for MCP clients
 * - Developer REST API (/api/v1/) for programmatic access
 *
 * Run: npx regen-compute serve [--port 3141]
 *
 * Certificate routes work without Stripe configuration.
 * Payment routes require STRIPE_SECRET_KEY.
 * API routes require STRIPE_SECRET_KEY (for the DB / API key system).
 */

import { join } from "path";
import { readFileSync } from "fs";
import express from "express";
import helmet from "helmet";
import Stripe from "stripe";
import { getDb } from "./db.js";
import { createRoutes } from "./routes.js";
import { createCertificateRoutes } from "./certificate.js";
import { createApiRoutes } from "./api-routes.js";
import { createDashboardRoutes } from "./dashboard.js";
import { createResearchRoutes } from "./research.js";
import { createAboutRoutes } from "./about.js";
import { createDevelopersRoutes } from "./developers.js";
import { createBadgesRoutes } from "./badges.js";
import { createAiPluginRoutes } from "./ai-plugin.js";
import { createUnicornRoutes } from "./unicorns.js";
import { createRainbowRoutes } from "./rainbows.js";
import { createAgentViewRoutes } from "./agent-view.js";
import { createX402Middleware } from "./x402-middleware.js";
import { loadConfig } from "../config.js";
import { regenLogoSVG, regenLogoPNG } from "./brand.js";
import { getSubscribersNeedingRenewal, markRenewalReminderSent, type RenewalLevel } from "./db.js";
import { sendRenewalReminderEmail } from "../services/email.js";

export function startServer(options: { port?: number; dbPath?: string } = {}) {
  const port = options.port ?? parseInt(process.env.REGEN_SERVER_PORT ?? "3141", 10);
  const dbPath = options.dbPath ?? process.env.REGEN_DB_PATH ?? "data/regen-compute.db";

  const baseUrl = process.env.REGEN_SERVER_URL ?? `http://localhost:${port}`;

  const app = express();

  // Trust the reverse proxy (e.g. nginx) so req.ip reflects the real client.
  // Required for per-IP rate limiting to work correctly in production. Set
  // REGEN_TRUST_PROXY="false" to disable, or to a number to trust N hops.
  const trustProxyEnv = process.env.REGEN_TRUST_PROXY;
  if (trustProxyEnv !== "false") {
    const hops = trustProxyEnv ? Number.parseInt(trustProxyEnv, 10) : NaN;
    app.set("trust proxy", Number.isFinite(hops) && hops > 0 ? hops : 1);
  }

  // Agent view middleware — intercepts ?view=agent on any page, mount first
  const agentViewRoutes = createAgentViewRoutes(baseUrl);
  app.use(agentViewRoutes);

  // Certificate routes — no Stripe dependency, mount first
  const certificateRoutes = createCertificateRoutes(baseUrl);
  app.use(certificateRoutes);

  // Static public assets (badge icons, hero images, etc.)
  app.use("/public", express.static(join(process.cwd(), "public"), { maxAge: "1d" }));

  // Self-hosted favicon
  app.get("/favicon.ico", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=31536000");
    res.sendFile("favicon.ico", { root: join(process.cwd(), "public") });
  });

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", version: "0.3.0" });
  });

  // Static logo for emails (SVG)
  app.get("/logo.svg", (_req, res) => {
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=31536000");
    res.send(regenLogoSVG);
  });

  // Static logo for emails (PNG — compatible with Gmail, Outlook, Apple Mail)
  app.get("/logo.png", (_req, res) => {
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=31536000");
    res.send(regenLogoPNG);
  });

  // Profile avatar for app.regen.network (square, solid green background + leaf mark)
  app.get("/profile-avatar.svg", (_req, res) => {
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=31536000");
    res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1a5c3a"/>
      <stop offset="100%" stop-color="#0d7a5f"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" fill="url(#bg)"/>
  <g transform="translate(52,40) scale(3.7)" fill="white" opacity="0.95">
    <path d="M39.83 27.32V27.37L34.98 1.8L30.97.52 28.44 3.92 39.83 27.32Z"/>
    <path d="M42.46 16.65L44.52 26.55 46.73 16.5 44.57 15.05 42.46 16.65Z"/>
    <path d="M57.76 18.4L55.13 18.66 52.04 28.46 58.84 20.78 57.76 18.4Z"/>
    <path d="M80.22 20.47V16.29L76.15 15 57.09 32.89 80.22 20.47Z"/>
    <path d="M33.64 31.03L27.98 22.53 28.08 22.73 27.98 22.53 25.4 22.94 24.99 25.52 33.64 31.03Z"/>
    <path d="M70.12 39.7L59.97 41.71 70.12 43.92 71.67 41.81 70.12 39.7Z"/>
    <path d="M29.11 41.76L3.04 38.46.52 41.86 3.04 45.26 29.11 41.76Z"/>
    <path d="M19.48 47.43L18.7 49.85 20.82 51.4 29.83 46.35 19.48 47.43Z"/>
    <path d="M22.46 54.59L22.36 57.17 24.83 58.05 32.05 50.47 22.46 54.59Z"/>
    <path d="M35.45 53.98L27.77 60.73 28.44 63.2 31.07 63.31 35.45 53.98Z"/>
    <path d="M44.57 56.97L42.51 66.97 44.62 68.46 46.73 66.92 44.57 56.97Z"/>
    <path d="M80.27 63.05L57.09 50.73 76.25 68.51 80.27 67.22V63.05Z"/>
    <path d="M54.72 64.96L49.51 56.24 50.7 66.25 53.17 67.02 54.72 64.96Z"/>
    <path d="M39.88 56.24L28.6 79.7 31.12 83.1 35.14 81.81 39.88 56.24Z"/>
  </g>
</svg>`);
  });

  // Profile banner for app.regen.network (wide, abstract teal-green gradient)
  app.get("/profile-banner.svg", (_req, res) => {
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=31536000");
    res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="400" viewBox="0 0 1600 400">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="0.3">
      <stop offset="0%" stop-color="#0a3d2e"/>
      <stop offset="40%" stop-color="#0d6b52"/>
      <stop offset="70%" stop-color="#1a8a6e"/>
      <stop offset="100%" stop-color="#0f5a4a"/>
    </linearGradient>
    <radialGradient id="glow1" cx="0.2" cy="0.5" r="0.4">
      <stop offset="0%" stop-color="#2dd4a8" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="#2dd4a8" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow2" cx="0.75" cy="0.3" r="0.35">
      <stop offset="0%" stop-color="#34d399" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#34d399" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1600" height="400" fill="url(#bg)"/>
  <rect width="1600" height="400" fill="url(#glow1)"/>
  <rect width="1600" height="400" fill="url(#glow2)"/>
  <!-- Subtle network nodes -->
  <g fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1">
    <circle cx="200" cy="120" r="3" fill="rgba(255,255,255,0.12)"/>
    <circle cx="350" cy="80" r="2.5" fill="rgba(255,255,255,0.1)"/>
    <circle cx="480" cy="160" r="3.5" fill="rgba(255,255,255,0.1)"/>
    <circle cx="650" cy="90" r="2" fill="rgba(255,255,255,0.08)"/>
    <circle cx="800" cy="200" r="3" fill="rgba(255,255,255,0.1)"/>
    <circle cx="1000" cy="130" r="2.5" fill="rgba(255,255,255,0.1)"/>
    <circle cx="1150" cy="180" r="3" fill="rgba(255,255,255,0.12)"/>
    <circle cx="1300" cy="100" r="2" fill="rgba(255,255,255,0.08)"/>
    <circle cx="1420" cy="220" r="3.5" fill="rgba(255,255,255,0.1)"/>
    <line x1="200" y1="120" x2="350" y2="80"/>
    <line x1="350" y1="80" x2="480" y2="160"/>
    <line x1="480" y1="160" x2="650" y2="90"/>
    <line x1="650" y1="90" x2="800" y2="200"/>
    <line x1="800" y1="200" x2="1000" y2="130"/>
    <line x1="1000" y1="130" x2="1150" y2="180"/>
    <line x1="1150" y1="180" x2="1300" y2="100"/>
    <line x1="1300" y1="100" x2="1420" y2="220"/>
    <line x1="200" y1="120" x2="480" y2="160"/>
    <line x1="650" y1="90" x2="1000" y2="130"/>
    <line x1="800" y1="200" x2="1150" y2="180"/>
  </g>
  <!-- Subtle horizontal light streak -->
  <rect x="0" y="195" width="1600" height="1.5" fill="rgba(52,211,153,0.15)"/>
  <rect x="0" y="197" width="1600" height="0.5" fill="rgba(52,211,153,0.08)"/>
</svg>`);
  });

  // --- Machine-readable discovery endpoints for autonomous AI agents ---

  // MCP Server Card — describes this MCP server's capabilities and tools
  app.get("/.well-known/mcp/server-card.json", (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.json({
      name: "regen-compute",
      version: "0.3.4",
      description: "Ecological accountability for AI compute — retire verified ecocredits on Regen Network",
      transport: ["stdio"],
      install: "npx regen-compute",
      homepage: "https://compute.regen.network",
      repository: "https://github.com/regen-network/regen-compute",
      npm: "https://www.npmjs.com/package/regen-compute",
      capabilities: {
        tools: true,
        prompts: true,
        resources: false,
      },
      tools: [
        "estimate_session_footprint",
        "estimate_monthly_footprint",
        "browse_available_credits",
        "retire_credits",
        "get_retirement_certificate",
        "get_impact_summary",
        "check_subscription_status",
      ],
      credit_types: ["carbon", "biodiversity", "umbrella_species", "marine_biodiversity", "regenerative_grazing"],
    });
  });

  // Google A2A Agent Card — describes agent capabilities for A2A protocol
  app.get("/.well-known/agent.json", (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.json({
      name: "Regen Compute",
      description: "Retire verified ecological credits on behalf of AI compute usage on Regen Network",
      url: "https://compute.regen.network",
      version: "1.0",
      provider: {
        organization: "Regen Network Development",
        url: "https://regen.network",
      },
      capabilities: {
        streaming: false,
        pushNotifications: false,
      },
      skills: [
        { id: "estimate_footprint", name: "Estimate AI Footprint", description: "Estimate the ecological footprint of an AI session based on duration and tool calls" },
        { id: "browse_credits", name: "Browse Ecological Credits", description: "View available carbon, biodiversity, and species stewardship credits with live pricing" },
        { id: "retire_credits", name: "Retire Ecological Credits", description: "Permanently retire verified ecological credits on Regen Ledger" },
        { id: "get_certificate", name: "Get Retirement Certificate", description: "Retrieve on-chain proof of credit retirement with verifiable transaction hash" },
        { id: "check_subscription", name: "Check Subscription Status", description: "Check subscriber status, cumulative impact, and referral link" },
      ],
      authentication: {
        schemes: ["bearer", "x402"],
        credentials_url: "https://compute.regen.network",
        description: "API key via subscription, or x402 per-request payment (USDC on Base). x402-enabled agents can pay automatically.",
      },
      defaultInputModes: ["application/json"],
      defaultOutputModes: ["application/json"],
    });
  });

  // Multi-step agent flows — describes API workflows for orchestration agents
  app.get("/.well-known/agents.json", (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.json({
      version: "1.0",
      name: "Regen Compute",
      description: "Ecological accountability for AI compute via verified credit retirement on Regen Network",
      api_base: "https://compute.regen.network/api/v1",
      openapi: "https://compute.regen.network/api/v1/openapi.json",
      authentication: { type: "bearer", header: "Authorization" },
      flows: [
        {
          id: "offset_ai_session",
          name: "Offset AI Session",
          description: "Estimate footprint, browse credits, retire, get certificate",
          steps: [
            { method: "GET", path: "/footprint?session_minutes={minutes}&tool_calls={calls}", description: "Estimate session footprint" },
            { method: "GET", path: "/credits?type=all", description: "Browse available credits" },
            { method: "POST", path: "/retire", body: { credit_class: "string", quantity: "number" }, description: "Retire ecological credits" },
            { method: "GET", path: "/certificates/{nodeId}", description: "Get retirement certificate" },
          ],
        },
        {
          id: "check_impact",
          name: "Check Ecological Impact",
          description: "View subscription status and network-wide impact",
          steps: [
            { method: "GET", path: "/subscription", description: "Check subscription and cumulative impact" },
            { method: "GET", path: "/impact", description: "View Regen Network aggregate stats" },
          ],
        },
      ],
    });
  });

  // Strip trailing slashes (301 redirect) to prevent duplicate content
  app.use((req, res, next) => {
    if (req.path !== "/" && req.path.endsWith("/")) {
      const query = req.url.slice(req.path.length);
      res.redirect(301, req.path.slice(0, -1) + query);
    } else {
      next();
    }
  });

  // llms.txt — AI crawler discovery file
  app.get("/llms.txt", (_req, res) => {
    res.type("text/plain").send(
      `# Regen Compute\n` +
      `> Ecological accountability for AI compute — retire verified ecocredits on Regen Network.\n\n` +
      `## What it is\n` +
      `Regen Compute is an MCP (Model Context Protocol) server that connects AI sessions to verified ecological credit retirement. It is not a carbon offset — it funds regenerative projects with permanent, on-chain proof.\n\n` +
      `## Key pages\n` +
      `- Homepage: ${baseUrl}/\n` +
      `- AI Plugin (MCP installation): ${baseUrl}/ai-plugin\n` +
      `- Developers (API reference): ${baseUrl}/developers\n` +
      `- Research (AI emissions methodology): ${baseUrl}/research\n` +
      `- About (team and mission): ${baseUrl}/about\n\n` +
      `## Pricing\n` +
      `- Dabbler: $1.25/month (casual AI users)\n` +
      `- Builder: $2.50/month (regular AI developers)\n` +
      `- Agent: $50/year (AI-native teams and autonomous agents)\n\n` +
      `## Installation\n` +
      `claude mcp add -s user regen-compute -- npx regen-compute\n\n` +
      `## Links\n` +
      `- npm: https://www.npmjs.com/package/regen-compute\n` +
      `- GitHub: https://github.com/regen-network/regen-compute\n` +
      `- Regen Network: https://regen.network\n` +
      `- X/Twitter: https://x.com/Regen_compute\n\n` +
      `## Credit types supported\n` +
      `- Carbon (C) — forest conservation, soil carbon\n` +
      `- Biodiversity (BT) — habitat banks, Terrasos\n` +
      `- Umbrella Species Stewardship (USS) — jaguar credits\n` +
      `- Kilo-Sheep-Hour (KSH) — regenerative grazing\n` +
      `- Marine Biodiversity Stewardship (MBS) — ocean conservation\n`
    );
  });

  // Allow all crawlers but block auth/redirect-only paths
  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").send(
      `User-agent: *\nAllow: /\n\n` +
      `# Auth-gated pages (redirect to login)\n` +
      `Disallow: /dashboard\n` +
      `Disallow: /dashboard/\n` +
      `Disallow: /manage\n\n` +
      `# Legacy redirects\n` +
      `Disallow: /checkout-page\n\n` +
      `# Language alias redirects\n` +
      `Disallow: /is\n` +
      `Disallow: /br\n` +
      `Disallow: /mx\n` +
      `Disallow: /cn\n` +
      `Disallow: /tw\n` +
      `Disallow: /in\n\n` +
      `# Referral short links\n` +
      `Disallow: /r/\n\n` +
      `Sitemap: ${baseUrl}/sitemap.xml\n`
    );
  });

  app.get("/sitemap.xml", (_req, res) => {
    const langs = ["", "es", "pt", "fr", "de", "zh", "ja", "ko", "hi", "ar", "ru", "id", "tr", "vi", "th", "it", "nl", "pl", "ms", "sw", "uk", "ur"];
    const pages = [
      { path: "", lastmod: "2026-04-02" },
      { path: "research", lastmod: "2026-03-15" },
      { path: "about", lastmod: "2026-03-25" },
      { path: "ai-plugin", lastmod: "2026-03-20" },
      { path: "developers", lastmod: "2026-03-26" },
      { path: "badges", lastmod: "2026-03-25" },
    ];
    const entries: string[] = [];
    for (const page of pages) {
      if (page.path === "") {
        for (const lang of langs) {
          entries.push(`  <url><loc>${baseUrl}/${lang}</loc><lastmod>${page.lastmod}</lastmod></url>`);
        }
      } else {
        entries.push(`  <url><loc>${baseUrl}/${page.path}</loc><lastmod>${page.lastmod}</lastmod></url>`);
      }
    }
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>`;
    res.type("application/xml").send(xml);
  });

  // OG image for social media previews
  app.get("/og-card.jpg", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=31536000");
    res.sendFile("og-card.jpg", { root: process.cwd() });
  });
  // Legacy fallbacks
  app.get("/og-preview.jpg", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=31536000");
    res.sendFile("og-card.jpg", { root: process.cwd() });
  });
  app.get("/og-image.png", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=31536000");
    res.sendFile("og-card.jpg", { root: process.cwd() });
  });
  app.get("/og-image.jpg", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=31536000");
    res.sendFile("og-card.jpg", { root: process.cwd() });
  });

  // Project images (optimized, served from public/projects/ directory)
  app.get("/projects/:filename", (req, res) => {
    const filename = req.params.filename.replace(/[^a-zA-Z0-9._-]/g, "");
    if (!filename.match(/\.(png|jpg|jpeg|webp)$/i)) {
      return res.status(404).send("Not found");
    }
    res.setHeader("Cache-Control", "public, max-age=31536000");
    res.sendFile(`public/projects/${filename}`, { root: process.cwd() });
  });

  // Team photos (served from public/team/ directory)
  app.get("/team/:filename", (req, res) => {
    const filename = req.params.filename.replace(/[^a-zA-Z0-9._-]/g, "");
    if (!filename.match(/\.(png|jpg|jpeg|webp)$/i)) {
      return res.status(404).send("Not found");
    }
    res.setHeader("Cache-Control", "public, max-age=31536000");
    res.sendFile(`public/team/${filename}`, { root: process.cwd() });
  });

  // Hero and CTA background images (clean URLs with 1-year cache)
  app.get("/images/hero.webp", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=31536000");
    res.sendFile("public/hero.webp", { root: process.cwd() });
  });
  app.get("/images/cta-bg.webp", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=31536000");
    res.sendFile("public/cta-bg.webp", { root: process.cwd() });
  });

  // General image route (catch-all for /images/:filename, restricted to image extensions)
  app.get("/images/:filename", (req, res) => {
    const filename = req.params.filename.replace(/[^a-zA-Z0-9._-]/g, "");
    if (!filename.match(/\.(webp|png|jpg)$/i)) {
      return res.status(404).send("Not found");
    }
    res.setHeader("Cache-Control", "public, max-age=31536000");
    res.sendFile(`public/${filename}`, { root: process.cwd() });
  });

  // Always init DB and config — display-only pages need them
  const db = getDb(dbPath);
  const config = loadConfig();

  // Stripe setup (optional — display pages work without it)
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (stripeKey && process.env.NODE_ENV === "production" && !process.env.STRIPE_WEBHOOK_SECRET) {
    console.warn("WARNING: STRIPE_WEBHOOK_SECRET not set — webhook signature verification disabled. Set this for production security.");
  }
  const stripe = stripeKey ? new Stripe(stripeKey) : null;

  // Stripe webhooks need raw body for signature verification
  if (stripe) {
    app.use("/webhook", express.raw({ type: "application/json" }));
  }

  // JSON + URL-encoded body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Security headers (relaxed CSP since we use inline scripts extensively)
  app.use(helmet({
    contentSecurityPolicy: false,
  }));

  // Mount routes (landing page, feedback, cancel, checkout-page always work;
  // Stripe-dependent routes like /subscribe, /checkout, /webhook, /success, /manage
  // are conditionally registered inside createRoutes when stripe is non-null)
  const routes = createRoutes(stripe, db, baseUrl, config);
  app.use(routes);

  // Research page (static, no dependencies)
  const researchRoutes = createResearchRoutes(baseUrl);
  app.use(researchRoutes);

  // About page (static, no dependencies)
  const aboutRoutes = createAboutRoutes(baseUrl);
  app.use(aboutRoutes);

  // Developers page (static, no dependencies)
  const developersRoutes = createDevelopersRoutes(baseUrl);
  app.use(developersRoutes);

  // AI Plugin page (static, no dependencies)
  const aiPluginRoutes = createAiPluginRoutes(baseUrl);
  app.use(aiPluginRoutes);

  // Unicorns & Rainbows campaign pages
  const unicornRoutes = createUnicornRoutes(db, baseUrl, config);
  app.use(unicornRoutes);

  const rainbowRoutes = createRainbowRoutes(db, baseUrl, config);
  app.use(rainbowRoutes);

  // Dashboard routes (login page works without Stripe; full dashboard needs DB)
  const dashboardRoutes = createDashboardRoutes(db, baseUrl, config);
  app.use(dashboardRoutes);

  // Badges & seal pack page
  const badgesRoutes = createBadgesRoutes(baseUrl);
  app.use(badgesRoutes);


  if (stripe) {
    // x402 payment protocol middleware (opt-in via X402_ENABLED=true)
    // Must be mounted BEFORE API routes so it can intercept unauthenticated requests
    if (process.env.X402_ENABLED === "true") {
      const x402Middleware = createX402Middleware({ db, baseUrl });
      app.use(x402Middleware);
      console.log("  x402 protocol: enabled (self-settling, no facilitator)");
    }

    // Developer API routes (require Stripe for the full API key system)
    const apiRoutes = createApiRoutes(db, baseUrl, config);
    app.use(apiRoutes);
  }

  // --- Daily crypto renewal reminder check ---
  async function checkCryptoRenewals() {
    const levels: Array<{ level: RenewalLevel; daysAhead: number }> = [
      { level: "30d", daysAhead: 30 },
      { level: "14d", daysAhead: 14 },
      { level: "5d", daysAhead: 5 },
      { level: "expired", daysAhead: 0 },
    ];

    for (const { level, daysAhead } of levels) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + daysAhead);
      const cutoffStr = cutoff.toISOString();

      const subs = getSubscribersNeedingRenewal(db, level, cutoffStr);
      for (const sub of subs) {
        try {
          const isCancelledStripe = !sub.stripe_subscription_id.startsWith("crypto_") && sub.status === "cancelled";
          await sendRenewalReminderEmail(
            sub.email,
            sub.plan,
            sub.current_period_end!,
            level,
            `${baseUrl}/dashboard`,
            isCancelledStripe,
          );
          markRenewalReminderSent(db, sub.id, level);
          console.log(`Sent ${level} renewal reminder to ${sub.email} (sub ${sub.id})`);
        } catch (err) {
          console.error(`Failed to send ${level} renewal reminder to ${sub.email}:`, err);
        }
      }
    }
  }

  // Run once on startup (delayed 30s), then every 24 hours
  setTimeout(() => {
    checkCryptoRenewals().catch(console.error);
  }, 30_000);
  setInterval(() => {
    checkCryptoRenewals().catch(console.error);
  }, 24 * 60 * 60 * 1000);

  // --- Password-protected strategy document ---
  const STRATEGY_PASSWORD = process.env.STRATEGY_PASSWORD ?? "regen";
  app.get("/strategy", (req, res) => {
    if (req.query.p === STRATEGY_PASSWORD) {
      try {
        const html = readFileSync(join(process.cwd(), "regen-compute-strategy.html"), "utf-8");
        res.send(html);
      } catch {
        res.status(404).send("Document not found");
      }
      return;
    }
    res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Strategy — Regen Compute</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
background:linear-gradient(135deg,#0a3d2e 0%,#0d6b52 50%,#0f5a4a 100%);color:#fff}
.box{text-align:center;padding:2rem;max-width:400px}
h2{font-size:1.3rem;font-weight:400;margin-bottom:1.5rem;opacity:0.9}
form{display:flex;gap:8px;justify-content:center}
input{padding:10px 16px;border-radius:8px;border:1px solid rgba(255,255,255,0.25);
background:rgba(255,255,255,0.1);color:#fff;font-size:1rem;outline:none;width:180px}
input::placeholder{color:rgba(255,255,255,0.4)}
input:focus{border-color:rgba(255,255,255,0.5);background:rgba(255,255,255,0.15)}
button{padding:10px 20px;border-radius:8px;border:1px solid rgba(255,255,255,0.25);
background:rgba(255,255,255,0.15);color:#fff;font-size:1rem;cursor:pointer}
button:hover{background:rgba(255,255,255,0.25)}
</style></head><body><div class="box">
<h2>This document is password-protected</h2>
<form method="get" action="/strategy">
<input type="password" name="p" placeholder="Password" autofocus/>
<button type="submit">View</button>
</form></div></body></html>`);
  });

  // --- Convenience redirects for commonly guessed URLs ---
  app.get("/pricing", (_req, res) => res.redirect(301, "/#pricing"));
  app.get("/subscribe", (_req, res) => res.redirect(301, "/#pricing"));

  // --- Custom 404 handler (must be last) ---
  app.use((_req, res) => {
    res.status(404).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Page Not Found — Regen Compute</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      background:linear-gradient(135deg,#0a3d2e 0%,#0d6b52 50%,#0f5a4a 100%);color:#fff}
    .container{text-align:center;padding:2rem;max-width:480px}
    h1{font-size:5rem;font-weight:200;opacity:0.3;margin-bottom:0.5rem}
    h2{font-size:1.5rem;font-weight:400;margin-bottom:1rem}
    p{opacity:0.8;margin-bottom:2rem;line-height:1.6}
    a{display:inline-block;padding:0.75rem 2rem;background:rgba(255,255,255,0.15);
      color:#fff;text-decoration:none;border-radius:8px;border:1px solid rgba(255,255,255,0.25);
      transition:background 0.2s}
    a:hover{background:rgba(255,255,255,0.25)}
  </style>
</head>
<body>
  <div class="container">
    <h1>404</h1>
    <h2>Page not found</h2>
    <p>The page you're looking for doesn't exist. It may have been moved or removed.</p>
    <a href="/">Back to Regen Compute</a>
  </div>
</body>
</html>`);
  });

  app.listen(port, () => {
    console.log(`Regen Compute server running on ${baseUrl}`);
    console.log(`  Certificates: ${baseUrl}/impact/:nodeId`);
    if (stripeKey) {
      console.log(`  Landing page: ${baseUrl}/`);
      console.log(`  Developer API: ${baseUrl}/api/v1/`);
      console.log(`  OpenAPI spec: ${baseUrl}/api/v1/openapi.json`);
      console.log(`  Dashboard: ${baseUrl}/dashboard`);
      console.log(`  Stripe mode: ${stripeKey.startsWith("sk_test_") ? "TEST" : "LIVE"}`);
      console.log(`  Database: ${dbPath}`);
    } else {
      console.log(`  Payment routes: disabled (no STRIPE_SECRET_KEY)`);
    }
  });
}
