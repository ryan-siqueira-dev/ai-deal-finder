import { createHash } from "node:crypto";
import type { ListingDetails, ListingSummary } from "../marketplaces/types.js";
import { normalizeTitle } from "./normalization.js";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function listingFingerprint(listing: ListingSummary): string {
  return sha256(
    [listing.source, normalizeTitle(listing.title), listing.price ?? "", normalizeTitle(listing.location ?? "")].join("|"),
  );
}

export function listingContentHash(listing: ListingDetails): string {
  return sha256(JSON.stringify({
    title: listing.title,
    description: listing.description,
    price: listing.price,
    attributes: listing.attributes,
    images: listing.images,
  }));
}
