/**
 * Regen for AI — Payment & Balance Server
 *
 * A small Express server that handles:
 * - Shareable retirement certificate pages (/impact/:nodeId)
 * - Stripe Checkout for prepaid balance top-ups
 * - Stripe webhooks for payment confirmation
 * - Balance checking and debiting for MCP clients
 *
 * Run: npx regen-for-ai serve [--port 3141]
 *
 * Certificate routes work without Stripe configuration.
 * Payment routes require STRIPE_SECRET_KEY.
 */

import express from "express";
import Stripe from "stripe";
import { getDb } from "./db.js";
import { createRoutes } from "./routes.js";
import { createCertificateRoutes } from "./certificate.js";
import { loadConfig } from "../config.js";

export function startServer(options: { port?: number; dbPath?: string } = {}) {
  const port = options.port ?? parseInt(process.env.REGEN_SERVER_PORT ?? "3141", 10);
  const dbPath = options.dbPath ?? process.env.REGEN_DB_PATH ?? "data/regen-for-ai.db";

  const baseUrl = process.env.REGEN_SERVER_URL ?? `http://localhost:${port}`;

  const app = express();

  // Certificate routes — no Stripe dependency, mount first
  const certificateRoutes = createCertificateRoutes(baseUrl);
  app.use(certificateRoutes);

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", version: "0.3.0" });
  });

  // Payment routes — require Stripe
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (stripeKey) {
    const stripe = new Stripe(stripeKey);
    const db = getDb(dbPath);

    // Stripe webhooks need raw body for signature verification
    app.use("/webhook", express.raw({ type: "application/json" }));

    // Everything else uses JSON
    app.use(express.json());

    // Mount payment routes
    const config = loadConfig();
    const routes = createRoutes(stripe, db, baseUrl, config);
    app.use(routes);
  }

  app.listen(port, () => {
    console.log(`Regen for AI server running on ${baseUrl}`);
    console.log(`  Certificates: ${baseUrl}/impact/:nodeId`);
    if (stripeKey) {
      console.log(`  Checkout page: ${baseUrl}/checkout-page`);
      console.log(`  Landing page: ${baseUrl}/`);
      console.log(`  Stripe mode: ${stripeKey.startsWith("sk_test_") ? "TEST" : "LIVE"}`);
      console.log(`  Database: ${dbPath}`);
    } else {
      console.log(`  Payment routes: disabled (no STRIPE_SECRET_KEY)`);
    }
  });
}
