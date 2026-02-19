import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { estimateSessionFootprint } from "./tools/footprint.js";
import { browseAvailableCredits } from "./tools/credits.js";
import { getRetirementCertificate } from "./tools/certificates.js";
import { getImpactSummary } from "./tools/impact.js";
import { retireCredits } from "./tools/retire.js";
import { loadConfig, isWalletConfigured } from "./config.js";

// Load config early so isWalletConfigured() is available for annotations
loadConfig();

const walletMode = isWalletConfigured();

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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `Regen Compute Credits MCP server running (wallet mode: ${walletMode ? "enabled" : "disabled"})`
  );
}

main().catch(console.error);
