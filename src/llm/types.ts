import { z } from "zod";
import type { ListingCategory, StructuredListing } from "../categories/types.js";
import type { ListingDetails, MarketplaceName } from "../marketplaces/types.js";
import type { MarketStatistics } from "../market-analysis/statistics.js";

export interface ListingExtractionInput {
  listing: ListingDetails;
  category: ListingCategory;
  deterministicExtraction: StructuredListing;
}

export const extractedListingDataSchema = z.object({
  data: z.record(z.unknown()),
  confidence: z.number().min(0).max(1),
});
export type ExtractedListingData = z.infer<typeof extractedListingDataSchema>;

export interface DealAnalysisInput {
  listing: ListingDetails;
  structured: StructuredListing;
  marketplace: MarketplaceName;
  market: MarketStatistics;
  priceHistory: Array<{ price: number; observedAt: Date }>;
  deterministicScore: number;
  searchCriteria: Record<string, unknown>;
}

export const dealAnalysisSchema = z.object({
  score: z.number().min(0).max(100),
  verdict: z.enum(["bad", "weak", "fair", "good", "excellent_deal"]),
  advantages: z.array(z.string().trim().min(1).max(500)).max(10),
  risks: z.array(z.string().trim().min(1).max(500)).max(10),
  reason: z.string().trim().min(1).max(2000),
});
export type DealAnalysis = z.infer<typeof dealAnalysisSchema>;

export interface LLMProvider {
  readonly extractionModel: string;
  readonly analysisModel: string;
  extractListingData(input: ListingExtractionInput): Promise<ExtractedListingData>;
  analyzeDeal(input: DealAnalysisInput): Promise<DealAnalysis>;
}
