import { describe, expect, it } from "vitest";
import { searchDefinitionSchema } from "../src/searches/validation.js";

const valid = {
  name: "RTX barata",
  query: "RTX 3060 Ti",
  category: "gpu",
  providers: ["mercadolivre"],
  minPrice: null,
  maxPrice: 1_500,
  minYear: null,
  maxYear: null,
  location: "Itajaí, SC",
  radiusKm: 100,
  minimumScore: 70,
  intervalMinutes: 60,
  forbiddenWords: [],
};

describe("searchDefinitionSchema", () => {
  it("accepts a coherent search and removes repeated providers", () => {
    expect(searchDefinitionSchema.parse({ ...valid, providers: ["mercadolivre", "mercadolivre"] }).providers).toEqual(["mercadolivre"]);
  });

  it.each([
    { query: " " },
    { minPrice: 2_000 },
    { minimumScore: 101 },
    { intervalMinutes: 0 },
    { radiusKm: 10, location: null },
    { providers: [] },
  ])("rejects invalid search data: %o", (change) => {
    expect(searchDefinitionSchema.safeParse({ ...valid, ...change }).success).toBe(false);
  });
});
