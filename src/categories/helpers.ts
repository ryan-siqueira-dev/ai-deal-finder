import type { ListingDetails } from "../marketplaces/types.js";
import { normalizeTitle } from "../utils/normalization.js";

export function listingText(listing: ListingDetails): string {
  return normalizeTitle([
    listing.title,
    listing.description ?? "",
    Object.entries(listing.attributes).map(([key, value]) => `${key} ${String(value)}`).join(" "),
  ].join(" "));
}

export function stringValue(data: Record<string, unknown>, key: string): string | null {
  return typeof data[key] === "string" ? data[key] : null;
}

export function numberValue(data: Record<string, unknown>, key: string): number | null {
  return typeof data[key] === "number" && Number.isFinite(data[key]) ? data[key] : null;
}

export function includesTerm(text: string, term: string): boolean {
  const normalizedText = ` ${normalizeTitle(text)} `;
  const normalizedTerm = normalizeTitle(term);
  return normalizedTerm.length > 0 && normalizedText.includes(` ${normalizedTerm} `);
}

export function containsDefect(text: string): boolean {
  const normalized = normalizeTitle(text).replace(
    /\b(?:sem|nenhum(?:a)?|nao (?:tem|possui|apresenta))(?: qualquer)? (?:defeitos?|avarias?|problemas?)\b/g,
    "",
  );
  return /\b(?:defeitos?|defeituos[oa]s?|nao funciona|quebrad[oa]s?|avariad[oa]s?|para retirar pecas|com problema)\b/.test(normalized);
}
