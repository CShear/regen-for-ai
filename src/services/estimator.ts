/**
 * AI Compute Ecological Footprint Estimator
 *
 * Provides heuristic estimates of the ecological footprint of AI sessions.
 * These are approximate — MCP servers cannot access internal compute metrics.
 *
 * Methodology sources:
 * - IEA: Data centres and AI are driving a surge in global electricity demand (2024)
 * - Luccioni et al.: "Power Hungry Processing" — energy and carbon costs of AI (2023)
 * - de Vries: "The growing energy footprint of artificial intelligence" (2023)
 *
 * Key assumptions:
 * - Average AI query energy: ~0.01 kWh (GPT-4 class, incl. data center overhead)
 * - Grid carbon intensity: ~0.4 kg CO2/kWh (global average, IEA 2023)
 * - Tool calls are a rough proxy for compute intensity
 * - A "session" of moderate use ≈ 20-50 queries
 */

// Energy per AI interaction (kWh) — conservative estimate for LLM inference
// Includes PUE (Power Usage Effectiveness) overhead of ~1.2x
const KWH_PER_QUERY = 0.01;

// Estimated queries per minute of active AI session
const QUERIES_PER_MINUTE = 1.5;

// Global average grid carbon intensity (kg CO2 per kWh)
// Source: IEA 2023 global average
const KG_CO2_PER_KWH = 0.4;

// Average price per tonne CO2 for Regen carbon credits (USD)
const USD_PER_TONNE_CO2 = 40;

// Average price per biodiversity credit (USD)
const USD_PER_BIO_CREDIT = 26;

export interface FootprintEstimate {
  session_minutes: number;
  estimated_queries: number;
  energy_kwh: number;
  co2_kg: number;
  co2_tonnes: number;
  equivalent_carbon_credits: number;
  equivalent_cost_usd: number;
  methodology_note: string;
}

export function estimateFootprint(
  sessionMinutes: number,
  toolCalls?: number
): FootprintEstimate {
  // Estimate query count from session duration, with tool calls as a floor
  const estimatedFromDuration = sessionMinutes * QUERIES_PER_MINUTE;
  const estimatedQueries = toolCalls
    ? Math.max(toolCalls * 2, estimatedFromDuration) // Each tool call likely involves ~2 LLM round-trips
    : estimatedFromDuration;

  const energyKwh = estimatedQueries * KWH_PER_QUERY;
  const co2Kg = energyKwh * KG_CO2_PER_KWH;
  const co2Tonnes = co2Kg / 1000;
  const equivalentCredits = co2Tonnes; // 1 carbon credit = 1 tonne CO2
  const equivalentCostUsd = co2Tonnes * USD_PER_TONNE_CO2;

  return {
    session_minutes: sessionMinutes,
    estimated_queries: Math.round(estimatedQueries),
    energy_kwh: Math.round(energyKwh * 10000) / 10000,
    co2_kg: Math.round(co2Kg * 1000) / 1000,
    co2_tonnes: Math.round(co2Tonnes * 100000) / 100000,
    equivalent_carbon_credits: Math.round(co2Tonnes * 100000) / 100000,
    equivalent_cost_usd: Math.round(equivalentCostUsd * 100) / 100,
    methodology_note:
      "This is an approximate estimate based on published research on AI energy consumption " +
      "(IEA 2024, Luccioni et al. 2023). Actual energy use varies by model, data center, " +
      "and grid energy mix. This estimate uses global averages and should be treated as " +
      "directional, not precise.",
  };
}
