import { describe, expect, it } from "vitest";
import { normalizeMileage, normalizeTitle, normalizeUrl, parseBRLPrice } from "../src/utils/normalization.js";

describe("normalization", () => {
  it.each([
    ["R$ 1.500,00", 1500],
    ["R$ 75.000", 75000],
    ["1299.90", 1299.9],
    [null, null],
    ["Consulte", null],
  ])("parseBRLPrice(%s)", (input, expected) => expect(parseBRLPrice(input)).toBe(expected));

  it("normalizes titles and accents", () => {
    expect(normalizeTitle("  Galax RTX 3060 Ti — 8GB! ")).toBe("galax rtx 3060 ti 8gb");
  });

  it("removes tracking parameters without removing functional parameters", () => {
    expect(normalizeUrl("https://WWW.Example.com/item/1/?utm_source=x&variant=2#top"))
      .toBe("https://example.com/item/1?variant=2");
  });

  it.each([["92.000 km", 92000], ["92 mil km", 92000], ["120k km", 120000], [15000, 15000]])
    ("normalizes mileage %s", (input, expected) => expect(normalizeMileage(input)).toBe(expected));
});
