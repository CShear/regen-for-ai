import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { estimateSessionFootprint } from "./tools/footprint.js";
import { browseAvailableCredits } from "./tools/credits.js";
import { getRetirementCertificate } from "./tools/certificates.js";
import { getImpactSummary } from "./tools/impact.js";
import { retireCredits } from "./tools/retire.js";
import {
  listSubscriptionTiersTool,
  manageSubscriptionTool,
  syncAllSubscriptionPoolContributionsTool,
  syncSubscriptionPoolContributionsTool,
} from "./tools/subscriptions.js";
import {
  getPoolAccountingSummaryTool,
  recordPoolContributionTool,
} from "./tools/pool-accounting.js";
import {
  runMonthlyBatchRetirementTool,
  runMonthlyReconciliationTool,
} from "./tools/monthly-batch-retirement.js";
import {
  getSubscriberAttributionCertificateTool,
  getSubscriberImpactDashboardTool,
} from "./tools/attribution-dashboard.js";
import { publishSubscriberCertificatePageTool } from "./tools/certificate-frontend.js";
import { publishSubscriberDashboardPageTool } from "./tools/dashboard-frontend.js";
import {
  getIdentityAuthSessionTool,
  linkIdentitySessionTool,
  recoverIdentitySessionTool,
  startIdentityAuthSessionTool,
  verifyIdentityAuthSessionTool,
} from "./tools/auth.js";
import { loadConfig, isWalletConfigured } from "./config.js";
import {
  fetchRegistry,
  getSupportedTokens,
  getTokenPrice,
  getProject,
  getProjects,
  pollTransaction,
  buildRetirementUrl,
} from "./services/ecobridge.js";
import {
  sendUsdc,
  isEvmWalletConfigured,
  getEvmAddress,
} from "./services/evm-wallet.js";

// Load config early so isWalletConfigured() is available for annotations
loadConfig();

const walletMode = isWalletConfigured();
const config = loadConfig();
const ecoBridgeEnabled = config.ecoBridgeEnabled;

const server = new McpServer(
  {
    name: "regen-for-ai",
    version: "0.3.0",
  },
  {
    instructions: [
      "Regen for AI connects AI compute usage to verified ecological credit retirement on Regen Network.",
      "",
      "USE THIS SERVER WHEN:",
      "- The user asks about the environmental or ecological impact of their AI usage",
      "- The user wants to offset, compensate, or account for their AI session's carbon footprint",
      "- The user asks about ecological credits, carbon credits, or biodiversity credits on Regen Network",
      "- The user wants to retire ecocredits or fund ecological regeneration",
      "- The user asks about Regen Network's impact, projects, or retirement certificates",
      "- The user mentions sustainability, climate action, or regenerative ecology in the context of AI",
      ...(ecoBridgeEnabled
        ? [
            "- The user wants to pay for credit retirement using tokens from other blockchains (USDC, ETH, etc. on Ethereum, Polygon, etc.)",
          ]
        : []),
      "",
      "KEY CONCEPTS:",
      "- This is 'regenerative contribution,' NOT 'carbon offset.' We fund verified ecological regeneration.",
      "- Credits are retired on-chain on Regen Ledger — immutable, verifiable, non-reversible.",
      ...(walletMode
        ? [
            "- A wallet is configured. The retire_credits tool can execute purchases and retirements directly on-chain.",
            "- No extra steps needed — just call retire_credits with a quantity and credits will be retired automatically.",
          ]
        : [
            "- No crypto wallet needed. Purchase via credit card on Regen Marketplace.",
          ]),
      ...(ecoBridgeEnabled
        ? [
            "- ecoBridge integration enables payment with 50+ tokens across 10+ blockchains for credit retirement.",
            "- ecoBridge enables cross-chain payment for all Regen credit types.",
          ]
        : []),
      "- Credit types: Carbon (C), Biodiversity/Terrasos (BT), Kilo-Sheep-Hour (KSH), Marine Biodiversity (MBS), Umbrella Species Stewardship (USS).",
      "",
      "TYPICAL WORKFLOW:",
      "1. estimate_session_footprint — see the ecological cost of this AI session",
      "2. browse_available_credits — explore what credits are available",
      ...(walletMode
        ? [
            "3. retire_credits — directly purchase and retire credits on-chain (returns a retirement certificate)",
          ]
        : [
            "3. retire_credits — get a purchase link to retire credits via credit card",
          ]),
      "4. get_retirement_certificate — verify an on-chain retirement",
      ...(ecoBridgeEnabled
        ? [
            "",
            "CROSS-CHAIN PAYMENT WORKFLOW (via ecoBridge):",
            "1. browse_ecobridge_tokens — list all supported tokens and chains",
            "2. retire_via_ecobridge — generate a payment link using USDC, ETH, or any supported token",
          ]
        : []),
      "5. list_subscription_tiers / manage_subscription — manage $1/$3/$5 recurring contribution plans",
      "6. sync_subscription_pool_contributions — ingest paid Stripe invoices into pool accounting with idempotency",
      "7. sync_all_subscription_pool_contributions — account-wide Stripe paid-invoice reconciliation with pagination",
      "8. record_pool_contribution / get_pool_accounting_summary — track monthly subscription pool accounting",
      "9. run_monthly_batch_retirement — execute the monthly pooled credit retirement batch",
      "10. run_monthly_reconciliation — optional contribution sync + monthly batch in one operator workflow",
      "11. get_subscriber_impact_dashboard / get_subscriber_attribution_certificate — user-facing fractional impact views",
      "12. publish_subscriber_certificate_page — generate a user-facing certificate HTML page and URL",
      "13. publish_subscriber_dashboard_page — generate a user-facing dashboard HTML page and URL",
      "14. start_identity_auth_session / verify_identity_auth_session / get_identity_auth_session — hardened identity auth session lifecycle",
      "15. link_identity_session / recover_identity_session — identity linking and recovery flows",
      "",
      ...(walletMode
        ? [
            "The retire_credits tool executes real on-chain transactions. Credits are permanently retired.",
          ]
        : [
            "Without a wallet, retire_credits returns marketplace links instead of broadcasting on-chain transactions.",
          ]),
      "The manage_subscription tool can create, update, or cancel Stripe subscriptions.",
      "The sync_subscription_pool_contributions tool ingests paid Stripe invoices into the pool ledger safely (duplicate-safe via invoice IDs).",
      "The sync_all_subscription_pool_contributions tool performs account-wide paid invoice ingestion across customers with pagination controls.",
      "Pool accounting tools support per-user contribution tracking and monthly aggregation summaries.",
      "Monthly batch retirement uses pool accounting totals to execute one on-chain retirement per month.",
      "The run_monthly_reconciliation tool orchestrates contribution sync and monthly batch execution in one call.",
      "Subscriber dashboard tools expose fractional attribution and impact history per user.",
      "Certificate frontend tool publishes shareable subscriber certificate pages to a configurable URL/path.",
      "Dashboard frontend tool publishes shareable subscriber impact dashboard pages to a configurable URL/path.",
      "Identity auth tools support verified email/OAuth attribution sessions with expiry, attempt limits, linking, and recovery.",
    ].join("\n"),
  }
);

// Tool: Estimate the ecological footprint of the current AI session
server.tool(
  "estimate_session_footprint",
  "Estimates the ecological footprint of the current AI session. Use this when the user asks about the environmental cost of their AI usage, wants to know their carbon footprint, or is considering offsetting their compute impact. Returns energy consumption (kWh), CO2 equivalent (kg), and suggested credit retirement quantity. The estimate is heuristic-based and clearly labeled as approximate.",
  {
    session_minutes: z
      .number()
      .describe("Approximate session duration in minutes"),
    tool_calls: z
      .number()
      .optional()
      .describe("Number of tool calls made in session (improves estimate accuracy)"),
  },
  {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async ({ session_minutes, tool_calls }) => {
    return estimateSessionFootprint(session_minutes, tool_calls);
  }
);

// Tool: Browse available ecocredits on Regen Marketplace
server.tool(
  "browse_available_credits",
  "Lists ecocredits currently available for purchase on Regen Network marketplace. Use this when the user asks what credits exist, wants to compare carbon vs. biodiversity credits, or is exploring options before retiring. Shows live sell orders, recent marketplace activity, credit classes, and project details.",
  {
    credit_type: z
      .enum(["carbon", "biodiversity", "all"])
      .optional()
      .default("all")
      .describe("Filter by credit type: 'carbon' for CO2 credits, 'biodiversity' for ecological stewardship credits, 'all' for everything"),
    max_results: z
      .number()
      .optional()
      .default(10)
      .describe("Maximum number of credit classes to return"),
  },
  {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  async ({ credit_type, max_results }) => {
    return browseAvailableCredits(credit_type, max_results);
  }
);

// Tool: Get a verifiable retirement certificate
server.tool(
  "get_retirement_certificate",
  "Retrieves a verifiable ecocredit retirement certificate from Regen Network. Use this when the user has a retirement transaction hash or certificate ID and wants to verify it, or when showing proof of a completed retirement. Returns the project funded, credits retired, beneficiary, jurisdiction, and on-chain transaction proof.",
  {
    retirement_id: z
      .string()
      .describe("The retirement certificate nodeId (starts with 'Wy') or the on-chain transaction hash"),
  },
  {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  async ({ retirement_id }) => {
    return getRetirementCertificate(retirement_id);
  }
);

// Tool: Get aggregate impact summary
server.tool(
  "get_impact_summary",
  "Shows aggregate ecological impact statistics from Regen Network. Use this when the user asks about the overall scale of Regen Network, wants context on how many credits have been retired network-wide, or needs background on available credit types and project coverage. Returns live on-chain counts of retirements, orders, projects, and jurisdictions.",
  {},
  {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  async () => {
    return getImpactSummary();
  }
);

// Tool: List available subscription tiers
server.tool(
  "list_subscription_tiers",
  "Lists recurring contribution tiers for the Regen membership plans ($1/$3/$5 monthly) and shows whether Stripe price IDs are configured for each tier.",
  {},
  {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async () => {
    return listSubscriptionTiersTool();
  }
);

// Tool: Create/update/check/cancel Stripe subscription state
server.tool(
  "manage_subscription",
  "Manages customer subscription state for Regen contribution plans. Actions: subscribe to a tier, check current status, or cancel at period end.",
  {
    action: z
      .enum(["subscribe", "status", "cancel"])
      .describe("Operation to perform: subscribe, status, or cancel"),
    tier: z
      .enum(["starter", "growth", "impact"])
      .optional()
      .describe("Tier ID for subscribe: starter ($1), growth ($3), impact ($5)"),
    email: z
      .string()
      .optional()
      .describe("Customer email used for lookup or creation"),
    customer_id: z
      .string()
      .optional()
      .describe("Existing Stripe customer ID (optional alternative to email)"),
    full_name: z
      .string()
      .optional()
      .describe("Customer display name (used when creating Stripe customer)"),
    payment_method_id: z
      .string()
      .optional()
      .describe("Stripe PaymentMethod ID to set as default for subscriptions"),
  },
  {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  async ({ action, tier, email, customer_id, full_name, payment_method_id }) => {
    return manageSubscriptionTool(
      action,
      tier,
      email,
      customer_id,
      full_name,
      payment_method_id
    );
  }
);

// Tool: Sync paid Stripe invoices into pool accounting
server.tool(
  "sync_subscription_pool_contributions",
  "Ingests paid Stripe invoices into pool accounting for a customer/email with idempotent deduplication by invoice ID. Useful for recurring subscription reconciliation.",
  {
    month: z
      .string()
      .optional()
      .describe("Optional month filter in YYYY-MM format"),
    email: z
      .string()
      .optional()
      .describe("Customer email used for Stripe customer lookup"),
    customer_id: z
      .string()
      .optional()
      .describe("Stripe customer ID (optional alternative to email)"),
    user_id: z
      .string()
      .optional()
      .describe("Optional internal user ID override for pool attribution"),
    limit: z
      .number()
      .int()
      .optional()
      .describe("Max invoices to fetch from Stripe (1-100, default 100)"),
  },
  {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  async ({ month, email, customer_id, user_id, limit }) => {
    return syncSubscriptionPoolContributionsTool(
      month,
      email,
      customer_id,
      user_id,
      limit
    );
  }
);

// Tool: Sync paid Stripe invoices across all customers into pool accounting
server.tool(
  "sync_all_subscription_pool_contributions",
  "Ingests paid Stripe invoices account-wide into pool accounting with idempotent deduplication by invoice ID. Supports pagination controls for large invoice sets.",
  {
    month: z
      .string()
      .optional()
      .describe("Optional month filter in YYYY-MM format"),
    limit: z
      .number()
      .int()
      .optional()
      .describe("Per-page Stripe invoice fetch size (1-100, default 100)"),
    max_pages: z
      .number()
      .int()
      .optional()
      .describe("Maximum pages to fetch from Stripe invoices API (1-50, default 10)"),
  },
  {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  async ({ month, limit, max_pages }) => {
    return syncAllSubscriptionPoolContributionsTool(month, limit, max_pages);
  }
);

// Tool: Record a contribution entry in the pool accounting ledger
server.tool(
  "record_pool_contribution",
  "Records a contribution event for subscription pool accounting. Tracks per-user contribution ledger entries for monthly aggregation and batch retirement planning.",
  {
    user_id: z
      .string()
      .optional()
      .describe("Internal stable user ID (optional if customer_id or email is provided)"),
    email: z
      .string()
      .optional()
      .describe("User email (optional alternative identifier)"),
    customer_id: z
      .string()
      .optional()
      .describe("Stripe customer ID (optional alternative identifier)"),
    subscription_id: z
      .string()
      .optional()
      .describe("Stripe subscription ID associated with this contribution"),
    source_event_id: z
      .string()
      .optional()
      .describe("External event ID for idempotency (e.g., stripe invoice ID)"),
    tier: z
      .enum(["starter", "growth", "impact"])
      .optional()
      .describe("Tier ID; if amount is omitted this determines default amount ($1/$3/$5)"),
    amount_usd: z
      .number()
      .optional()
      .describe("Contribution amount in USD (decimal), e.g. 3 or 2.5"),
    amount_usd_cents: z
      .number()
      .int()
      .optional()
      .describe("Contribution amount in USD cents"),
    contributed_at: z
      .string()
      .optional()
      .describe("ISO timestamp of the contribution event"),
    source: z
      .enum(["subscription", "manual", "adjustment"])
      .optional()
      .describe("Contribution source type"),
  },
  {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  async ({
    user_id,
    email,
    customer_id,
    subscription_id,
    source_event_id,
    tier,
    amount_usd,
    amount_usd_cents,
    contributed_at,
    source,
  }) => {
    return recordPoolContributionTool({
      userId: user_id,
      email,
      customerId: customer_id,
      subscriptionId: subscription_id,
      externalEventId: source_event_id,
      tierId: tier,
      amountUsd: amount_usd,
      amountUsdCents: amount_usd_cents,
      contributedAt: contributed_at,
      source,
    });
  }
);

// Tool: Query per-user or monthly pool accounting summaries
server.tool(
  "get_pool_accounting_summary",
  "Returns pool accounting summaries for either a user or a month. Use user identifiers for lifetime/by-month user totals, or pass month for aggregate pool totals.",
  {
    month: z
      .string()
      .optional()
      .describe("Month in YYYY-MM format for monthly pool summary"),
    user_id: z
      .string()
      .optional()
      .describe("Internal user ID for user-specific summary"),
    email: z
      .string()
      .optional()
      .describe("Email for user-specific summary"),
    customer_id: z
      .string()
      .optional()
      .describe("Stripe customer ID for user-specific summary"),
  },
  {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async ({ month, user_id, email, customer_id }) => {
    return getPoolAccountingSummaryTool(month, user_id, email, customer_id);
  }
);

// Tool: Execute monthly pooled retirement run
server.tool(
  "run_monthly_batch_retirement",
  "Executes a monthly pooled retirement batch using recorded pool contributions. Supports dry-run planning and real on-chain execution.",
  {
    month: z
      .string()
      .describe("Target month in YYYY-MM format, e.g. 2026-03"),
    credit_type: z
      .enum(["carbon", "biodiversity"])
      .optional()
      .describe("Optional credit type filter for the batch retirement"),
    max_budget_usd: z
      .number()
      .optional()
      .describe("Optional max budget in USD for this run"),
    dry_run: z
      .boolean()
      .optional()
      .default(true)
      .describe("If true, plans the batch without broadcasting a transaction"),
    force: z
      .boolean()
      .optional()
      .default(false)
      .describe("If true, allows rerunning a month even if a prior success exists"),
    reason: z
      .string()
      .optional()
      .describe("Optional retirement reason override"),
    jurisdiction: z
      .string()
      .optional()
      .describe("Optional retirement jurisdiction override"),
  },
  {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  async ({
    month,
    credit_type,
    max_budget_usd,
    dry_run,
    force,
    reason,
    jurisdiction,
  }) => {
    return runMonthlyBatchRetirementTool(
      month,
      credit_type,
      max_budget_usd,
      dry_run,
      force,
      reason,
      jurisdiction
    );
  }
);

// Tool: Reconcile contributions and run monthly batch in one operation
server.tool(
  "run_monthly_reconciliation",
  "Runs monthly pool reconciliation workflow. Optionally syncs paid Stripe invoices first, then executes monthly pooled retirement planning/execution.",
  {
    month: z
      .string()
      .describe("Target month in YYYY-MM format, e.g. 2026-03"),
    credit_type: z
      .enum(["carbon", "biodiversity"])
      .optional()
      .describe("Optional credit type filter for the batch retirement"),
    max_budget_usd: z
      .number()
      .optional()
      .describe("Optional max budget in USD for this run"),
    dry_run: z
      .boolean()
      .optional()
      .default(true)
      .describe("If true, plans the batch without broadcasting a transaction"),
    force: z
      .boolean()
      .optional()
      .default(false)
      .describe("If true, allows rerunning a month even if a prior success exists"),
    reason: z
      .string()
      .optional()
      .describe("Optional retirement reason override"),
    jurisdiction: z
      .string()
      .optional()
      .describe("Optional retirement jurisdiction override"),
    sync_scope: z
      .enum(["none", "customer", "all_customers"])
      .optional()
      .default("all_customers")
      .describe("Contribution sync scope before batch execution"),
    email: z
      .string()
      .optional()
      .describe("Customer email for sync_scope=customer"),
    customer_id: z
      .string()
      .optional()
      .describe("Stripe customer ID for sync_scope=customer"),
    user_id: z
      .string()
      .optional()
      .describe("Optional internal user ID override for synced contributions"),
    invoice_limit: z
      .number()
      .int()
      .optional()
      .describe("Invoice fetch size per request (1-100)"),
    invoice_max_pages: z
      .number()
      .int()
      .optional()
      .describe("Max pages for account-wide sync (1-50)"),
  },
  {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  async ({
    month,
    credit_type,
    max_budget_usd,
    dry_run,
    force,
    reason,
    jurisdiction,
    sync_scope,
    email,
    customer_id,
    user_id,
    invoice_limit,
    invoice_max_pages,
  }) => {
    return runMonthlyReconciliationTool({
      month,
      creditType: credit_type,
      maxBudgetUsd: max_budget_usd,
      dryRun: dry_run,
      force,
      reason,
      jurisdiction,
      syncScope: sync_scope,
      email,
      customerId: customer_id,
      userId: user_id,
      invoiceLimit: invoice_limit,
      invoiceMaxPages: invoice_max_pages,
    });
  }
);

// Tool: User-facing fractional impact dashboard
server.tool(
  "get_subscriber_impact_dashboard",
  "Returns a user-facing dashboard of pooled contribution history and fractional retirement attribution impact.",
  {
    user_id: z
      .string()
      .optional()
      .describe("Internal user ID"),
    email: z
      .string()
      .optional()
      .describe("User email"),
    customer_id: z
      .string()
      .optional()
      .describe("Stripe customer ID"),
  },
  {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async ({ user_id, email, customer_id }) => {
    return getSubscriberImpactDashboardTool(user_id, email, customer_id);
  }
);

// Tool: User-facing per-month attribution certificate
server.tool(
  "get_subscriber_attribution_certificate",
  "Returns a user-facing certificate for a subscriber's fractional attribution in a specific monthly pooled retirement batch.",
  {
    month: z
      .string()
      .describe("Target month in YYYY-MM format"),
    user_id: z
      .string()
      .optional()
      .describe("Internal user ID"),
    email: z
      .string()
      .optional()
      .describe("User email"),
    customer_id: z
      .string()
      .optional()
      .describe("Stripe customer ID"),
  },
  {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async ({ month, user_id, email, customer_id }) => {
    return getSubscriberAttributionCertificateTool(
      month,
      user_id,
      email,
      customer_id
    );
  }
);

// Tool: Publish subscriber certificate frontend page
server.tool(
  "publish_subscriber_certificate_page",
  "Publishes a user-facing HTML certificate page for a subscriber's monthly fractional attribution, returning both a public URL and local file path.",
  {
    month: z
      .string()
      .describe("Target month in YYYY-MM format"),
    user_id: z
      .string()
      .optional()
      .describe("Internal user ID"),
    email: z
      .string()
      .optional()
      .describe("User email"),
    customer_id: z
      .string()
      .optional()
      .describe("Stripe customer ID"),
  },
  {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  async ({ month, user_id, email, customer_id }) => {
    return publishSubscriberCertificatePageTool(
      month,
      user_id,
      email,
      customer_id
    );
  }
);

// Tool: Publish subscriber dashboard frontend page
server.tool(
  "publish_subscriber_dashboard_page",
  "Publishes a user-facing HTML dashboard page with contribution totals, attribution history, and subscription state, returning both a public URL and local file path.",
  {
    user_id: z
      .string()
      .optional()
      .describe("Internal user ID"),
    email: z
      .string()
      .optional()
      .describe("User email"),
    customer_id: z
      .string()
      .optional()
      .describe("Stripe customer ID"),
  },
  {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  async ({ user_id, email, customer_id }) => {
    return publishSubscriberDashboardPageTool(user_id, email, customer_id);
  }
);

// Tool: Start identity auth session
server.tool(
  "start_identity_auth_session",
  "Starts an identity verification session using email or OAuth. Returns session metadata and the challenge material needed to verify.",
  {
    method: z
      .enum(["email", "oauth"])
      .describe("Auth method to start"),
    beneficiary_email: z
      .string()
      .optional()
      .describe("Beneficiary email (required for method=email, optional for method=oauth)"),
    beneficiary_name: z
      .string()
      .optional()
      .describe("Optional beneficiary display name"),
    auth_provider: z
      .string()
      .optional()
      .describe("OAuth provider (required for method=oauth)"),
  },
  {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  async ({ method, beneficiary_email, beneficiary_name, auth_provider }) => {
    return startIdentityAuthSessionTool(
      method,
      beneficiary_email,
      beneficiary_name,
      auth_provider
    );
  }
);

// Tool: Verify identity auth session
server.tool(
  "verify_identity_auth_session",
  "Verifies an identity auth session. Email sessions require verification_code; OAuth sessions require oauth_state_token + auth_provider + auth_subject.",
  {
    session_id: z
      .string()
      .describe("Identity auth session ID"),
    method: z
      .enum(["email", "oauth"])
      .describe("Session method"),
    verification_code: z
      .string()
      .optional()
      .describe("Email verification code (required for method=email)"),
    oauth_state_token: z
      .string()
      .optional()
      .describe("OAuth state token issued at session start (required for method=oauth)"),
    auth_provider: z
      .string()
      .optional()
      .describe("OAuth provider (required for method=oauth)"),
    auth_subject: z
      .string()
      .optional()
      .describe("OAuth subject/user ID (required for method=oauth)"),
    beneficiary_email: z
      .string()
      .optional()
      .describe("Optional verified email to store during oauth verification"),
  },
  {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  async ({
    session_id,
    method,
    verification_code,
    oauth_state_token,
    auth_provider,
    auth_subject,
    beneficiary_email,
  }) => {
    return verifyIdentityAuthSessionTool({
      sessionId: session_id,
      method,
      verificationCode: verification_code,
      oauthStateToken: oauth_state_token,
      authProvider: auth_provider,
      authSubject: auth_subject,
      beneficiaryEmail: beneficiary_email,
    });
  }
);

// Tool: Get identity auth session status
server.tool(
  "get_identity_auth_session",
  "Returns status and metadata for an identity auth session (pending/verified/expired/locked).",
  {
    session_id: z
      .string()
      .describe("Identity auth session ID"),
  },
  {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async ({ session_id }) => {
    return getIdentityAuthSessionTool(session_id);
  }
);

// Tool: Link verified identity session to internal user
server.tool(
  "link_identity_session",
  "Links a verified identity auth session to an internal user ID for attribution continuity.",
  {
    session_id: z
      .string()
      .describe("Verified auth session ID"),
    user_id: z
      .string()
      .describe("Internal user ID to link"),
  },
  {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  async ({ session_id, user_id }) => {
    return linkIdentitySessionTool(session_id, user_id);
  }
);

// Tool: Start or complete identity recovery
server.tool(
  "recover_identity_session",
  "Handles identity session recovery. action=start issues a recovery token by verified email; action=complete consumes token and issues a fresh verified session.",
  {
    action: z
      .enum(["start", "complete"])
      .describe("Recovery action"),
    beneficiary_email: z
      .string()
      .optional()
      .describe("Verified beneficiary email (required for action=start)"),
    recovery_token: z
      .string()
      .optional()
      .describe("Recovery token (required for action=complete)"),
  },
  {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  async ({ action, beneficiary_email, recovery_token }) => {
    return recoverIdentitySessionTool(action, beneficiary_email, recovery_token);
  }
);

// Tool: Retire credits — either direct on-chain execution or marketplace link
server.tool(
  "retire_credits",
  walletMode
    ? "Purchases and retires ecocredits directly on-chain on Regen Network. Use this when the user wants to take action — offset their footprint, fund ecological regeneration, or retire credits. Credits are permanently retired on-chain in a single transaction. Supports beneficiary attribution via name/email/OAuth metadata and returns a retirement certificate with on-chain proof."
    : "Generates a link to retire ecocredits on Regen Network marketplace via credit card. Use this when the user wants to take action — offset their footprint, fund ecological regeneration, or retire credits for any reason. Credits are permanently retired on-chain with optional identity attribution metadata. No crypto wallet needed. Returns a direct marketplace link and step-by-step instructions.",
  {
    credit_class: z
      .string()
      .optional()
      .describe(
        "Credit class to retire (e.g., 'C01' for carbon, 'BT01' for biodiversity). Omit to browse all."
      ),
    quantity: z
      .number()
      .optional()
      .describe("Number of credits to retire"),
    beneficiary_name: z
      .string()
      .optional()
      .describe("Name to appear on the retirement certificate"),
    beneficiary_email: z
      .string()
      .optional()
      .describe("Email to attribute to the retirement certificate"),
    auth_provider: z
      .string()
      .optional()
      .describe("OAuth provider name for identity attribution (e.g., google, github)"),
    auth_subject: z
      .string()
      .optional()
      .describe("OAuth subject/user ID for identity attribution"),
    auth_session_id: z
      .string()
      .optional()
      .describe(
        "Verified identity auth session ID from verify_identity_auth_session; overrides direct auth/email fields when present"
      ),
    jurisdiction: z
      .string()
      .optional()
      .describe(
        "Retirement jurisdiction (ISO 3166-1 alpha-2 country code, e.g., 'US', 'DE', or sub-national like 'US-OR')"
      ),
    reason: z
      .string()
      .optional()
      .describe("Reason for retiring credits (recorded on-chain)"),
  },
  {
    readOnlyHint: !walletMode,
    destructiveHint: walletMode,
    idempotentHint: !walletMode,
    openWorldHint: walletMode,
  },
  async ({
    credit_class,
    quantity,
    beneficiary_name,
    beneficiary_email,
    auth_provider,
    auth_subject,
    auth_session_id,
    jurisdiction,
    reason,
  }) => {
    return retireCredits(
      credit_class,
      quantity,
      beneficiary_name,
      jurisdiction,
      reason,
      beneficiary_email,
      auth_provider,
      auth_subject,
      auth_session_id
    );
  }
);

// Tools: ecoBridge cross-chain payment (conditionally registered)
if (ecoBridgeEnabled) {
  // Tool: Browse all tokens/chains supported by ecoBridge
  server.tool(
    "browse_ecobridge_tokens",
    "Lists all tokens and chains supported by ecoBridge for retiring credits on Regen Network. Use this when the user wants to pay for credit retirement using tokens from other chains (e.g., USDC on Ethereum, ETH on Arbitrum, etc.) rather than native REGEN tokens.",
    {
      chain: z
        .string()
        .optional()
        .describe(
          "Filter by chain name (e.g., 'ethereum', 'polygon', 'arbitrum')"
        ),
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async ({ chain }) => {
      try {
        const tokens = await getSupportedTokens(chain);

        if (tokens.length === 0) {
          const msg = chain
            ? `No tokens found for chain "${chain}". Use \`browse_ecobridge_tokens\` without a chain filter to see all supported chains.`
            : "No tokens found in the ecoBridge registry. The service may be temporarily unavailable.";
          return { content: [{ type: "text" as const, text: msg }] };
        }

        // Group by chain for display
        const byChain = new Map<
          string,
          Array<(typeof tokens)[0]>
        >();
        for (const t of tokens) {
          const key = t.chainName || t.chainId;
          if (!byChain.has(key)) byChain.set(key, []);
          byChain.get(key)!.push(t);
        }

        const lines: string[] = [
          `## ecoBridge Supported Tokens`,
          ``,
          `Pay for Regen Network credit retirements using any of the tokens below.`,
          `Use \`retire_via_ecobridge\` to generate a payment link.`,
          ``,
        ];

        for (const [chainName, chainTokens] of byChain) {
          lines.push(`### ${chainName}`);
          lines.push(`| Token | Symbol | Price (USD) |`);
          lines.push(`|-------|--------|------------|`);
          for (const t of chainTokens) {
            const price =
              t.priceUsd != null ? `$${t.priceUsd.toFixed(2)}` : "—";
            lines.push(`| ${t.name} | ${t.symbol} | ${price} |`);
          }
          lines.push(``);
        }

        lines.push(
          `*Prices updated approximately every 60 seconds via CoinGecko Pro.*`
        );

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to fetch ecoBridge token list: ${errMsg}`,
            },
          ],
        };
      }
    }
  );

  // Tool: Retire credits via ecoBridge by sending tokens to project wallet
  server.tool(
    "retire_via_ecobridge",
    isEvmWalletConfigured()
      ? "Sends USDC on an EVM chain (Base, Ethereum, etc.) to an ecoBridge project wallet to retire ecocredits on Regen Network. Executes a real on-chain token transfer and polls bridge.eco until the retirement is confirmed. This is a destructive action — tokens are spent permanently."
      : "Lists ecoBridge projects available for credit retirement. An EVM wallet must be configured (ECOBRIDGE_EVM_MNEMONIC) to execute transactions.",
    {
      project_id: z
        .union([z.string(), z.number()])
        .describe("Project ID (number) or partial name match (e.g., 'mongolia', 'kasigau')"),
      chain: z
        .string()
        .default("base")
        .describe("Chain to send payment from (default: 'base')"),
      amount_usdc: z
        .number()
        .describe("Amount of USDC to send (e.g., 0.1 for a test, 1.5 for 1 tCO2e of Inner Mongolia)"),
      wait_for_retirement: z
        .boolean()
        .optional()
        .default(true)
        .describe("If true, polls bridge.eco API until retirement is confirmed (up to 5 min). If false, returns immediately after tx is sent."),
    },
    {
      readOnlyHint: !isEvmWalletConfigured(),
      destructiveHint: isEvmWalletConfigured(),
      idempotentHint: false,
      openWorldHint: true,
    },
    async ({ project_id, chain, amount_usdc, wait_for_retirement }) => {
      try {
        // 1. Look up the project
        const project = await getProject(project_id);
        if (!project) {
          const allProjects = await getProjects();
          const list = allProjects
            .map((p) => `  ${p.id}: ${p.name} ($${p.price}/${p.unit || "unit"}) — ${p.location}`)
            .join("\n");
          return {
            content: [{
              type: "text" as const,
              text: `Project "${project_id}" not found.\n\nAvailable projects:\n${list}`,
            }],
          };
        }

        if (!project.evmWallet) {
          return {
            content: [{
              type: "text" as const,
              text: `Project "${project.name}" does not have an EVM wallet configured. Cannot send payment.`,
            }],
          };
        }

        // 2. Check wallet is configured
        if (!isEvmWalletConfigured()) {
          return {
            content: [{
              type: "text" as const,
              text: `EVM wallet not configured. Set ECOBRIDGE_EVM_MNEMONIC in .env to enable cross-chain retirement.\n\nProject: ${project.name}\nEVM Wallet: ${project.evmWallet}\nPrice: $${project.price}/${project.unit || "unit"}`,
            }],
          };
        }

        const fromAddress = getEvmAddress();
        const estimatedCredits = project.price
          ? (amount_usdc / project.price).toFixed(4)
          : "unknown";

        const lines: string[] = [
          `## ecoBridge Retirement: ${project.name}`,
          ``,
          `| Field | Value |`,
          `|-------|-------|`,
          `| Project | ${project.name} |`,
          `| Location | ${project.location || "—"} |`,
          `| Type | ${project.type || "—"} |`,
          `| Price | $${project.price}/${project.unit || "unit"} |`,
          `| Payment | ${amount_usdc} USDC on ${chain} |`,
          `| Est. Credits | ~${estimatedCredits} ${project.unit || "units"} |`,
          `| From | ${fromAddress} |`,
          `| To | ${project.evmWallet} |`,
          ``,
        ];

        // 3. Send USDC
        lines.push(`### Sending USDC...`);
        const result = await sendUsdc(chain, project.evmWallet, amount_usdc);
        lines.push(
          ``,
          `**Transaction sent!**`,
          `| Field | Value |`,
          `|-------|-------|`,
          `| Tx Hash | \`${result.txHash}\` |`,
          `| Amount | ${result.amountUsdc} USDC |`,
          `| Chain | ${result.chain} |`,
          ``,
        );

        // 4. Optionally poll for retirement
        if (wait_for_retirement) {
          lines.push(`### Polling bridge.eco for retirement status...`);
          try {
            const tx = await pollTransaction(result.txHash, 60, 5000);
            lines.push(
              ``,
              `**Retirement status: ${tx.status}**`,
              ``,
            );
            if (tx.status === "RETIRED" || tx.status === "RWI_MINTED" || tx.status === "FEE_CALCULATED") {
              lines.push(
                `Credits successfully retired on Regen Network!`,
                ``,
                `Use \`get_retirement_certificate\` with the transaction hash to retrieve your verifiable certificate.`,
              );
            }
            if (tx.retirementDetails) {
              lines.push(``, `**Retirement details:** ${JSON.stringify(tx.retirementDetails, null, 2)}`);
            }
          } catch (pollErr) {
            const pollMsg = pollErr instanceof Error ? pollErr.message : String(pollErr);
            lines.push(
              ``,
              `Polling timed out: ${pollMsg}`,
              ``,
              `The transaction was sent successfully. bridge.eco may still be processing it.`,
              `Check status manually: \`GET https://api.bridge.eco/transactions/${result.txHash}\``,
            );
          }
        } else {
          lines.push(
            `Transaction sent. To check retirement status later:`,
            `\`GET https://api.bridge.eco/transactions/${result.txHash}\``,
          );
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{
            type: "text" as const,
            text: `ecoBridge retirement failed: ${errMsg}`,
          }],
        };
      }
    }
  );
}

// Prompt: Offset my AI session
server.prompt(
  "offset_my_session",
  walletMode
    ? "Estimate the ecological footprint of your current AI session and directly retire ecocredits on-chain to fund regeneration."
    : "Estimate the ecological footprint of your current AI session and get a link to retire ecocredits to fund regeneration.",
  {
    session_minutes: z
      .string()
      .describe("How long this session has been running, in minutes"),
    tool_calls: z
      .string()
      .optional()
      .describe("Approximate number of tool calls made this session"),
  },
  ({ session_minutes, tool_calls }) => {
    const mins = session_minutes || "30";
    const calls = tool_calls ? `, and approximately ${tool_calls} tool calls have been made` : "";
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `I'd like to understand and offset the ecological footprint of this AI session.`,
              `This session has been running for about ${mins} minutes${calls}.`,
              ``,
              `Please:`,
              `1. Use estimate_session_footprint to calculate my session's footprint`,
              `2. Use browse_available_credits to show me what credits are available`,
              ...(walletMode
                ? [`3. Use retire_credits to directly retire enough credits to cover my session's impact`]
                : [`3. Use retire_credits to give me a link to retire enough credits to cover my session's impact`]),
              ``,
              `Frame this as funding ecological regeneration, not just carbon offsetting.`,
            ].join("\n"),
          },
        },
      ],
    };
  }
);

// Prompt: Show Regen Network impact
server.prompt(
  "show_regen_impact",
  "See the aggregate ecological impact of Regen Network — retirements, projects, credit types, and global coverage.",
  async () => {
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Show me the ecological impact of Regen Network.`,
              ``,
              `Please use get_impact_summary to pull live on-chain statistics,`,
              `then summarize the scale of ecological regeneration happening on the network.`,
              `Include how many credits have been retired, how many projects are active,`,
              `and what types of ecological credits are available.`,
            ].join("\n"),
          },
        },
      ],
    };
  }
);

// Prompt: Retire with any token via ecoBridge
if (ecoBridgeEnabled) {
  server.prompt(
    "retire_with_any_token",
    "Explore cross-chain payment options and retire ecocredits using any supported token via ecoBridge.",
    {
      chain: z
        .string()
        .optional()
        .describe("Preferred blockchain (e.g., 'ethereum', 'polygon')"),
      token: z
        .string()
        .optional()
        .describe("Preferred token (e.g., 'USDC', 'ETH')"),
    },
    ({ chain, token }) => {
      const chainNote = chain ? ` on ${chain}` : "";
      const tokenNote = token ? ` using ${token}` : "";
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `I'd like to retire ecocredits on Regen Network${tokenNote}${chainNote}.`,
                ``,
                `Please:`,
                `1. Use browse_ecobridge_tokens${chain ? ` with chain="${chain}"` : ""} to show me available tokens and their current prices`,
                `2. Help me choose a token and chain that works for me`,
                `3. Use retire_via_ecobridge to generate a payment link with my chosen token`,
                ``,
                `Frame this as funding ecological regeneration across chains.`,
              ].join("\n"),
            },
          },
        ],
      };
    }
  );
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `Regen for AI MCP server running (wallet mode: ${walletMode ? "enabled" : "disabled"}, ecoBridge: ${ecoBridgeEnabled ? "enabled" : "disabled"})`
  );
}

main().catch(console.error);
