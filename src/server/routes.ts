/**
 * Express routes for the Regen for AI payment service.
 *
 * GET  /                  — Subscription landing page with live stats
 * POST /checkout          — Create a Stripe Checkout session
 * POST /webhook           — Handle Stripe webhook events
 * GET  /balance           — Check prepaid balance (API key in header)
 * POST /debit             — Debit balance after retirement (API key in header)
 * GET  /transactions      — Transaction history (API key in header)
 */

import { Router, Request, Response } from "express";
import Stripe from "stripe";
import type Database from "better-sqlite3";
import type { Config } from "../config.js";
import { getNetworkStats, type NetworkStats } from "../services/indexer.js";
import {
  getUserByApiKey,
  getUserByEmail,
  createUser,
  creditBalance,
  debitBalance,
  getTransactions,
  getSubscriberByStripeId,
  createSubscriber,
  updateSubscriber,
  updateSubscriberStatus,
} from "./db.js";

// 5-minute in-memory cache for network stats
let statsCache: { data: NetworkStats; fetchedAt: number } | null = null;
const STATS_CACHE_TTL = 300_000;

async function getCachedStats(): Promise<NetworkStats | null> {
  if (statsCache && Date.now() - statsCache.fetchedAt < STATS_CACHE_TTL) {
    return statsCache.data;
  }
  try {
    const data = await getNetworkStats();
    statsCache = { data, fetchedAt: Date.now() };
    return data;
  } catch {
    return statsCache?.data ?? null;
  }
}

export function createRoutes(stripe: Stripe, db: Database.Database, baseUrl: string, config?: Config): Router {
  const router = Router();

  // --- Public routes ---

  /**
   * GET /
   * Subscription landing page with live impact stats.
   */
  router.get("/", async (_req: Request, res: Response) => {
    const seedlingUrl = config?.stripePaymentLinkSeedling ?? process.env.STRIPE_PAYMENT_LINK_SEEDLING ?? "#";
    const groveUrl = config?.stripePaymentLinkGrove ?? process.env.STRIPE_PAYMENT_LINK_GROVE ?? "#";
    const forestUrl = config?.stripePaymentLinkForest ?? process.env.STRIPE_PAYMENT_LINK_FOREST ?? "#";

    const stats = await getCachedStats();
    const totalRetirements = stats ? stats.totalRetirements.toLocaleString() : "--";
    const totalOrders = stats ? stats.totalOrders.toLocaleString() : "--";

    res.setHeader("Content-Type", "text/html");
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Regen for AI — Regenerative AI</title>
  <meta name="description" content="Fund verified ecological regeneration from your AI sessions. Monthly subscriptions retire real carbon and biodiversity credits on Regen Network.">
  <meta property="og:title" content="Regen for AI — Regenerative AI">
  <meta property="og:description" content="Fund verified ecological regeneration from your AI sessions. Monthly subscriptions retire real carbon and biodiversity credits on Regen Network.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${baseUrl}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Regen for AI — Regenerative AI">
  <meta name="twitter:description" content="Fund verified ecological regeneration from your AI sessions.">
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, system-ui, 'Segoe UI', sans-serif;
      margin: 0; padding: 0;
      color: #1a1a1a; line-height: 1.6;
      background: #fff;
    }
    .container { max-width: 900px; margin: 0 auto; padding: 0 24px; }

    /* Hero */
    .hero {
      padding: 80px 0 60px;
      text-align: center;
    }
    .hero-label {
      display: inline-block;
      font-size: 13px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;
      color: #2d6a4f; background: #f0f7f4;
      padding: 4px 12px; border-radius: 20px; margin-bottom: 16px;
    }
    .hero h1 {
      font-size: 42px; font-weight: 700; color: #1a1a1a;
      margin: 0 0 16px; line-height: 1.15;
    }
    .hero h1 span { color: #2d6a4f; }
    .hero p {
      font-size: 18px; color: #555; max-width: 600px; margin: 0 auto 32px;
    }
    .cta-btn {
      display: inline-block; padding: 14px 32px;
      background: #2d6a4f; color: #fff;
      font-size: 16px; font-weight: 600;
      border-radius: 8px; text-decoration: none;
      transition: background 0.2s;
    }
    .cta-btn:hover { background: #1b4332; }

    /* How it works */
    .how-it-works {
      padding: 60px 0;
      border-top: 1px solid #e8e8e8;
    }
    .section-title {
      text-align: center; font-size: 28px; font-weight: 700;
      margin: 0 0 40px; color: #1a1a1a;
    }
    .steps {
      display: flex; gap: 24px; flex-wrap: wrap;
      justify-content: center;
    }
    .step {
      flex: 1 1 180px; max-width: 200px;
      text-align: center; padding: 0 8px;
    }
    .step-num {
      width: 40px; height: 40px; line-height: 40px;
      border-radius: 50%; background: #2d6a4f; color: #fff;
      font-size: 18px; font-weight: 700;
      margin: 0 auto 12px;
    }
    .step h3 { font-size: 16px; margin: 0 0 6px; color: #1a1a1a; }
    .step p { font-size: 13px; color: #666; margin: 0; }
    .step code {
      font-size: 11px; background: #f4f4f4; padding: 2px 5px;
      border-radius: 3px; word-break: break-all;
    }

    /* Pricing */
    .pricing {
      padding: 60px 0;
      background: #fafcfb;
      border-top: 1px solid #e8e8e8;
    }
    .tiers {
      display: flex; gap: 20px; flex-wrap: wrap;
      justify-content: center;
    }
    .tier {
      flex: 1 1 240px; max-width: 280px;
      background: #fff; border: 2px solid #e0e0e0; border-radius: 12px;
      padding: 32px 24px; text-align: center;
      text-decoration: none; color: #1a1a1a;
      transition: border-color 0.2s, box-shadow 0.2s;
      display: flex; flex-direction: column;
    }
    .tier:hover {
      border-color: #2d6a4f;
      box-shadow: 0 4px 20px rgba(45, 106, 79, 0.1);
    }
    .tier.featured {
      border-color: #2d6a4f;
      position: relative;
    }
    .tier-badge {
      position: absolute; top: -12px; left: 50%; transform: translateX(-50%);
      background: #2d6a4f; color: #fff;
      font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
      padding: 4px 14px; border-radius: 20px; white-space: nowrap;
    }
    .tier-name { font-size: 20px; font-weight: 700; color: #2d6a4f; margin-bottom: 4px; }
    .tier-price { font-size: 36px; font-weight: 700; margin: 8px 0 4px; }
    .tier-price span { font-size: 16px; font-weight: 400; color: #888; }
    .tier-desc {
      font-size: 14px; color: #666; margin: 12px 0 20px;
      flex-grow: 1;
    }
    .tier-btn {
      display: block; padding: 12px 0;
      background: #2d6a4f; color: #fff;
      font-size: 15px; font-weight: 600;
      border-radius: 8px; text-decoration: none;
      transition: background 0.2s;
    }
    .tier-btn:hover { background: #1b4332; }

    /* Stats */
    .stats {
      padding: 48px 0;
      border-top: 1px solid #e8e8e8;
    }
    .stats-bar {
      display: flex; gap: 40px; flex-wrap: wrap;
      justify-content: center; text-align: center;
    }
    .stat-item {}
    .stat-num {
      font-size: 36px; font-weight: 700; color: #2d6a4f;
      line-height: 1.1;
    }
    .stat-label { font-size: 14px; color: #888; margin-top: 4px; }

    /* Trust */
    .trust {
      padding: 60px 0;
      border-top: 1px solid #e8e8e8;
    }
    .trust-grid {
      display: flex; gap: 32px; flex-wrap: wrap;
      justify-content: center;
    }
    .trust-item {
      flex: 1 1 220px; max-width: 260px;
    }
    .trust-item h3 { font-size: 16px; margin: 0 0 6px; color: #2d6a4f; }
    .trust-item p { font-size: 14px; color: #666; margin: 0; }

    /* Footer */
    .footer {
      padding: 48px 0;
      text-align: center;
      border-top: 1px solid #e8e8e8;
    }
    .footer p { font-size: 14px; color: #888; margin: 12px 0; }
    .footer a { color: #2d6a4f; text-decoration: none; }
    .footer a:hover { text-decoration: underline; }

    /* Mobile */
    @media (max-width: 700px) {
      .hero { padding: 48px 0 40px; }
      .hero h1 { font-size: 28px; }
      .hero p { font-size: 16px; }
      .step { flex: 1 1 140px; }
      .tier { flex: 1 1 100%; max-width: 100%; }
      .stats-bar { gap: 24px; }
      .stat-num { font-size: 28px; }
      .trust-item { flex: 1 1 100%; max-width: 100%; }
    }
  </style>
</head>
<body>

  <!-- Hero -->
  <section class="hero">
    <div class="container">
      <div class="hero-label">Regenerative AI</div>
      <h1>Fund <span>Ecological Regeneration</span> from Your AI Sessions</h1>
      <p>Regenerative contribution, not carbon offset. Monthly subscriptions retire verified carbon and biodiversity credits on Regen Network.</p>
      <a class="cta-btn" href="#pricing">Choose Your Plan</a>
    </div>
  </section>

  <!-- How it works -->
  <section class="how-it-works">
    <div class="container">
      <h2 class="section-title">How It Works</h2>
      <div class="steps">
        <div class="step">
          <div class="step-num">1</div>
          <h3>Install</h3>
          <p>One command:<br><code>claude mcp add regen-for-ai</code></p>
        </div>
        <div class="step">
          <div class="step-num">2</div>
          <h3>Estimate</h3>
          <p>AI estimates your session's ecological footprint</p>
        </div>
        <div class="step">
          <div class="step-num">3</div>
          <h3>Subscribe</h3>
          <p>Pick a monthly tier that funds ongoing regeneration</p>
        </div>
        <div class="step">
          <div class="step-num">4</div>
          <h3>Retire</h3>
          <p>Credits retired on-chain monthly with verifiable proof</p>
        </div>
      </div>
    </div>
  </section>

  <!-- Pricing -->
  <section class="pricing" id="pricing">
    <div class="container">
      <h2 class="section-title">Choose Your Plan</h2>
      <div class="tiers">
        <div class="tier">
          <div class="tier-name">Seedling</div>
          <div class="tier-price">$2<span>/mo</span></div>
          <div class="tier-desc">~0.5 carbon credits retired per month. Perfect for individual developers.</div>
          <a class="tier-btn" href="${seedlingUrl}">Subscribe</a>
        </div>
        <div class="tier featured">
          <div class="tier-badge">Most Popular</div>
          <div class="tier-name">Grove</div>
          <div class="tier-price">$5<span>/mo</span></div>
          <div class="tier-desc">~1 carbon credit + 0.5 biodiversity credits per month. The sweet spot.</div>
          <a class="tier-btn" href="${groveUrl}">Subscribe</a>
        </div>
        <div class="tier">
          <div class="tier-name">Forest</div>
          <div class="tier-price">$10<span>/mo</span></div>
          <div class="tier-desc">~2.5 carbon credits + 1 biodiversity credit per month. For teams and power users.</div>
          <a class="tier-btn" href="${forestUrl}">Subscribe</a>
        </div>
      </div>
    </div>
  </section>

  <!-- Live Stats -->
  <section class="stats">
    <div class="container">
      <h2 class="section-title">Live from Regen Network</h2>
      <div class="stats-bar">
        <div class="stat-item">
          <div class="stat-num">${totalRetirements}</div>
          <div class="stat-label">Total Retirements</div>
        </div>
        <div class="stat-item">
          <div class="stat-num">${totalOrders}</div>
          <div class="stat-label">Marketplace Orders</div>
        </div>
        <div class="stat-item">
          <div class="stat-num">5</div>
          <div class="stat-label">Credit Types</div>
        </div>
      </div>
    </div>
  </section>

  <!-- Trust -->
  <section class="trust">
    <div class="container">
      <h2 class="section-title">Why Regen for AI</h2>
      <div class="trust-grid">
        <div class="trust-item">
          <h3>Verified On-Chain</h3>
          <p>Every retirement is recorded immutably on Regen Ledger. No double-counting, no greenwashing.</p>
        </div>
        <div class="trust-item">
          <h3>Not Carbon Offset</h3>
          <p>Regenerative contribution funds real ecological projects — carbon, biodiversity, and beyond.</p>
        </div>
        <div class="trust-item">
          <h3>Open Source</h3>
          <p>Full transparency. Inspect the MCP server, verify the retirements, audit the code yourself.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- Footer -->
  <section class="footer">
    <div class="container">
      <a class="cta-btn" href="#pricing">Choose Your Plan</a>
      <p>Powered by <a href="https://regen.network">Regen Network</a></p>
      <p><a href="https://github.com/CShear/regen-for-ai">GitHub</a></p>
    </div>
  </section>

</body>
</html>`);
  });

  /**
   * POST /checkout
   * Body: { amount_cents: 1000, email?: "user@example.com" }
   * Returns: { url: "https://checkout.stripe.com/..." }
   */
  router.post("/checkout", async (req: Request, res: Response) => {
    try {
      const { amount_cents, email } = req.body;

      if (!amount_cents || typeof amount_cents !== "number" || amount_cents < 100) {
        res.status(400).json({ error: "amount_cents must be at least 100 ($1.00)" });
        return;
      }

      const amountDollars = (amount_cents / 100).toFixed(2);

      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: amount_cents,
              product_data: {
                name: "Regen for AI — Ecological Credit Balance",
                description: `$${amountDollars} prepaid balance for retiring verified ecocredits via your AI assistant`,
              },
            },
            quantity: 1,
          },
        ],
        success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/cancel`,
        ...(email ? { customer_email: email } : {}),
      };

      const session = await stripe.checkout.sessions.create(sessionParams);
      res.json({ url: session.url });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Checkout error:", msg);
      res.status(500).json({ error: msg });
    }
  });

  /**
   * POST /webhook
   * Stripe webhook handler — processes checkout.session.completed events.
   * Creates user if new, credits their balance, generates API key.
   */
  router.post("/webhook", async (req: Request, res: Response) => {
    const sig = req.headers["stripe-signature"] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event: Stripe.Event;

    if (webhookSecret && sig) {
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("Webhook signature verification failed:", msg);
        res.status(400).json({ error: `Webhook Error: ${msg}` });
        return;
      }
    } else {
      // In test mode without webhook secret, parse the raw body
      const body = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : req.body;
      event = (typeof body === "string" ? JSON.parse(body) : body) as Stripe.Event;
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const amountCents = session.amount_total ?? 0;
      const email = session.customer_email ?? session.customer_details?.email ?? null;
      const stripeCustomerId = typeof session.customer === "string" ? session.customer : null;

      // Find or create user
      let user = email ? getUserByEmail(db, email) : undefined;
      if (!user) {
        user = createUser(db, email, stripeCustomerId);
        console.log(`New user created: ${user.api_key} (${email})`);
      }

      // Credit balance
      creditBalance(
        db,
        user.id,
        amountCents,
        session.id,
        `Stripe top-up: $${(amountCents / 100).toFixed(2)}`
      );

      console.log(
        `Balance credited: user=${user.id} amount=$${(amountCents / 100).toFixed(2)} balance=$${((user.balance_cents + amountCents) / 100).toFixed(2)}`
      );
    } else if (event.type === "customer.subscription.created") {
      const sub = event.data.object as Stripe.Subscription;
      handleSubscriptionCreated(db, sub, stripe);
    } else if (event.type === "customer.subscription.updated") {
      const sub = event.data.object as Stripe.Subscription;
      handleSubscriptionUpdated(db, sub);
    } else if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      handleSubscriptionDeleted(db, sub);
    }

    res.json({ received: true });
  });

  /**
   * GET /success?session_id=cs_xxx
   * Success page after Stripe Checkout — shows API key and install instructions.
   */
  router.get("/success", async (req: Request, res: Response) => {
    try {
      const sessionId = req.query.session_id as string;
      if (!sessionId) {
        res.status(400).send("Missing session_id");
        return;
      }

      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const email = session.customer_email ?? session.customer_details?.email ?? null;

      if (!email) {
        res.status(400).send("No email found for this session");
        return;
      }

      const user = getUserByEmail(db, email);
      if (!user) {
        res.status(404).send("User not found — webhook may not have processed yet. Refresh in a few seconds.");
        return;
      }

      const amountDollars = (session.amount_total ?? 0) / 100;

      res.setHeader("Content-Type", "text/html");
      res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Regen for AI — Payment Successful</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 640px; margin: 60px auto; padding: 0 20px; color: #1a1a1a; line-height: 1.6; }
    h1 { color: #2d6a4f; }
    .key-box { background: #f0f7f4; border: 2px solid #2d6a4f; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .api-key { font-family: monospace; font-size: 14px; background: #fff; border: 1px solid #ccc; padding: 8px 12px; border-radius: 4px; word-break: break-all; display: block; margin: 8px 0; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-size: 13px; }
    pre { background: #1a1a1a; color: #e0e0e0; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 13px; }
    .balance { font-size: 24px; font-weight: bold; color: #2d6a4f; }
  </style>
</head>
<body>
  <h1>Payment Successful</h1>
  <p>You've added <strong>$${amountDollars.toFixed(2)}</strong> to your Regen for AI balance.</p>
  <p>Current balance: <span class="balance">$${(user.balance_cents / 100).toFixed(2)}</span></p>

  <div class="key-box">
    <strong>Your API Key</strong>
    <span class="api-key">${user.api_key}</span>
    <p><strong>Save this key!</strong> You'll need it to connect your AI assistant.</p>
  </div>

  <h2>Setup (30 seconds)</h2>

  <p><strong>1. Install the MCP server</strong> (if you haven't already):</p>
  <pre>claude mcp add -s user regen-for-ai -- npx regen-for-ai</pre>

  <p><strong>2. Set your API key</strong> — add to your shell profile or <code>.env</code>:</p>
  <pre>export REGEN_API_KEY=${user.api_key}
export REGEN_BALANCE_URL=${baseUrl}</pre>

  <p><strong>3. Done!</strong> In Claude Code, just say "retire 1 carbon credit" and it'll happen automatically from your prepaid balance.</p>

  <h2>What happens next</h2>
  <ul>
    <li>Your AI assistant checks your balance before each retirement</li>
    <li>Credits are retired on-chain on Regen Network with verifiable proof</li>
    <li>When your balance gets low, you'll be prompted to top up</li>
  </ul>

  <p><a href="${baseUrl}/checkout-page">Top up again</a></p>
</body>
</html>`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Success page error:", msg);
      res.status(500).send("Error loading success page. Your payment was received — check back shortly.");
    }
  });

  /**
   * GET /cancel
   * Cancelled checkout — redirect or show message.
   */
  router.get("/cancel", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/html");
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Regen for AI — Checkout Cancelled</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 640px; margin: 60px auto; padding: 0 20px; color: #1a1a1a; }
    h1 { color: #666; }
  </style>
</head>
<body>
  <h1>Checkout Cancelled</h1>
  <p>No payment was processed. <a href="/checkout-page">Try again</a> when you're ready.</p>
</body>
</html>`);
  });

  /**
   * GET /checkout-page
   * Landing page with Payment Link tiers.
   * Payment Links are configured via STRIPE_PAYMENT_LINK_* env vars.
   */
  router.get("/checkout-page", (_req: Request, res: Response) => {
    const seedlingUrl = config?.stripePaymentLinkSeedling ?? process.env.STRIPE_PAYMENT_LINK_SEEDLING ?? "#";
    const groveUrl = config?.stripePaymentLinkGrove ?? process.env.STRIPE_PAYMENT_LINK_GROVE ?? "#";
    const forestUrl = config?.stripePaymentLinkForest ?? process.env.STRIPE_PAYMENT_LINK_FOREST ?? "#";

    res.setHeader("Content-Type", "text/html");
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Regen for AI — Fund Ecological Regeneration</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; max-width: 640px; margin: 60px auto; padding: 0 20px; color: #1a1a1a; line-height: 1.6; }
    h1 { color: #2d6a4f; }
    .tiers { display: flex; gap: 16px; margin: 24px 0; }
    .tier { flex: 1; border: 2px solid #ddd; border-radius: 12px; padding: 20px; text-align: center; text-decoration: none; color: #1a1a1a; transition: border-color 0.2s, background 0.2s; display: block; }
    .tier:hover { border-color: #2d6a4f; background: #f0f7f4; }
    .tier-name { font-weight: bold; font-size: 18px; color: #2d6a4f; }
    .tier-price { font-size: 28px; font-weight: bold; margin: 8px 0; }
    .tier-desc { font-size: 13px; color: #666; }
    .info { background: #f0f7f4; border-left: 4px solid #2d6a4f; padding: 12px 16px; margin: 20px 0; }
    .steps { margin: 24px 0; }
    .steps li { margin-bottom: 8px; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-size: 13px; }
  </style>
</head>
<body>
  <h1>Regen for AI</h1>
  <p>Fund verified ecological regeneration from your AI sessions. Pay once, retire credits seamlessly from Claude Code.</p>

  <div class="info">
    <strong>How it works:</strong> Pick a tier below, pay with your card, and you'll get an API key. Your AI assistant will use your prepaid balance to retire ecocredits on-chain — no need to leave your coding session.
  </div>

  <div class="tiers">
    <a class="tier" href="${seedlingUrl}">
      <div class="tier-name">Seedling</div>
      <div class="tier-price">$5</div>
      <div class="tier-desc">~1 carbon credit<br>~125 sessions</div>
    </a>
    <a class="tier" href="${groveUrl}">
      <div class="tier-name">Grove</div>
      <div class="tier-price">$10</div>
      <div class="tier-desc">~2.5 carbon credits<br>~250 sessions</div>
    </a>
    <a class="tier" href="${forestUrl}">
      <div class="tier-name">Forest</div>
      <div class="tier-price">$25</div>
      <div class="tier-desc">~6 carbon credits<br>~625 sessions</div>
    </a>
  </div>

  <h2>After payment</h2>
  <ol class="steps">
    <li>You'll receive an API key on the confirmation page</li>
    <li>Install the MCP: <code>claude mcp add -s user regen-for-ai -- npx regen-for-ai</code></li>
    <li>Set your key: <code>export REGEN_API_KEY=your_key</code> and <code>export REGEN_BALANCE_URL=${baseUrl}</code></li>
    <li>In Claude, say "retire 1 carbon credit" — it happens automatically from your balance</li>
  </ol>
</body>
</html>`);
  });

  // --- Authenticated routes (API key in header) ---

  /**
   * GET /balance
   * Header: Authorization: Bearer rfa_xxx
   * Returns: { balance_cents, balance_dollars, email }
   */
  router.get("/balance", (req: Request, res: Response) => {
    const user = authenticateRequest(req, res, db);
    if (!user) return;

    res.json({
      balance_cents: user.balance_cents,
      balance_dollars: (user.balance_cents / 100).toFixed(2),
      email: user.email,
      topup_url: `${baseUrl}/checkout-page`,
    });
  });

  /**
   * POST /debit
   * Header: Authorization: Bearer rfa_xxx
   * Body: { amount_cents, description, retirement_tx_hash?, credit_class?, credits_retired? }
   * Returns: { success, balance_cents, balance_dollars }
   */
  router.post("/debit", (req: Request, res: Response) => {
    const user = authenticateRequest(req, res, db);
    if (!user) return;

    const { amount_cents, description, retirement_tx_hash, credit_class, credits_retired } = req.body;

    if (!amount_cents || typeof amount_cents !== "number" || amount_cents <= 0) {
      res.status(400).json({ error: "amount_cents must be a positive number" });
      return;
    }

    const result = debitBalance(
      db,
      user.id,
      amount_cents,
      description ?? "Credit retirement",
      retirement_tx_hash,
      credit_class,
      credits_retired
    );

    if (!result.success) {
      res.status(402).json({
        error: "Insufficient balance",
        balance_cents: result.balance_cents,
        balance_dollars: (result.balance_cents / 100).toFixed(2),
        topup_url: `${baseUrl}/checkout-page`,
      });
      return;
    }

    res.json({
      success: true,
      balance_cents: result.balance_cents,
      balance_dollars: (result.balance_cents / 100).toFixed(2),
    });
  });

  /**
   * GET /transactions
   * Header: Authorization: Bearer rfa_xxx
   * Returns: { transactions: [...] }
   */
  router.get("/transactions", (req: Request, res: Response) => {
    const user = authenticateRequest(req, res, db);
    if (!user) return;

    const txns = getTransactions(db, user.id);
    res.json({
      transactions: txns.map((t) => ({
        ...t,
        amount_dollars: (t.amount_cents / 100).toFixed(2),
      })),
    });
  });

  return router;
}

/** Extract and validate API key from Authorization header */
function authenticateRequest(req: Request, res: Response, db: Database.Database) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing Authorization header. Use: Bearer <api_key>" });
    return null;
  }

  const apiKey = auth.slice(7).trim();
  const user = getUserByApiKey(db, apiKey);
  if (!user) {
    res.status(401).json({ error: "Invalid API key" });
    return null;
  }

  return user;
}

/** Map Stripe subscription amount to plan name */
function amountToPlan(amountCents: number): "seedling" | "grove" | "forest" {
  if (amountCents <= 200) return "seedling";
  if (amountCents <= 500) return "grove";
  return "forest";
}

/** Map Stripe subscription status to our subscriber status */
function stripeStatusToLocal(status: string): "active" | "paused" | "cancelled" {
  if (status === "active" || status === "trialing") return "active";
  if (status === "paused") return "paused";
  return "cancelled";
}

async function handleSubscriptionCreated(db: Database.Database, sub: Stripe.Subscription, stripe: Stripe) {
  try {
    const stripeSubId = sub.id;
    const existing = getSubscriberByStripeId(db, stripeSubId);
    if (existing) return; // Already processed

    // Get customer email to find/create user
    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
    let email: string | null = null;
    if (customerId) {
      try {
        const customer = await stripe.customers.retrieve(customerId);
        if (customer && !customer.deleted) {
          email = (customer as Stripe.Customer).email;
        }
      } catch { /* ignore */ }
    }

    let user = email ? getUserByEmail(db, email) : undefined;
    if (!user) {
      user = createUser(db, email, customerId ?? null);
      console.log(`New user created for subscription: ${user.api_key} (${email})`);
    }

    const amountCents = sub.items?.data?.[0]?.price?.unit_amount ?? 0;
    const plan = amountToPlan(amountCents);
    const periodStart = (sub as unknown as Record<string, unknown>).current_period_start
      ? new Date(((sub as unknown as Record<string, unknown>).current_period_start as number) * 1000).toISOString()
      : undefined;
    const periodEnd = (sub as unknown as Record<string, unknown>).current_period_end
      ? new Date(((sub as unknown as Record<string, unknown>).current_period_end as number) * 1000).toISOString()
      : undefined;

    createSubscriber(db, user.id, stripeSubId, plan, amountCents, periodStart, periodEnd);
    console.log(`Subscription created: ${stripeSubId} plan=${plan} amount=$${(amountCents / 100).toFixed(2)}`);
  } catch (err) {
    console.error("Error handling subscription.created:", err instanceof Error ? err.message : err);
  }
}

function handleSubscriptionUpdated(db: Database.Database, sub: Stripe.Subscription) {
  try {
    const stripeSubId = sub.id;
    const existing = getSubscriberByStripeId(db, stripeSubId);
    if (!existing) return; // Not tracked

    const amountCents = sub.items?.data?.[0]?.price?.unit_amount ?? existing.amount_cents;
    const plan = amountToPlan(amountCents);
    const status = stripeStatusToLocal(sub.status);
    const periodStart = (sub as unknown as Record<string, unknown>).current_period_start
      ? new Date(((sub as unknown as Record<string, unknown>).current_period_start as number) * 1000).toISOString()
      : undefined;
    const periodEnd = (sub as unknown as Record<string, unknown>).current_period_end
      ? new Date(((sub as unknown as Record<string, unknown>).current_period_end as number) * 1000).toISOString()
      : undefined;

    updateSubscriber(db, stripeSubId, {
      plan,
      amount_cents: amountCents,
      status,
      current_period_start: periodStart,
      current_period_end: periodEnd,
    });
    console.log(`Subscription updated: ${stripeSubId} plan=${plan} status=${status}`);
  } catch (err) {
    console.error("Error handling subscription.updated:", err instanceof Error ? err.message : err);
  }
}

function handleSubscriptionDeleted(db: Database.Database, sub: Stripe.Subscription) {
  try {
    const stripeSubId = sub.id;
    updateSubscriberStatus(db, stripeSubId, "cancelled");
    console.log(`Subscription cancelled: ${stripeSubId}`);
  } catch (err) {
    console.error("Error handling subscription.deleted:", err instanceof Error ? err.message : err);
  }
}
