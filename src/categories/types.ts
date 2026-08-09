import { z } from "zod";
import type { ListingDetails, MarketplaceName } from "../marketplaces/types.js";

export const listingCategories = ["vehicle", "gpu", "notebook", "electronics", "generic"] as const;
export const listingCategorySchema = z.enum(listingCategories);
export type ListingCategory = z.infer<typeof listingCategorySchema>;

export const structuredListingSchema = z.object({
  category: listingCategorySchema,
  data: z.record(z.unknown()),
  extractionConfidence: z.number().min(0).max(1),
});
export type StructuredListing = z.infer<typeof structuredListingSchema>;

export interface AnalysisContext {
  listing: ListingDetails;
  structured: StructuredListing;
  comparableListings: StructuredListing[];
  marketMedianPrice: number | null;
  source: MarketplaceName;
}

export interface CategoryAnalysis {
  featureScore: number;
  riskScore: number;
  advantages: string[];
  risks: string[];
}
