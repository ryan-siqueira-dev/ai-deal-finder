import { createHash } from "node:crypto";
import type { ListingDetails, ListingSummary } from "../marketplaces/types.js";
import { normalizeTitle } from "./normalization.js";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function listingFingerprint(listing: ListingSummary): string {
  return sha256(
    [listing.source, normalizeTitle(listing.title), listing.price ?? "", normalizeTitle(listing.location ?? "")].join("|"),
  );
}

export function listingContentHash(listing: ListingDetails): string {
  return sha256(stableStringify({
    title: listing.title,
    description: listing.description,
    price: listing.price,
    attributes: listing.attributes,
    images: listing.images,
  }));
}
