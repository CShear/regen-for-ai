/**
 * Express routes for the Regen Compute payment service.
 *
 * GET  /                  — Subscription landing page with live stats
 * POST /checkout          — Create a Stripe Checkout session
 * POST /webhook           — Handle Stripe webhook events
 * GET  /manage            — Redirect to Stripe Customer Portal (subscription self-management)
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
  getUserByReferralCode,
  setUserReferredBy,
  createReferralReward,
  fulfillReferralReward,
  getPendingReferralRewardForReferred,
  getTodayReferralCount,
  holdReferralReward,
  getHeldReferralRewards,
  approveReferralReward,
  getReferralCount,
  getMedianReferralCount,
  getFulfilledReferralRewardsForUser,
  insertReferralBonusTransaction,
  type ReferralReward,
  setSubscriberRegenAddress,
  createScheduledRetirement,
  getDueScheduledRetirements,
  updateScheduledRetirement,
  cancelScheduledRetirements,
  setUserDisplayName,
  getSubscriberByUserId,
  getCumulativeAttribution,
  isEventProcessed,
  markEventProcessed,
  createOrganization,
  getOrganizationById,
  getOrganizationBySubscriberId,
  updateOrganizationPublicity,
  linkSubscriberToOrg,
  getPublicOrganizations,
} from "./db.js";
import { betaBannerCSS, betaBannerHTML, betaBannerJS } from "./beta-banner.js";
import { createCheckoutLimiter, createWebhookLimiter } from "./rate-limit.js";
import { sendWelcomeEmail, sendFirstRetirementEmail, sendRetirementReceiptEmail, sendReferralBonusEmail } from "../services/email.js";
import { deriveSubscriberAddress, sweepSubscriberFunds } from "../services/subscriber-wallet.js";
import { retireForSubscriber, accumulateBurnBudget, getPendingBurnBudget, markBurnExecuted, calculateNetAfterStripe, type SubscriberRetirementResult } from "../services/retire-subscriber.js";
import { swapAndBurn, checkOsmosisReadiness } from "../services/swap-and-burn.js";
import { getProjectForBatch, PROJECTS } from "./project-metadata.js";
import { checkAndSendMonthlyReminder, checkCreditStock, sendTelegram } from "../services/admin-telegram.js";
import { updateRegistryProfile } from "../services/registry-profile.js";
import { brandFonts, brandCSS, brandHeader, brandFooter, brandSchemaOrg, regenLogoSVG } from "./brand.js";
import { t, SUPPORTED_LANGS, LANG_NAMES, LANG_FLAGS, LANG_SHORT, type LangCode } from "./translations.js";

/** Per-subscriber lock to prevent concurrent retirement execution */
const _subscriberLocks = new Map<number, Promise<void>>();

async function withSubscriberLock<T>(subscriberId: number, fn: () => Promise<T>): Promise<T> {
  const existing = _subscriberLocks.get(subscriberId) ?? Promise.resolve();
  let resolve: () => void;
  const next = new Promise<void>((r) => { resolve = r; });
  _subscriberLocks.set(subscriberId, next);

  await existing; // Wait for any prior retirement to finish
  try {
    return await fn();
  } finally {
    resolve!();
    if (_subscriberLocks.get(subscriberId) === next) {
      _subscriberLocks.delete(subscriberId);
    }
  }
}

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

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function createRoutes(stripe: Stripe | null, db: Database.Database, baseUrl: string, config?: Config): Router {
  const router = Router();

  // Per-IP rate limiters for Stripe-facing endpoints. These are unauthenticated
  // (no API key), so without limits a single IP could spam Stripe API calls or
  // replay webhook payloads. Real correctness for /webhook still relies on
  // signature verification + event-id idempotency below — this is just a
  // resource-exhaustion bound.
  const checkoutLimiter = createCheckoutLimiter();
  const webhookLimiter = createWebhookLimiter();

  // --- Public routes ---

  /**
   * GET / and GET /:lang
   * Subscription landing page with live impact stats.
   * Supports 21 languages via /:lang (e.g. /es, /fr, /zh).
   */
  async function serveLandingPage(_req: Request, res: Response, lang: LangCode = "en") {
    const dabblerUrl = config?.stripePaymentLinkSeedling ?? process.env.STRIPE_PAYMENT_LINK_SEEDLING ?? "#";
    const builderUrl = config?.stripePaymentLinkGrove ?? process.env.STRIPE_PAYMENT_LINK_GROVE ?? "#";
    const agentUrl = config?.stripePaymentLinkForest ?? process.env.STRIPE_PAYMENT_LINK_FOREST ?? "#";

    // Check for referral code
    const refCode = (_req.query.ref as string) || "";
    let referralValid = false;
    if (refCode) {
      const referrer = getUserByReferralCode(db, refCode);
      referralValid = !!referrer;
    }
    const hasPriceIds = !!(config?.stripePriceIdSeedling && config?.stripePriceIdGrove && config?.stripePriceIdForest);

    const stats = await getCachedStats();
    const totalRetirements = stats ? stats.totalRetirements.toLocaleString() : "--";
    const totalOrders = stats ? stats.totalOrders.toLocaleString() : "--";
    const publicOrgs = getPublicOrganizations(db);

    res.setHeader("Content-Type", "text/html");
    res.send(`<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t(lang, "page_title")}</title>
  <meta name="description" content="${t(lang, "page_description")}">
  <meta property="og:title" content="${t(lang, "page_title")}">
  <meta property="og:description" content="${t(lang, "page_description")}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${baseUrl}">
  <meta property="og:image" content="${baseUrl}/og-card.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:type" content="image/jpeg">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@Regen_compute">
  <meta name="twitter:title" content="${t(lang, "page_title")}">
  <meta name="twitter:description" content="${t(lang, "page_description")}">
  <meta name="twitter:image" content="${baseUrl}/og-card.jpg">
  <link rel="canonical" href="${baseUrl}/${lang === 'en' ? '' : lang}">
${SUPPORTED_LANGS.map(l => `  <link rel="alternate" hreflang="${l}" href="${baseUrl}/${l === 'en' ? '' : l}">`).join('\n')}
  <link rel="alternate" hreflang="x-default" href="${baseUrl}/">
  ${brandFonts()}
  <style>
    ${betaBannerCSS()}
    ${brandCSS()}

    /* Language picker */
    .lang-picker { position: relative; margin-left: 8px; }
    .lang-picker__btn { display: inline-flex; align-items: center; gap: 4px; background: none; border: 1px solid var(--color-border-light); border-radius: 6px; padding: 5px 10px; cursor: pointer; font-size: 13px; color: var(--color-cream); font-family: inherit; transition: border-color 0.2s; }
    .lang-picker__btn:hover { border-color: var(--color-emerald); }
    .lang-picker__flag { font-size: 16px; line-height: 1; }
    .lang-picker__code { font-weight: 600; font-size: 12px; }
    .lang-picker__menu { display: none; position: absolute; right: 0; top: calc(100% + 6px); background: var(--color-surface); border: 1px solid var(--color-border-light); border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); padding: 6px 0; min-width: 200px; max-height: 360px; overflow-y: auto; z-index: 1000; }
    .lang-picker__menu.open { display: block; }
    .lang-picker__item { display: flex; align-items: center; gap: 8px; padding: 8px 16px; font-size: 14px; color: var(--color-cream); text-decoration: none; transition: background 0.15s; }
    .lang-picker__item:hover { background: var(--color-card); }
    .lang-picker__item--active { font-weight: 700; color: var(--color-emerald); }

    /* ---- Hero section ---- */
    .hero-section { position: relative; min-height: 100vh; display: flex; align-items: center; overflow: hidden; }
    .hero-bg { position: absolute; inset: 0; overflow: hidden; }
    .hero-bg img { width: 100%; height: 100%; object-fit: cover; object-position: center 40%; filter: brightness(0.3) saturate(0.8); }
    .hero-gradient { position: absolute; inset: 0; background: linear-gradient(to bottom, rgba(5,6,10,0.4), rgba(5,6,10,0.2) 70%, var(--color-void)); }
    .hero-content { position: relative; z-index: 10; max-width: 1200px; margin: 0 auto; padding: 80px 24px 64px; display: grid; grid-template-columns: 1fr 400px; gap: 80px; align-items: center; }
    @media (max-width: 900px) {
      .hero-content { grid-template-columns: 1fr; gap: 40px; padding: 72px 24px 48px; }
      .hero-inline-logo { display: none; }
    }

    /* ---- Problem / Stats section ---- */
    .problem-section { position: relative; padding: 100px 0; overflow: hidden; }
    .problem-canvas { position: absolute; inset: 0; z-index: 0; }
    .problem-content { position: relative; z-index: 1; max-width: 1200px; margin: 0 auto; padding: 0 24px; }
    .stats-grid-dark { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; margin-top: 48px; }
    .stat-card-dark {
      background: var(--color-glass); backdrop-filter: blur(12px);
      border: 1px solid var(--color-border-light); border-radius: 16px;
      padding: 28px 24px; text-align: center;
      transition: border-color 0.3s, transform 0.3s;
    }
    .stat-card-dark:hover { border-color: var(--color-border-emerald); transform: translateY(-2px); }
    .stat-card-dark .stat-num { font-family: var(--font-display); font-size: 36px; font-weight: 800; color: var(--color-emerald); margin-bottom: 4px; }
    .stat-card-dark .stat-label { font-family: var(--font-ui); font-size: 13px; color: var(--color-muted); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; }
    @media (max-width: 700px) {
      .stats-grid-dark { grid-template-columns: repeat(2, 1fr); }
    }

    /* ---- Projects section ---- */
    .projects-section { padding: 100px 0; }
    .project-spread {
      display: grid; grid-template-columns: 1fr 1fr; min-height: 500px;
      border-top: 1px solid var(--color-border);
      transition: background 0.3s;
    }
    .project-spread:hover { background: rgba(255,255,255,0.01); }
    .project-spread--reverse .project-spread__img-wrap { order: 2; }
    .project-spread--reverse .project-spread__text { order: 1; }
    .project-spread__img-wrap {
      position: relative; overflow: hidden; min-height: 300px;
    }
    .project-spread__img {
      position: absolute; inset: 0; width: 100%; height: 100%;
      object-fit: cover; display: block;
      filter: brightness(0.85) saturate(0.9);
      transition: all 0.7s ease-out;
    }
    .project-spread:hover .project-spread__img {
      transform: scale(1.03); filter: brightness(0.95) saturate(1);
    }
    .project-spread__img-fade {
      position: absolute; inset: 0; pointer-events: none;
    }
    .project-spread__img-fade--right {
      background: linear-gradient(to right, transparent, transparent 60%, var(--color-void));
    }
    .project-spread__img-fade--left {
      background: linear-gradient(to left, transparent, transparent 60%, var(--color-void));
    }
    .project-spread__text {
      display: flex; flex-direction: column; justify-content: center;
      padding: 48px 60px;
    }
    .project-spread__badge { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.15em; padding: 4px 12px; border-radius: 20px; margin-bottom: 16px; width: fit-content; border: 1px solid; }
    .project-spread__badge-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .project-spread__name { font-family: var(--font-display); font-size: 1.8rem; font-weight: 600; color: var(--color-cream); margin: 0 0 6px; line-height: 1.2; }
    .project-spread__location { font-family: var(--font-mono); font-size: 0.65rem; color: var(--color-dim); letter-spacing: 0.05em; margin-bottom: 20px; }
    .project-spread__desc { font-size: 1rem; color: var(--color-cream-soft); line-height: 1.75; margin: 0 0 28px; max-width: 440px; }
    .project-spread__metrics { display: flex; gap: 28px; padding-top: 20px; border-top: 1px solid var(--color-border); margin-bottom: 20px; }
    .project-spread__metric-val { font-family: var(--font-mono); font-size: 0.9rem; font-weight: 500; color: var(--color-cream); }
    .project-spread__metric-label { font-family: var(--font-mono); font-size: 0.52rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--color-dim); margin-top: 2px; }
    .project-spread__links { display: flex; gap: 16px; flex-wrap: wrap; }
    .project-spread__link { font-family: var(--font-mono); font-size: 0.62rem; font-weight: 500; color: var(--color-emerald); letter-spacing: 0.05em; opacity: 0.7; transition: opacity 0.2s; }
    .project-spread__link:hover { opacity: 1; text-decoration: none; }
    @media (max-width: 700px) {
      .project-spread { grid-template-columns: 1fr; min-height: auto; }
      .project-spread--reverse .project-spread__img-wrap { order: 0; }
      .project-spread--reverse .project-spread__text { order: 0; }
      .project-spread__img-wrap { min-height: 250px; }
      .project-spread__img-fade--right, .project-spread__img-fade--left { background: linear-gradient(to bottom, transparent 60%, var(--color-void)); }
      .project-spread__text { padding: 32px 24px; }
      .project-spread__name { font-size: 1.4rem; }
    }

    /* ---- How It Works ---- */
    .hiw-section-dark { padding: 100px 0; border-top: 1px solid var(--color-border); }
    .hiw-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 48px; }
    .hiw-card {
      background: var(--color-card); border: 1px solid var(--color-border);
      border-radius: 16px; padding: 32px 28px;
      transition: border-color 0.3s, transform 0.3s;
    }
    .hiw-card:hover { border-color: var(--color-border-emerald); transform: translateY(-3px); }
    .hiw-card__num { font-family: var(--font-mono); font-size: 13px; font-weight: 700; color: var(--color-emerald); margin-bottom: 16px; letter-spacing: 0.1em; }
    .hiw-card__title { font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--color-cream); margin: 0 0 8px; }
    .hiw-card__desc { font-size: 14px; color: var(--color-muted); line-height: 1.6; margin: 0; }
    .install-block {
      background: var(--color-surface); border: 1px solid var(--color-border-light);
      border-radius: 12px; padding: 20px 24px; display: flex; align-items: center; gap: 12px;
      transition: border-color 0.2s;
    }
    .install-block:hover { border-color: var(--color-emerald); }
    .install-block code { font-family: var(--font-mono); font-size: 14px; color: var(--color-cream-soft); white-space: nowrap; overflow-x: auto; flex: 1; }
    .copy-btn {
      font-family: var(--font-mono); font-size: 0.62rem; font-weight: 500;
      background: transparent; color: var(--color-dim);
      border: 1px solid var(--color-border); border-radius: 5px;
      padding: 4px 10px; cursor: pointer; white-space: nowrap;
      transition: all 0.2s;
    }
    .copy-btn:hover { color: var(--color-emerald); border-color: var(--color-border-emerald); }
    @media (max-width: 700px) {
      .hiw-cards { grid-template-columns: 1fr; }
      .install-block { flex-direction: column; text-align: center; }
    }

    /* ---- Trust comparison table ---- */
    .trust-compare-section { padding: 100px 0; border-top: 1px solid var(--color-border); }
    .trust-table { max-width: 800px; margin: 48px auto 0; border: 1px solid var(--color-border); border-radius: 16px; overflow: hidden; }
    .trust-table-header { display: grid; grid-template-columns: 1fr 1fr; }
    .trust-table-header div { padding: 20px 28px; font-family: var(--font-ui); font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; }
    .trust-table-header div:first-child { background: var(--color-surface); color: var(--color-muted); border-right: 1px solid var(--color-border); }
    .trust-table-header div:last-child { background: var(--color-emerald-dim); color: var(--color-emerald); border-right: none; }
    .trust-row { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid var(--color-border); opacity: 0; transform: translateY(16px); transition: opacity 0.5s ease, transform 0.5s ease; }
    .trust-row.visible { opacity: 1; transform: translateY(0); }
    .trust-row div { padding: 16px 28px; font-size: 14px; line-height: 1.6; }
    .trust-row div:first-child { color: var(--color-muted); background: var(--color-surface); border-right: 1px solid var(--color-border); transition: background 0.3s ease; }
    .trust-row div:last-child { color: var(--color-cream-soft); background: var(--color-card); transition: background 0.3s ease; }
    .trust-row:hover div:first-child { background: rgba(255,255,255,0.03); }
    .trust-row:hover div:last-child { background: rgba(255,255,255,0.04); }

    /* ---- Subscribe card (hero) ---- */
    .subscribe-card {
      background: var(--color-glass); backdrop-filter: blur(24px);
      border: 1px solid var(--color-border-light); border-radius: 16px; padding: 28px;
      scroll-margin-top: 96px;
    }
    .plan-option {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px; border: 2px solid var(--color-border);
      border-radius: 10px; cursor: pointer; transition: all 0.15s; margin-bottom: 8px;
    }
    .plan-option:hover, .plan-option.selected { border-color: var(--color-emerald); background: var(--color-emerald-dim); }
    .plan-option__name { font-family: var(--font-ui); font-weight: 700; font-size: 14px; color: var(--color-cream); }
    .plan-option__desc { font-size: 11px; color: var(--color-muted); }
    .plan-option__price { font-family: var(--font-mono); font-weight: 800; font-size: 15px; color: var(--color-emerald); }

    /* ---- Pricing interval toggle ---- */
    .interval-btn {
      font-family: var(--font-ui); font-size: 0.68rem; font-weight: 500;
      padding: 6px 14px; border-radius: 6px; border: none; cursor: pointer;
      transition: all 0.2s; background: transparent; color: var(--color-dim);
    }
    .interval-btn--active {
      background: var(--color-card); color: var(--color-cream);
      box-shadow: 0 1px 2px rgba(0,0,0,0.2);
    }
    .interval-btn--yearly {
      border: none;
    }
    .interval-btn--yearly.interval-btn--active {
      background: var(--color-card); color: var(--color-cream);
    }
    .regen-tier__effective {
      font-size: 13px; color: var(--color-emerald); font-weight: 600;
      margin: -4px 0 8px;
    }

    /* ---- Final CTA ---- */
    .cta-section { position: relative; padding: 100px 0; overflow: hidden; text-align: center; }
    .cta-bg { position: absolute; inset: 0; background: url('/public/cta-bg.webp') center / cover; filter: brightness(0.25) saturate(0.8); }
    .cta-gradient { position: absolute; inset: 0; background: linear-gradient(to bottom, var(--color-void), rgba(5,6,10,0.3) 30%, rgba(5,6,10,0.3) 70%, var(--color-void)); }
    .cta-content { position: relative; z-index: 1; max-width: 640px; margin: 0 auto; padding: 0 24px; }

    /* ---- Annual nudge modal (dark) ---- */
    .nudge-overlay {
      display: none; position: fixed; inset: 0; z-index: 9999;
      background: rgba(0,0,0,0.6); align-items: center; justify-content: center;
    }
    .nudge-overlay.active { display: flex; }
    .nudge-box {
      background: var(--color-surface); border: 1px solid var(--color-border-light);
      border-radius: var(--regen-radius-lg);
      padding: 32px 28px; max-width: 420px; width: 90%;
      box-shadow: 0 12px 40px rgba(0,0,0,0.5); text-align: center;
      position: relative;
    }
    .nudge-box h3 {
      font-size: 20px; font-weight: 800; color: var(--color-cream);
      margin: 0 0 16px;
    }
    .nudge-reason {
      display: flex; align-items: flex-start; gap: 10px;
      text-align: left; margin-bottom: 12px;
    }
    .nudge-reason-icon {
      flex-shrink: 0; width: 28px; height: 28px; line-height: 28px;
      border-radius: 50%; background: var(--color-emerald); color: #fff;
      font-size: 14px; font-weight: 800; text-align: center;
    }
    .nudge-reason p {
      margin: 0; font-size: 14px; color: var(--color-muted); line-height: 1.5;
    }
    .nudge-reason strong { color: var(--color-cream); }
    .nudge-btns {
      display: flex; flex-direction: column; gap: 10px; margin-top: 20px;
    }
    .nudge-btn-yearly {
      display: block; width: 100%; padding: 12px;
      background: var(--color-emerald);
      color: #fff; border: none; border-radius: 10px;
      font-size: 15px; font-weight: 700; cursor: pointer;
      transition: opacity 0.15s;
    }
    .nudge-btn-yearly:hover { opacity: 0.9; }
    .nudge-btn-monthly {
      display: block; width: 100%; padding: 10px;
      background: transparent; color: var(--color-muted);
      border: 1px solid var(--color-border-light); border-radius: 10px;
      font-size: 13px; cursor: pointer;
      transition: background 0.15s;
    }
    .nudge-btn-monthly:hover { background: var(--color-card); }

    /* ---- Crypto checkout modal (dark) ---- */
    .crypto-overlay {
      display: none; position: fixed; inset: 0; z-index: 10000;
      background: rgba(0,0,0,0.6); align-items: center; justify-content: center;
    }
    .crypto-overlay.active { display: flex; }
    .crypto-box {
      background: var(--color-surface); border: 1px solid var(--color-border-light);
      border-radius: var(--regen-radius-lg);
      padding: 32px 28px; max-width: 480px; width: 92%;
      box-shadow: 0 12px 40px rgba(0,0,0,0.5); position: relative;
      max-height: 90vh; overflow-y: auto;
    }
    .crypto-box h3 {
      font-size: 20px; font-weight: 800; color: var(--color-cream);
      margin: 0 0 6px;
    }
    .crypto-box .crypto-subtitle {
      font-size: 14px; color: var(--color-muted); margin: 0 0 20px;
    }
    .crypto-close {
      position: absolute; top: 12px; right: 16px;
      background: none; border: none; font-size: 22px; color: var(--color-dim);
      cursor: pointer; line-height: 1; padding: 4px;
    }
    .crypto-close:hover { color: var(--color-cream); }
    .crypto-step { display: none; }
    .crypto-step.active { display: block; }
    .crypto-plans {
      display: flex; flex-direction: column; gap: 10px;
    }
    .crypto-plan {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 18px; border: 2px solid var(--color-border);
      border-radius: 10px; cursor: pointer; transition: all 0.15s;
    }
    .crypto-plan:hover { border-color: var(--color-emerald); background: var(--color-emerald-dim); }
    .crypto-plan-name { font-weight: 700; color: var(--color-cream); font-size: 15px; }
    .crypto-plan-price { font-weight: 800; color: var(--color-emerald); font-size: 16px; }
    .crypto-plan-desc { font-size: 12px; color: var(--color-dim); }
    .crypto-chain-tabs {
      display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px;
    }
    .crypto-chain-tab {
      padding: 6px 14px; border: 1px solid var(--color-border);
      border-radius: 8px; font-size: 13px; font-weight: 600;
      cursor: pointer; background: var(--color-card); color: var(--color-muted);
      transition: all 0.15s;
    }
    .crypto-chain-tab:hover { border-color: var(--color-emerald); }
    .crypto-chain-tab.active {
      background: var(--color-emerald); color: #fff; border-color: var(--color-emerald);
    }
    .crypto-addr-box {
      background: var(--color-card); border: 1px solid var(--color-border);
      border-radius: 10px; padding: 16px; text-align: center;
    }
    .crypto-addr-box .qr-container {
      margin: 0 auto 12px; width: 160px; height: 160px;
    }
    .crypto-addr-box .qr-container svg { width: 100%; height: 100%; }
    .crypto-addr-text {
      font-family: monospace; font-size: 12px; word-break: break-all;
      color: var(--color-cream); background: var(--color-surface);
      padding: 8px 12px; border-radius: 6px; border: 1px solid var(--color-border);
      cursor: pointer; position: relative;
    }
    .crypto-addr-text:hover { border-color: var(--color-emerald); }
    .crypto-copied {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      background: var(--color-emerald); color: #fff; border-radius: 6px;
      font-family: var(--font-body); font-size: 13px; font-weight: 700;
      opacity: 0; transition: opacity 0.2s; pointer-events: none;
    }
    .crypto-copied.show { opacity: 1; }
    .crypto-send-amount {
      font-size: 14px; color: var(--color-muted); margin: 12px 0 0;
    }
    .crypto-send-amount strong { color: var(--color-cream); }
    .crypto-evm-chain-select {
      margin-bottom: 12px;
    }
    .crypto-evm-chain-select select {
      width: 100%; padding: 8px 12px; border: 1px solid var(--color-border);
      border-radius: 8px; font-size: 14px; color: var(--color-cream);
      background: var(--color-card); cursor: pointer;
    }
    .crypto-input {
      width: 100%; padding: 10px 14px; border: 1px solid var(--color-border);
      border-radius: 8px; font-size: 14px; font-family: monospace;
      box-sizing: border-box; background: var(--color-card); color: var(--color-cream);
    }
    .crypto-input:focus { outline: none; border-color: var(--color-emerald); }
    .crypto-label {
      display: block; font-weight: 600; font-size: 14px;
      color: var(--color-cream); margin-bottom: 6px;
    }
    .crypto-field { margin-bottom: 14px; }
    .crypto-result {
      text-align: center; padding: 16px;
    }
    .crypto-result-icon {
      width: 56px; height: 56px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 12px; font-size: 28px;
    }
    .crypto-result-icon.success { background: var(--color-emerald-dim); }
    .crypto-result-icon.error { background: rgba(204,51,51,0.15); }
    .crypto-result h4 { font-size: 18px; font-weight: 800; margin: 0 0 8px; }
    .crypto-result p { font-size: 14px; color: var(--color-muted); margin: 0 0 16px; }
    .crypto-spinner {
      width: 32px; height: 32px; border: 3px solid var(--color-border);
      border-top-color: var(--color-emerald); border-radius: 50%;
      animation: crypto-spin 0.8s linear infinite; margin: 0 auto 12px;
    }
    @keyframes crypto-spin { to { transform: rotate(360deg); } }
    .crypto-back {
      background: none; border: none; color: var(--color-dim);
      font-size: 13px; cursor: pointer; padding: 0; margin-bottom: 16px;
      display: inline-flex; align-items: center; gap: 4px;
    }
    .crypto-back:hover { color: var(--color-cream); }
    .crypto-badge {
      display: inline-flex; align-items: center; gap: 8px;
      font-size: 14px; font-weight: 600; color: var(--color-muted);
      cursor: pointer; transition: all 0.2s;
      border: 1px solid var(--color-border); border-radius: 8px;
      padding: 10px 18px; background: var(--color-card);
    }
    .crypto-badge:hover { color: var(--color-emerald); border-color: var(--color-emerald); background: var(--color-emerald-dim); }
    .crypto-badge svg { opacity: 0.7; transition: opacity 0.15s; }
    .crypto-badge:hover svg { opacity: 1; }

    /* ---- Orgs section ---- */
    .orgs-section { padding: 64px 0; border-top: 1px solid var(--color-border); }
  </style>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "name": "Regen Compute",
  "applicationCategory": "DeveloperApplication",
  "description": "Ecological accountability for AI compute — retire verified ecocredits on Regen Network. MCP server for Claude, Cursor, and any MCP-compatible AI tool.",
  "operatingSystem": "Any",
  "url": "https://compute.regen.network",
  "inLanguage": "en",
  "offers": [
    { "@type": "Offer", "name": "Dabbler", "description": "For casual AI users", "priceSpecification": { "@type": "UnitPriceSpecification", "price": "1.25", "priceCurrency": "USD", "unitCode": "MON", "referenceQuantity": { "@type": "QuantitativeValue", "value": "1", "unitCode": "MON" } } },
    { "@type": "Offer", "name": "Builder", "description": "For regular AI developers", "priceSpecification": { "@type": "UnitPriceSpecification", "price": "2.50", "priceCurrency": "USD", "unitCode": "MON", "referenceQuantity": { "@type": "QuantitativeValue", "value": "1", "unitCode": "MON" } } },
    { "@type": "Offer", "name": "Agent", "description": "For AI-native teams and autonomous agents", "priceSpecification": { "@type": "UnitPriceSpecification", "price": "50.00", "priceCurrency": "USD", "unitCode": "ANN", "referenceQuantity": { "@type": "QuantitativeValue", "value": "1", "unitCode": "ANN" } } }
  ],
  "provider": {
    "@type": "Organization",
    "name": "Regen Network Development",
    "url": "https://regen.network"
  }
}
</script>
${brandSchemaOrg()}
</head>
<body>
  ${betaBannerHTML()}

  ${referralValid ? `<div class="regen-ref-banner"><span>${t(lang, "referral_banner_prefix")}</span> ${t(lang, "referral_banner_suffix")}</div>` : ""}

  ${brandHeader({ nav: [{ label: t(lang, "nav_ai_plugin"), href: "/ai-plugin" }, { label: t(lang, "nav_research"), href: "/research" }, { label: t(lang, "nav_about"), href: "/about" }, { label: "Developers", href: "/developers" }, { label: t(lang, "nav_dashboard"), href: "/dashboard/login" }], navSuffix: `
    <div class="lang-picker">
      <button class="lang-picker__btn" onclick="this.nextElementSibling.classList.toggle('open')" type="button">
        <span class="lang-picker__flag">${LANG_FLAGS[lang]}</span>
        <span class="lang-picker__code">${LANG_SHORT[lang]}</span>
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" style="margin-left:2px;"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="lang-picker__menu">
        ${SUPPORTED_LANGS.map(l => `<a class="lang-picker__item${l === lang ? ' lang-picker__item--active' : ''}" href="${l === 'en' ? '/' : '/' + l}"><span class="lang-picker__flag">${LANG_FLAGS[l]}</span> ${LANG_NAMES[l]}</a>`).join('')}
      </div>
    </div>` })}

  <!-- ==================== HERO ==================== -->
  <section class="hero-section">
    <div class="hero-bg"><img src="/public/hero.webp" alt="Regenerative ecological landscape" width="1920" height="1080" fetchpriority="high"></div>
    <div class="hero-gradient"></div>
    <div class="hero-content">
      <!-- Left: Story -->
      <div>
        <div class="hero-inline-logo" style="display:flex;align-items:center;gap:12px;margin-bottom:32px;">
          <span style="color:var(--color-cream);display:inline-flex;align-items:center;">${regenLogoSVG.replace('width="186" height="84"', 'width="auto" height="36"')}</span>
        </div>
        <h1 style="font-family:var(--font-display);font-size:clamp(2.6rem,5vw,4rem);font-weight:700;line-height:1.08;letter-spacing:-0.01em;margin:0 0 28px;color:var(--color-cream);">
          ${t(lang, "hero_title")}
          <br>
          <span style="background:linear-gradient(to bottom right,var(--color-emerald),var(--color-emerald-bright));-webkit-background-clip:text;-webkit-text-fill-color:transparent;">${t(lang, "hero_title_highlight")}</span>
        </h1>
        <p style="font-size:1.15rem;line-height:1.75;color:var(--color-cream-soft);margin:0 0 20px;max-width:540px;">
          ${t(lang, "hero_desc")}
        </p>
        <p style="font-size:0.95rem;line-height:1.7;color:var(--color-muted);margin:0 0 36px;max-width:520px;">
          No carbon-neutrality claims. No greenwashing. Every single credit retirement is permanently recorded on <a href="https://regen.network" target="_blank" style="color:var(--color-emerald);text-decoration:underline;text-decoration-color:rgba(43,153,79,0.3);">Regen Network</a>'s public ledger.
        </p>
      </div>

      <!-- Right: Subscribe Card -->
      <div id="pricing" class="subscribe-card" style="scroll-margin-top:96px;">
        <h3 style="font-family:var(--font-ui);font-size:0.95rem;font-weight:600;color:var(--color-cream);margin:0 0 4px;">Choose your commitment</h3>
        <p style="font-size:0.78rem;color:var(--color-muted);margin:0 0 20px;line-height:1.6;">100% funds verified ecological credit retirements. Cancel anytime.</p>

        <!-- Monthly/Yearly toggle -->
        <div style="display:flex;align-items:center;gap:4px;padding:2px;background:var(--color-surface);border-radius:8px;margin-bottom:16px;width:fit-content;">
          <button id="toggle-monthly" onclick="setPricingInterval('monthly')" class="interval-btn interval-btn--active">${t(lang, "toggle_monthly")}</button>
          <button id="toggle-yearly" onclick="setPricingInterval('yearly')" class="interval-btn interval-btn--yearly">${t(lang, "toggle_yearly")} <span style="font-size:0.55rem;color:var(--color-emerald);font-family:var(--font-mono);">${t(lang, "toggle_save")}</span></button>
        </div>

        <!-- Plan options -->
        <div class="plan-option" onclick="${hasPriceIds ? "subscribe('dabbler')" : `window.location.href='${dabblerUrl}'`}">
          <div>
            <div class="plan-option__name">${t(lang, "tier_dabbler")}</div>
            <div class="plan-option__desc">${t(lang, "tier_dabbler_desc")}${referralValid ? ` &mdash; <strong style="color:var(--color-emerald);">${t(lang, "tier_first_month_free")}</strong>` : ""}</div>
          </div>
          <div>
            <span class="plan-option__price price-monthly">$1.25<span style="font-size:11px;color:var(--color-muted);font-weight:400;">/mo</span></span>
            <span class="plan-option__price price-yearly" style="display:none;">$12.50<span style="font-size:11px;color:var(--color-muted);font-weight:400;">/yr</span></span>
          </div>
        </div>
        <div class="plan-option selected" onclick="${hasPriceIds ? "subscribe('builder')" : `window.location.href='${builderUrl}'`}">
          <div>
            <div class="plan-option__name">${t(lang, "tier_builder")} <span style="font-size:10px;background:var(--color-emerald);color:#fff;padding:2px 8px;border-radius:10px;margin-left:6px;font-weight:700;">${t(lang, "tier_builder_badge")}</span></div>
            <div class="plan-option__desc">${t(lang, "tier_builder_desc")}${referralValid ? ` &mdash; <strong style="color:var(--color-emerald);">${t(lang, "tier_first_month_free")}</strong>` : ""}</div>
          </div>
          <div>
            <span class="plan-option__price price-monthly">$2.50<span style="font-size:11px;color:var(--color-muted);font-weight:400;">/mo</span></span>
            <span class="plan-option__price price-yearly" style="display:none;">$25<span style="font-size:11px;color:var(--color-muted);font-weight:400;">/yr</span></span>
          </div>
        </div>
        <div class="plan-option" onclick="${hasPriceIds ? "subscribe('agent')" : `window.location.href='${agentUrl}'`}">
          <div>
            <div class="plan-option__name">${t(lang, "tier_agent")}</div>
            <div class="plan-option__desc">${t(lang, "tier_agent_desc")}${referralValid ? ` &mdash; <strong style="color:var(--color-emerald);">${t(lang, "tier_first_month_free")}</strong>` : ""}</div>
          </div>
          <div>
            <span class="plan-option__price price-monthly">$5<span style="font-size:11px;color:var(--color-muted);font-weight:400;">/mo</span></span>
            <span class="plan-option__price price-yearly" style="display:none;">$50<span style="font-size:11px;color:var(--color-muted);font-weight:400;">/yr</span></span>
          </div>
        </div>

        <!-- Yearly effective rates (hidden by default) -->
        <div class="regen-tier__effective price-yearly" style="display:none;text-align:center;margin-top:8px;">+ ${t(lang, "tier_yearly_bonus")}</div>

        <!-- Crypto + one-time links -->
        <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--color-border);">
          <div style="display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;">
            <a href="https://app.regen.network/projects/1?buying_options_filters=credit_card" target="_blank" rel="noopener" style="font-family:var(--font-ui);font-size:13px;color:var(--color-muted);text-decoration:underline;text-decoration-color:var(--color-border-light);">${t(lang, "onetime_title")}</a>
          </div>
        </div>

        <!-- Team plan link -->
        <div style="margin-top:12px;text-align:center;">
          <a href="#" onclick="event.preventDefault();showOrgForm()" style="font-family:var(--font-ui);font-size:12px;color:var(--color-dim);">${t(lang, "org_cta_heading")} &rarr;</a>
        </div>
      </div>
    </div>
  </section>

  <!-- ==================== PROBLEM / STATS ==================== -->
  <section class="problem-section">
    <canvas class="problem-canvas" id="ripple-canvas"></canvas>
    <div class="problem-content">
      <p style="font-family:var(--font-ui);font-size:13px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-emerald);margin:0 0 16px;">${t(lang, "stats_title")}</p>
      <h2 style="font-family:var(--font-display);font-size:clamp(1.8rem,3.5vw,2.8rem);font-weight:700;color:var(--color-cream);margin:0 0 16px;max-width:600px;line-height:1.15;">The Uncomfortable Math</h2>
      <p style="font-size:1rem;color:var(--color-muted);max-width:560px;line-height:1.7;margin:0;">
        ${t(lang, "impact_prefix")} <strong style="color:var(--color-cream);white-space:nowrap;">${t(lang, "impact_co2_daily")}</strong>. ${t(lang, "impact_middle")} <strong style="color:var(--color-cream);white-space:nowrap;">${t(lang, "impact_co2_agentic")}</strong>.
        <a href="/research" style="color:var(--color-emerald);font-weight:600;margin-left:4px;">${t(lang, "impact_link")} &rarr;</a>
      </p>
      <div class="stats-grid-dark">
        <div class="stat-card-dark">
          <div class="stat-num">${totalRetirements}</div>
          <div class="stat-label">${t(lang, "stats_credits")}</div>
        </div>
        <div class="stat-card-dark">
          <div class="stat-num">6</div>
          <div class="stat-label">Verified Projects</div>
        </div>
        <div class="stat-card-dark">
          <div class="stat-num">5</div>
          <div class="stat-label">${t(lang, "stats_credit_types")}</div>
        </div>
        <div class="stat-card-dark">
          <div class="stat-num">9+</div>
          <div class="stat-label">${t(lang, "stats_countries")}</div>
        </div>
      </div>
    </div>
  </section>

  <!-- ==================== PROJECTS ==================== -->
  <section id="projects" style="padding:40px 0 0;">
    <div style="max-width:1200px;margin:0 auto;padding:0 24px 48px;display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:12px;">
      <h2 style="font-family:var(--font-display);font-size:2rem;font-weight:600;color:var(--color-cream);margin:0;">Where your money goes</h2>
      <a href="https://app.regen.network" target="_blank" rel="noopener" style="font-family:var(--font-mono);font-size:0.68rem;color:var(--color-muted);letter-spacing:0.05em;transition:color 0.2s;">View all on Regen Marketplace &rarr;</a>
    </div>

    ${PROJECTS.map((p, i) => {
      const reversed = i % 2 !== 0;
      const fadeClass = reversed ? 'project-spread__img-fade--left' : 'project-spread__img-fade--right';
      return `
    <div class="project-spread${reversed ? ' project-spread--reverse' : ''}">
      <div class="project-spread__img-wrap">
        <img class="project-spread__img" src="${p.imageUrl}" alt="${p.imageAlt}" width="${p.imageWidth}" height="${p.imageHeight}" loading="lazy">
        <div class="project-spread__img-fade ${fadeClass}"></div>
      </div>
      <div class="project-spread__text">
        <span class="project-spread__badge" style="background:${p.accentColor}14;color:${p.accentColor};border-color:${p.accentColor}26;">
          <span class="project-spread__badge-dot"></span>
          ${p.creditTypeLabel}
        </span>
        <h3 class="project-spread__name">${p.name}</h3>
        <p class="project-spread__location">${p.location} &middot; Credit Class ${p.creditClassId}</p>
        <p class="project-spread__desc">${p.description}</p>
        <div class="project-spread__links">
          <a class="project-spread__link" href="https://www.mintscan.io/regen/credit-class/${p.creditClassId}" target="_blank" rel="noopener">Verify on Regen Ledger &rarr;</a>
          <a class="project-spread__link" href="${p.projectPageUrl}" target="_blank" rel="noopener">${t(lang, "basket_view_project")} &rarr;</a>
        </div>
      </div>
    </div>`;
    }).join('')}
  </section>

  <!-- ==================== HOW IT WORKS ==================== -->
  <section class="hiw-section-dark" id="how">
    <div style="max-width:1200px;margin:0 auto;padding:0 24px;">
      <p style="font-family:var(--font-ui);font-size:13px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-emerald);margin:0 0 16px;text-align:center;">${t(lang, "hiw_title")}</p>
      <h2 style="font-family:var(--font-display);font-size:clamp(1.8rem,3.5vw,2.8rem);font-weight:700;color:var(--color-cream);margin:0 0 8px;text-align:center;">Three steps to ecological accountability</h2>
      <div class="hiw-cards">
        <div class="hiw-card">
          <div class="hiw-card__num">01 SUBSCRIBE</div>
          <h3 class="hiw-card__title">${t(lang, "hiw_step1_title")}</h3>
          <p class="hiw-card__desc">${t(lang, "hiw_step1_desc")}</p>
        </div>
        <div class="hiw-card">
          <div class="hiw-card__num">02 CONNECT</div>
          <h3 class="hiw-card__title">${t(lang, "hiw_step2_title")}</h3>
          <p class="hiw-card__desc">${t(lang, "hiw_step2_desc")}</p>
        </div>
        <div class="hiw-card">
          <div class="hiw-card__num">03 VERIFY</div>
          <h3 class="hiw-card__title">${t(lang, "hiw_step3_title")}</h3>
          <p class="hiw-card__desc">${t(lang, "hiw_step3_desc")}</p>
        </div>
      </div>

      <!-- Install command -->
      <div style="margin-top:64px;max-width:680px;margin-left:auto;margin-right:auto;">
        <div style="text-align:center;margin-bottom:24px;">
          <div style="font-family:var(--font-mono);font-size:0.6rem;color:var(--color-emerald);letter-spacing:0.2em;text-transform:uppercase;margin-bottom:8px;">Works with Claude, Cursor, VS Code, Windsurf, Gemini</div>
          <h3 style="font-family:var(--font-display);font-size:1.25rem;font-weight:600;color:var(--color-cream);margin:0;">One command to connect your AI</h3>
        </div>
        <div class="install-block">
          <span style="color:var(--color-emerald);font-size:1.1rem;font-family:var(--font-mono);">$</span>
          <code id="install-cmd">claude mcp add -s user regen-compute -- npx regen-compute</code>
          <button class="copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('install-cmd').textContent);this.textContent='Copied!';setTimeout(()=>{this.textContent='Copy'},1500);">Copy</button>
        </div>
        <p style="text-align:center;margin-top:12px;font-family:var(--font-mono);font-size:0.6rem;color:var(--color-dim);">Zero config. Read-only tools work immediately. On-chain retirement requires a wallet.</p>
      </div>
    </div>
  </section>

  <!-- ==================== TRUST COMPARISON ==================== -->
  <section class="trust-compare-section">
    <div style="max-width:1200px;margin:0 auto;padding:0 24px;text-align:center;">
      <p style="font-family:var(--font-ui);font-size:13px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-emerald);margin:0 0 16px;">${t(lang, "trust_title")}</p>
      <h2 style="font-family:var(--font-display);font-weight:700;color:var(--color-cream);margin:0;line-height:1.2;"><span style="font-size:clamp(1.2rem,2.5vw,1.8rem);display:block;color:var(--color-muted);">This is not a carbon offset program.</span><span style="font-size:clamp(1.8rem,3.5vw,2.8rem);">This is Regeneration.</span></h2>
    </div>
    <div class="trust-table" id="trust-table">
      <div class="trust-table-header">
        <div>Traditional Offsets</div>
        <div>Regen Compute</div>
      </div>
      <div class="trust-row">
        <div>Opaque registries &mdash; hard to verify claims independently</div>
        <div>${t(lang, "trust_auditable_desc")}</div>
      </div>
      <div class="trust-row">
        <div>Carbon-only &mdash; ignores biodiversity, species, soil health</div>
        <div>${t(lang, "trust_beyond_desc")}</div>
      </div>
      <div class="trust-row">
        <div>Proprietary data behind paywalls</div>
        <div>${t(lang, "trust_open_desc")}</div>
      </div>
      <div class="trust-row">
        <div>Middlemen take 30-50% in fees</div>
        <div>75% goes directly to credit purchases. 5% burns REGEN supply. 20% operations.</div>
      </div>
      <div class="trust-row">
        <div>One-time purchase, no ongoing accountability</div>
        <div>Monthly retirements with on-chain proof and retirement certificates you can share.</div>
      </div>
    </div>
  </section>

  ${publicOrgs.length > 0 ? `
  <!-- ==================== ORGANIZATIONS ==================== -->
  <section class="orgs-section">
    <div style="max-width:1200px;margin:0 auto;padding:0 24px;text-align:center;">
      <h2 style="font-family:var(--font-display);font-size:clamp(1.6rem,3vw,2.4rem);font-weight:700;color:var(--color-cream);margin:0 0 12px;">${t(lang, "orgs_title")}</h2>
      <p style="font-size:1rem;color:var(--color-muted);margin:0 0 32px;">${t(lang, "orgs_desc")}</p>
      <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:16px;">
        ${publicOrgs.map(o => `<div style="background:var(--color-card);border:1px solid var(--color-border);border-radius:10px;padding:14px 24px;font-weight:600;color:var(--color-cream);font-size:15px;font-family:var(--font-ui);">${o.name.replace(/</g, "&lt;")}</div>`).join("")}
      </div>
    </div>
  </section>
  ` : ""}

  <!-- ==================== ORGANIZATION FORM (hidden) ==================== -->
  <div id="org-cta" style="display:none;"></div>
  <div id="org-form" style="display:none;padding:48px 24px;">
    <div style="background:var(--color-surface);border:1px solid var(--color-border-light);border-radius:var(--regen-radius-lg);padding:28px 32px;max-width:560px;margin:0 auto;">
      <h3 style="margin:0 0 4px;font-size:18px;color:var(--color-cream);font-weight:700;">${t(lang, "org_title")}</h3>
      <p style="color:var(--color-muted);font-size:14px;margin:0 0 20px;">${t(lang, "org_desc")}</p>
      <div style="margin-bottom:18px;">
        <label style="display:block;font-weight:600;font-size:14px;color:var(--color-cream);margin-bottom:6px;">${t(lang, "org_label_name")}</label>
        <input id="org-name" type="text" placeholder="${t(lang, "org_placeholder_name")}" class="regen-input">
      </div>
      <div style="margin-bottom:18px;">
        <label style="display:block;font-weight:600;font-size:14px;color:var(--color-cream);margin-bottom:6px;">${t(lang, "org_label_devs")} <span style="font-weight:400;color:var(--color-muted);">${t(lang, "org_hint_devs")}</span></label>
        <input id="org-devs" type="number" min="0" value="0" class="regen-input" style="width:100px;text-align:center;">
      </div>
      <div style="margin-bottom:18px;">
        <label style="display:block;font-weight:600;font-size:14px;color:var(--color-cream);margin-bottom:6px;">${t(lang, "org_label_agents")} <span style="font-weight:400;color:var(--color-muted);">${t(lang, "org_hint_agents")}</span></label>
        <input id="org-agents" type="number" min="0" value="0" class="regen-input" style="width:100px;text-align:center;">
      </div>
      <div style="margin-bottom:24px;">
        <label style="display:block;font-weight:600;font-size:14px;color:var(--color-cream);margin-bottom:6px;">${t(lang, "org_label_parttime")} <span style="font-weight:400;color:var(--color-muted);">${t(lang, "org_hint_parttime")}</span></label>
        <input id="org-parttime" type="number" min="0" value="0" class="regen-input" style="width:100px;text-align:center;">
      </div>

      <!-- Calculated estimate -->
      <div id="org-estimate" style="display:none;background:var(--color-emerald-dim);border:1px solid var(--color-border-emerald);border-radius:10px;padding:20px 24px;margin-bottom:20px;">
        <div style="font-size:13px;color:var(--color-muted);margin-bottom:4px;">${t(lang, "org_estimate_label")}</div>
        <div style="display:flex;align-items:baseline;gap:8px;">
          <span id="org-price" style="font-size:32px;font-weight:800;color:var(--color-cream);">$0</span>
          <span style="font-size:14px;color:var(--color-muted);">${t(lang, "org_estimate_unit")}</span>
        </div>
        <div id="org-breakdown" style="margin-top:10px;font-size:13px;color:var(--color-cream-soft);line-height:1.6;"></div>
        <div style="margin-top:12px;font-size:12px;color:var(--color-dim);">${t(lang, "org_estimate_note")}</div>
      </div>

      <button id="org-subscribe-btn" onclick="subscribeOrg()" class="regen-btn regen-btn--solid regen-btn--block" style="font-size:16px;padding:14px;">${t(lang, "org_submit")}</button>
      <p id="org-error" style="color:#fca5a5;font-size:13px;margin:8px 0 0;display:none;text-align:center;"></p>
      <p style="text-align:center;margin:16px 0 0;font-size:14px;color:var(--color-muted);">Have questions? <a href="https://calendar.app.google/PQV1pY7kjiBPN5eZ8" target="_blank" rel="noopener" style="color:var(--color-emerald);font-weight:600;">Schedule a call</a> with our team.</p>
    </div>
  </div>

  <!-- ==================== FINAL CTA ==================== -->
  <section class="cta-section">
    <div class="cta-bg"></div>
    <div class="cta-gradient"></div>
    <div class="cta-content">
      <h2 style="font-family:var(--font-display);font-size:clamp(2rem,4vw,3rem);font-weight:700;color:var(--color-cream);margin:0 0 16px;line-height:1.1;">Join the movement</h2>
      <p style="font-size:1.05rem;color:var(--color-cream-soft);margin:0 0 32px;line-height:1.7;">Every AI session can fund real ecological regeneration. Start for $1.25/month.</p>
      <div style="display:flex;justify-content:center;gap:16px;flex-wrap:wrap;">
        <a class="regen-btn regen-btn--solid" href="#pricing" style="font-size:16px;padding:14px 32px;">Subscribe Now</a>
        <a class="regen-btn regen-btn--dark" href="https://github.com/regen-network/regen-compute" target="_blank" rel="noopener" style="font-size:16px;padding:14px 32px;">View on GitHub</a>
      </div>
    </div>
  </section>

  ${brandFooter({ showInstall: false, links: [
    { label: "Regen Network", href: "https://regen.network" },
    { label: "Marketplace", href: "https://app.regen.network" },
    { label: "GitHub", href: "https://github.com/regen-network/regen-compute" },
  ] })}

  <button onclick="window.location.href='/?view=agent'" style="position:fixed;bottom:24px;right:24px;z-index:9999;background:var(--color-surface);color:var(--color-emerald);border:1px solid var(--color-border-emerald);border-radius:8px;padding:10px 18px;cursor:pointer;font-family:var(--font-mono);font-size:13px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,0.3);transition:all 0.2s;" onmouseover="this.style.background='var(--color-card)'" onmouseout="this.style.background='var(--color-surface)'">&#129302; Agent View</button>

  <script>
    // Close language picker when clicking outside
    document.addEventListener('click', function(e) {
      document.querySelectorAll('.lang-picker__menu').forEach(function(menu) {
        var btn = menu.previousElementSibling;
        if (btn && !btn.contains(e.target) && !menu.contains(e.target)) {
          menu.classList.remove('open');
        }
      });
    });
    // Mobile nav: close menu when a link is clicked
    document.querySelectorAll('.regen-mobile-nav a').forEach(function(link) {
      link.addEventListener('click', function() {
        document.getElementById('mobile-nav').classList.remove('open');
        document.querySelector('.regen-hamburger').classList.remove('active');
      });
    });

    function showOrgForm() {
      document.getElementById('org-cta').style.display = 'none';
      document.getElementById('org-form').style.display = 'block';
      document.getElementById('org-name').focus();
    }

    function recalcOrg() {
      var devs = parseInt(document.getElementById('org-devs').value) || 0;
      var agents = parseInt(document.getElementById('org-agents').value) || 0;
      var parttime = parseInt(document.getElementById('org-parttime').value) || 0;

      if (devs + agents + parttime === 0) {
        document.getElementById('org-estimate').style.display = 'none';
        return;
      }

      // Pricing: devs $2.50/mo, agents $5/mo (always-on, highest compute), part-time $1.25/mo
      var devCost = devs * 250;
      var agentCost = agents * 500;
      var ptCost = parttime * 125;
      var totalCents = devCost + agentCost + ptCost;

      document.getElementById('org-estimate').style.display = 'block';
      document.getElementById('org-price').textContent = '$' + (totalCents / 100).toFixed(2).replace(/\\.00$/, '');

      var parts = [];
      if (devs > 0) parts.push(devs + ' developer' + (devs > 1 ? 's' : '') + ' x $2.50');
      if (agents > 0) parts.push(agents + ' agent' + (agents > 1 ? 's' : '') + ' x $5.00');
      if (parttime > 0) parts.push(parttime + ' part-time' + ' x $1.25');
      document.getElementById('org-breakdown').textContent = parts.join(' + ');
    }

    // Recalculate on any input change
    ['org-devs', 'org-agents', 'org-parttime'].forEach(function(id) {
      document.getElementById(id).addEventListener('input', recalcOrg);
    });

    function subscribeOrg() {
      var name = document.getElementById('org-name').value.trim();
      var devs = parseInt(document.getElementById('org-devs').value) || 0;
      var agents = parseInt(document.getElementById('org-agents').value) || 0;
      var parttime = parseInt(document.getElementById('org-parttime').value) || 0;
      var errEl = document.getElementById('org-error');
      errEl.style.display = 'none';

      if (!name) {
        errEl.textContent = 'Please enter your company name.';
        errEl.style.display = 'block';
        return;
      }
      if (devs + agents + parttime === 0) {
        errEl.textContent = 'Please enter at least one team member or agent.';
        errEl.style.display = 'block';
        return;
      }

      var totalCents = (devs * 250) + (agents * 500) + (parttime * 125);

      fetch('/subscribe-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_name: name, full_time_devs: devs, autonomous_agents: agents, part_time_users: parttime, amount_cents: totalCents })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.url) window.location.href = data.url;
        else {
          errEl.textContent = data.error || 'Something went wrong.';
          errEl.style.display = 'block';
        }
      })
      .catch(function(e) {
        errEl.textContent = e.message;
        errEl.style.display = 'block';
      });
    }
  </script>

  <script>
    var currentInterval = 'monthly';
    function setPricingInterval(interval) {
      currentInterval = interval;
      var monthlyEls = document.querySelectorAll('.price-monthly');
      var yearlyEls = document.querySelectorAll('.price-yearly');
      for (var i = 0; i < monthlyEls.length; i++) monthlyEls[i].style.display = interval === 'monthly' ? '' : 'none';
      for (var i = 0; i < yearlyEls.length; i++) yearlyEls[i].style.display = interval === 'yearly' ? '' : 'none';
      document.getElementById('toggle-monthly').className = 'interval-btn' + (interval === 'monthly' ? ' interval-btn--active' : '');
      document.getElementById('toggle-yearly').className = 'interval-btn interval-btn--yearly' + (interval === 'yearly' ? ' interval-btn--active' : '');
    }
  </script>

  <!-- Ripple canvas animation -->
  <script>
    (function() {
      var canvas = document.getElementById('ripple-canvas');
      if (!canvas) return;
      var ctx = canvas.getContext('2d');
      var ripples = [];
      var w, h;

      function resize() {
        var rect = canvas.parentElement.getBoundingClientRect();
        w = canvas.width = rect.width;
        h = canvas.height = rect.height;
      }
      resize();
      window.addEventListener('resize', resize);

      function spawnRipple() {
        ripples.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: 0,
          maxR: 80 + Math.random() * 120,
          alpha: 0.12 + Math.random() * 0.08,
          speed: 0.3 + Math.random() * 0.4
        });
        if (ripples.length > 8) ripples.shift();
      }

      function draw() {
        ctx.clearRect(0, 0, w, h);
        for (var i = ripples.length - 1; i >= 0; i--) {
          var rp = ripples[i];
          rp.r += rp.speed;
          var progress = rp.r / rp.maxR;
          if (progress >= 1) { ripples.splice(i, 1); continue; }
          var alpha = rp.alpha * (1 - progress);
          ctx.beginPath();
          ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(43, 153, 79, ' + alpha + ')';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
        requestAnimationFrame(draw);
      }

      setInterval(spawnRipple, 1200);
      spawnRipple();
      draw();
    })();
  </script>

  <!-- IntersectionObserver for trust table rows -->
  <script>
    (function() {
      var rows = document.querySelectorAll('.trust-row');
      if (!rows.length) return;
      var observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
          }
        });
      }, { threshold: 0.2 });
      rows.forEach(function(row, i) {
        row.style.transitionDelay = (i * 0.12) + 's';
        observer.observe(row);
      });
    })();
  </script>

  <!-- Crypto checkout modal -->
  <div class="crypto-overlay" id="crypto-overlay" onclick="if(event.target===this)closeCryptoCheckout()">
    <div class="crypto-box">
      <button class="crypto-close" onclick="closeCryptoCheckout()">&times;</button>

      <!-- Step 1: Choose plan -->
      <div class="crypto-step active" id="crypto-step-1">
        <h3>Pay with Crypto</h3>
        <p class="crypto-subtitle">Choose your plan — pay annually, get more impact per dollar</p>
        <div class="crypto-plans">
          <div class="crypto-plan" onclick="selectCryptoPlan('dabbler', 1250, 'Dabbler — 1 year')">
            <div>
              <div class="crypto-plan-name">Dabbler</div>
              <div class="crypto-plan-desc">For casual AI users — 1 year</div>
            </div>
            <div class="crypto-plan-price">$12.50</div>
          </div>
          <div class="crypto-plan" onclick="selectCryptoPlan('builder', 2500, 'Builder — 1 year')">
            <div>
              <div class="crypto-plan-name">Builder</div>
              <div class="crypto-plan-desc">For regular AI developers — 1 year</div>
            </div>
            <div class="crypto-plan-price">$25</div>
          </div>
          <div class="crypto-plan" onclick="selectCryptoPlan('agent', 5000, 'Agent — 1 year')">
            <div>
              <div class="crypto-plan-name">Agent</div>
              <div class="crypto-plan-desc">For AI-native teams — 1 year</div>
            </div>
            <div class="crypto-plan-price">$50</div>
          </div>
        </div>
      </div>

      <!-- Step 2: Send payment -->
      <div class="crypto-step" id="crypto-step-2">
        <button class="crypto-back" onclick="cryptoGoStep(1)">&larr; Back to plans</button>
        <h3>Send Payment</h3>
        <p class="crypto-subtitle" id="crypto-plan-label">Builder — 1 year</p>

        <div class="crypto-chain-tabs">
          <div class="crypto-chain-tab active" data-chain="evm" onclick="selectCryptoChain('evm')">EVM</div>
          <div class="crypto-chain-tab" data-chain="bitcoin" onclick="selectCryptoChain('bitcoin')">Bitcoin</div>
          <div class="crypto-chain-tab" data-chain="solana" onclick="selectCryptoChain('solana')">Solana</div>
          <div class="crypto-chain-tab" data-chain="tron" onclick="selectCryptoChain('tron')">Tron</div>
        </div>

        <div class="crypto-evm-chain-select" id="crypto-evm-select">
          <select id="crypto-evm-chain" onchange="updateCryptoChainLabel()">
            <option value="ethereum">Ethereum</option>
            <option value="base" selected>Base (recommended — low fees)</option>
            <option value="arbitrum">Arbitrum</option>
            <option value="polygon">Polygon</option>
            <option value="optimism">Optimism</option>
            <option value="avalanche">Avalanche</option>
            <option value="bnb">BNB Chain</option>
            <option value="linea">Linea</option>
            <option value="zksync">zkSync</option>
            <option value="scroll">Scroll</option>
            <option value="celo">Celo</option>
            <option value="gnosis">Gnosis</option>
          </select>
        </div>

        <div class="crypto-addr-box">
          <div class="qr-container" id="crypto-qr"></div>
          <div class="crypto-addr-text" id="crypto-addr" onclick="copyCryptoAddr()">
            <span id="crypto-addr-val"></span>
            <div class="crypto-copied" id="crypto-copied">Copied!</div>
          </div>
          <p class="crypto-send-amount">Send <strong id="crypto-amount-label">$25</strong> worth of any token (USDC preferred for exact amounts)</p>
        </div>

        <div class="crypto-field" style="margin-top:18px;">
          <label class="crypto-label">After sending, continue below:</label>
          <button class="regen-btn regen-btn--solid regen-btn--block" onclick="cryptoGoStep(3)" style="font-size:15px;padding:12px;">I've sent the payment</button>
        </div>
      </div>

      <!-- Step 3: Confirm tx hash -->
      <div class="crypto-step" id="crypto-step-3">
        <button class="crypto-back" onclick="cryptoGoStep(2)">&larr; Back</button>
        <h3>Confirm Payment</h3>
        <p class="crypto-subtitle">Paste your transaction hash so we can verify it on-chain</p>

        <div class="crypto-field">
          <label class="crypto-label">Chain</label>
          <select id="crypto-confirm-chain" class="crypto-input" style="font-family:inherit;">
            <option value="ethereum">Ethereum</option>
            <option value="base" selected>Base</option>
            <option value="arbitrum">Arbitrum</option>
            <option value="polygon">Polygon</option>
            <option value="optimism">Optimism</option>
            <option value="avalanche">Avalanche</option>
            <option value="bnb">BNB Chain</option>
            <option value="linea">Linea</option>
            <option value="zksync">zkSync</option>
            <option value="scroll">Scroll</option>
            <option value="celo">Celo</option>
            <option value="gnosis">Gnosis</option>
            <option value="bitcoin">Bitcoin</option>
            <option value="solana">Solana</option>
            <option value="tron">Tron</option>
          </select>
        </div>

        <div class="crypto-field">
          <label class="crypto-label">Transaction Hash</label>
          <input type="text" id="crypto-tx-hash" class="crypto-input" placeholder="0x... or transaction ID">
        </div>

        <div class="crypto-field">
          <label class="crypto-label">Email (to receive your API key)</label>
          <input type="email" id="crypto-email" class="crypto-input" placeholder="you@example.com">
        </div>

        <p id="crypto-confirm-error" style="color:#c33;font-size:13px;display:none;margin:0 0 12px;"></p>

        <button id="crypto-confirm-btn" class="regen-btn regen-btn--solid regen-btn--block" onclick="confirmCryptoPayment()" style="font-size:15px;padding:12px;">Verify & Activate</button>
      </div>

      <!-- Step 4: Result -->
      <div class="crypto-step" id="crypto-step-4">
        <div id="crypto-result-content"></div>
      </div>
    </div>
  </div>

  <script>
    // --- Crypto checkout logic ---
    var cryptoAddresses = {
      evm: '0x0687cC26060FE12Fd4A6210c2f30Cf24a9853C6b',
      bitcoin: 'bc1qa2wlapdsmf0pp8x3gamp6elaaehkarpgdre5vq',
      solana: '9npQZwDxDAcbnpVpQKzKYtLDKN8xpAMfE5FSAuSGsaJh',
      tron: 'TRNx7dZXm2HNqaUp9oLTSLBhN4tHmsyUfL'
    };
    var cryptoSelectedPlan = { id: '', cents: 0, label: '' };
    var cryptoSelectedChain = 'evm';

    function openCryptoCheckout() {
      document.getElementById('crypto-overlay').classList.add('active');
      cryptoGoStep(1);
    }
    function closeCryptoCheckout() {
      document.getElementById('crypto-overlay').classList.remove('active');
    }

    function cryptoGoStep(n) {
      var steps = document.querySelectorAll('.crypto-step');
      for (var i = 0; i < steps.length; i++) steps[i].classList.remove('active');
      document.getElementById('crypto-step-' + n).classList.add('active');
    }

    function selectCryptoPlan(id, cents, label) {
      cryptoSelectedPlan = { id: id, cents: cents, label: label };
      document.getElementById('crypto-plan-label').textContent = label;
      document.getElementById('crypto-amount-label').textContent = '$' + (cents / 100);
      selectCryptoChain('evm');
      cryptoGoStep(2);
    }

    function selectCryptoChain(chain) {
      cryptoSelectedChain = chain;
      var tabs = document.querySelectorAll('.crypto-chain-tab');
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.toggle('active', tabs[i].getAttribute('data-chain') === chain);
      }
      document.getElementById('crypto-evm-select').style.display = chain === 'evm' ? 'block' : 'none';

      var addr = cryptoAddresses[chain];
      document.getElementById('crypto-addr-val').textContent = addr;
      renderQR(addr);
      updateCryptoChainLabel();
    }

    function updateCryptoChainLabel() {
      var chain = cryptoSelectedChain;
      if (chain === 'evm') {
        chain = document.getElementById('crypto-evm-chain').value;
      }
      // Pre-select the confirm chain dropdown
      var sel = document.getElementById('crypto-confirm-chain');
      for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === chain) { sel.selectedIndex = i; break; }
      }
    }

    function copyCryptoAddr() {
      var addr = document.getElementById('crypto-addr-val').textContent;
      navigator.clipboard.writeText(addr).then(function() {
        var el = document.getElementById('crypto-copied');
        el.classList.add('show');
        setTimeout(function() { el.classList.remove('show'); }, 1200);
      });
    }

    function confirmCryptoPayment() {
      var chain = document.getElementById('crypto-confirm-chain').value;
      var txHash = document.getElementById('crypto-tx-hash').value.trim();
      var email = document.getElementById('crypto-email').value.trim();
      var errEl = document.getElementById('crypto-confirm-error');
      errEl.style.display = 'none';

      if (!txHash) {
        errEl.textContent = 'Please enter the transaction hash.';
        errEl.style.display = 'block';
        return;
      }
      if (!email || email.indexOf('@') < 1) {
        errEl.textContent = 'Please enter a valid email address.';
        errEl.style.display = 'block';
        return;
      }

      // Show loading
      var btn = document.getElementById('crypto-confirm-btn');
      btn.disabled = true;
      btn.textContent = 'Verifying on-chain...';

      // Show spinner step
      cryptoGoStep(4);
      document.getElementById('crypto-result-content').innerHTML =
        '<div class="crypto-result"><div class="crypto-spinner"></div>' +
        '<h4 style="color:var(--regen-navy);">Verifying transaction...</h4>' +
        '<p>Checking on-chain confirmation. This may take a moment.</p></div>';

      fetch('/api/v1/confirm-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chain: chain, tx_hash: txHash, email: email })
      })
      .then(function(r) { return r.json().then(function(data) { return { ok: r.ok, data: data }; }); })
      .then(function(res) {
        if (res.ok && res.data.subscription) {
          var sub = res.data.subscription;
          document.getElementById('crypto-result-content').innerHTML =
            '<div class="crypto-result">' +
            '<div class="crypto-result-icon success">&#10003;</div>' +
            '<h4 style="color:var(--regen-green);">Payment Verified!</h4>' +
            '<p><strong>' + sub.plan + '</strong> plan activated' +
            (sub.expires && sub.expires !== 'never' ? ' until ' + sub.expires : ' — lifetime') + '.</p>' +
            '<p style="font-size:13px;color:var(--regen-gray-400);">Your API key has been sent to <strong>' + email + '</strong>.</p>' +
            '<p style="font-size:13px;">Amount: <strong>$' + res.data.payment.usd_value + '</strong> (' +
            res.data.payment.token + ' on ' + res.data.payment.chain + ')</p>' +
            '<button class="regen-btn regen-btn--solid" onclick="closeCryptoCheckout()" style="margin-top:12px;">Done</button>' +
            '</div>';
        } else {
          var msg = (res.data && res.data.error && res.data.error.message) || 'Verification failed. Please check the transaction hash and try again.';
          document.getElementById('crypto-result-content').innerHTML =
            '<div class="crypto-result">' +
            '<div class="crypto-result-icon error" style="color:#c33;">&#10007;</div>' +
            '<h4 style="color:#c33;">Verification Failed</h4>' +
            '<p>' + msg + '</p>' +
            '<button class="regen-btn regen-btn--outline" onclick="cryptoRetry()" style="margin-top:8px;">Try Again</button>' +
            '</div>';
        }
      })
      .catch(function(e) {
        document.getElementById('crypto-result-content').innerHTML =
          '<div class="crypto-result">' +
          '<div class="crypto-result-icon error" style="color:#c33;">&#10007;</div>' +
          '<h4 style="color:#c33;">Network Error</h4>' +
          '<p>' + e.message + '</p>' +
          '<button class="regen-btn regen-btn--outline" onclick="cryptoRetry()" style="margin-top:8px;">Try Again</button>' +
          '</div>';
      });
    }

    function cryptoRetry() {
      cryptoGoStep(3);
      document.getElementById('crypto-confirm-btn').disabled = false;
      document.getElementById('crypto-confirm-btn').textContent = 'Verify & Activate';
    }

    // --- Minimal QR Code generator (SVG) ---
    // Generates a simple QR code using a basic implementation
    function renderQR(text) {
      var container = document.getElementById('crypto-qr');
      // Use a simple approach: generate via an inline canvas-to-SVG
      // We'll use a lightweight QR encoding algorithm
      try {
        var modules = generateQRModules(text);
        var size = modules.length;
        var cellSize = Math.floor(160 / (size + 8));
        var offset = Math.floor((160 - cellSize * size) / 2);
        var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160">';
        svg += '<rect width="160" height="160" fill="#0E1018"/>';
        for (var y = 0; y < size; y++) {
          for (var x = 0; x < size; x++) {
            if (modules[y][x]) {
              svg += '<rect x="' + (offset + x * cellSize) + '" y="' + (offset + y * cellSize) + '" width="' + cellSize + '" height="' + cellSize + '" fill="#F0ECE2"/>';
            }
          }
        }
        svg += '</svg>';
        container.innerHTML = svg;
      } catch(e) {
        // Fallback: just show the address text, no QR
        container.innerHTML = '<div style="width:160px;height:160px;display:flex;align-items:center;justify-content:center;background:var(--regen-gray-100);border-radius:8px;font-size:11px;color:var(--regen-gray-400);">QR unavailable</div>';
      }
    }

    // Minimal QR Code encoder (Version 1-6, Byte mode, ECC-L)
    // This is a simplified implementation for address-length strings
    function generateQRModules(data) {
      // Use the qrcodegen approach: encode data bytes, add ECC, build matrix
      var bytes = [];
      for (var i = 0; i < data.length; i++) {
        var c = data.charCodeAt(i);
        if (c < 128) bytes.push(c);
        else if (c < 2048) { bytes.push(192 | (c >> 6)); bytes.push(128 | (c & 63)); }
        else { bytes.push(224 | (c >> 12)); bytes.push(128 | ((c >> 6) & 63)); bytes.push(128 | (c & 63)); }
      }

      // Select version based on data length (ECC-L, byte mode)
      var capacities = [0, 17, 32, 53, 78, 106, 134, 154, 192, 230, 271]; // v1-v10 byte capacity at ECC-L
      var version = 1;
      for (var v = 1; v <= 10; v++) {
        if (bytes.length <= capacities[v]) { version = v; break; }
      }

      var size = 17 + version * 4;
      var matrix = [];
      var reserved = [];
      for (var i = 0; i < size; i++) {
        matrix[i] = [];
        reserved[i] = [];
        for (var j = 0; j < size; j++) {
          matrix[i][j] = false;
          reserved[i][j] = false;
        }
      }

      // Place finder patterns
      function placeFinder(row, col) {
        for (var dy = -1; dy <= 7; dy++) {
          for (var dx = -1; dx <= 7; dx++) {
            var r = row + dy, c = col + dx;
            if (r < 0 || r >= size || c < 0 || c >= size) continue;
            var dark = (dy >= 0 && dy <= 6 && (dx === 0 || dx === 6)) ||
                       (dx >= 0 && dx <= 6 && (dy === 0 || dy === 6)) ||
                       (dy >= 2 && dy <= 4 && dx >= 2 && dx <= 4);
            matrix[r][c] = dark;
            reserved[r][c] = true;
          }
        }
      }
      placeFinder(0, 0);
      placeFinder(0, size - 7);
      placeFinder(size - 7, 0);

      // Place timing patterns
      for (var i = 8; i < size - 8; i++) {
        matrix[6][i] = i % 2 === 0;
        reserved[6][i] = true;
        matrix[i][6] = i % 2 === 0;
        reserved[i][6] = true;
      }

      // Reserve format info areas
      for (var i = 0; i < 9; i++) {
        reserved[8][i] = true;
        reserved[i][8] = true;
        if (i < 8) {
          reserved[8][size - 1 - i] = true;
          reserved[size - 1 - i][8] = true;
        }
      }
      matrix[size - 8][8] = true; // dark module
      reserved[size - 8][8] = true;

      // Place alignment patterns for version >= 2
      if (version >= 2) {
        var alignPos = getAlignmentPositions(version);
        for (var ai = 0; ai < alignPos.length; ai++) {
          for (var aj = 0; aj < alignPos.length; aj++) {
            var ay = alignPos[ai], ax = alignPos[aj];
            if (reserved[ay][ax]) continue;
            for (var dy = -2; dy <= 2; dy++) {
              for (var dx = -2; dx <= 2; dx++) {
                var dark = Math.abs(dy) === 2 || Math.abs(dx) === 2 || (dy === 0 && dx === 0);
                matrix[ay + dy][ax + dx] = dark;
                reserved[ay + dy][ax + dx] = true;
              }
            }
          }
        }
      }

      // Reserve version info for version >= 7
      if (version >= 7) {
        for (var i = 0; i < 6; i++) {
          for (var j = 0; j < 3; j++) {
            reserved[i][size - 11 + j] = true;
            reserved[size - 11 + j][i] = true;
          }
        }
      }

      // Encode data
      var eccBlocks = getEccInfo(version);
      var totalCodewords = eccBlocks.totalCodewords;
      var dataCodewords = eccBlocks.dataCodewords;

      // Build data bitstream
      var bits = [];
      // Mode: byte (0100)
      bits.push(0, 1, 0, 0);
      // Character count (8 bits for v1-9, 16 for v10+)
      var ccBits = version <= 9 ? 8 : 16;
      for (var i = ccBits - 1; i >= 0; i--) bits.push((bytes.length >> i) & 1);
      // Data bytes
      for (var i = 0; i < bytes.length; i++) {
        for (var b = 7; b >= 0; b--) bits.push((bytes[i] >> b) & 1);
      }
      // Terminator
      var termLen = Math.min(4, dataCodewords * 8 - bits.length);
      for (var i = 0; i < termLen; i++) bits.push(0);
      // Pad to byte boundary
      while (bits.length % 8 !== 0) bits.push(0);
      // Pad codewords
      var padBytes = [236, 17];
      var padIdx = 0;
      while (bits.length < dataCodewords * 8) {
        for (var b = 7; b >= 0; b--) bits.push((padBytes[padIdx] >> b) & 1);
        padIdx = (padIdx + 1) % 2;
      }

      // Convert to codeword array
      var codewords = [];
      for (var i = 0; i < bits.length; i += 8) {
        var val = 0;
        for (var b = 0; b < 8; b++) val = (val << 1) | (bits[i + b] || 0);
        codewords.push(val);
      }

      // Generate ECC
      var allCodewords = generateECC(codewords, eccBlocks);

      // Place data in matrix
      var bitIdx = 0;
      var allBits = [];
      for (var i = 0; i < allCodewords.length; i++) {
        for (var b = 7; b >= 0; b--) allBits.push((allCodewords[i] >> b) & 1);
      }

      var right = true;
      for (var col = size - 1; col >= 0; col -= 2) {
        if (col === 6) col = 5; // Skip timing column
        for (var cnt = 0; cnt < size; cnt++) {
          var row = right ? size - 1 - cnt : cnt;
          for (var dx = 0; dx >= -1; dx--) {
            var c = col + dx;
            if (c < 0 || c >= size) continue;
            if (reserved[row][c]) continue;
            matrix[row][c] = bitIdx < allBits.length ? !!allBits[bitIdx] : false;
            bitIdx++;
          }
        }
        right = !right;
      }

      // Apply mask (mask 0: (row + col) % 2 === 0) and format info
      var bestMatrix = applyMaskAndFormat(matrix, reserved, size, 0);
      return bestMatrix;
    }

    function getAlignmentPositions(version) {
      if (version <= 1) return [];
      var table = [[], [6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50],[6,30,54]];
      return table[version] || [];
    }

    function getEccInfo(version) {
      // ECC-L block info: [totalCodewords, dataCodewords, numBlocks, eccPerBlock]
      var table = {
        1: { totalCodewords: 26, dataCodewords: 19, blocks: [{count:1, dataPerBlock:19, eccPerBlock:7}] },
        2: { totalCodewords: 44, dataCodewords: 34, blocks: [{count:1, dataPerBlock:34, eccPerBlock:10}] },
        3: { totalCodewords: 70, dataCodewords: 55, blocks: [{count:1, dataPerBlock:55, eccPerBlock:15}] },
        4: { totalCodewords: 100, dataCodewords: 80, blocks: [{count:1, dataPerBlock:80, eccPerBlock:20}] },
        5: { totalCodewords: 134, dataCodewords: 108, blocks: [{count:1, dataPerBlock:108, eccPerBlock:26}] },
        6: { totalCodewords: 172, dataCodewords: 136, blocks: [{count:2, dataPerBlock:68, eccPerBlock:18}] },
        7: { totalCodewords: 196, dataCodewords: 156, blocks: [{count:2, dataPerBlock:78, eccPerBlock:20}] },
        8: { totalCodewords: 242, dataCodewords: 194, blocks: [{count:2, dataPerBlock:97, eccPerBlock:24}] },
        9: { totalCodewords: 292, dataCodewords: 232, blocks: [{count:2, dataPerBlock:116, eccPerBlock:30}] },
        10: { totalCodewords: 346, dataCodewords: 274, blocks: [{count:2, dataPerBlock:68, eccPerBlock:18},{count:2, dataPerBlock:69, eccPerBlock:18}] },
      };
      return table[version] || table[3];
    }

    function generateECC(dataCodewords, eccInfo) {
      var blocks = eccInfo.blocks;
      var dataBlocks = [];
      var eccBlocks = [];
      var dataIdx = 0;

      for (var bi = 0; bi < blocks.length; bi++) {
        for (var bc = 0; bc < blocks[bi].count; bc++) {
          var blockData = dataCodewords.slice(dataIdx, dataIdx + blocks[bi].dataPerBlock);
          dataIdx += blocks[bi].dataPerBlock;
          var eccLen = blocks[bi].eccPerBlock;
          var ecc = rsEncode(blockData, eccLen);
          dataBlocks.push(blockData);
          eccBlocks.push(ecc);
        }
      }

      // Interleave data blocks then ECC blocks
      var result = [];
      var maxDataLen = Math.max.apply(null, dataBlocks.map(function(b) { return b.length; }));
      for (var i = 0; i < maxDataLen; i++) {
        for (var j = 0; j < dataBlocks.length; j++) {
          if (i < dataBlocks[j].length) result.push(dataBlocks[j][i]);
        }
      }
      var maxEccLen = Math.max.apply(null, eccBlocks.map(function(b) { return b.length; }));
      for (var i = 0; i < maxEccLen; i++) {
        for (var j = 0; j < eccBlocks.length; j++) {
          if (i < eccBlocks[j].length) result.push(eccBlocks[j][i]);
        }
      }
      return result;
    }

    // Reed-Solomon encoding over GF(256)
    var gfExp = new Array(512);
    var gfLog = new Array(256);
    (function initGF() {
      var x = 1;
      for (var i = 0; i < 255; i++) {
        gfExp[i] = x;
        gfLog[x] = i;
        x = x << 1;
        if (x >= 256) x ^= 0x11d;
      }
      for (var i = 255; i < 512; i++) gfExp[i] = gfExp[i - 255];
      gfLog[0] = -1;
    })();

    function gfMul(a, b) {
      if (a === 0 || b === 0) return 0;
      return gfExp[gfLog[a] + gfLog[b]];
    }

    function rsEncode(data, eccLen) {
      // Build generator polynomial
      var gen = [1];
      for (var i = 0; i < eccLen; i++) {
        var newGen = new Array(gen.length + 1);
        for (var j = 0; j < newGen.length; j++) newGen[j] = 0;
        for (var j = 0; j < gen.length; j++) {
          newGen[j] ^= gfMul(gen[j], gfExp[i]);
          newGen[j + 1] ^= gen[j];
        }
        gen = newGen;
      }

      // Divide data by generator
      var remainder = new Array(eccLen);
      for (var i = 0; i < eccLen; i++) remainder[i] = 0;

      for (var i = 0; i < data.length; i++) {
        var coef = data[i] ^ remainder[0];
        remainder.shift();
        remainder.push(0);
        if (coef !== 0) {
          for (var j = 0; j < remainder.length; j++) {
            remainder[j] ^= gfMul(gen[j + 1], coef);
          }
        }
      }
      return remainder;
    }

    function applyMaskAndFormat(matrix, reserved, size, maskNum) {
      var result = [];
      for (var i = 0; i < size; i++) {
        result[i] = [];
        for (var j = 0; j < size; j++) {
          result[i][j] = matrix[i][j];
        }
      }

      // Apply mask to data areas
      for (var row = 0; row < size; row++) {
        for (var col = 0; col < size; col++) {
          if (reserved[row][col]) continue;
          var invert = false;
          switch (maskNum) {
            case 0: invert = (row + col) % 2 === 0; break;
            case 1: invert = row % 2 === 0; break;
            case 2: invert = col % 3 === 0; break;
            case 3: invert = (row + col) % 3 === 0; break;
          }
          if (invert) result[row][col] = !result[row][col];
        }
      }

      // Write format info (ECC-L = 01, mask 0 = 000 → data = 01000 → with BCH = 0x5412 for L/mask0)
      var formatBits = [
        0x5412, 0x5125, 0x5E7C, 0x5B4B, 0x45F9, 0x40CE, 0x4F97, 0x4AA0
      ][maskNum];

      for (var i = 0; i < 15; i++) {
        var bit = !!((formatBits >> (14 - i)) & 1);
        // Horizontal
        if (i < 8) {
          var col = i < 6 ? i : (i === 6 ? 7 : 8);
          result[8][col] = bit;
        } else {
          result[8][size - 15 + i] = bit;
        }
        // Vertical
        if (i < 8) {
          result[i < 6 ? i : (i === 6 ? 7 : 8)][8] = bit;
        } else {
          result[size - 15 + i][8] = bit;
        }
      }

      return result;
    }
  </script>

  <!-- Annual nudge modal -->
  <div class="nudge-overlay" id="nudge-overlay" onclick="if(event.target===this)closeNudge()">
    <div class="nudge-box">
      <h3>${t(lang, "nudge_title")}</h3>
      <div class="nudge-reason">
        <div class="nudge-reason-icon">1</div>
        <p><strong>${t(lang, "nudge_reason1_title")}</strong> — ${t(lang, "nudge_reason1_desc")}</p>
      </div>
      <div class="nudge-reason">
        <div class="nudge-reason-icon">2</div>
        <p><strong>${t(lang, "nudge_reason2_title")}</strong> — ${t(lang, "nudge_reason2_desc")}</p>
      </div>
      <div class="nudge-btns">
        <button class="nudge-btn-yearly" id="nudge-btn-yearly" onclick="switchToYearly()">${t(lang, "nudge_cta_yearly")}</button>
        <button class="nudge-btn-monthly" id="nudge-btn-monthly" onclick="continueMonthly()">${t(lang, "nudge_cta_monthly")}</button>
      </div>
    </div>
  </div>

  ${hasPriceIds ? `<script>
    var pendingTier = null;

    function subscribe(tier) {
      if (currentInterval === 'monthly') {
        pendingTier = tier;
        document.getElementById('nudge-overlay').classList.add('active');
        return;
      }
      doSubscribe(tier, currentInterval);
    }

    function switchToYearly() {
      var tier = pendingTier;
      closeNudge();
      setPricingInterval('yearly');
      doSubscribe(tier, 'yearly');
    }

    function continueMonthly() {
      var tier = pendingTier;
      closeNudge();
      doSubscribe(tier, 'monthly');
    }

    function closeNudge() {
      document.getElementById('nudge-overlay').classList.remove('active');
      pendingTier = null;
    }

    function doSubscribe(tier, interval) {
      var body = { tier: tier, interval: interval };
      ${refCode ? `body.referral_code = ${JSON.stringify(refCode).replace(/</g, "\\u003c")};` : ""}
      fetch('/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.url) window.location.href = data.url;
        else alert('Error: ' + (data.error || 'Unknown error'));
      })
      .catch(function(e) { alert('Error: ' + e.message); });
    }
  </script>` : ""}

${betaBannerJS()}
</body>
</html>`);
  }

  // Language routes: GET / and GET /:lang
  router.get("/", async (req: Request, res: Response) => {
    // Auto-detect language from Accept-Language header
    const acceptLang = req.headers["accept-language"] || "";
    const preferred = acceptLang.split(",")[0]?.split("-")[0]?.toLowerCase() as LangCode;
    const lang: LangCode = SUPPORTED_LANGS.includes(preferred) ? preferred : "en";
    await serveLandingPage(req, res, lang);
  });

  // Explicit language routes
  for (const langCode of SUPPORTED_LANGS.filter(l => l !== "en")) {
    router.get(`/${langCode}`, async (req: Request, res: Response) => {
      await serveLandingPage(req, res, langCode);
    });
  }

  // Common language code redirects for unsupported variants
  const LANG_REDIRECTS: Record<string, LangCode> = { is: "es", br: "pt", mx: "es", cn: "zh", tw: "zh", in: "hi" };
  for (const [from, to] of Object.entries(LANG_REDIRECTS)) {
    router.get(`/${from}`, (_req: Request, res: Response) => {
      res.redirect(301, `/${to}`);
    });
  }

  // --- Stripe-dependent routes (only registered when Stripe is configured) ---
  if (stripe) {

  /**
   * POST /subscribe
   * Body: { tier: "dabbler"|"builder"|"agent", interval?: "monthly"|"yearly", email?: string, referral_code?: string }
   * Returns: { url: "https://checkout.stripe.com/..." }
   *
   * Creates a Stripe Checkout Session in subscription mode.
   * If a valid referral_code is provided, the subscription gets a 30-day free trial.
   */
  router.post("/subscribe", checkoutLimiter, async (req: Request, res: Response) => {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { tier, interval, email, referral_code } = body ?? {};

      if (!tier || !["dabbler", "builder", "agent"].includes(tier)) {
        res.status(400).json({ error: 'tier must be "dabbler", "builder", or "agent"' });
        return;
      }

      const isYearly = interval === "yearly";

      // Resolve price ID for the tier + interval
      // Config still uses seedling/grove/forest env var names for Stripe price IDs
      const monthlyPriceIdMap: Record<string, string | undefined> = {
        dabbler: config?.stripePriceIdSeedling,
        builder: config?.stripePriceIdGrove,
        agent: config?.stripePriceIdForest,
      };
      const yearlyPriceIdMap: Record<string, string | undefined> = {
        dabbler: config?.stripePriceIdSeedlingYearly,
        builder: config?.stripePriceIdGroveYearly,
        agent: config?.stripePriceIdForestYearly,
      };

      const priceId = isYearly ? yearlyPriceIdMap[tier] : monthlyPriceIdMap[tier];
      if (!priceId) {
        // Fall back to Payment Links (monthly only)
        const linkMap: Record<string, string> = {
          dabbler: config?.stripePaymentLinkSeedling ?? "#",
          builder: config?.stripePaymentLinkGrove ?? "#",
          agent: config?.stripePaymentLinkForest ?? "#",
        };
        res.json({ url: linkMap[tier], fallback: true });
        return;
      }

      // Check referral code
      let referrerUser: ReturnType<typeof getUserByReferralCode> | undefined;
      if (referral_code) {
        referrerUser = getUserByReferralCode(db, referral_code);
      }

      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}&type=subscription`,
        cancel_url: `${baseUrl}/cancel`,
        ...(email ? { customer_email: email } : {}),
        subscription_data: {
          metadata: {
            tier,
            source: "regen-compute",
            ...(referrerUser
              ? {
                  referrer_id: String(referrerUser.id),
                  referral_code: referral_code,
                }
              : {}),
          },
          ...(referrerUser ? { trial_period_days: 30 } : {}),
        },
      };

      const session = await stripe.checkout.sessions.create(sessionParams);
      res.json({ url: session.url });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Subscribe error:", msg);
      res.status(500).json({ error: "An internal error occurred. Please try again." });
    }
  });

  /**
   * POST /subscribe-org
   * Body: { org_name, full_time_devs, autonomous_agents, part_time_users, amount_cents }
   * Creates organization record, then a Stripe Checkout Session for the calculated amount.
   */
  router.post("/subscribe-org", checkoutLimiter, async (req: Request, res: Response) => {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { org_name, full_time_devs, autonomous_agents, part_time_users, amount_cents } = body ?? {};

      if (!org_name || typeof org_name !== "string" || !org_name.trim()) {
        res.status(400).json({ error: "org_name is required" });
        return;
      }

      const devs = Math.max(0, Math.floor(Number(full_time_devs) || 0));
      const agents = Math.max(0, Math.floor(Number(autonomous_agents) || 0));
      const parttime = Math.max(0, Math.floor(Number(part_time_users) || 0));

      if (devs + agents + parttime === 0) {
        res.status(400).json({ error: "At least one team member or agent is required" });
        return;
      }

      // Validate amount — minimum $1
      const cents = Math.max(100, Math.round(Number(amount_cents) || 0));

      // Create org record (will be linked to subscriber after Stripe checkout completes)
      const org = createOrganization(db, {
        name: org_name.trim(),
        contact_email: "", // filled by webhook when Stripe provides email
        full_time_devs: devs,
        autonomous_agents: agents,
        part_time_users: parttime,
        suggested_cents: cents,
      });

      const amountDollars = (cents / 100).toFixed(2);

      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode: "subscription",
        line_items: [
          {
            price_data: {
              currency: "usd",
              recurring: { interval: "month" },
              unit_amount: cents,
              product_data: {
                name: `Regen Compute — ${org_name.trim()} (Organization)`,
                description: `Monthly ecological credit retirement for ${devs + agents + parttime} team members/agents`,
              },
            },
            quantity: 1,
          },
        ],
        success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}&type=subscription&org_id=${org.id}`,
        cancel_url: `${baseUrl}/cancel`,
        subscription_data: {
          metadata: {
            tier: "org",
            org_id: String(org.id),
            org_name: org_name.trim(),
            source: "regen-compute",
          },
        },
      };

      const session = await stripe.checkout.sessions.create(sessionParams);
      res.json({ url: session.url });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Subscribe-org error:", msg);
      res.status(500).json({ error: "An internal error occurred. Please try again." });
    }
  });

  /**
   * POST /org/publicity
   * Body: { org_id: number, opt_in: boolean }
   * Updates an organization's publicity preference.
   */
  router.post("/org/publicity", async (req: Request, res: Response) => {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { org_id, opt_in, session_id } = body ?? {};

      if (!org_id) {
        res.status(400).json({ error: "org_id is required" });
        return;
      }

      // Verify the org exists and the session matches
      const org = getOrganizationById(db, Number(org_id));
      if (!org) {
        res.status(404).json({ error: "Organization not found" });
        return;
      }

      updateOrganizationPublicity(db, org.id, !!opt_in);

      // Update contact email if we can resolve it from the session
      if (session_id) {
        try {
          const session = await stripe.checkout.sessions.retrieve(session_id);
          const email = session.customer_email ?? session.customer_details?.email;
          if (email) {
            db.prepare("UPDATE organizations SET contact_email = ?, updated_at = datetime('now') WHERE id = ?").run(email, org.id);
          }
        } catch { /* non-critical */ }
      }

      res.json({ ok: true, publicity_opt_in: !!opt_in });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Org publicity error:", msg);
      res.status(500).json({ error: "An internal error occurred. Please try again." });
    }
  });

  /**
   * GET /r/:code
   * Short referral redirect → /?ref=CODE
   */
  router.get("/r/:code", (req: Request, res: Response) => {
    const code = Array.isArray(req.params.code) ? req.params.code[0] : req.params.code;
    res.redirect(302, `${baseUrl}/?ref=${encodeURIComponent(code)}`);
  });

  /**
   * POST /checkout
   * Body: { amount_cents: 1000, email?: "user@example.com" }
   * Returns: { url: "https://checkout.stripe.com/..." }
   */
  router.post("/checkout", checkoutLimiter, async (req: Request, res: Response) => {
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
                name: "Regen Compute — Ecological Credit Balance",
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
      res.status(500).json({ error: "An internal error occurred. Please try again." });
    }
  });

  /**
   * POST /boost-checkout
   * Body: { amount_cents: 500, batch_denom: "BT01-001-...", project_name: "El Globo..." }
   * Creates a Stripe Checkout session for a one-time boost retirement targeting a specific project.
   * Returns: { url: "https://checkout.stripe.com/..." }
   */
  router.post("/boost-checkout", checkoutLimiter, async (req: Request, res: Response) => {
    try {
      const { amount_cents, batch_denom, project_name } = req.body;

      if (!amount_cents || typeof amount_cents !== "number" || amount_cents < 100) {
        res.status(400).json({ error: "amount_cents must be at least 100 ($1.00)" });
        return;
      }

      if (!batch_denom || typeof batch_denom !== "string") {
        res.status(400).json({ error: "batch_denom is required" });
        return;
      }

      // Get the logged-in subscriber from the session cookie
      const { getSessionEmail } = await import("./magic-link.js");
      const email = getSessionEmail(req.headers.cookie, config?.sessionSecret ?? "");
      if (!email) {
        res.status(401).json({ error: "Not logged in" });
        return;
      }

      const user = getUserByEmail(db, email);
      const subscriber = user ? getSubscriberByStripeId(db, "") : null;
      // Look up subscriber by user id instead
      const sub = user ? db.prepare("SELECT * FROM subscribers WHERE user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1").get(user.id) as { id: number } | undefined : undefined;

      const amountDollars = (amount_cents / 100).toFixed(2);
      const displayName = project_name || batch_denom;

      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: amount_cents,
              product_data: {
                name: `Boost: ${displayName}`,
                description: `$${amountDollars} one-time ecological credit retirement — ${displayName}`,
              },
            },
            quantity: 1,
          },
        ],
        metadata: {
          type: "boost",
          batch_denom,
          project_name: displayName,
          subscriber_id: sub?.id?.toString() ?? "",
        },
        success_url: `${baseUrl}/dashboard?boost=success`,
        cancel_url: `${baseUrl}/dashboard`,
        customer_email: email,
      };

      const session = await stripe.checkout.sessions.create(sessionParams);
      res.json({ url: session.url });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Boost checkout error:", msg);
      res.status(500).json({ error: "An internal error occurred. Please try again." });
    }
  });

  /**
   * POST /webhook
   * Stripe webhook handler — processes checkout.session.completed events.
   * Creates user if new, credits their balance, generates API key.
   */
  router.post("/webhook", webhookLimiter, async (req: Request, res: Response) => {
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
    } else if (process.env.NODE_ENV === "production") {
      console.error("Webhook rejected: STRIPE_WEBHOOK_SECRET is required in production");
      res.status(500).json({ error: "Webhook signature verification not configured" });
      return;
    } else {
      // Development only: accept unverified webhooks for local testing
      console.warn("WARNING: Processing unverified webhook (no STRIPE_WEBHOOK_SECRET set)");
      const body = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : req.body;
      event = (typeof body === "string" ? JSON.parse(body) : body) as Stripe.Event;
    }

    // Idempotency: skip duplicate webhook events (Stripe retries)
    if (isEventProcessed(db, event.id)) {
      console.log(`Skipping duplicate webhook event: ${event.id} (${event.type})`);
      return res.json({ received: true });
    }
    markEventProcessed(db, event.id, event.type);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const amountCents = session.amount_total ?? 0;
      const email = session.customer_email ?? session.customer_details?.email ?? null;
      const stripeCustomerId = typeof session.customer === "string" ? session.customer : null;

      // Find or create user
      let user = email ? getUserByEmail(db, email) : undefined;
      if (!user) {
        user = createUser(db, email, stripeCustomerId);
        console.log(`New user created: ${user.api_key.slice(0, 12)}... (${email})`);
      }

      // Extract billing interval from the Stripe subscription (if subscription mode)
      const isSubscription = session.mode === "subscription";
      let billingInterval: "monthly" | "yearly" | undefined;
      let stripeSubscriptionId: string | undefined;
      if (isSubscription && session.subscription) {
        stripeSubscriptionId = typeof session.subscription === "string"
          ? session.subscription
          : session.subscription.id;
        try {
          const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
          const interval = sub.items?.data?.[0]?.price?.recurring?.interval;
          billingInterval = interval === "year" ? "yearly" : "monthly";
        } catch (err) {
          console.warn(`Could not retrieve subscription ${stripeSubscriptionId} for billing interval:`, err instanceof Error ? err.message : err);
          billingInterval = undefined; // Will be backfilled from subscriber record
        }
      }

      creditBalance(
        db,
        user.id,
        amountCents,
        session.id,
        isSubscription
          ? `Subscription payment (${billingInterval ?? "unknown"}): $${(amountCents / 100).toFixed(2)}`
          : `One-time boost: $${(amountCents / 100).toFixed(2)}`,
        isSubscription ? "subscription" : "topup",
        billingInterval,
        stripeSubscriptionId
      );

      console.log(
        `Balance credited: user=${user.id} amount=$${(amountCents / 100).toFixed(2)} interval=${billingInterval ?? "n/a"} balance=$${((user.balance_cents + amountCents) / 100).toFixed(2)}`
      );
    } else if (event.type === "customer.subscription.created") {
      const sub = event.data.object as Stripe.Subscription;
      handleSubscriptionCreated(db, sub, stripe, baseUrl);
    } else if (event.type === "customer.subscription.updated") {
      const sub = event.data.object as Stripe.Subscription;
      handleSubscriptionUpdated(db, sub);
    } else if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      handleSubscriptionDeleted(db, sub);
    } else if (event.type === "invoice.paid") {
      const invoice = event.data.object as Stripe.Invoice;
      // Note: handleInvoicePaid triggers retirement asynchronously (fire-and-forget)
      // so the webhook responds quickly. We still await the synchronous part (period updates).
      await handleInvoicePaid(db, invoice, baseUrl);
    } else if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      const subDetails = invoice.parent?.subscription_details;
      const subRef = subDetails?.subscription;
      const subId = typeof subRef === "string" ? subRef : subRef?.id;
      if (subId) {
        const existing = getSubscriberByStripeId(db, subId);
        if (existing) {
          console.warn(`Payment failed for subscriber ${existing.id} (${subId}): ${invoice.id}`);
          sendTelegram(
            `\u26a0\ufe0f *Payment Failed*\nSubscriber ${existing.id} (${subId})\nInvoice: ${invoice.id}`
          ).catch(() => {});
        }
      }
    } else if (event.type === "charge.refunded") {
      const charge = event.data.object as Stripe.Charge;
      const amountRefunded = charge.amount_refunded ?? 0;
      console.warn(`Charge refunded: ${charge.id}, amount=$${(amountRefunded / 100).toFixed(2)}`);
      // Note: Credits already retired on-chain cannot be reversed.
      // This is logged for accounting reconciliation.
      sendTelegram(
        `\ud83d\udcb8 *Charge Refunded*\nCharge: ${charge.id}\nAmount: $${(amountRefunded / 100).toFixed(2)}\n_Credits retired on-chain cannot be reversed._`
      ).catch(() => {});
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
      const isSubscription = req.query.type === "subscription";
      const orgIdParam = req.query.org_id as string | undefined;
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

      res.setHeader("Content-Type", "text/html");

      if (isSubscription) {
        // Subscription success page
        const referralLink = `${baseUrl}/r/${user.referral_code}`;
        const shareText = encodeURIComponent(
          "I just subscribed to @Regen_compute — funding verified ecological regeneration from my AI sessions. Use my link for a free first month:"
        );
        const shareUrl = encodeURIComponent(referralLink);
        const twitterUrl = `https://twitter.com/intent/tweet?text=${shareText}&url=${shareUrl}`;
        const linkedinUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl}`;

        // Resolve organization if this is an org subscription
        const orgId = orgIdParam ? parseInt(orgIdParam, 10) : undefined;
        const org = orgId ? getOrganizationById(db, orgId) : undefined;

        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Regen Compute — Thank You!</title>
  ${brandFonts()}
  <style>
    ${betaBannerCSS()}
    ${brandCSS()}
    .setup-toggle { background: none; border: none; color: var(--regen-green); font-size: 14px; font-weight: 600; cursor: pointer; padding: 0; text-decoration: underline; text-underline-offset: 3px; }
    .setup-toggle:hover { color: var(--regen-teal); }
    .setup-details { display: none; margin-top: 16px; }
    .profile-prompt { background: linear-gradient(135deg, var(--regen-gray-50), #f0faf4); border: 1px solid #d0e8d8; border-radius: 12px; padding: 20px 24px; }
    .profile-prompt h2 { color: var(--regen-green); margin: 0 0 6px; font-size: 18px; font-weight: 700; }
    .profile-prompt p { color: var(--regen-gray-700); font-size: 14px; margin: 0 0 14px; }
    .profile-prompt input { width: 100%; padding: 10px 14px; border: 1px solid var(--color-border-light); border-radius: 8px; font-size: 15px; font-family: inherit; box-sizing: border-box; background: var(--color-surface); color: var(--color-cream); }
    .profile-prompt input:focus { outline: none; border-color: var(--color-emerald); box-shadow: 0 0 0 2px var(--color-emerald-glow); }
    .profile-prompt .btn-row { display: flex; gap: 10px; margin-top: 12px; align-items: center; }
    .profile-prompt .save-btn { background: var(--color-emerald); color: #fff; border: none; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
    .profile-prompt .save-btn:hover { background: var(--color-emerald-bright); }
    .profile-prompt .save-btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .profile-prompt .skip-btn { background: none; border: none; color: var(--color-muted); font-size: 13px; cursor: pointer; text-decoration: underline; }
    .profile-saved { display: none; padding: 14px 20px; background: var(--color-emerald-dim); border: 1px solid var(--color-border-emerald); border-radius: 10px; color: var(--color-emerald-bright); font-weight: 600; font-size: 14px; }
  </style>
</head>
<body>
  ${betaBannerHTML()}
  ${brandHeader({ nav: [{ label: "AI Plugin", href: "/ai-plugin" }, { label: "Research", href: "/research" }, { label: "About", href: "/about" }, { label: "Developers", href: "/developers" }, { label: "Dashboard", href: "/dashboard" }] })}

  <div class="regen-container--narrow" style="padding-top:32px;">
    <div style="text-align:center;padding:32px 0 8px;">
      <h1 style="margin:0 0 12px;font-size:36px;font-weight:700;color:var(--color-cream);font-family:var(--font-display);">Thank You</h1>
      <p style="margin:0 auto;font-size:18px;color:var(--color-cream-soft);max-width:460px;line-height:1.6;font-family:var(--font-body);">You're now funding real ecological regeneration every month. Welcome aboard.</p>
    </div>

    <div class="profile-prompt" id="profilePrompt" style="margin-top:28px;">
      <h2 style="color:var(--regen-navy);font-size:20px;margin:0 0 4px;">One more thing</h2>
      <p style="color:var(--regen-gray-700);font-size:15px;margin:0 0 14px;">Every credit we retire on your behalf goes to a public <a href="https://app.regen.network" target="_blank" rel="noopener" style="color:var(--regen-green);font-weight:600;">Regen Network portfolio page</a> with your name on it. What would you like displayed?</p>
      <input type="text" id="displayNameInput" placeholder="e.g. Jane Smith, Acme Corp, JS" maxlength="100" autocomplete="name" />
      <div class="btn-row">
        <button class="save-btn" id="saveNameBtn" onclick="saveDisplayName()">Save</button>
        <button class="skip-btn" onclick="skipDisplayName()">Skip for now</button>
      </div>
    </div>
    <div class="profile-saved" id="profileSaved"></div>

    <div class="regen-card" style="margin-top:24px;">
      <div class="regen-card__body">
        <h2 style="color:var(--regen-green);margin:0 0 12px;font-size:20px;font-weight:700;">What your subscription does</h2>
        <p style="margin:0 0 10px;color:var(--regen-gray-700);">Every month, we retire verified ecological credits on <strong>Regen Network</strong> — a public blockchain purpose-built for climate and biodiversity action.</p>
        <ul style="margin:12px 0 0;padding-left:20px;color:var(--regen-gray-700);">
          <li style="margin-bottom:6px;"><strong>Real impact</strong> — your money goes directly to projects restoring forests, protecting biodiversity, and regenerating land</li>
          <li style="margin-bottom:6px;"><strong>Permanently recorded</strong> — every retirement is on-chain, immutable, and verifiable by anyone</li>
          <li style="margin-bottom:6px;"><strong>You'll get a monthly email</strong> with a certificate showing exactly what was retired on your behalf</li>
        </ul>
        <p style="margin:12px 0 0;color:var(--regen-gray-700);">This isn't a carbon offset. It's a direct contribution to ecological regeneration.</p>
      </div>
    </div>

    <div class="regen-card" style="margin-top:24px;">
      <div class="regen-card__body">
        <h2 style="color:var(--regen-navy);margin:0 0 8px;font-size:18px;font-weight:700;">Connect to your AI assistant (optional)</h2>
        <p style="color:var(--regen-gray-500);font-size:14px;margin:0 0 16px;">If you use Claude Code, Cursor, or another AI tool that supports MCP, you can connect your subscription so your assistant can check your impact and retire credits on your behalf. <em>Skip this if you'd rather just let your monthly subscription do the work.</em></p>
        <button class="setup-toggle" onclick="toggleSetup()">Show setup instructions</button>
        <div class="setup-details" id="setupDetails">
          <p style="margin:8px 0;"><strong>Your API Key</strong></p>
          <span class="regen-api-key">${user.api_key}</span>
          <p style="font-size:13px;color:var(--regen-gray-500);margin-bottom:16px;">This key links your AI assistant to your subscription. Copy it somewhere safe.</p>
          <p style="margin:8px 0;"><strong>Step 1.</strong> Install the MCP server:</p>
          <pre class="regen-pre">claude mcp add -s user regen-compute -- npx regen-compute</pre>
          <p style="margin:8px 0;"><strong>Step 2.</strong> Set your API key (add to your shell profile or <span class="regen-code">.env</span>):</p>
          <pre class="regen-pre">export REGEN_API_KEY=${user.api_key}
export REGEN_BALANCE_URL=${baseUrl}</pre>
          <p style="margin:8px 0;"><strong>That's it.</strong> Your assistant can now show your subscription status and ecological impact. Try asking: <em>"What's my regenerative compute impact?"</em></p>
        </div>
      </div>
    </div>

    ${org ? `
    <div class="regen-card" style="margin-top:24px;">
      <div class="regen-card__body">
        <h2 style="color:var(--regen-navy);margin:0 0 8px;font-size:18px;font-weight:700;">Share your commitment?</h2>
        <p style="color:var(--regen-gray-700);font-size:14px;margin:0 0 14px;line-height:1.6;">
          Would you like us to feature <strong>${escapeHtml(org.name)}</strong> on our website and social media as an organization committed to regenerative AI? This helps inspire others to follow your lead.
        </p>
        <div id="publicity-prompt" style="display:flex;gap:10px;align-items:center;">
          <button onclick="setPublicity(true)" class="regen-btn regen-btn--solid regen-btn--sm">Yes, share it</button>
          <button onclick="setPublicity(false)" style="background:none;border:none;color:var(--regen-gray-500);font-size:13px;cursor:pointer;text-decoration:underline;">No thanks</button>
        </div>
        <div id="publicity-saved" style="display:none;padding:10px 0;color:var(--regen-green);font-weight:600;font-size:14px;"></div>
      </div>
    </div>
    <script>
    function setPublicity(optIn) {
      fetch('/org/publicity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: ${org.id}, opt_in: optIn, session_id: ${JSON.stringify(sessionId).replace(/</g, "\\u003c")} })
      }).then(function(r) { return r.json(); }).then(function(data) {
        document.getElementById('publicity-prompt').style.display = 'none';
        var saved = document.getElementById('publicity-saved');
        saved.style.display = 'block';
        saved.textContent = optIn ? 'Thank you! We\\'ll feature ' + ${JSON.stringify(org.name).replace(/</g, "\\u003c")} + ' on our site.' : 'No problem — you can change this anytime from your dashboard.';
      });
    }
    </script>
    ` : ""}

    <div class="regen-referral-box">
      <h2>Give a Friend Their First Month Free</h2>
      <p>Share your link and your friend gets 30 days free. You earn bonus credit retirements.</p>
      <span class="regen-ref-link" onclick="copyLink()" id="refLink">${referralLink}</span>
      <div class="regen-share-btns">
        <a class="regen-share-btn regen-share-btn--x" href="${twitterUrl}" target="_blank" rel="noopener">Post on X</a>
        <a class="regen-share-btn regen-share-btn--linkedin" href="${linkedinUrl}" target="_blank" rel="noopener">Share on LinkedIn</a>
        <button class="regen-share-btn regen-share-btn--copy" onclick="copyLink()">Copy Link</button>
      </div>
    </div>
  </div>

  ${brandFooter({ links: [
    { label: "Manage subscription", href: baseUrl + "/manage?email=" + encodeURIComponent(email) },
    { label: "Dashboard", href: "/dashboard" },
    { label: "Regen Marketplace", href: "https://app.regen.network" },
  ] })}

  <script>
    function copyLink() {
      var el = document.getElementById('refLink');
      navigator.clipboard.writeText(el.textContent).then(function() {
        el.textContent = 'Copied!';
        setTimeout(function() { el.textContent = '${referralLink}'; }, 2000);
      });
    }
    function toggleSetup() {
      var d = document.getElementById('setupDetails');
      var btn = d.previousElementSibling;
      if (d.style.display === 'block') {
        d.style.display = 'none';
        btn.textContent = 'Show setup instructions';
      } else {
        d.style.display = 'block';
        btn.textContent = 'Hide setup instructions';
      }
    }
    function saveDisplayName() {
      var name = document.getElementById('displayNameInput').value.trim();
      if (!name) return;
      var btn = document.getElementById('saveNameBtn');
      btn.disabled = true;
      btn.textContent = 'Saving...';
      fetch('/profile/display-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: ${JSON.stringify(sessionId).replace(/</g, "\\u003c")}, display_name: name })
      }).then(function(r) { return r.json(); }).then(function(data) {
        if (data.ok) {
          document.getElementById('profilePrompt').style.display = 'none';
          var saved = document.getElementById('profileSaved');
          saved.style.display = 'block';
          var msg = 'Saved! Your retirements will be credited to <strong>' + name.replace(/</g,'&lt;') + '</strong>.';
          if (data.profile_url) {
            msg += ' <a href="' + data.profile_url + '" target="_blank" rel="noopener" style="color:var(--regen-green);font-weight:600;">View your Regen portfolio &rarr;</a>';
          }
          saved.innerHTML = msg;
        } else {
          btn.disabled = false;
          btn.textContent = 'Save';
          alert('Could not save: ' + (data.error || 'unknown error'));
        }
      }).catch(function() {
        btn.disabled = false;
        btn.textContent = 'Save';
        alert('Network error — please try again.');
      });
    }
    function skipDisplayName() {
      document.getElementById('profilePrompt').style.display = 'none';
      // Set default name in background
      fetch('/profile/display-name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: ${JSON.stringify(sessionId).replace(/</g, "\\u003c")}, display_name: 'My On-Chain Proof' })
      }).catch(function() {});
    }
  </script>
${betaBannerJS()}
</body>
</html>`);
      } else {
        // One-time payment success page (existing)
        const amountDollars = (session.amount_total ?? 0) / 100;

        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Regen Compute — Payment Successful</title>
  ${brandFonts()}
  <style>
    ${betaBannerCSS()}
    ${brandCSS()}
  </style>
</head>
<body>
  ${betaBannerHTML()}
  ${brandHeader({ nav: [{ label: "AI Plugin", href: "/ai-plugin" }, { label: "Research", href: "/research" }, { label: "About", href: "/about" }, { label: "Developers", href: "/developers" }, { label: "Dashboard", href: "/dashboard/login" }] })}

  <div class="regen-container--narrow" style="padding-top:40px;padding-bottom:40px;">
    <h1 style="color:var(--regen-navy);font-size:28px;font-weight:800;margin:0 0 8px;">Payment Successful</h1>
    <p>You've added <strong>$${amountDollars.toFixed(2)}</strong> to your Regen Compute balance.</p>
    <p>Current balance: <span style="font-size:24px;font-weight:800;color:var(--regen-green);">$${(user.balance_cents / 100).toFixed(2)}</span></p>

    <div class="regen-card" style="margin:24px 0;">
      <div class="regen-card__body">
        <strong style="color:var(--regen-navy);">Your API Key</strong>
        <span class="regen-api-key">${user.api_key}</span>
        <p style="font-size:14px;color:var(--regen-gray-500);"><strong>Save this key!</strong> You'll need it to connect your AI assistant.</p>
      </div>
    </div>

    <h2 style="color:var(--regen-navy);font-size:20px;font-weight:700;">Setup (30 seconds)</h2>
    <p><strong>1. Install the MCP server</strong> (if you haven't already):</p>
    <pre class="regen-pre">claude mcp add -s user regen-compute -- npx regen-compute</pre>
    <p><strong>2. Set your API key</strong> — add to your shell profile or <span class="regen-code">.env</span>:</p>
    <pre class="regen-pre">export REGEN_API_KEY=${user.api_key}
export REGEN_BALANCE_URL=${baseUrl}</pre>
    <p><strong>3. Done!</strong> In Claude Code, just say "retire 1 carbon credit" and it'll happen automatically from your prepaid balance.</p>

    <h2 style="color:var(--regen-navy);font-size:20px;font-weight:700;margin-top:28px;">What happens next</h2>
    <ul style="color:var(--regen-gray-700);">
      <li>Your AI assistant checks your balance before each retirement</li>
      <li>Credits are retired on-chain on Regen Network with verifiable proof</li>
      <li>When your balance gets low, you'll be prompted to top up</li>
    </ul>
    <p style="margin-top:20px;"><a class="regen-btn regen-btn--outline regen-btn--sm" href="${baseUrl}/#pricing">Top up again</a></p>
  </div>

  ${brandFooter({ showInstall: true })}
${betaBannerJS()}
</body>
</html>`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Success page error:", msg);
      res.status(500).send("Error loading success page. Your payment was received — check back shortly.");
    }
  });

  } // end if (stripe)

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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Regen Compute — Checkout Cancelled</title>
  ${brandFonts()}
  <style>
    ${betaBannerCSS()}
    ${brandCSS()}
  </style>
</head>
<body>
  ${betaBannerHTML()}
  ${brandHeader({ nav: [{ label: "AI Plugin", href: "/ai-plugin" }, { label: "Research", href: "/research" }, { label: "About", href: "/about" }, { label: "Developers", href: "/developers" }, { label: "Dashboard", href: "/dashboard/login" }] })}
  <div class="regen-container--narrow" style="padding:60px 24px;text-align:center;max-width:540px;margin:0 auto;">
    <h1 style="color:var(--regen-navy);font-size:24px;font-weight:700;margin:0 0 16px;">No worries!</h1>
    <p style="color:var(--regen-gray-600);font-size:15px;line-height:1.6;margin:0 0 24px;">
      No payment was processed. A subscription isn't for everyone, and that's totally okay.
    </p>
    <p style="color:var(--regen-gray-600);font-size:15px;line-height:1.6;margin:0 0 32px;">
      If you're curious about ecological credits — carbon, biodiversity, marine stewardship, and more — you can explore what's available and retire credits directly on the Regen Marketplace.
    </p>
    <div style="display:flex;flex-direction:column;gap:12px;align-items:center;">
      <a class="regen-btn regen-btn--primary regen-btn--sm" href="/#pricing">Back to subscription plans</a>
      <a class="regen-btn regen-btn--outline regen-btn--sm" href="https://app.regen.network" target="_blank" rel="noopener">Explore ecocredits on Regen Marketplace &rarr;</a>
    </div>
  </div>
  ${brandFooter()}
${betaBannerJS()}
</body>
</html>`);
  });

  /**
   * GET /checkout-page
   * Legacy route — redirects to landing page pricing section.
   */
  router.get("/checkout-page", (_req: Request, res: Response) => {
    res.redirect(301, "/#pricing");
  });

  if (stripe) {
  /**
   * GET /manage?email=user@example.com
   * Creates a Stripe Billing Portal session for subscription self-management
   * (upgrade, downgrade, cancel, update payment method) and redirects to it.
   */
  router.get("/manage", checkoutLimiter, async (req: Request, res: Response) => {
    try {
      const email = req.query.email as string | undefined;

      if (!email) {
        res.status(400).send("Missing email parameter. Use: /manage?email=you@example.com");
        return;
      }

      // Look up user to get their Stripe customer ID
      const user = getUserByEmail(db, email);
      if (!user || !user.stripe_customer_id) {
        res.status(404).send("No subscription found for this email. If you just subscribed, try again in a few seconds.");
        return;
      }

      const returnUrl = config?.stripePortalReturnUrl ?? baseUrl;
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: user.stripe_customer_id,
        return_url: returnUrl,
      });

      res.redirect(303, portalSession.url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Manage portal error:", msg);
      res.status(500).send("Error creating subscription management session. Please try again.");
    }
  });
  } // end if (stripe) — /manage

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
      topup_url: `${baseUrl}/#pricing`,
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
        topup_url: `${baseUrl}/#pricing`,
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

  // --- Profile endpoints ---

  router.post("/profile/display-name", async (req: Request, res: Response) => {
    try {
      const { session_id, display_name } = req.body ?? {};
      if (!session_id || typeof session_id !== "string") {
        res.status(400).json({ error: "session_id is required" });
        return;
      }
      const name = typeof display_name === "string" ? display_name.trim().slice(0, 100) : "";
      if (!name) {
        res.status(400).json({ error: "display_name is required" });
        return;
      }
      if (!stripe) {
        res.status(503).json({ error: "Stripe not configured" });
        return;
      }

      const session = await stripe.checkout.sessions.retrieve(session_id);
      const email = session.customer_email ?? session.customer_details?.email ?? null;
      if (!email) {
        res.status(400).json({ error: "No email found for session" });
        return;
      }

      const user = getUserByEmail(db, email);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      setUserDisplayName(db, user.id, name);
      const subscriber = getSubscriberByUserId(db, user.id);
      const regenAddress = subscriber?.regen_address ?? null;
      const profileUrl = regenAddress
        ? `https://app.regen.network/profiles/${regenAddress}/portfolio`
        : null;

      // Push profile to app.regen.network registry in the background (non-blocking)
      if (subscriber) {
        updateRegistryProfile(subscriber.id, {
          name,
          image: `${baseUrl}/profile-avatar.svg`,
          bgImage: `${baseUrl}/profile-banner.svg`,
        }).then((result) => {
          if (result.success) {
            console.log(`Registry profile synced for subscriber=${subscriber.id}`);
          } else {
            console.warn(`Registry profile sync failed for subscriber=${subscriber.id}: ${result.error}`);
          }
        }).catch(() => {}); // swallow — this is best-effort
      }

      res.json({ ok: true, display_name: name, regen_address: regenAddress, profile_url: profileUrl });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Profile display-name error:", msg);
      res.status(500).json({ error: "Failed to save display name" });
    }
  });

  // --- Beta feedback endpoints ---

  router.post("/feedback", (req: Request, res: Response) => {
    const { name, message, category, page } = req.body ?? {};
    if (!message || typeof message !== "string" || !message.trim()) {
      res.status(400).json({ error: "message is required" });
      return;
    }
    const cat = ["bug", "suggestion", "comment"].includes(category) ? category : "comment";
    db.prepare(
      "INSERT INTO beta_feedback (name, message, category, page) VALUES (?, ?, ?, ?)"
    ).run(
      typeof name === "string" && name.trim() ? name.trim() : null,
      message.trim(),
      cat,
      typeof page === "string" ? page : null
    );
    res.json({ ok: true });
  });

  router.get("/feedback", (_req: Request, res: Response) => {
    const rows = db.prepare(
      "SELECT * FROM beta_feedback ORDER BY created_at DESC"
    ).all() as Array<{ id: number; name: string | null; message: string; category: string; page: string | null; created_at: string }>;

    const tableRows = rows.map(r =>
      `<tr><td>${r.id}</td><td>${r.created_at}</td><td>${escapeHtml(r.category)}</td><td>${escapeHtml(r.name ?? "")}</td><td>${escapeHtml(r.message)}</td><td>${escapeHtml(r.page ?? "")}</td></tr>`
    ).join("");

    res.setHeader("Content-Type", "text/html");
    res.send(`<!DOCTYPE html><html><head><title>Beta Feedback</title>
<style>body{font-family:sans-serif;margin:24px;} table{border-collapse:collapse;width:100%;} th,td{border:1px solid #ddd;padding:8px;text-align:left;font-size:14px;} th{background:#f9fafb;} tr:hover{background:#f0f7f4;}</style>
</head><body><h1>Beta Feedback (${rows.length})</h1>
<table><thead><tr><th>ID</th><th>Date</th><th>Category</th><th>Name</th><th>Message</th><th>Page</th></tr></thead>
<tbody>${tableRows || "<tr><td colspan=6>No feedback yet</td></tr>"}</tbody></table></body></html>`);
  });

  // Daily admin checks: monthly credit selection + tradable stock levels
  const DAILY_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
  setInterval(() => {
    checkAndSendMonthlyReminder().catch((err) => {
      console.error("Monthly reminder check error:", err instanceof Error ? err.message : err);
    });
    checkCreditStock().catch((err) => {
      console.error("Tradable stock check error:", err instanceof Error ? err.message : err);
    });
  }, DAILY_CHECK_INTERVAL_MS);
  // Also check on startup
  setTimeout(() => {
    checkAndSendMonthlyReminder().catch((err) => {
      console.error("Monthly reminder check error (startup):", err instanceof Error ? err.message : err);
    });
    checkCreditStock().catch((err) => {
      console.error("Tradable stock check error (startup):", err instanceof Error ? err.message : err);
    });
  }, 15_000);

  // Start scheduled retirement processor — checks every hour for due yearly retirements
  const SCHEDULED_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  setInterval(() => {
    processScheduledRetirements(db, baseUrl).catch((err) => {
      console.error("Scheduled retirement processor error:", err instanceof Error ? err.message : err);
    });
  }, SCHEDULED_CHECK_INTERVAL_MS);
  // Also run once on startup (after a short delay to let the server finish initializing)
  setTimeout(() => {
    processScheduledRetirements(db, baseUrl).catch((err) => {
      console.error("Scheduled retirement processor error (startup):", err instanceof Error ? err.message : err);
    });
    // Backfill any subscribers missing regen_address from their retirement records
    backfillSubscriberRegenAddresses(db);
  }, 10_000);

  // --- Admin: approve held referral rewards ---
  // POST /admin/referrals/approve { reward_id: number } or { all: true }
  // Auth: Bearer SESSION_SECRET
  router.post("/admin/referrals/approve", async (req: Request, res: Response) => {
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${config?.sessionSecret}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { reward_id, all } = body ?? {};

    const held = getHeldReferralRewards(db);
    if (held.length === 0) {
      res.json({ message: "No held referral rewards", approved: 0 });
      return;
    }

    const REFERRAL_BONUS_CAP_CENTS = 250;
    const toApprove = all ? held : held.filter(r => r.id === reward_id);
    let approved = 0;

    for (const reward of toApprove) {
      // Look up the referred subscriber to get their plan amount for the bonus calculation
      const referredSub = getSubscriberByUserId(db, reward.referred_user_id);
      const effectiveAmount = Math.min(referredSub?.amount_cents ?? 500, 500); // cap at $5
      approveReferralReward(db, reward.id);
      const updatedReward = getPendingReferralRewardForReferred(db, reward.referred_user_id);
      if (updatedReward) {
        await executeReferralBonus(db, updatedReward, effectiveAmount, REFERRAL_BONUS_CAP_CENTS, baseUrl);
      }
      approved++;
    }

    res.json({ message: `Approved ${approved} referral reward(s)`, approved, held_remaining: held.length - approved });
  });

  // GET /admin/referrals/held — list held referral rewards
  router.get("/admin/referrals/held", (req: Request, res: Response) => {
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${config?.sessionSecret}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const held = getHeldReferralRewards(db);
    res.json({ held, count: held.length });
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
function amountToPlan(amountCents: number, interval: "monthly" | "yearly" = "monthly"): "dabbler" | "builder" | "agent" {
  if (interval === "yearly") {
    // Yearly amounts: $12.50 (1250), $25 (2500), $50 (5000)
    if (amountCents <= 1500) return "dabbler";
    if (amountCents <= 3000) return "builder";
    return "agent";
  }
  // Monthly amounts: $1.25 (125), $2.50 (250), $5 (500)
  if (amountCents <= 150) return "dabbler";
  if (amountCents <= 300) return "builder";
  return "agent";
}

/** Map Stripe subscription status to our subscriber status */
function stripeStatusToLocal(status: string): "active" | "paused" | "cancelled" {
  if (status === "active" || status === "trialing") return "active";
  if (status === "paused") return "paused";
  return "cancelled";
}

async function handleSubscriptionCreated(db: Database.Database, sub: Stripe.Subscription, stripe: Stripe, baseUrl: string) {
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
      console.log(`New user created for subscription: ${user.api_key.slice(0, 12)}... (${email})`);
    }

    const priceItem = sub.items?.data?.[0]?.price;
    const amountCents = priceItem?.unit_amount ?? 0;
    const stripeInterval = priceItem?.recurring?.interval;
    const billingInterval: "monthly" | "yearly" = stripeInterval === "year" ? "yearly" : "monthly";
    const plan = amountToPlan(amountCents, billingInterval);
    const periodStart = (sub as unknown as Record<string, unknown>).current_period_start
      ? new Date(((sub as unknown as Record<string, unknown>).current_period_start as number) * 1000).toISOString()
      : undefined;
    const periodEnd = (sub as unknown as Record<string, unknown>).current_period_end
      ? new Date(((sub as unknown as Record<string, unknown>).current_period_end as number) * 1000).toISOString()
      : undefined;

    const subscriber = createSubscriber(db, user.id, stripeSubId, plan, amountCents, periodStart, periodEnd, billingInterval);
    console.log(`Subscription created: ${stripeSubId} plan=${plan} interval=${billingInterval} amount=$${(amountCents / 100).toFixed(2)}`);

    // Link to organization if this is an org subscription
    const orgId = sub.metadata?.org_id;
    if (orgId) {
      try {
        linkSubscriberToOrg(db, subscriber.id, parseInt(orgId, 10));
        // Update org contact email
        if (email) {
          db.prepare("UPDATE organizations SET contact_email = ?, updated_at = datetime('now') WHERE id = ?").run(email, parseInt(orgId, 10));
        }
        console.log(`Subscriber ${subscriber.id} linked to org ${orgId}`);
      } catch (err) {
        console.error(`Failed to link subscriber to org ${orgId}:`, err instanceof Error ? err.message : err);
      }
    }

    // Derive and store Regen address for this subscriber
    try {
      const regenAddr = await deriveSubscriberAddress(subscriber.id);
      setSubscriberRegenAddress(db, subscriber.id, regenAddr);
      console.log(`Regen address derived: subscriber=${subscriber.id} addr=${regenAddr}`);
    } catch (err) {
      console.error(`Failed to derive regen address for subscriber ${subscriber.id}:`, err instanceof Error ? err.message : err);
    }

    // Send welcome email (fire-and-forget, don't block webhook response)
    if (email) {
      const dashboardUrl = `${baseUrl}/dashboard/login`;
      sendWelcomeEmail(email, plan, dashboardUrl).catch(err => {
        console.error("Failed to send welcome email:", err instanceof Error ? err.message : err);
      });
    }

    // Handle referral tracking from subscription metadata
    const referrerId = sub.metadata?.referrer_id;
    if (referrerId) {
      const referrerUserId = parseInt(referrerId, 10);
      if (!isNaN(referrerUserId) && referrerUserId !== user.id) {
        setUserReferredBy(db, user.id, referrerUserId);
        createReferralReward(db, referrerUserId, user.id, "extra_credit_retirement");
        console.log(`Referral tracked: referrer=${referrerUserId} referred=${user.id}`);
      }
    }
  } catch (err) {
    console.error("Error handling subscription.created:", err instanceof Error ? err.message : err);
  }
}

function handleSubscriptionUpdated(db: Database.Database, sub: Stripe.Subscription) {
  try {
    const stripeSubId = sub.id;
    const existing = getSubscriberByStripeId(db, stripeSubId);
    if (!existing) return; // Not tracked

    const priceItem = sub.items?.data?.[0]?.price;
    const amountCents = priceItem?.unit_amount ?? existing.amount_cents;
    const stripeInterval = priceItem?.recurring?.interval;
    const billingInterval: "monthly" | "yearly" = stripeInterval === "year" ? "yearly" : "monthly";
    const plan = amountToPlan(amountCents, billingInterval);
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
      billing_interval: billingInterval,
      status,
      current_period_start: periodStart,
      current_period_end: periodEnd,
    });

    // If a yearly subscriber's amount changed, recalculate scheduled retirements
    if (existing.billing_interval === "yearly" && amountCents !== existing.amount_cents) {
      // Cancel existing pending scheduled retirements
      const cancelled = db.prepare(
        "UPDATE scheduled_retirements SET status = 'failed', error = 'plan_changed' WHERE subscriber_id = ? AND status = 'pending'"
      ).run(existing.id);

      if (cancelled.changes > 0) {
        // Recalculate with new amount
        const newNetTotal = calculateNetAfterStripe(amountCents);
        const newMonthlyNet = Math.floor(newNetTotal / 12);
        const newMonthlyGross = Math.floor(amountCents / 12);

        // Recreate scheduled retirements for remaining months
        const now = new Date();
        for (let i = 0; i < cancelled.changes; i++) {
          const scheduledDate = new Date(now);
          scheduledDate.setMonth(scheduledDate.getMonth() + i + 1);
          createScheduledRetirement(
            db, existing.id, newMonthlyGross, newMonthlyNet,
            scheduledDate.toISOString().split("T")[0],
            "yearly"
          );
        }

        console.log(
          `Recalculated ${cancelled.changes} scheduled retirements for subscriber ${existing.id} ` +
          `after plan change: $${(existing.amount_cents / 100).toFixed(2)} → $${(amountCents / 100).toFixed(2)}`
        );
      }
    }

    console.log(`Subscription updated: ${stripeSubId} plan=${plan} interval=${billingInterval} status=${status}`);
  } catch (err) {
    console.error("Error handling subscription.updated:", err instanceof Error ? err.message : err);
  }
}

function handleSubscriptionDeleted(db: Database.Database, sub: Stripe.Subscription) {
  try {
    const stripeSubId = sub.id;
    const existing = getSubscriberByStripeId(db, stripeSubId);
    updateSubscriberStatus(db, stripeSubId, "cancelled");

    // Cancel any pending scheduled retirements for yearly subscribers
    if (existing) {
      const cancelled = cancelScheduledRetirements(db, existing.id);
      if (cancelled > 0) {
        console.log(`Cancelled ${cancelled} scheduled retirement(s) for subscriber ${existing.id}`);
      }

      // Refund unused burn budget for yearly subscribers
      if (existing.billing_interval === "yearly") {
        // Count how many monthly retirements were actually executed
        const executedCount = db.prepare(
          "SELECT COUNT(*) as count FROM subscriber_retirements WHERE subscriber_id = ?"
        ).get(existing.id) as { count: number };

        const monthsUsed = executedCount.count;
        const monthsUnused = Math.max(0, 12 - monthsUsed);

        if (monthsUnused > 0) {
          const yearlyNet = calculateNetAfterStripe(existing.amount_cents);
          const yearlyBurnBudget = Math.floor(yearlyNet * 0.05);
          const unusedBurn = Math.floor(yearlyBurnBudget * monthsUnused / 12);

          if (unusedBurn > 0) {
            // Insert negative entry to offset the front-loaded burn
            accumulateBurnBudget(db, -unusedBurn, "yearly_cancel_refund", existing.id);
            console.log(
              `Refunded unused burn budget for cancelled yearly subscriber ${existing.id}: ` +
              `$${(unusedBurn / 100).toFixed(2)} (${monthsUnused} unused months of ${yearlyBurnBudget} total)`
            );
          }
        }
      }
      // Sweep remaining funds from subscriber wallet back to master
      sweepSubscriberFunds(existing.id).then((result) => {
        if (result.swept.length > 0) {
          console.log(
            `Swept subscriber ${existing.id} wallet on cancellation: ` +
            `${result.swept.map((a) => `${a.amount} ${a.denom}`).join(", ")} tx=${result.txHash}`
          );
        }
      }).catch((err) => {
        console.error(`Failed to sweep funds for cancelled subscriber ${existing.id}:`, err instanceof Error ? err.message : err);
      });
    }

    console.log(`Subscription cancelled: ${stripeSubId}`);
  } catch (err) {
    console.error("Error handling subscription.deleted:", err instanceof Error ? err.message : err);
  }
}

async function handleInvoicePaid(db: Database.Database, invoice: Stripe.Invoice, baseUrl: string, retryCount = 0) {
  try {
    // In Stripe SDK v20+, subscription is nested under parent.subscription_details
    const subDetails = invoice.parent?.subscription_details;
    const subRef = subDetails?.subscription;
    const subId = typeof subRef === "string" ? subRef : subRef?.id;
    if (!subId) return; // Not a subscription invoice

    let existing = getSubscriberByStripeId(db, subId);
    if (!existing) {
      // Race condition: invoice.paid can arrive before customer.subscription.created.
      // Retry up to 3 times with increasing delays to give subscription.created time to process.
      const MAX_RETRIES = 3;
      const RETRY_DELAYS = [5_000, 15_000, 30_000]; // 5s, 15s, 30s
      if (retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAYS[retryCount];
        console.log(`Invoice paid but subscriber not found for ${subId} — retrying in ${delay / 1000}s (attempt ${retryCount + 1}/${MAX_RETRIES})`);
        setTimeout(() => {
          handleInvoicePaid(db, invoice, baseUrl, retryCount + 1).catch(err => {
            console.error(`Invoice retry failed for ${subId}:`, err instanceof Error ? err.message : err);
          });
        }, delay);
        return;
      }
      console.error(`Invoice paid but subscriber never found for ${subId} after ${MAX_RETRIES} retries — retirement skipped`);
      return;
    }

    // Update subscription period from the invoice
    const periodStart = invoice.lines?.data?.[0]?.period?.start;
    const periodEnd = invoice.lines?.data?.[0]?.period?.end;

    const updates: Parameters<typeof updateSubscriber>[2] = {};
    if (periodStart) {
      updates.current_period_start = new Date(periodStart * 1000).toISOString();
    }
    if (periodEnd) {
      updates.current_period_end = new Date(periodEnd * 1000).toISOString();
    }

    if (Object.keys(updates).length > 0) {
      updateSubscriber(db, subId, updates);
    }

    const amountCents = invoice.amount_paid ?? 0;
    console.log(
      `Invoice paid: subscription=${subId} amount=$${(amountCents / 100).toFixed(2)} period=${updates.current_period_start ?? "?"} to ${updates.current_period_end ?? "?"}`
    );

    // Trigger per-subscriber retirement (fire-and-forget, don't block webhook response)
    // For free-month referrals ($0 invoice), retire as if the subscriber paid their plan amount.
    // Apply Stripe fee deduction to match what they'll see on paid months (consistency).
    // The full cost is funded from the Operations budget.
    const FREE_MONTH_CAP_CENTS = 500; // Cap free-month retirement at $5
    const REFERRAL_BONUS_CAP_CENTS = 250; // Cap referral bonus at $2.50
    let effectiveAmountCents = amountCents;
    const isFreeMonth = amountCents === 0 && existing.status === "active" && existing.amount_cents > 0;
    if (isFreeMonth) {
      effectiveAmountCents = Math.min(existing.amount_cents, FREE_MONTH_CAP_CENTS);
      console.log(
        `Free-month referral: subscriber=${existing.id} plan=${existing.plan} — ` +
        `retiring as if paid $${(effectiveAmountCents / 100).toFixed(2)} (capped at $${(FREE_MONTH_CAP_CENTS / 100).toFixed(2)}, funded from ops budget)`
      );
    }

    if (effectiveAmountCents > 0 && existing.status === "active") {
      // Derive and store regen address if not yet set
      if (!existing.regen_address) {
        try {
          const regenAddr = await deriveSubscriberAddress(existing.id);
          setSubscriberRegenAddress(db, existing.id, regenAddr);
        } catch (err) {
          console.error(`Failed to derive regen address for subscriber ${existing.id}:`, err instanceof Error ? err.message : err);
        }
      }

      if (existing.billing_interval === "yearly") {
        // Yearly: deduct Stripe fees ONCE on the full payment, then divide net by 12.
        const netTotal = calculateNetAfterStripe(effectiveAmountCents);
        const monthlyNet = Math.floor(netTotal / 12);
        const firstMonthNet = netTotal - (monthlyNet * 11); // remainder goes to first month
        const monthlyGross = Math.floor(effectiveAmountCents / 12);
        const firstMonthGross = effectiveAmountCents - (monthlyGross * 11);

        // Schedule months 2-12 (store gross for display, but net is pre-computed at execution)
        const now = new Date();
        for (let month = 1; month <= 11; month++) {
          const scheduledDate = new Date(now);
          scheduledDate.setMonth(scheduledDate.getMonth() + month);
          createScheduledRetirement(
            db, existing.id, monthlyGross, monthlyNet,
            scheduledDate.toISOString().split("T")[0],
            "yearly"
          );
        }
        console.log(
          `Scheduled 11 future retirements for yearly subscriber ${existing.id} ` +
          `(net $${(monthlyNet / 100).toFixed(2)}/mo from $${(effectiveAmountCents / 100).toFixed(2)} yearly)`
        );

        // Accumulate FULL year's burn budget upfront (5% of entire net payment).
        // Monthly retirements will skip burn accumulation since it's already front-loaded.
        const yearlyBurnBudget = Math.floor(netTotal * 0.05); // 5% burn split
        if (yearlyBurnBudget > 0) {
          accumulateBurnBudget(db, yearlyBurnBudget, "yearly_frontload", existing.id);
          console.log(
            `Front-loaded yearly burn budget: $${(yearlyBurnBudget / 100).toFixed(2)} ` +
            `(5% of $${(netTotal / 100).toFixed(2)} net) for subscriber ${existing.id}`
          );
          maybeExecuteAutoBurn(db).catch(() => {});
        }

        // Execute first month immediately — pass precomputedNetCents to skip double fee deduction.
        // skipBurnAccumulation=true because burn was already front-loaded above.
        executeRetirementAsync(db, existing.id, firstMonthGross, existing.billing_interval, baseUrl, firstMonthNet, invoice.id, true);
      } else {
        // Monthly: execute immediately (Stripe fees deducted inside retireForSubscriber)
        executeRetirementAsync(db, existing.id, effectiveAmountCents, existing.billing_interval, baseUrl, undefined, invoice.id);
      }

      // Referral bonus: triggered immediately when a free-month referral signs up.
      // The referrer gets rewarded right away — caps and daily rate limits prevent abuse.
      if (isFreeMonth) {
        const referralReward = getPendingReferralRewardForReferred(db, existing.user_id);
        if (referralReward) {
          // Rate-limit: if more than 10 referrals today, hold for admin review
          const todayCount = getTodayReferralCount(db);
          if (todayCount > 10) {
            holdReferralReward(db, referralReward.id);
            console.warn(
              `Referral anomaly: ${todayCount} referrals today — holding reward ${referralReward.id} ` +
              `(referrer=${referralReward.referrer_user_id} referred=${referralReward.referred_user_id}) for admin review`
            );
            sendTelegram(
              `⚠️ *Referral Anomaly*\n${todayCount} referrals today — exceeds daily limit of 10.\n` +
              `Reward #${referralReward.id} held for review.\n` +
              `Referrer: user ${referralReward.referrer_user_id}\n` +
              `Referred: user ${referralReward.referred_user_id}`
            ).catch(() => {});
          } else {
            const cappedForBonus = Math.min(effectiveAmountCents, FREE_MONTH_CAP_CENTS);
            executeReferralBonus(db, referralReward, cappedForBonus, REFERRAL_BONUS_CAP_CENTS, baseUrl);
          }
        }
      }
    }
  } catch (err) {
    console.error("Error handling invoice.paid:", err instanceof Error ? err.message : err);
  }
}

/** Send the appropriate retirement notification email (first vs recurring) */
async function sendRetirementNotificationEmail(
  db: Database.Database,
  subscriberId: number,
  result: SubscriberRetirementResult,
  baseUrl: string,
): Promise<void> {
  try {
    // Look up subscriber email
    const sub = db.prepare(
      "SELECT s.*, u.email FROM subscribers s JOIN users u ON u.id = s.user_id WHERE s.id = ?"
    ).get(subscriberId) as { email: string; id: number } | undefined;
    if (!sub?.email) return;

    const dashboardUrl = `${baseUrl}/dashboard/login`;
    const portfolioUrl = result.regenAddress
      ? `https://app.regen.network/profiles/${result.regenAddress}/portfolio`
      : null;

    // Build batch summaries from result
    const batchSummaries = result.batches
      .filter((b) => b.creditsRetired > 0)
      .map((b) => {
        const project = getProjectForBatch(b.batchDenom);
        return {
          projectName: project?.name ?? b.creditClassId,
          credits: b.creditsRetired,
          creditType: project?.creditTypeLabel ?? b.creditTypeAbbrev,
        };
      });

    // Count total retirements to determine first vs recurring
    const retirementCount = (db.prepare(
      "SELECT COUNT(*) as cnt FROM subscriber_retirements WHERE subscriber_id = ?"
    ).get(subscriberId) as { cnt: number })?.cnt ?? 0;

    if (retirementCount <= 1) {
      await sendFirstRetirementEmail(
        sub.email, dashboardUrl, result.totalCreditsRetired, portfolioUrl, batchSummaries,
      );
      console.log(`First retirement email sent to ${sub.email}`);
    } else {
      // Get cumulative stats from subscriber_retirements (attributions may not be written yet)
      const cumRow = db.prepare(
        "SELECT COALESCE(SUM(total_credits_retired), 0) AS total_credits, COUNT(DISTINCT strftime('%Y-%m', created_at)) AS months_active FROM subscriber_retirements WHERE subscriber_id = ?"
      ).get(subscriberId) as { total_credits: number; months_active: number } | undefined;
      const totalCumCredits = cumRow?.total_credits ?? 0;
      const monthsActive = cumRow?.months_active ?? 1;
      await sendRetirementReceiptEmail(
        sub.email, dashboardUrl, result.totalCreditsRetired, totalCumCredits,
        Math.max(1, monthsActive), portfolioUrl, batchSummaries,
      );
      console.log(`Retirement receipt email sent to ${sub.email}`);
    }
  } catch (err) {
    console.error(`Failed to send retirement email for subscriber ${subscriberId}:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Execute referral bonus retirement for the referrer.
 * Retires at half the referred subscriber's effective amount (capped),
 * plus half the burn credit. Both funded from ops budget.
 */
async function executeReferralBonus(
  db: Database.Database,
  referralReward: ReferralReward,
  referredEffectiveAmountCents: number,
  bonusCapCents: number,
  baseUrl: string,
): Promise<void> {
  const referrerSub = getSubscriberByUserId(db, referralReward.referrer_user_id);
  if (!referrerSub || referrerSub.status !== "active") {
    console.warn(
      `Referral bonus skipped: referrer user=${referralReward.referrer_user_id} has no active subscription`
    );
    return;
  }

  const bonusGross = Math.min(Math.floor(referredEffectiveAmountCents / 2), bonusCapCents);

  // Ensure referrer has a regen address
  if (!referrerSub.regen_address) {
    try {
      const addr = await deriveSubscriberAddress(referrerSub.id);
      setSubscriberRegenAddress(db, referrerSub.id, addr);
    } catch (err) {
      console.error(`Failed to derive regen address for referrer subscriber ${referrerSub.id}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(
    `Referral bonus: referrer subscriber=${referrerSub.id} (user=${referralReward.referrer_user_id}) — ` +
    `retiring $${(bonusGross / 100).toFixed(2)} gross (half of $${(referredEffectiveAmountCents / 100).toFixed(2)}, ` +
    `capped at $${(bonusCapCents / 100).toFixed(2)}) funded from ops budget`
  );

  // Look up referrer's email and referral code for the bonus notification email
  const referrerUser = db.prepare(
    "SELECT email, referral_code FROM users WHERE id = ?"
  ).get(referralReward.referrer_user_id) as { email: string | null; referral_code: string } | undefined;

  // Execute retirement for the referrer (Stripe fees applied to match normal flow).
  // skipBurnAccumulation=true — burn is handled separately below at the explicit half rate.
  executeRetirementAsync(db, referrerSub.id, bonusGross, referrerSub.billing_interval, baseUrl, undefined, `referral-bonus-${referralReward.id}`, true,
    (result) => {
      // Record transaction for dashboard contributions table
      const firstTxHash = result.batches.find(b => b.buyTxHash)?.buyTxHash ?? null;
      insertReferralBonusTransaction(
        db, referralReward.referrer_user_id, bonusGross,
        firstTxHash, result.totalCreditsRetired,
      );

      // Send referral bonus thank-you email on successful retirement
      if (referrerUser?.email && result.totalCreditsRetired > 0) {
        const dashboardUrl = `${baseUrl}/dashboard/login`;
        const referralLink = `${baseUrl}/r/${referrerUser.referral_code}`;
        const batchSummaries = result.batches
          .filter((b) => b.creditsRetired > 0)
          .map((b) => {
            const project = getProjectForBatch(b.batchDenom);
            return {
              projectName: project?.name ?? b.creditClassId,
              credits: b.creditsRetired,
              creditType: project?.creditTypeLabel ?? b.creditTypeAbbrev,
            };
          });
        sendReferralBonusEmail(
          referrerUser.email, dashboardUrl, referralLink,
          result.totalCreditsRetired, batchSummaries,
        ).then(() => {
          console.log(`Referral bonus email sent to ${referrerUser.email}`);
        }).catch((err) => {
          console.error(`Failed to send referral bonus email to ${referrerUser.email}:`, err instanceof Error ? err.message : err);
        });
      }
    },
  );

  // Credit half the burn amount that the referred subscriber's retirement generates
  const referredNet = calculateNetAfterStripe(referredEffectiveAmountCents);
  const referredBurn = Math.floor(referredNet * 0.05);
  const bonusBurn = Math.floor(referredBurn / 2);
  if (bonusBurn > 0) {
    accumulateBurnBudget(db, bonusBurn, "referral_bonus", referrerSub.id);
    console.log(
      `Referral bonus burn: $${(bonusBurn / 100).toFixed(2)} credited for referrer subscriber=${referrerSub.id}`
    );
    maybeExecuteAutoBurn(db).catch(() => {});
  }

  // Mark the referral reward as fulfilled
  fulfillReferralReward(db, referralReward.id, `referral-bonus-${referrerSub.id}`);
}

/** Fire-and-forget retirement execution with logging */
function executeRetirementAsync(
  db: Database.Database,
  subscriberId: number,
  grossAmountCents: number,
  billingInterval: "monthly" | "yearly",
  baseUrl: string,
  precomputedNetCents?: number,
  paymentId?: string,
  skipBurnAccumulation = false,
  onSuccess?: (result: SubscriberRetirementResult) => void,
): void {
  withSubscriberLock(subscriberId, async () => {
    const result = await retireForSubscriber({
      subscriberId,
      grossAmountCents,
      billingInterval,
      precomputedNetCents,
      paymentId,
    });

    if (!skipBurnAccumulation && result.burnBudgetCents > 0 && (result.status === "success" || result.status === "partial")) {
      accumulateBurnBudget(db, result.burnBudgetCents, "monthly_retirement", subscriberId);
      // Check if pending burn budget has reached threshold — trigger auto burn
      maybeExecuteAutoBurn(db).catch(() => {});
    }
    if (result.status === "success") {
      console.log(
        `Retirement completed: subscriber=${subscriberId} credits=${result.totalCreditsRetired.toFixed(6)} ` +
        `spent=$${(result.totalSpentCents / 100).toFixed(2)} status=${result.status}`
      );
      // Send retirement notification email (fire-and-forget)
      sendRetirementNotificationEmail(db, subscriberId, result, baseUrl).catch(() => {});
      // Invoke optional success callback (e.g., referral bonus email)
      if (onSuccess) {
        try { onSuccess(result); } catch (err) {
          console.error(`onSuccess callback error for subscriber ${subscriberId}:`, err instanceof Error ? err.message : err);
        }
      }
    } else if (result.status === "partial" && paymentId) {
      // Auto-retry partial retirements after 60 seconds
      const failedBatches = result.batches.filter(b => b.error !== null);
      console.log(
        `Partial retirement for subscriber ${subscriberId}: ${failedBatches.length} failed batches. ` +
        `Auto-retrying in 60s with payment_id=${paymentId}`
      );
      setTimeout(async () => {
        try {
          console.log(`Auto-retry: re-executing retirement for subscriber ${subscriberId} (payment_id=${paymentId})`);
          const retryResult = await retireForSubscriber({
            subscriberId,
            grossAmountCents,
            billingInterval,
            precomputedNetCents,
            paymentId,
          });
          console.log(`Auto-retry result: subscriber ${subscriberId} status=${retryResult.status} credits=${retryResult.totalCreditsRetired}`);
        } catch (err) {
          console.error(`Auto-retry failed for subscriber ${subscriberId}:`, err instanceof Error ? err.message : err);
        }
      }, 60_000);
    } else if (result.status === "partial") {
      console.warn(
        `Retirement partial: subscriber=${subscriberId} credits=${result.totalCreditsRetired.toFixed(6)} ` +
        `errors=${result.errors.length} (no paymentId, cannot retry)`
      );
    } else {
      console.error(
        `Retirement failed: subscriber=${subscriberId} errors=${JSON.stringify(result.errors)}`
      );
    }
  }).catch((err) => {
    console.error(`Retirement error for subscriber ${subscriberId}:`, err instanceof Error ? err.message : err);
  });
}

/**
 * Process due scheduled retirements (for yearly subscribers).
 * Should be called periodically (e.g. daily via cron or setInterval).
 */
async function processScheduledRetirements(db: Database.Database, baseUrl?: string): Promise<void> {
  const due = getDueScheduledRetirements(db);
  if (due.length === 0) return;

  console.log(`Processing ${due.length} scheduled retirement(s)...`);

  for (const scheduled of due) {
    updateScheduledRetirement(db, scheduled.id, { status: "running" });

    try {
      await withSubscriberLock(scheduled.subscriber_id, async () => {
        const result = await retireForSubscriber({
          subscriberId: scheduled.subscriber_id,
          grossAmountCents: scheduled.gross_amount_cents,
          billingInterval: scheduled.billing_interval as "monthly" | "yearly",
          precomputedNetCents: scheduled.net_amount_cents || undefined,
          paymentId: `scheduled-${scheduled.id}`,
        });

        // Yearly burn budget is front-loaded at payment time — skip per-month accumulation.
        // Only accumulate burn for monthly scheduled retirements (currently none, but future-proof).
        const isYearlyScheduled = scheduled.billing_interval === "yearly";

        if (result.status === "success") {
          if (!isYearlyScheduled && result.burnBudgetCents > 0) {
            accumulateBurnBudget(db, result.burnBudgetCents, "scheduled_retirement", scheduled.subscriber_id);
            maybeExecuteAutoBurn(db).catch(() => {});
          }
          updateScheduledRetirement(db, scheduled.id, {
            status: "completed",
            executed_at: new Date().toISOString(),
          });
          console.log(
            `Scheduled retirement completed: id=${scheduled.id} subscriber=${scheduled.subscriber_id} ` +
            `credits=${result.totalCreditsRetired.toFixed(6)}`
          );
          // Send retirement notification email
          if (baseUrl) {
            sendRetirementNotificationEmail(db, scheduled.subscriber_id, result, baseUrl).catch(() => {});
          }
        } else if (result.status === "partial") {
          // Some batches succeeded, others failed — mark as partial so it will be retried
          if (!isYearlyScheduled && result.burnBudgetCents > 0) {
            accumulateBurnBudget(db, result.burnBudgetCents, "scheduled_retirement", scheduled.subscriber_id);
            maybeExecuteAutoBurn(db).catch(() => {});
          }
          updateScheduledRetirement(db, scheduled.id, {
            status: "partial",
            error: result.errors.join("; "),
            executed_at: new Date().toISOString(),
          });
          console.warn(
            `Scheduled retirement partial: id=${scheduled.id} subscriber=${scheduled.subscriber_id} ` +
            `credits=${result.totalCreditsRetired.toFixed(6)} — will retry failed batches`
          );
        } else {
          updateScheduledRetirement(db, scheduled.id, {
            status: "failed",
            error: result.errors.join("; "),
            executed_at: new Date().toISOString(),
          });
          console.error(
            `Scheduled retirement failed: id=${scheduled.id} subscriber=${scheduled.subscriber_id} ` +
            `errors=${JSON.stringify(result.errors)}`
          );
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      db.prepare("UPDATE scheduled_retirements SET retry_count = retry_count + 1 WHERE id = ?").run(scheduled.id);
      updateScheduledRetirement(db, scheduled.id, {
        status: "failed",
        error: msg,
        executed_at: new Date().toISOString(),
      });
      console.error(`Scheduled retirement error: id=${scheduled.id} retry_count=${(scheduled.retry_count ?? 0) + 1} ${msg}`);
    }
  }
}

// --- Auto burn trigger ---

/** Minimum pending burn budget before triggering a swap-and-burn (in cents). */
const AUTO_BURN_THRESHOLD_CENTS = 500; // $5.00

/** Debounce: don't trigger another burn if one ran within the last hour. */
const BURN_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

/** Get last burn attempt timestamp from DB (survives restarts). */
function getLastBurnAttempt(db: Database.Database): number {
  const row = db.prepare(
    "SELECT MAX(created_at) as last FROM burn_accumulator WHERE executed = 1"
  ).get() as { last: string | null } | undefined;
  if (!row?.last) return 0;
  return new Date(row.last).getTime();
}

/**
 * Backfill subscribers.regen_address from subscriber_retirements for any subscribers
 * that have had retirements executed but are missing the address on their subscriber record.
 * Runs once on startup. Also derives addresses for active subscribers with no retirements yet.
 */
function backfillSubscriberRegenAddresses(db: Database.Database): void {
  try {
    const backfillable = db.prepare(`
      SELECT sr.subscriber_id, sr.regen_address
      FROM subscriber_retirements sr
      JOIN subscribers s ON s.id = sr.subscriber_id
      WHERE s.regen_address IS NULL
      GROUP BY sr.subscriber_id
    `).all() as { subscriber_id: number; regen_address: string }[];

    for (const row of backfillable) {
      setSubscriberRegenAddress(db, row.subscriber_id, row.regen_address);
    }

    if (backfillable.length > 0) {
      console.log(`Backfilled regen_address for ${backfillable.length} subscribers from retirement records`);
    }

    // Also derive addresses for active subscribers with no retirements and no address
    const needDerivation = db.prepare(`
      SELECT s.id FROM subscribers s
      WHERE s.regen_address IS NULL AND s.status = 'active'
    `).all() as { id: number }[];

    for (const row of needDerivation) {
      deriveSubscriberAddress(row.id).then(addr => {
        setSubscriberRegenAddress(db, row.id, addr);
        console.log(`Derived regen_address for subscriber ${row.id}: ${addr}`);
      }).catch(err => {
        console.error(`Failed to derive regen_address for subscriber ${row.id}:`, err instanceof Error ? err.message : err);
      });
    }
  } catch (err) {
    console.error("Backfill regen addresses error:", err instanceof Error ? err.message : err);
  }
}

/**
 * Check pending burn budget and trigger swap-and-burn if threshold is met.
 * Called after every retirement that accumulates burn budget.
 * Non-blocking, fire-and-forget — failures are logged, not thrown.
 */
async function maybeExecuteAutoBurn(db: Database.Database): Promise<void> {
  const now = Date.now();
  const lastBurn = getLastBurnAttempt(db);
  if (now - lastBurn < BURN_COOLDOWN_MS) return;

  const pendingCents = getPendingBurnBudget(db);
  if (pendingCents < AUTO_BURN_THRESHOLD_CENTS) return;

  // Check Osmosis wallet readiness before attempting
  const readiness = await checkOsmosisReadiness();
  if (!readiness.ready) {
    console.log(
      `Auto-burn: $${(pendingCents / 100).toFixed(2)} pending but Osmosis wallet not ready: ` +
      readiness.issues.join("; ")
    );
    return;
  }

  console.log(`Auto-burn: triggering swap-and-burn for $${(pendingCents / 100).toFixed(2)} pending burn budget`);

  try {
    const result = await swapAndBurn({
      allocationCents: pendingCents,
      swapDenom: readiness.usdcBalance >= pendingCents / 100
        ? "usdc"
        : readiness.atomBalance >= pendingCents / 100 / 10
          ? "atom"
          : "osmo",
    });

    if (result.status === "completed" || result.status === "partial") {
      // Mark accumulated entries as executed — even on partial, the swap already
      // happened so we must not re-process these entries (prevents over-burning).
      const maxId = db.prepare(
        "SELECT MAX(id) AS max_id FROM burn_accumulator WHERE executed = 0"
      ).get() as { max_id: number | null };
      if (maxId.max_id) {
        markBurnExecuted(db, maxId.max_id);
      }
      if (result.status === "partial") {
        console.warn(`Auto-burn partial: swap succeeded but IBC/burn may have failed. Entries marked executed to prevent double-swap.`);
      }
      console.log(
        `Auto-burn completed: burned ${Number(result.burnAmountUregen) / 1e6} REGEN ` +
        `(swap: ${result.swapTxHash}, ibc: ${result.ibcTxHash}, burn: ${result.burnTxHash})`
      );
    } else {
      console.warn(`Auto-burn ${result.status}: ${result.errors.join("; ")}`);
    }
  } catch (err) {
    console.error("Auto-burn error:", err instanceof Error ? err.message : err);
  }
}
