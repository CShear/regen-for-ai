import { describe, expect, it } from "vitest";
import { estimateFootprint } from "../src/services/estimator.js";

describe("estimateFootprint", () => {
  it("estimates query floor from session duration", () => {
    const estimate = estimateFootprint(10);
    expect(estimate.estimated_queries).toBe(15);
    expect(estimate.energy_kwh).toBe(0.15);
    expect(estimate.co2_kg).toBe(0.06);
  });

  it("applies tool-call floor when higher than duration estimate", () => {
    const estimate = estimateFootprint(10, 20);
    expect(estimate.estimated_queries).toBe(40);
    expect(estimate.energy_kwh).toBe(0.4);
    expect(estimate.co2_kg).toBe(0.16);
  });

  it("keeps duration estimate when tool-call floor is lower", () => {
    const estimate = estimateFootprint(10, 2);
    expect(estimate.estimated_queries).toBe(15);
  });

  it("rounds values to expected precision", () => {
    const estimate = estimateFootprint(7);
    expect(estimate.energy_kwh).toBe(0.105);
    expect(estimate.co2_kg).toBe(0.042);
    expect(estimate.co2_tonnes).toBe(0.00004);
    expect(estimate.equivalent_cost_usd).toBe(0);
  });

  it("keeps methodology note populated", () => {
    const estimate = estimateFootprint(1);
    expect(estimate.methodology_note.toLowerCase()).toContain("approximate");
  });
});
