import type { ListingSummary } from "../marketplaces/types.js";
import { normalizeUrl } from "../utils/normalization.js";

export function deduplicateListings(listings: readonly ListingSummary[]): ListingSummary[] {
  const seen = new Set<string>();
  return listings.filter((listing) => {
    if (listing.externalId) {
      const key = `${listing.source}:id:${listing.externalId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }
    const urlKey = `${listing.source}:url:${normalizeUrl(listing.url)}`;
    if (seen.has(urlKey)) return false;
    seen.add(urlKey);
    return true;
  });
}
