import type { ListingSummary } from "../marketplaces/types.js";
import { listingFingerprint } from "../utils/hash.js";
import { normalizeUrl } from "../utils/normalization.js";

export function deduplicateListings(listings: readonly ListingSummary[]): ListingSummary[] {
  const seen = new Set<string>();
  return listings.filter((listing) => {
    const key = listing.externalId
      ? `${listing.source}:id:${listing.externalId}`
      : `${listing.source}:url:${normalizeUrl(listing.url)}`;
    const fallback = `${listing.source}:fingerprint:${listingFingerprint(listing)}`;
    if (seen.has(key) || seen.has(fallback)) return false;
    seen.add(key);
    seen.add(fallback);
    return true;
  });
}
