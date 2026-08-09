import type { ListingDetails } from "../marketplaces/types.js";
import type { AnalysisContext, CategoryAnalysis, ListingCategory, StructuredListing } from "./types.js";

export interface CategoryAnalyzer {
  readonly category: ListingCategory;
  extract(listing: ListingDetails): Promise<StructuredListing>;
  isComparable(a: StructuredListing, b: StructuredListing): boolean;
  analyze(input: AnalysisContext): Promise<CategoryAnalysis>;
}
