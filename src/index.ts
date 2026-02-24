import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { estimateSessionFootprint } from "./tools/footprint.js";
import { browseAvailableCredits } from "./tools/credits.js";
import { getRetirementCertificate } from "./tools/certificates.js";
import { getImpactSummary } from "./tools/impact.js";
import { retireCredits } from "./tools/retire.js";
import { loadConfig, isWalletConfigured } from "./config.js";
import {
  fetchRegistry,
  getSupportedTokens,
  getTokenPrice,
  buildRetirementUrl,
} from "./services/ecobridge.js";

// Load config early so isWalletConfigured() is available for annotations
loadConfig();

const walletMode = isWalletConfigured();
const config = loadConfig();
const ecoBridgeEnabled = config.ecoBridgeEnabled;

const server = new McpServer(
  {
    name: "regen-compute-credits",
    version: "0.2.0",
  },
  {
    instructions: [
      "Regen Compute Credits connects AI compute usage to verified ecological credit retirement on Regen Network.",
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
      "",
      ...(walletMode
        ? [
            "The retire_credits tool executes real on-chain transactions. Credits are permanently retired.",
          ]
        : [
            "All tools in this server are read-only and safe to call at any time.",
          ]),
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

// Tool: Retire credits — either direct on-chain execution or marketplace link
server.tool(
  "retire_credits",
  walletMode
    ? "Purchases and retires ecocredits directly on-chain on Regen Network. Use this when the user wants to take action — offset their footprint, fund ecological regeneration, or retire credits. Credits are permanently retired on-chain in a single transaction. Returns a retirement certificate with on-chain proof."
    : "Generates a link to retire ecocredits on Regen Network marketplace via credit card. Use this when the user wants to take action — offset their footprint, fund ecological regeneration, or retire credits for any reason. Credits are permanently retired on-chain with the user's name as beneficiary. No crypto wallet needed. Returns a direct marketplace link and step-by-step instructions.",
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
  async ({ credit_class, quantity, beneficiary_name, jurisdiction, reason }) => {
    return retireCredits(credit_class, quantity, beneficiary_name, jurisdiction, reason);
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

  // Tool: Generate an ecoBridge payment link for credit retirement
  server.tool(
    "retire_via_ecobridge",
    "Generates an ecoBridge payment link to retire ecocredits on Regen Network using any supported token on any supported chain. Use this when the user wants to pay with tokens like USDC, USDT, ETH on Ethereum, Polygon, Arbitrum, Base, or other chains instead of native REGEN tokens.",
    {
      chain: z
        .string()
        .describe(
          "The blockchain to pay from (e.g., 'ethereum', 'polygon', 'arbitrum', 'base')"
        ),
      token: z
        .string()
        .describe("The token to pay with (e.g., 'USDC', 'USDT', 'ETH')"),
      credit_class: z
        .string()
        .optional()
        .describe("Credit class to retire (e.g., 'C01', 'BT01')"),
      quantity: z
        .number()
        .optional()
        .describe("Number of credits to retire (defaults to 1)"),
      beneficiary_name: z
        .string()
        .optional()
        .describe("Name for the retirement certificate"),
      jurisdiction: z
        .string()
        .optional()
        .describe("Retirement jurisdiction (ISO 3166-1)"),
      reason: z
        .string()
        .optional()
        .describe("Reason for retiring credits"),
    },
    {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    async ({
      chain,
      token,
      credit_class,
      quantity,
      beneficiary_name,
      jurisdiction,
      reason,
    }) => {
      try {
        const qty = quantity ?? 1;

        // Validate chain/token via registry
        const tokens = await getSupportedTokens(chain);
        const matchedToken = tokens.find(
          (t) => t.symbol.toLowerCase() === token.toLowerCase()
        );

        if (!matchedToken) {
          // Provide helpful list of available tokens for this chain
          const available = tokens.map((t) => t.symbol).join(", ");
          const msg = available
            ? `Token "${token}" is not supported on "${chain}". Available tokens: ${available}.\n\nUse \`browse_ecobridge_tokens\` to see all supported chains and tokens.`
            : `Chain "${chain}" is not supported by ecoBridge, or no tokens are available.\n\nUse \`browse_ecobridge_tokens\` to see all supported chains and tokens.`;
          return { content: [{ type: "text" as const, text: msg }] };
        }

        // Get current token price for cost estimate
        const priceUsd = await getTokenPrice(token, chain);

        // Build deep-linked widget URL
        const widgetUrl = buildRetirementUrl({
          chain,
          token,
          amount: qty,
          beneficiaryName: beneficiary_name,
          retirementReason:
            reason || "Regenerative contribution via Regen Compute Credits",
          jurisdiction,
        });

        const lines: string[] = [
          `## Retire Ecocredits via ecoBridge`,
          ``,
          `Pay with **${token}** on **${matchedToken.chainName}** to retire ecocredits on Regen Network.`,
          ``,
          `| Field | Value |`,
          `|-------|-------|`,
          `| Chain | ${matchedToken.chainName} |`,
          `| Token | ${token} |`,
          `| Quantity | ${qty} credit${qty !== 1 ? "s" : ""} |`,
        ];

        if (credit_class) lines.push(`| Credit Class | ${credit_class} |`);
        if (beneficiary_name)
          lines.push(`| Beneficiary | ${beneficiary_name} |`);
        if (jurisdiction) lines.push(`| Jurisdiction | ${jurisdiction} |`);

        if (priceUsd != null) {
          lines.push(`| Token Price | $${priceUsd.toFixed(2)} USD |`);
        }

        lines.push(
          ``,
          `### Payment Link`,
          ``,
          `**[Open ecoBridge Widget](${widgetUrl})**`,
          ``,
          `**How it works:**`,
          `1. Click the link above to open the ecoBridge payment widget`,
          `2. Connect your wallet on ${matchedToken.chainName}`,
          `3. The widget will pre-select ${token} and the credit retirement details`,
          `4. Confirm the transaction — ecoBridge bridges your tokens and retires credits on Regen Network`,
          `5. You'll receive a verifiable on-chain retirement certificate`,
          ``,
          `After retiring, use \`get_retirement_certificate\` to retrieve your verifiable certificate.`
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
              text: `Failed to generate ecoBridge retirement link: ${errMsg}\n\nUse \`browse_ecobridge_tokens\` to verify chain and token support.`,
            },
          ],
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
    `Regen Compute Credits MCP server running (wallet mode: ${walletMode ? "enabled" : "disabled"}, ecoBridge: ${ecoBridgeEnabled ? "enabled" : "disabled"})`
  );
}

main().catch(console.error);
