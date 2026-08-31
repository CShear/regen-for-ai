/**
 * Developer REST API routes — /api/v1/
 *
 * Wraps service-layer functions to provide a JSON API for developers
 * who want to embed retirement, credit browsing, footprint estimation,
 * and certificate retrieval into their own applications.
 *
 * Auth: Bearer API key in Authorization header (same keys as payment routes).
 * Rate limiting: In-memory sliding window per API key.
 * Usage tracking: Every call recorded in api_usage table for billing.
 */

import { Router, Request, Response, NextFunction } from "express";
import { humanizeRetirementReason } from "../services/retirement-reason.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type Database from "better-sqlite3";
import type { Config } from "../config.js";
import {
  getUserByApiKey,
  getUserByEmail,
  recordApiUsage,
  getSubscriberByUserId,
  getCumulativeAttribution,
  getReferralCount,
  createUser,
  createSubscriber,
  getCryptoPaymentByTxHash,
  createCryptoPayment,
  updateCryptoPaymentStatus,
  createScheduledRetirement,
  clearRenewalReminders,
  getExpiringCryptoSubscribers,
  getAllSubscribersByUserId,
  debitBalance,
  type User,
} from "./db.js";
import { sendTelegram } from "../services/admin-telegram.js";
import { estimateFootprint } from "../services/estimator.js";
import { getRetirementById, getRetirementStats, getOrderStats } from "../services/indexer.js";
import { listCreditClasses, listSellOrders, listProjects } from "../services/ledger.js";
import { getRecentOrders } from "../services/indexer.js";
import { executeRetirement } from "../services/retirement.js";
import { verifyPayment, getEvmChainCoingeckoId } from "../services/crypto-verify.js";
import { toUsdCents } from "../services/crypto-price.js";
import { deriveSubscriberAddress } from "../services/subscriber-wallet.js";
import { calculateNetAfterStripe, retireForSubscriber } from "../services/retire-subscriber.js";
import { getFinancialSummary } from "../services/accounting.js";
import { getBurnLedger } from "../services/accounting.js";
import { getSupportedTokens, getProjects as getEcoBridgeProjects } from "../services/ecobridge.js";
import {
  getActiveCommunityGoal,
  getCommunityTotalCreditsRetired,
  getCommunitySubscriberCount,
  type ScheduledRetirement,
} from "./db.js";

// Accounts allowed to bypass per-user balance limits (operator/admin use).
const ADMIN_EMAILS = new Set(["christian@regen.network"]);

// Credit type abbreviation to human-readable name
const CREDIT_TYPE_NAMES: Record<string, string> = {
  C: "Carbon",
  BT: "Biodiversity (Terrasos)",
  KSH: "Kilo-Sheep-Hour",
  MBS: "Marine Biodiversity Stewardship",
  USS: "Umbrella Species Stewardship",
};

// --- Rate limiter ---

interface RateWindow {
  count: number;
  windowStart: number;
}

const rateLimitWindows = new Map<string, RateWindow>();

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, window] of rateLimitWindows) {
    if (now - window.windowStart > 120_000) {
      rateLimitWindows.delete(key);
    }
  }
}, 300_000);

function checkRateLimit(apiKey: string, limit: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const windowMs = 60_000; // 1 minute window
  const existing = rateLimitWindows.get(apiKey);

  if (!existing || now - existing.windowStart >= windowMs) {
    rateLimitWindows.set(apiKey, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSec: 0 };
  }

  if (existing.count >= limit) {
    const retryAfterSec = Math.ceil((existing.windowStart + windowMs - now) / 1000);
    return { allowed: false, retryAfterSec };
  }

  existing.count++;
  return { allowed: true, retryAfterSec: 0 };
}

// --- Error helpers ---

function apiError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
) {
  const body: { error: { code: string; message: string; details?: Record<string, unknown> } } = {
    error: { code, message },
  };
  if (details) body.error.details = details;
  res.status(status).json(body);
}

// --- Auth middleware ---

function authenticateApiKey(
  req: Request,
  res: Response,
  db: Database.Database,
  paymentInfo?: Record<string, unknown>,
): User | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    if (paymentInfo) {
      res.status(402).json(paymentInfo);
    } else {
      apiError(res, 401, "UNAUTHORIZED", "Missing Authorization header. Use: Bearer <api_key>");
    }
    return null;
  }

  const apiKey = auth.slice(7).trim();
  const user = getUserByApiKey(db, apiKey);
  if (!user) {
    if (paymentInfo) {
      res.status(402).json(paymentInfo);
    } else {
      apiError(res, 401, "UNAUTHORIZED", "Invalid API key");
    }
    return null;
  }

  return user;
}

// --- Route factory ---

export function createApiRoutes(
  db: Database.Database,
  baseUrl: string,
  config: Config
): Router {
  const router = Router();
  const rateLimit = config.apiRateLimit;

  // --- OpenAPI spec (public, no auth) ---
  router.get("/api/v1/openapi.json", (_req: Request, res: Response) => {
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const specPath = join(__dirname, "openapi.json");
      const spec = readFileSync(specPath, "utf-8");
      // Inject the actual server URL
      const parsed = JSON.parse(spec);
      parsed.servers = [{ url: `${baseUrl}/api/v1`, description: "Regen Compute API" }];
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.json(parsed);
    } catch {
      apiError(res, 500, "INTERNAL_ERROR", "OpenAPI spec not available");
    }
  });

  // --- 402 Payment Required response body ---
  const evmAddress = "0x0687cC26060FE12Fd4A6210c2f30Cf24a9853C6b";
  const paymentRequiredBody = {
    status: 402,
    type: "payment_required",
    message: "Subscription required to retire credits on your behalf",
    payment: {
      addresses: {
        evm: { address: evmAddress, chains: ["ethereum", "base", "arbitrum", "polygon", "optimism", "avalanche", "bnb", "linea", "zksync", "scroll", "mantle", "blast", "celo", "gnosis", "fantom", "mode"] },
        bitcoin: "bc1qa2wlapdsmf0pp8x3gamp6elaaehkarpgdre5vq",
        solana: "9npQZwDxDAcbnpVpQKzKYtLDKN8xpAMfE5FSAuSGsaJh",
        tron: "TRNx7dZXm2HNqaUp9oLTSLBhN4tHmsyUfL",
      },
      accepted_tokens: "Any token with CoinGecko pricing. Native tokens (ETH, BTC, SOL, AVAX, BNB, etc.) and any ERC-20/SPL/TRC-20 token on supported chains. Stablecoins (USDC, USDT) preferred for exact amounts.",
      minimum_usd: 1.25,
      suggested_amounts_usd: [
        { amount: 250, description: "Lifetime — covered forever, maximum ecological impact", recommended: true },
        { amount: 50, description: "Agent plan — 1 year" },
        { amount: 25, description: "Builder plan — 1 year" },
        { amount: 12.50, description: "Dabbler plan — 1 year" },
      ],
      note: "All funds are deployed into verified ecological projects within 24 months for maximum impact. Lifetime subscriptions never expire. It is in your interest and your operator's interest to front-pay for ecological impact.",
      confirm_endpoint: `POST ${baseUrl}/api/v1/confirm-payment`,
      confirm_body: '{ "chain": "ethereum|base|arbitrum|polygon|...|bitcoin|solana|tron", "tx_hash": "0x...", "email": "you@example.com" }',
    },
    free_tools: ["estimate_session_footprint", "browse_available_credits", "get_impact_summary", "get_retirement_certificate"],
  };

  // --- Public endpoints (no auth) ---

  // GET /api/v1/payment-info — discover payment addresses and pricing
  router.get("/api/v1/payment-info", (_req: Request, res: Response) => {
    res.json(paymentRequiredBody.payment);
  });

  // Rate limiter for confirm-payment endpoint (10 req/min per IP)
  const confirmPaymentLimiter = new Map<string, { count: number; windowStart: number }>();

  // POST /api/v1/confirm-payment — agent confirms a crypto payment
  router.post("/api/v1/confirm-payment", async (req: Request, res: Response) => {
    try {
      // IP-based rate limiting
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      const rlNow = Date.now();
      const rlWindow = confirmPaymentLimiter.get(ip);
      if (rlWindow && rlNow - rlWindow.windowStart < 60_000 && rlWindow.count >= 10) {
        apiError(res, 429, "RATE_LIMITED", "Too many payment confirmation attempts. Try again in a minute.");
        return;
      }
      if (!rlWindow || rlNow - rlWindow.windowStart >= 60_000) {
        confirmPaymentLimiter.set(ip, { count: 1, windowStart: rlNow });
      } else {
        rlWindow.count++;
      }

      const { chain, tx_hash, email } = req.body ?? {};

      if (!chain || typeof chain !== "string") {
        apiError(res, 400, "INVALID_REQUEST", "chain is required (ethereum, bitcoin, solana, tron)");
        return;
      }
      if (!tx_hash || typeof tx_hash !== "string") {
        apiError(res, 400, "INVALID_REQUEST", "tx_hash is required");
        return;
      }

      // Check if already processed
      const existing = getCryptoPaymentByTxHash(db, tx_hash);
      if (existing) {
        if (existing.status === "provisioned" && existing.user_id) {
          const user = db.prepare("SELECT * FROM users WHERE id = ?").get(existing.user_id) as User | undefined;
          res.json({ status: "already_provisioned", message: "This payment has already been processed. Check your email for your API key." });
        } else {
          res.json({ status: existing.status, message: "This transaction has already been recorded." });
        }
        return;
      }

      // Verify the transaction on-chain
      const verified = await verifyPayment(chain, tx_hash);
      if (!verified.confirmed) {
        apiError(res, 400, "TX_NOT_CONFIRMED", `Transaction not yet confirmed. Need more confirmations (have ${verified.confirmations}).`);
        return;
      }

      // Convert to USD
      const usdCents = await toUsdCents(
        verified.token,
        verified.amount,
        verified.contractAddress,
        verified.contractAddress ? getEvmChainCoingeckoId(verified.chain) : undefined,
      );
      if (usdCents < 125) {
        apiError(res, 400, "AMOUNT_TOO_LOW", `Payment too small: $${(usdCents / 100).toFixed(2)}. Minimum is $1.25.`);
        return;
      }

      // Find or create user — bind from_address to prevent front-running.
      // (Read-only checks are done before the write transaction so we can
      //  early-return cleanly on an address-ownership conflict.)
      const contactEmail = (typeof email === "string" && email.includes("@")) ? email.trim().toLowerCase() : null;
      let boundUser: User | undefined;
      if (verified.fromAddress) {
        const existingPayment = db.prepare(
          "SELECT user_id FROM crypto_payments WHERE from_address = ? AND user_id IS NOT NULL AND status = 'provisioned' LIMIT 1"
        ).get(verified.fromAddress) as { user_id: number } | undefined;

        if (existingPayment) {
          boundUser = db.prepare("SELECT * FROM users WHERE id = ?").get(existingPayment.user_id) as User | undefined;
          if (boundUser && contactEmail && boundUser.email && boundUser.email.toLowerCase() !== contactEmail) {
            apiError(res, 403, "ADDRESS_BOUND", "This sender address is already associated with a different account.");
            return;
          }
        }
      }

      // Calculate subscription duration
      // Rates: Dabbler $1.25/mo, Builder $2.50/mo, Agent $5/mo
      // Use Agent rate ($5/mo = $60/yr) as the baseline for crypto payments
      const monthlyRateCents = 500; // Agent rate
      const totalMonths = Math.max(1, Math.floor(usdCents / monthlyRateCents));
      const isLifetime = totalMonths >= 600; // 50+ years = lifetime
      const subscriptionMonths = isLifetime ? 99999 : totalMonths; // effectively forever

      // Spread retirements over max 24 months
      const retirementMonths = Math.min(totalMonths, 24);
      const monthlyGrossCents = Math.floor(usdCents / retirementMonths);

      // No Stripe fees for crypto payments — net = gross
      const monthlyNetCents = monthlyGrossCents;
      const burnBudgetCents = Math.floor(usdCents * 0.05); // front-loaded 5%

      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + subscriptionMonths);
      const plan = usdCents >= 5000 ? "agent" : usdCents >= 2500 ? "builder" : "dabbler";

      // ATOMIC PROVISIONING: record the payment, create the user + subscriber,
      // schedule retirements, front-load burn budget, and flip the payment to
      // 'provisioned' — all in one transaction. A crash mid-way rolls the whole
      // thing back so a retry re-provisions cleanly, instead of leaving a paid
      // customer stranded with a half-written, un-retryable record.
      let user!: User;
      let subscriber!: ReturnType<typeof createSubscriber>;
      const provision = db.transaction(() => {
        const cryptoPayment = createCryptoPayment(db, {
          chain: verified.chain,
          tx_hash: verified.txHash,
          from_address: verified.fromAddress,
          token: verified.token,
          amount: verified.amount,
          usd_value_cents: usdCents,
        });

        user = boundUser
          ?? (contactEmail ? getUserByEmail(db, contactEmail) : undefined)
          ?? createUser(db, contactEmail, null);

        subscriber = createSubscriber(
          db, user.id,
          `crypto_${verified.chain}_${verified.txHash.slice(0, 16)}`,
          plan, usdCents,
          now.toISOString(), periodEnd.toISOString(),
          "yearly" // treat crypto as yearly for revenue split (85/5/10)
        );

        for (let month = 1; month < retirementMonths; month++) {
          const scheduledDate = new Date(now);
          scheduledDate.setMonth(scheduledDate.getMonth() + month);
          createScheduledRetirement(
            db, subscriber.id, monthlyGrossCents, monthlyNetCents,
            scheduledDate.toISOString().split("T")[0],
            "yearly"
          );
        }

        db.prepare(
          "INSERT INTO burn_accumulator (amount_cents, source_type, subscriber_id) VALUES (?, 'crypto_payment', ?)"
        ).run(burnBudgetCents, subscriber.id);

        updateCryptoPaymentStatus(db, cryptoPayment.id, "provisioned", subscriber.id, user.id);
      });
      provision();

      // Post-commit, non-critical: derive Regen address (async, can't run inside a
      // better-sqlite3 transaction) and clear stale renewal reminders.
      let regenAddr: string | null = null;
      try {
        const existingSubs = getAllSubscribersByUserId(db, user.id);
        const existingAddr = existingSubs.find(s => s.regen_address && s.id !== subscriber.id)?.regen_address;
        regenAddr = existingAddr ?? await deriveSubscriberAddress(subscriber.id);
        db.prepare("UPDATE subscribers SET regen_address = ? WHERE id = ?").run(regenAddr, subscriber.id);
      } catch { /* non-critical */ }

      const existingCryptoSubs = getExpiringCryptoSubscribers(db, user.id);
      for (const cs of existingCryptoSubs) {
        clearRenewalReminders(db, cs.id);
      }

      // Execute month 1 retirement immediately (fire-and-forget, don't block response)
      retireForSubscriber({
        subscriberId: subscriber.id,
        grossAmountCents: monthlyGrossCents,
        billingInterval: "yearly",
        precomputedNetCents: monthlyNetCents,
        paymentId: `crypto-${verified.chain}-${verified.txHash.slice(0, 16)}-m1`,
        overrideAddress: regenAddr ?? undefined,
      }).then(result => {
        console.log(`Crypto sub ${subscriber.id} month-1 retirement: ${result.status} (${result.totalCreditsRetired} credits)`);
      }).catch(err => {
        console.error(`Crypto sub ${subscriber.id} month-1 retirement failed:`, err);
      });

      res.json({
        status: "provisioned",
        api_key: user.api_key,
        subscription: {
          plan,
          amount_usd: (usdCents / 100).toFixed(2),
          duration_months: isLifetime ? "lifetime" : totalMonths,
          retirement_months: retirementMonths,
          monthly_retirement_usd: (monthlyNetCents / 100).toFixed(2),
          expires: isLifetime ? "never" : periodEnd.toISOString().split("T")[0],
        },
        payment: {
          chain: verified.chain,
          tx_hash: verified.txHash,
          token: verified.token,
          amount: verified.amount,
          usd_value: (usdCents / 100).toFixed(2),
        },
        message: isLifetime
          ? "Lifetime subscription provisioned. Your ecological impact starts now — all funds deployed within 24 months."
          : `${totalMonths}-month subscription provisioned. Credits will be retired monthly on your behalf.`,
        next_steps: {
          set_api_key: `export REGEN_API_KEY=${user.api_key}`,
          install_mcp: "claude mcp add -s user regen-compute -- npx regen-compute",
          check_status: `curl -H 'Authorization: Bearer ${user.api_key}' ${baseUrl}/api/v1/subscription`,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("confirm-payment error:", msg);
      apiError(res, 400, "VERIFICATION_FAILED", msg);
    }
  });

  // --- Auth + rate limit middleware for all other /api/v1/ routes ---
  router.use("/api/v1", (req: Request, res: Response, next: NextFunction) => {
    // Skip public endpoints (already handled above)
    if (req.path === "/openapi.json" || req.path === "/payment-info" || req.path === "/confirm-payment") {
      next();
      return;
    }

    const startTime = Date.now();
    const user = authenticateApiKey(req, res, db, paymentRequiredBody);
    if (!user) return;

    // Rate limiting
    const { allowed, retryAfterSec } = checkRateLimit(user.api_key, rateLimit);
    if (!allowed) {
      res.setHeader("Retry-After", String(retryAfterSec));
      apiError(res, 429, "RATE_LIMITED", `Rate limit exceeded. Try again in ${retryAfterSec} seconds.`);
      recordApiUsage(db, user.id, req.path, req.method, 429, Date.now() - startTime);
      return;
    }

    // Attach user and timing to request for downstream handlers
    (req as unknown as Record<string, unknown>)._apiUser = user;
    (req as unknown as Record<string, unknown>)._apiStartTime = startTime;

    // Track usage after response is sent
    res.on("finish", () => {
      recordApiUsage(db, user.id, req.path, req.method, res.statusCode, Date.now() - startTime);
    });

    // Set rate limit headers
    res.setHeader("X-RateLimit-Limit", String(rateLimit));

    next();
  });

  // Helper to get authenticated user from request
  function getUser(req: Request): User {
    return (req as unknown as Record<string, unknown>)._apiUser as User;
  }

  // --- POST /api/v1/retire ---
  router.post("/api/v1/retire", async (req: Request, res: Response) => {
    const user = getUser(req);
    if (!user) return;

    const { credit_class, quantity, beneficiary_name, jurisdiction, reason } = req.body ?? {};

    if (quantity !== undefined && (typeof quantity !== "number" || quantity <= 0)) {
      apiError(res, 400, "INVALID_REQUEST", "quantity must be a positive number");
      return;
    }

    // Authorization: this endpoint spends the shared operator wallet. Re-read the
    // caller's CURRENT balance and only allow spend up to that balance, debiting it
    // atomically after the retirement. Without this, any valid API key could drain
    // the wallet. Admins are exempt (operator/testing use).
    const freshUser = getUserByApiKey(db, user.api_key) ?? user;
    const isAdmin = !!freshUser.email && ADMIN_EMAILS.has(freshUser.email);
    if (!isAdmin && freshUser.balance_cents <= 0) {
      apiError(
        res, 402, "INSUFFICIENT_BALANCE",
        "Retiring credits requires a prepaid balance. Top up to enable on-demand retirement.",
        { balance_cents: freshUser.balance_cents, topup_url: `${baseUrl}/#pricing` }
      );
      return;
    }

    try {
      const result = await executeRetirement({
        creditClass: credit_class,
        quantity,
        beneficiaryName: beneficiary_name,
        jurisdiction,
        reason,
        // Cap spend at the caller's balance so cost can never exceed what they paid.
        maxCostCents: isAdmin ? undefined : freshUser.balance_cents,
      });

      // Charge the caller's own prepaid balance for a successful on-chain retirement.
      if (result.status === "success" && !isAdmin) {
        const chargeCents = result.costCents ?? 0;
        if (chargeCents > 0) {
          const debit = debitBalance(
            db, freshUser.id, chargeCents,
            `On-demand retirement (${credit_class || "mixed"})`,
            result.txHash, credit_class, result.creditsRetired ? parseFloat(result.creditsRetired) : undefined
          );
          if (!debit.success) {
            // Cost was capped to balance, so this should not happen except under a
            // concurrent race. Credits are already retired — alert for reconciliation.
            const alertMsg =
              `⚠️ API retire: balance debit FAILED after on-chain retirement.\n` +
              `user=${freshUser.id} tx=${result.txHash} cost=$${(chargeCents / 100).toFixed(2)}\n` +
              `Credits retired but user NOT charged — reconcile.`;
            console.error(alertMsg);
            sendTelegram(alertMsg).catch(() => {});
          }
        }
      }

      if (result.status === "success") {
        const batches = (result.batches ?? []).map((b) => ({
          batch_denom: b.batchDenom,
          class_id: b.classId,
          project_id: b.projectId,
          amount: b.amount,
        }));
        const uniqueClassIds = [...new Set(batches.map((b) => b.class_id))];
        const uniqueProjectIds = [...new Set(batches.map((b) => b.project_id))];
        res.json({
          status: "success",
          tx_hash: result.txHash,
          credits_retired: result.creditsRetired,
          cost: result.cost,
          block_height: result.blockHeight,
          certificate_id: result.certificateId ?? null,
          certificate_url: result.certificateId ? `${baseUrl}/impact/${encodeURIComponent(result.certificateId)}` : null,
          jurisdiction: result.jurisdiction,
          reason: result.reason,
          beneficiary_name: result.beneficiaryName ?? null,
          remaining_balance_cents: result.remainingBalanceCents ?? null,
          batches,
          class_ids: uniqueClassIds,
          project_ids: uniqueProjectIds,
        });
      } else {
        res.json({
          status: "marketplace_link",
          marketplace_url: result.marketplaceUrl,
          message: result.message,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, "INTERNAL_ERROR", `Retirement failed: ${msg}`);
    }
  });

  // --- GET /api/v1/credits ---
  router.get("/api/v1/credits", async (req: Request, res: Response) => {
    const user = getUser(req);
    if (!user) return;

    const creditType = (req.query.type as string) || "all";
    const maxResults = Math.min(parseInt((req.query.max_results as string) || "10", 10), 50);

    try {
      const [classes, sellOrders, projects, recentOrders] = await Promise.all([
        listCreditClasses(),
        listSellOrders().catch(() => []),
        listProjects(),
        getRecentOrders(5).catch(() => []),
      ]);

      // Filter classes by credit type
      const filteredClasses =
        creditType === "all"
          ? classes
          : classes.filter((c) => {
              if (creditType === "carbon") return c.credit_type_abbrev === "C";
              if (creditType === "biodiversity")
                return ["BT", "MBS", "KSH", "USS"].includes(c.credit_type_abbrev);
              return true;
            });

      // Project lookup
      const projectsByClass = new Map<string, typeof projects>();
      for (const project of projects) {
        const existing = projectsByClass.get(project.class_id) || [];
        existing.push(project);
        projectsByClass.set(project.class_id, existing);
      }

      // Aggregate sell orders by type
      const classLookup = new Map(classes.map((c) => [c.id, c]));
      const sellOrdersByType = new Map<string, { quantity: number; count: number }>();
      for (const order of sellOrders) {
        const classId = order.batch_denom.replace(/-\d.*$/, "");
        const cls = classLookup.get(classId);
        const typeAbbrev = cls?.credit_type_abbrev || "Other";
        const existing = sellOrdersByType.get(typeAbbrev) || { quantity: 0, count: 0 };
        existing.quantity += parseFloat(order.quantity) || 0;
        existing.count += 1;
        sellOrdersByType.set(typeAbbrev, existing);
      }

      const marketplaceSnapshot = Array.from(sellOrdersByType.entries()).map(([abbrev, stats]) => ({
        credit_type: CREDIT_TYPE_NAMES[abbrev] || abbrev,
        credit_type_abbreviation: abbrev,
        available_credits: Math.round(stats.quantity * 10) / 10,
        sell_orders: stats.count,
      }));

      const creditClasses = filteredClasses.slice(0, maxResults).map((cls) => {
        const classProjects = projectsByClass.get(cls.id) || [];
        return {
          id: cls.id,
          type: CREDIT_TYPE_NAMES[cls.credit_type_abbrev] || cls.credit_type_abbrev,
          type_abbreviation: cls.credit_type_abbrev,
          projects: classProjects.length,
          jurisdictions: [...new Set(classProjects.map((p) => p.jurisdiction))],
        };
      });

      const sellOrderList = sellOrders.slice(0, maxResults).map((order) => ({
        batch_denom: order.batch_denom,
        quantity: order.quantity,
        ask_amount: order.ask_amount,
        ask_denom: order.ask_denom,
      }));

      const recent = recentOrders.map((order) => ({
        project_id: order.projectId,
        credits_amount: order.creditsAmount,
        total_price: order.totalPrice,
        ask_denom: order.askDenom,
        retired: order.retiredCredits,
      }));

      res.json({
        marketplace_snapshot: marketplaceSnapshot,
        credit_classes: creditClasses,
        sell_orders: sellOrderList,
        recent_orders: recent,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 503, "SERVICE_UNAVAILABLE", `Failed to fetch credits: ${msg}`);
    }
  });

  // --- GET /api/v1/footprint ---
  router.get("/api/v1/footprint", (req: Request, res: Response) => {
    const user = getUser(req);
    if (!user) return;

    const sessionMinutes = parseFloat((req.query.session_minutes as string) || "0");
    const toolCalls = req.query.tool_calls ? parseInt(req.query.tool_calls as string, 10) : undefined;

    if (!sessionMinutes || sessionMinutes <= 0) {
      apiError(res, 400, "INVALID_REQUEST", "session_minutes is required and must be a positive number");
      return;
    }

    const estimate = estimateFootprint(sessionMinutes, toolCalls);
    res.json(estimate);
  });

  // --- GET /api/v1/certificates/:id ---
  router.get("/api/v1/certificates/:id", async (req: Request, res: Response) => {
    const user = getUser(req);
    if (!user) return;

    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    try {
      const retirement = await getRetirementById(id);
      if (!retirement) {
        apiError(res, 404, "NOT_FOUND", `No retirement certificate found for ID: ${id}`);
        return;
      }

      res.json({
        node_id: retirement.nodeId,
        amount: retirement.amount,
        batch_denom: retirement.batchDenom,
        owner: retirement.owner,
        jurisdiction: retirement.jurisdiction,
        reason: humanizeRetirementReason(retirement.reason) || "Ecological regeneration",
        timestamp: retirement.timestamp,
        block_height: retirement.blockHeight,
        tx_hash: retirement.txHash,
        certificate_url: `${baseUrl}/impact/${encodeURIComponent(retirement.nodeId)}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 503, "SERVICE_UNAVAILABLE", `Failed to retrieve certificate: ${msg}`);
    }
  });

  // --- GET /api/v1/impact ---
  router.get("/api/v1/impact", async (req: Request, res: Response) => {
    const user = getUser(req);
    if (!user) return;

    try {
      const [classes, projects, retirementStats, orderStats] = await Promise.all([
        listCreditClasses(),
        listProjects(),
        getRetirementStats().catch(() => null),
        getOrderStats().catch(() => null),
      ]);

      const jurisdictions = [...new Set(projects.map((p) => p.jurisdiction))];

      const creditTypes = [
        { abbreviation: "C", name: "Carbon" },
        { abbreviation: "BT", name: "Biodiversity (Terrasos)" },
        { abbreviation: "MBS", name: "Marine Biodiversity Stewardship" },
        { abbreviation: "KSH", name: "Kilo-Sheep-Hour" },
        { abbreviation: "USS", name: "Umbrella Species Stewardship" },
      ];

      res.json({
        credit_classes: classes.length,
        active_projects: projects.length,
        jurisdictions: jurisdictions.length,
        total_retirements: retirementStats?.totalRetirements ?? null,
        total_marketplace_orders: orderStats?.totalOrders ?? null,
        credit_types: creditTypes,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 503, "SERVICE_UNAVAILABLE", `Failed to fetch impact data: ${msg}`);
    }
  });

  // --- GET /api/v1/subscription ---
  router.get("/api/v1/subscription", (req: Request, res: Response) => {
    const user = getUser(req);
    if (!user) return;

    const subscriber = getSubscriberByUserId(db, user.id);
    const referralCount = getReferralCount(db, user.id);
    const referralLink = user.referral_code
      ? `${baseUrl}/r/${user.referral_code}`
      : null;
    const subscribeUrl = `${baseUrl}/#pricing`;

    if (!subscriber || subscriber.status !== "active") {
      res.json({
        subscribed: false,
        subscribe_url: subscribeUrl,
        referral_link: referralLink,
        referral_count: referralCount,
        plans: [
          { name: "Dabbler", price: "$1.25/mo", description: "I chat with AI sometimes" },
          { name: "Builder", price: "$2.50/mo", description: "I regularly use AI for work" },
          { name: "Agent", price: "$5/mo", description: "For autonomous agents and power users" },
        ],
      });
      return;
    }

    const cumulative = getCumulativeAttribution(db, subscriber.id);

    res.json({
      subscribed: true,
      plan: subscriber.plan,
      status: subscriber.status,
      amount_cents: subscriber.amount_cents,
      amount_dollars: (subscriber.amount_cents / 100).toFixed(2),
      next_renewal: subscriber.current_period_end,
      cumulative_carbon_credits: cumulative.total_carbon,
      cumulative_biodiversity_credits: cumulative.total_biodiversity,
      cumulative_uss_credits: cumulative.total_uss,
      cumulative_contribution_dollars: (cumulative.total_contribution_cents / 100).toFixed(2),
      months_active: cumulative.months_active,
      referral_link: referralLink,
      referral_count: referralCount,
      subscribe_url: subscribeUrl,
      manage_url: `${baseUrl}/manage?email=${encodeURIComponent(user.email ?? "")}`,
    });
  });

  // --- GET /api/v1/accounting ---
  router.get("/api/v1/accounting", (req: Request, res: Response) => {
    const user = getUser(req);
    if (!user) return;

    // Admin-only: restrict to known admin email
    if (!user.email || !ADMIN_EMAILS.has(user.email)) {
      return apiError(res, 403, "FORBIDDEN", "This endpoint requires admin access");
    }

    try {
      const summary = getFinancialSummary(db);
      res.json(summary);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, "INTERNAL_ERROR", `Failed to generate accounting summary: ${msg}`);
    }
  });

  // --- GET /api/v1/usage ---
  router.get("/api/v1/usage", (req: Request, res: Response) => {
    const user = getUser(req);
    if (!user) return;

    const limit = Math.min(parseInt((req.query.limit as string) || "100", 10), 500);
    const endpoint = (req.query.endpoint as string) || undefined;

    try {
      // Usage for the authenticated user only
      let query = "SELECT endpoint, method, status_code, response_time_ms, created_at FROM api_usage WHERE user_id = ?";
      const params: unknown[] = [user.id];

      if (endpoint) {
        query += " AND endpoint = ?";
        params.push(endpoint);
      }

      query += " ORDER BY created_at DESC LIMIT ?";
      params.push(limit);

      const rows = db.prepare(query).all(...params) as Array<{
        endpoint: string; method: string; status_code: number;
        response_time_ms: number | null; created_at: string;
      }>;

      // Aggregate stats for this user
      const statsRow = db.prepare(`
        SELECT
          COUNT(*) AS total_requests,
          AVG(response_time_ms) AS avg_response_ms,
          MIN(created_at) AS first_request,
          MAX(created_at) AS last_request
        FROM api_usage WHERE user_id = ?
      `).get(user.id) as {
        total_requests: number; avg_response_ms: number | null;
        first_request: string | null; last_request: string | null;
      };

      // Per-endpoint breakdown
      const endpointBreakdown = db.prepare(`
        SELECT endpoint, method, COUNT(*) AS count, AVG(response_time_ms) AS avg_ms
        FROM api_usage WHERE user_id = ?
        GROUP BY endpoint, method ORDER BY count DESC
      `).all(user.id) as Array<{
        endpoint: string; method: string; count: number; avg_ms: number | null;
      }>;

      res.json({
        stats: {
          total_requests: statsRow.total_requests,
          avg_response_ms: statsRow.avg_response_ms !== null
            ? Math.round(statsRow.avg_response_ms)
            : null,
          first_request: statsRow.first_request,
          last_request: statsRow.last_request,
        },
        endpoints: endpointBreakdown.map((e) => ({
          endpoint: e.endpoint,
          method: e.method,
          count: e.count,
          avg_response_ms: e.avg_ms !== null ? Math.round(e.avg_ms) : null,
        })),
        recent: rows,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, "INTERNAL_ERROR", `Failed to fetch usage data: ${msg}`);
    }
  });


  // --- GET /api/v1/pool/history ---
  router.get("/api/v1/pool/history", (req: Request, res: Response) => {
    const user = getUser(req);
    if (!user) return;

    const limit = Math.min(parseInt((req.query.limit as string) || "10", 10), 50);

    try {
      const runs = db.prepare(
        "SELECT * FROM pool_runs ORDER BY id DESC LIMIT ?"
      ).all(limit) as Array<{
        id: number; run_date: string; status: string;
        total_revenue_cents: number; total_spent_cents: number;
        carbon_credits_retired: number; carbon_tx_hash: string | null;
        biodiversity_credits_retired: number; biodiversity_tx_hash: string | null;
        uss_credits_retired: number; uss_tx_hash: string | null;
        burn_allocation_cents: number; burn_tx_hash: string | null;
        ops_allocation_cents: number; carry_forward_cents: number;
        subscriber_count: number; dry_run: number;
        error_log: string | null; created_at: string; completed_at: string | null;
      }>;

      // Get attributions for the most recent run
      let latestAttributions: Array<{
        subscriber_id: number; contribution_cents: number;
        carbon_credits: number; biodiversity_credits: number; uss_credits: number;
      }> = [];
      if (runs.length > 0) {
        latestAttributions = db.prepare(
          "SELECT subscriber_id, contribution_cents, carbon_credits, biodiversity_credits, uss_credits FROM attributions WHERE pool_run_id = ?"
        ).all(runs[0].id) as typeof latestAttributions;
      }

      res.json({
        total_runs: runs.length,
        runs: runs.map((r) => ({
          id: r.id,
          run_date: r.run_date,
          status: r.status,
          dry_run: !!r.dry_run,
          subscriber_count: r.subscriber_count,
          total_revenue_cents: r.total_revenue_cents,
          total_spent_cents: r.total_spent_cents,
          carbon_credits_retired: r.carbon_credits_retired,
          biodiversity_credits_retired: r.biodiversity_credits_retired,
          uss_credits_retired: r.uss_credits_retired,
          burn_allocation_cents: r.burn_allocation_cents,
          ops_allocation_cents: r.ops_allocation_cents,
          carry_forward_cents: r.carry_forward_cents,
          error_log: r.error_log,
          created_at: r.created_at,
          completed_at: r.completed_at,
        })),
        latest_attributions: latestAttributions,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, "INTERNAL_ERROR", `Failed to fetch pool history: ${msg}`);
    }
  });

  // --- GET /api/v1/burn/history ---
  router.get("/api/v1/burn/history", (req: Request, res: Response) => {
    const user = getUser(req);
    if (!user) return;

    try {
      const entries = getBurnLedger(db);

      // Pending burn budget
      const pendingRow = db.prepare(`
        SELECT COALESCE(SUM(amount_cents), 0) AS total
        FROM burn_accumulator WHERE executed = 0
      `).get() as { total: number } | undefined;
      const pendingCents = pendingRow?.total ?? 0;

      // Totals
      const totalRegen = entries
        .filter((e) => e.status === "completed")
        .reduce((sum, e) => sum + e.regenBurned, 0);
      const totalAllocationCents = entries.reduce((sum, e) => sum + e.allocationCents, 0);

      res.json({
        pending_burn_budget_cents: pendingCents,
        total_regen_burned: totalRegen,
        total_allocation_cents: totalAllocationCents,
        total_burn_transactions: entries.filter((e) => e.status === "completed").length,
        burns: entries.map((e) => ({
          id: e.id,
          date: e.date,
          allocation_cents: e.allocationCents,
          regen_burned: e.regenBurned,
          regen_price_usd: e.regenPriceUsd,
          tx_hash: e.txHash,
          status: e.status,
          source: e.source,
        })),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, "INTERNAL_ERROR", `Failed to fetch burn history: ${msg}`);
    }
  });

  // --- GET /api/v1/community/goals ---
  router.get("/api/v1/community/goals", (req: Request, res: Response) => {
    const user = getUser(req);
    if (!user) return;

    try {
      const activeGoal = getActiveCommunityGoal(db);
      const totalCredits = getCommunityTotalCreditsRetired(db);
      const subscriberCount = getCommunitySubscriberCount(db);

      const allGoals = db.prepare(
        "SELECT * FROM community_goals ORDER BY id DESC"
      ).all() as Array<{
        id: number; goal_label: string; goal_credits: number;
        goal_deadline: string | null; active: number; created_at: string;
      }>;

      let progress: number | null = null;
      let completed = false;
      if (activeGoal && activeGoal.goal_credits > 0) {
        progress = Math.min((totalCredits / activeGoal.goal_credits) * 100, 100);
        completed = progress >= 100;
      }

      res.json({
        active_goal: activeGoal ? {
          id: activeGoal.id,
          label: activeGoal.goal_label,
          target_credits: activeGoal.goal_credits,
          deadline: activeGoal.goal_deadline,
          progress_percent: progress !== null ? parseFloat(progress.toFixed(1)) : null,
          completed,
          created_at: activeGoal.created_at,
        } : null,
        community_stats: {
          total_credits_retired: totalCredits,
          active_subscribers: subscriberCount,
        },
        goals: allGoals.map((g) => ({
          id: g.id,
          label: g.goal_label,
          target_credits: g.goal_credits,
          deadline: g.goal_deadline,
          active: !!g.active,
          created_at: g.created_at,
        })),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, "INTERNAL_ERROR", `Failed to fetch community goals: ${msg}`);
    }
  });

  // --- GET /api/v1/scheduled-retirements ---
  router.get("/api/v1/scheduled-retirements", (req: Request, res: Response) => {
    const user = getUser(req);
    if (!user) return;

    const status = (req.query.status as string) || undefined;
    const limit = Math.min(parseInt((req.query.limit as string) || "50", 10), 200);

    try {
      let query = "SELECT * FROM scheduled_retirements";
      const params: unknown[] = [];

      if (status) {
        query += " WHERE status = ?";
        params.push(status);
      }

      query += " ORDER BY scheduled_date DESC LIMIT ?";
      params.push(limit);

      const retirements = db.prepare(query).all(...params) as ScheduledRetirement[];

      // Summary stats
      const statsRow = db.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) AS partial,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running
        FROM scheduled_retirements
      `).get() as {
        total: number; pending: number; completed: number;
        partial: number; failed: number; running: number;
      };

      res.json({
        stats: {
          total: statsRow.total,
          pending: statsRow.pending,
          completed: statsRow.completed,
          partial: statsRow.partial,
          failed: statsRow.failed,
          running: statsRow.running,
        },
        retirements: retirements.map((r) => ({
          id: r.id,
          subscriber_id: r.subscriber_id,
          gross_amount_cents: r.gross_amount_cents,
          net_amount_cents: r.net_amount_cents,
          billing_interval: r.billing_interval,
          scheduled_date: r.scheduled_date,
          status: r.status,
          retirement_id: r.retirement_id,
          error: r.error,
          retry_count: r.retry_count,
          created_at: r.created_at,
          executed_at: r.executed_at,
        })),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 500, "INTERNAL_ERROR", `Failed to fetch scheduled retirements: ${msg}`);
    }
  });

  // --- GET /api/v1/ecobridge/tokens ---
  router.get("/api/v1/ecobridge/tokens", async (req: Request, res: Response) => {
    const user = getUser(req);
    if (!user) return;

    const chain = (req.query.chain as string) || undefined;

    try {
      const tokens = await getSupportedTokens(chain);

      // Group by chain
      const byChain: Record<string, Array<{ symbol: string; name: string; priceUsd: number | null }>> = {};
      for (const t of tokens) {
        const key = t.chainName || t.chainId;
        if (!byChain[key]) byChain[key] = [];
        byChain[key].push({ symbol: t.symbol, name: t.name, priceUsd: t.priceUsd });
      }

      res.json({
        total_tokens: tokens.length,
        chains: Object.entries(byChain).map(([chainName, chainTokens]) => ({
          chain: chainName,
          tokens: chainTokens,
        })),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 503, "SERVICE_UNAVAILABLE", `Failed to fetch ecoBridge tokens: ${msg}`);
    }
  });

  // --- GET /api/v1/ecobridge/projects ---
  router.get("/api/v1/ecobridge/projects", async (req: Request, res: Response) => {
    const user = getUser(req);
    if (!user) return;

    try {
      const projects = await getEcoBridgeProjects();

      res.json({
        total_projects: projects.length,
        projects: projects.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          credit_class: p.creditClass,
          price: p.price,
          unit: p.unit,
          location: p.location,
          type: p.type,
        })),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      apiError(res, 503, "SERVICE_UNAVAILABLE", `Failed to fetch ecoBridge projects: ${msg}`);
    }
  });

  return router;
}
