import { describe, expect, it } from "vitest";
import { deduplicateListings } from "../src/listings/deduplication.js";
import { findCrossMarketplaceMatch } from "../src/matching/cross-marketplace.js";
import type { ListingSummary } from "../src/marketplaces/types.js";

const base: ListingSummary = {
  source: "olx", externalId: "1", title: "BMW 320i 2015", price: 69900, currency: "BRL",
  location: "Itajaí, SC", url: "https://olx.com.br/item/bmw-1", imageUrl: null,
};

describe("deduplication", () => {
  it("uses external id first and keeps different marketplaces separate", () => {
    const duplicate = { ...base, url: "https://olx.com.br/item/outra-url" };
    const facebook = { ...base, source: "facebook" as const, url: "https://facebook.com/marketplace/item/1" };
    expect(deduplicateListings([base, duplicate, facebook])).toEqual([base, facebook]);
  });

  it("falls back to normalized url then fingerprint", () => {
    const anonymous = { ...base, externalId: null, url: "https://olx.com.br/item/bmw-1?utm_source=x" };
    const duplicate = { ...anonymous, url: "https://olx.com.br/item/bmw-1?utm_medium=y" };
    expect(deduplicateListings([anonymous, duplicate])).toHaveLength(1);
  });
});

describe("cross-market matching", () => {
  it("marks likely cross-posts without merging", () => {
    const match = findCrossMarketplaceMatch(
      { id: "a", source: "olx", title: "BMW 320i 2015 Sport", price: 69900, location: "Itajaí SC" },
      { id: "b", source: "facebook", title: "BMW 320i Sport 2015", price: 69900, location: "Itajaí, SC" },
    );
    expect(match?.confidence).toBeGreaterThanOrEqual(0.7);
    expect(match?.listingAId).toBe("a");
  });

  it("does not match listings from the same source", () => {
    expect(findCrossMarketplaceMatch(
      { id: "a", source: "olx", title: "BMW 320i", price: 1, location: null },
      { id: "b", source: "olx", title: "BMW 320i", price: 1, location: null },
    )).toBeNull();
  });
});
