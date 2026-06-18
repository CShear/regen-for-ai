/**
 * Rate-limit middleware for Stripe-facing endpoints.
 *
 * The API endpoints under /api are already rate-limited per API key in
 * api-routes.ts. This module adds per-IP limiting on the unauthenticated,
 * Stripe-adjacent endpoints (checkout, subscribe, manage, cancel, webhook),
 * so a single IP cannot hammer Stripe Checkout Session creation or replay
 * webhook traffic faster than the upstream can absorb.
 *
 * Limits are configurable via env:
 *   REGEN_RATELIMIT_CHECKOUT_PER_MIN   (default 20)
 *   REGEN_RATELIMIT_WEBHOOK_PER_MIN    (default 600 — Stripe bursts)
 */

import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";

const ONE_MINUTE_MS = 60_000;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Limiter for user-initiated checkout / subscription / portal endpoints.
 * Applied per IP. Default: 20 req/min/IP.
 */
export function createCheckoutLimiter(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: ONE_MINUTE_MS,
    limit: envInt("REGEN_RATELIMIT_CHECKOUT_PER_MIN", 20),
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests. Please try again in a minute." },
  });
}

/**
 * Limiter for the Stripe webhook endpoint.
 * Stripe bursts retries during outages, so this is intentionally generous.
 * Signature verification + event-id idempotency are the real correctness
 * controls; this limiter exists only to bound resource exhaustion from a
 * spoofed source. Default: 600 req/min/IP.
 */
export function createWebhookLimiter(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: ONE_MINUTE_MS,
    limit: envInt("REGEN_RATELIMIT_WEBHOOK_PER_MIN", 600),
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Webhook rate limit exceeded." },
  });
}
