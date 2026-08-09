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

export function containsDefect(text: string): boolean {
  return /defeito|nao funciona|quebrad|avariad|para retirar pecas|com problema/.test(text);
}
