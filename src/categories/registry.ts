import type { CategoryAnalyzer } from "./analyzer.js";
import type { ListingCategory } from "./types.js";

export class CategoryAnalyzerRegistry {
  readonly #analyzers = new Map<ListingCategory, CategoryAnalyzer>();

  register(analyzer: CategoryAnalyzer): void {
    if (this.#analyzers.has(analyzer.category)) {
      throw new Error(`category_analyzer_already_registered: ${analyzer.category}`);
    }
    this.#analyzers.set(analyzer.category, analyzer);
  }

  get(category: ListingCategory): CategoryAnalyzer {
    return this.#analyzers.get(category) ?? this.requireGeneric();
  }

  private requireGeneric(): CategoryAnalyzer {
    const analyzer = this.#analyzers.get("generic");
    if (!analyzer) throw new Error("generic_category_analyzer_not_registered");
    return analyzer;
  }
}
