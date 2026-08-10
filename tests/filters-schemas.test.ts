import { describe, expect, it } from "vitest";
import { applyDeterministicFilters } from "../src/scoring/filters.js";
import { listingDetailsSchema, marketplaceSearchCriteriaSchema } from "../src/marketplaces/types.js";
import { dealAnalysisSchema, extractedListingDataSchema } from "../src/llm/types.js";
import { gpuDataSchema } from "../src/categories/gpu/schema.js";
import { listingFixture } from "./fixtures/listings.js";

describe("deterministic filters", () => {
  it("accepts a matching candidate", () => {
    expect(applyDeterministicFilters({
      listing: listingFixture(),
      structured: { category: "gpu", data: {}, extractionConfidence: 0.8 },
      criteria: { category: "gpu", maxPrice: 1500, location: "Itajaí", forbiddenWords: ["defeito"] },
      alreadyAnalyzed: false, duplicate: false,
    })).toEqual({ passed: true, reasons: [] });
  });

  it("reports every deterministic rejection reason", () => {
    const result = applyDeterministicFilters({
      listing: listingFixture({ price: 2000, description: "Com defeito", location: "Florianópolis, SC" }),
      structured: { category: "generic", data: {}, extractionConfidence: 0.5 },
      criteria: { category: "gpu", maxPrice: 1500, location: "Itajaí", forbiddenWords: ["defeito"] },
      alreadyAnalyzed: true, duplicate: true,
    });
    expect(result.passed).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining(["duplicate_listing", "already_analyzed_without_change", "over_budget", "category_mismatch", "forbidden_word:defeito", "location_mismatch"]));
  });

  it("rejects a different city when the requested radius cannot be verified", () => {
    const base = {
      structured: { category: "gpu" as const, data: {}, extractionConfidence: 0.8 },
      criteria: { category: "gpu" as const, location: "Itajaí, SC", radiusKm: 150 },
      alreadyAnalyzed: false,
      duplicate: false,
    };
    expect(applyDeterministicFilters({ ...base, listing: listingFixture({ location: "Itajaí, SC" }) }).passed).toBe(true);
    expect(applyDeterministicFilters({ ...base, listing: listingFixture({ location: "São José, SC" }) }).reasons).toContain("location_mismatch");
    expect(applyDeterministicFilters({ ...base, listing: listingFixture({ location: "Curitiba - Paraná" }) }).reasons).toContain("location_mismatch");
  });

  it("rejects missing location and non-positive prices", () => {
    const result = applyDeterministicFilters({
      listing: listingFixture({ price: 0, location: null }),
      structured: { category: "gpu", data: {}, extractionConfidence: 0.8 },
      criteria: { category: "gpu", location: "Itajaí" },
      alreadyAnalyzed: false,
      duplicate: false,
    });
    expect(result.reasons).toEqual(expect.arrayContaining(["invalid_price", "location_unknown"]));
  });

  it("rejects marketplace results for a different model", () => {
    const result = applyDeterministicFilters({
      listing: listingFixture({ title: "BMW X1 2014" }),
      structured: { category: "vehicle", data: { year: 2014 }, extractionConfidence: 0.7 },
      criteria: { category: "vehicle", query: "BMW 320i", minYear: 2010 },
      alreadyAnalyzed: false,
      duplicate: false,
    });
    expect(result.reasons).toContain("query_mismatch");
  });
});

describe("Zod contracts", () => {
  it("validates normalized external and LLM data", () => {
    expect(listingDetailsSchema.safeParse(listingFixture()).success).toBe(true);
    expect(marketplaceSearchCriteriaSchema.parse({ query: "RTX" }).limit).toBe(50);
    expect(extractedListingDataSchema.safeParse({ data: {}, confidence: 0.8 }).success).toBe(true);
    expect(dealAnalysisSchema.safeParse({ score: 87, verdict: "excellent_deal", advantages: [], risks: [], reason: "Preço bom" }).success).toBe(true);
  });

  it("rejects invalid category data and out-of-range LLM scores", () => {
    expect(gpuDataSchema.safeParse({}).success).toBe(false);
    expect(dealAnalysisSchema.safeParse({ score: 110, verdict: "good", advantages: [], risks: [], reason: "x" }).success).toBe(false);
    expect(listingDetailsSchema.safeParse(listingFixture({ price: 1_000_000_000_000 })).success).toBe(false);
  });
});
