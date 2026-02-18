import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { estimateSessionFootprint } from "./tools/footprint.js";
import { browseAvailableCredits } from "./tools/credits.js";
import { getRetirementCertificate } from "./tools/certificates.js";
import { getImpactSummary } from "./tools/impact.js";
import { retireCredits } from "./tools/retire.js";

const server = new McpServer({
  name: "regen-compute-credits",
  version: "0.1.0",
});

// Tool: Estimate the ecological footprint of the current AI session
server.tool(
  "estimate_session_footprint",
  "Estimates the approximate ecological footprint of your current AI session based on duration and activity heuristics. Returns estimated energy consumption (kWh), CO2 equivalent (kg), and suggested credit retirement quantity. This is a directional estimate, not a precise measurement.",
  {
    session_minutes: z
      .number()
      .describe("Approximate session duration in minutes"),
    tool_calls: z
      .number()
      .optional()
      .describe("Number of tool calls made in session (improves estimate)"),
  },
  async ({ session_minutes, tool_calls }) => {
    return estimateSessionFootprint(session_minutes, tool_calls);
  }
);

// Tool: Browse available ecocredits on Regen Marketplace
server.tool(
  "browse_available_credits",
  "Lists ecocredits currently available for purchase on Regen Network marketplace. Includes carbon credits, biodiversity credits, and other ecological credit types with pricing and project details.",
  {
    credit_type: z
      .enum(["carbon", "biodiversity", "all"])
      .optional()
      .default("all")
      .describe("Filter by credit type"),
    max_results: z
      .number()
      .optional()
      .default(10)
      .describe("Maximum number of results to return"),
  },
  async ({ credit_type, max_results }) => {
    return browseAvailableCredits(credit_type, max_results);
  }
);

// Tool: Get a verifiable retirement certificate
server.tool(
  "get_retirement_certificate",
  "Retrieves a verifiable ecocredit retirement certificate from Regen Network. Shows the project funded, credits retired, beneficiary, and on-chain transaction proof.",
  {
    retirement_id: z
      .string()
      .describe("The retirement ID or transaction hash to look up"),
  },
  async ({ retirement_id }) => {
    return getRetirementCertificate(retirement_id);
  }
);

// Tool: Get aggregate impact summary
server.tool(
  "get_impact_summary",
  "Shows aggregate ecological impact statistics from Regen Network — total credits retired, projects funded, hectares under stewardship, and credit types available.",
  {},
  async () => {
    return getImpactSummary();
  }
);

// Tool: Retire credits via Regen Marketplace
server.tool(
  "retire_credits",
  "Generates a link to retire ecocredits on Regen Network marketplace via credit card. Credits are permanently retired on-chain with your name as beneficiary, and you receive a verifiable retirement certificate. No crypto wallet needed.",
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
  },
  async ({ credit_class, quantity, beneficiary_name }) => {
    return retireCredits(credit_class, quantity, beneficiary_name);
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Regen Compute Credits MCP server running");
}

main().catch(console.error);
