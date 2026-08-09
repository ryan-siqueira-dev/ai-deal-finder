import { describe, expect, it } from "vitest";
import { calculateMarketStatistics, mean, median, percentageDifference, percentile } from "../src/market-analysis/statistics.js";
import { calculateDeterministicScore, combineScores, verdictForScore } from "../src/scoring/hybrid.js";
import { listingFixture } from "./fixtures/listings.js";

describe("market statistics", () => {
  it("calculates mean, median and interpolated percentiles", () => {
    expect(mean([1, 2, 9])).toBe(4);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(percentile([0, 10, 20, 30], 25)).toBe(7.5);
    expect(percentageDifference(1300, 1520)).toBeCloseTo(-14.47, 2);
  });

  it("keeps provider references separate and also combines samples", () => {
    const market = calculateMarketStatistics([
      { id: "1", source: "facebook", price: 1450 },
      { id: "2", source: "facebook", price: 1550 },
      { id: "3", source: "olx", price: 1500 },
      { id: "4", source: "mercadolivre", price: 1650 },
      { id: "5", source: "mercadolivre", price: 1700 },
    ]);
    expect(market.byProvider.facebook?.medianPrice).toBe(1500);
    expect(market.byProvider.mercadolivre?.medianPrice).toBe(1675);
    expect(market.combined.sampleSize).toBe(5);
    expect(market.combined.confidence).toBe("medium");
  });
});

describe("hybrid scoring", () => {
  it("caps LLM influence at ten points", () => {
    expect(combineScores(80, 100)).toBe(90);
    expect(combineScores(80, 20)).toBe(82);
  });

  it("rewards listings below a confident market reference", () => {
    const market = calculateMarketStatistics(Array.from({ length: 10 }, (_, index) => ({ id: String(index), source: "olx" as const, price: 1500 + index * 10 })));
    const result = calculateDeterministicScore(listingFixture({ price: 1200 }), market, { featureScore: 12, riskScore: 13, advantages: [], risks: [] }, 1500);
    expect(result.components.priceVsMarket).toBeGreaterThanOrEqual(30);
    expect(result.score).toBeLessThanOrEqual(90);
    expect(verdictForScore(86)).toBe("excellent_deal");
  });
});
