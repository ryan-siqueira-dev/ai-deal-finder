import type { ListingDetails } from "../marketplaces/types.js";
import { normalizeTitle } from "../utils/normalization.js";
import type { ListingCategory, StructuredListing } from "../categories/types.js";

export interface FilterCriteria {
  category: ListingCategory;
  query?: string | null;
  minPrice?: number | null;
  maxPrice?: number | null;
  minYear?: number | null;
  maxYear?: number | null;
  location?: string | null;
  radiusKm?: number | null;
  forbiddenWords?: string[];
}

export interface FilterContext {
  listing: ListingDetails;
  structured: StructuredListing;
  criteria: FilterCriteria;
  alreadyAnalyzed: boolean;
  duplicate: boolean;
}

export interface FilterResult { passed: boolean; reasons: string[] }

const BRAZILIAN_STATES: Record<string, string> = {
  acre: "AC", alagoas: "AL", amapa: "AP", amazonas: "AM", bahia: "BA", ceara: "CE",
  "distrito federal": "DF", "espirito santo": "ES", goias: "GO", maranhao: "MA",
  "mato grosso": "MT", "mato grosso do sul": "MS", "minas gerais": "MG", para: "PA",
  paraiba: "PB", parana: "PR", pernambuco: "PE", piaui: "PI", "rio de janeiro": "RJ",
  "rio grande do norte": "RN", "rio grande do sul": "RS", rondonia: "RO", roraima: "RR",
  "santa catarina": "SC", "sao paulo": "SP", sergipe: "SE", tocantins: "TO",
};

function stateFromLocation(location: string): string | null {
  const abbreviation = location.match(/(?:,|-)\s*([A-Z]{2})\b/i)?.[1]?.toUpperCase();
  if (abbreviation) return abbreviation;
  const normalized = normalizeTitle(location);
  for (const [name, state] of Object.entries(BRAZILIAN_STATES)) {
    if (normalized === name || normalized.endsWith(` ${name}`)) return state;
  }
  return null;
}

function cityFromLocation(location: string): string {
  let normalized = normalizeTitle(location);
  for (const [name, state] of Object.entries(BRAZILIAN_STATES)) {
    const suffixes = [name, state.toLowerCase()];
    for (const suffix of suffixes) {
      if (normalized.endsWith(` ${suffix}`)) normalized = normalized.slice(0, -(suffix.length + 1)).trim();
    }
  }
  return normalized;
}

export function applyDeterministicFilters(input: FilterContext): FilterResult {
  const reasons: string[] = [];
  const { listing, criteria } = input;
  if (input.duplicate) reasons.push("duplicate_listing");
  if (input.alreadyAnalyzed) reasons.push("already_analyzed_without_change");
  if (listing.price === null || listing.price <= 0) reasons.push("invalid_price");
  if (criteria.minPrice != null && (listing.price === null || listing.price < criteria.minPrice)) reasons.push("below_minimum_price");
  if (criteria.maxPrice != null && (listing.price === null || listing.price > criteria.maxPrice)) reasons.push("over_budget");
  if (criteria.category !== "generic" && input.structured.category !== criteria.category) reasons.push("category_mismatch");
  const text = normalizeTitle(`${listing.title} ${listing.description ?? ""}`);
  const compactText = text.replace(/\s+/g, "");
  const queryTerms = normalizeTitle(criteria.query ?? "").split(" ").filter((term) => term.length >= 2);
  if (queryTerms.some((term) => !text.includes(term) && !compactText.includes(term.replace(/\s+/g, "")))) {
    reasons.push("query_mismatch");
  }
  for (const forbidden of criteria.forbiddenWords ?? []) {
    const normalizedForbidden = normalizeTitle(forbidden);
    if (normalizedForbidden && text.includes(normalizedForbidden)) reasons.push(`forbidden_word:${forbidden}`);
  }
  const year = input.structured.data["year"];
  if (criteria.minYear != null && (typeof year !== "number" || year < criteria.minYear)) reasons.push("year_below_minimum");
  if (criteria.maxYear != null && (typeof year !== "number" || year > criteria.maxYear)) reasons.push("year_above_maximum");
  if (criteria.location && !listing.location) reasons.push("location_unknown");
  if (criteria.location && listing.location) {
    const expected = normalizeTitle(criteria.location);
    const actual = normalizeTitle(listing.location);
    if (criteria.radiusKm != null) {
      const expectedState = stateFromLocation(criteria.location);
      const actualState = stateFromLocation(listing.location);
      const expectedCity = cityFromLocation(criteria.location);
      const actualCity = cityFromLocation(listing.location);
      if ((expectedState && actualState && expectedState !== actualState) || expectedCity !== actualCity) reasons.push("location_mismatch");
    } else if (!actual.includes(expected)) {
      reasons.push("location_mismatch");
    }
  }
  return { passed: reasons.length === 0, reasons };
}
