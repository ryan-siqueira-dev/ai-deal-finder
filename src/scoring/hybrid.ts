import type { CategoryAnalysis } from "../categories/types.js";
import type { ListingDetails } from "../marketplaces/types.js";
import type { MarketStatistics, ReferenceConfidence } from "../market-analysis/statistics.js";
import { percentageDifference } from "../market-analysis/statistics.js";

export type DealVerdict = "bad" | "weak" | "fair" | "good" | "excellent_deal";

export interface DeterministicScoreResult {
  score: number;
  components: {
    priceVsMarket: number;
    absolutePrice: number;
    features: number;
    listingQuality: number;
    risks: number;
    statisticalConfidence: number;
  };
  differencePercent: number | null;
}

function confidenceScore(confidence: ReferenceConfidence): number {
  return confidence === "high" ? 5 : confidence === "medium" ? 3 : 1;
}

export function calculateDeterministicScore(
  listing: ListingDetails,
  market: MarketStatistics,
  category: CategoryAnalysis,
  maxBudget: number | null,
): DeterministicScoreResult {
  const difference = listing.price === null ? null : percentageDifference(listing.price, market.combined.medianPrice);
  const priceVsMarket = difference === null ? 0 : difference <= -25 ? 35 : difference <= -15 ? 30 : difference <= -8 ? 24 : difference <= 0 ? 17 : difference <= 10 ? 8 : 0;
  const absolutePrice = listing.price === null || maxBudget === null ? 5 : listing.price <= maxBudget * 0.8 ? 10 : listing.price <= maxBudget ? 7 : 0;
  const listingQuality = Math.min(10, (listing.description && listing.description.length >= 80 ? 4 : 0) + (listing.images.length >= 3 ? 3 : 1) + (Object.keys(listing.attributes).length ? 3 : 0));
  const components = {
    priceVsMarket,
    absolutePrice,
    features: Math.max(0, Math.min(15, category.featureScore)),
    listingQuality,
    risks: Math.max(0, Math.min(15, category.riskScore)),
    statisticalConfidence: confidenceScore(market.combined.confidence),
  };
  return { score: Math.round(Object.values(components).reduce((sum, value) => sum + value, 0)), components, differencePercent: difference };
}

export function combineScores(deterministicScore: number, llmScore: number): number {
  const normalizedLlmContribution = Math.max(0, Math.min(10, llmScore / 10));
  return Math.round(Math.max(0, Math.min(100, deterministicScore + normalizedLlmContribution)));
}

export function verdictForScore(score: number): DealVerdict {
  if (score >= 85) return "excellent_deal";
  if (score >= 70) return "good";
  if (score >= 50) return "fair";
  if (score >= 30) return "weak";
  return "bad";
}
