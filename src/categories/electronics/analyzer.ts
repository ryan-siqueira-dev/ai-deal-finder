import type { ListingDetails } from "../../marketplaces/types.js";
import type { CategoryAnalyzer } from "../analyzer.js";
import type { AnalysisContext, CategoryAnalysis, StructuredListing } from "../types.js";
import { GenericAnalyzer } from "../generic/analyzer.js";

export class ElectronicsAnalyzer implements CategoryAnalyzer {
  readonly category = "electronics" as const;
  readonly #generic = new GenericAnalyzer();

  async extract(listing: ListingDetails): Promise<StructuredListing> {
    const extracted = await this.#generic.extract(listing);
    return { ...extracted, category: this.category };
  }
  isComparable(a: StructuredListing, b: StructuredListing): boolean { return this.#generic.isComparable(a, b); }
  analyze(input: AnalysisContext): Promise<CategoryAnalysis> { return this.#generic.analyze(input); }
}
