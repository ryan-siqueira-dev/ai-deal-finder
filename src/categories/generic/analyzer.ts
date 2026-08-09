import type { CategoryAnalyzer } from "../analyzer.js";
import type { AnalysisContext, CategoryAnalysis, StructuredListing } from "../types.js";
import type { ListingDetails } from "../../marketplaces/types.js";
import { containsDefect, listingText, stringValue } from "../helpers.js";
import { genericDataSchema } from "./schema.js";

const BRANDS = ["apple", "samsung", "sony", "lg", "dell", "lenovo", "asus", "acer", "motorola", "xiaomi"];

export class GenericAnalyzer implements CategoryAnalyzer {
  readonly category = "generic" as const;

  async extract(listing: ListingDetails): Promise<StructuredListing> {
    const text = listingText(listing);
    const brand = BRANDS.find((candidate) => text.includes(candidate)) ?? null;
    const condition = containsDefect(text)
      ? "damaged"
      : /novo|lacrado|sem uso/.test(text) ? "new" : /recondicionado/.test(text) ? "refurbished" : /usado/.test(text) ? "used" : "unknown";
    const defects = containsDefect(text) ? ["O anúncio menciona defeito ou avaria"] : [];
    const warrantyMatch = text.match(/garantia\s+(?:de\s+)?([\w\s]{1,30})/);
    const data = genericDataSchema.parse({
      brand,
      model: null,
      condition,
      warranty: warrantyMatch?.[1]?.trim() ?? null,
      defects,
      features: [],
    });
    return { category: this.category, data, extractionConfidence: brand ? 0.65 : 0.4 };
  }

  isComparable(a: StructuredListing, b: StructuredListing): boolean {
    const aBrand = stringValue(a.data, "brand");
    const bBrand = stringValue(b.data, "brand");
    const aModel = stringValue(a.data, "model");
    const bModel = stringValue(b.data, "model");
    if (aModel && bModel) return aBrand === bBrand && aModel === bModel;
    return Boolean(aBrand && aBrand === bBrand);
  }

  async analyze(input: AnalysisContext): Promise<CategoryAnalysis> {
    const defects = input.structured.data["defects"];
    const risks = Array.isArray(defects) ? defects.filter((item): item is string => typeof item === "string") : [];
    return {
      featureScore: input.structured.extractionConfidence >= 0.6 ? 9 : 5,
      riskScore: risks.length ? 3 : 11,
      advantages: risks.length ? [] : ["Nenhum defeito explícito foi identificado no texto"],
      risks,
    };
  }
}
