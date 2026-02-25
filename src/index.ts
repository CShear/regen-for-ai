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
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Handle --help and --version before starting the server
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Regen for AI — Verified ecological accountability for AI compute

USAGE:
  npx regen-for-ai              Start the MCP server (stdio transport)
  regen-for-ai --help           Show this help message
  regen-for-ai --version        Show version

INSTALL (Claude Code):
  claude mcp add -s user regen-for-ai -- npx regen-for-ai

MCP TOOLS:
  estimate_session_footprint    Estimate your AI session's ecological footprint
  browse_available_credits      Browse ecocredits on Regen Marketplace
  retire_credits                Retire credits (on-chain or marketplace link)
  get_retirement_certificate    Verify a retirement on-chain
  get_impact_summary            Regen Network aggregate impact stats
  browse_ecobridge_tokens       List cross-chain payment tokens (when enabled)
  retire_via_ecobridge          Pay with any token via ecoBridge (when enabled)

CONFIGURATION:
  Copy .env.example to .env to customize. The server works without any
  configuration — read-only tools (footprint, browsing, impact) need no keys.

  Optional:
    REGEN_WALLET_MNEMONIC       Enable direct on-chain retirement
    ECOBRIDGE_EVM_MNEMONIC      Enable cross-chain payment via ecoBridge
    ECOBRIDGE_ENABLED=false     Disable ecoBridge tools

  See .env.example for all options.

DOCUMENTATION:
  https://github.com/CShear/regen-for-ai`);
  process.exit(0);
}

if (args.includes("--version") || args.includes("-v")) {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
    console.log(pkg.version);
  } catch {
    console.log("0.3.0");
  }
  process.exit(0);
}

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
