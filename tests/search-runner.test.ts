import { Prisma, type Search } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import pino from "pino";
import { analysisInputHash, SearchRunner, validateProviderDetails } from "../src/jobs/search-runner.js";
import { calculateMarketStatistics } from "../src/market-analysis/statistics.js";
import { listingFixture } from "./fixtures/listings.js";
import { MarketplaceRegistry } from "../src/marketplaces/registry.js";
import { CategoryAnalyzerRegistry } from "../src/categories/registry.js";
import { ListingRepository } from "../src/listings/repository.js";

const mocks = vi.hoisted(() => ({ updateSearch: vi.fn().mockResolvedValue({ count: 1 }) }));
vi.mock("../src/db/client.js", () => ({
  prisma: { search: { updateMany: mocks.updateSearch } },
}));

function searchFixture(change: Partial<Search> = {}): Search {
  return {
    id: "search-1",
    name: "RTX",
    query: "RTX 3060 Ti",
    category: "gpu",
    minPrice: null,
    maxPrice: new Prisma.Decimal(1_500),
    minYear: null,
    maxYear: null,
    location: "Itajaí, SC",
    radiusKm: 100,
    minimumScore: 70,
    intervalMinutes: 60,
    providers: ["mercadolivre"],
    forbiddenWords: [],
    active: true,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-01T00:00:00Z"),
    lastRunAt: null,
    runLeaseId: null,
    runLeaseExpiresAt: null,
    ...change,
  };
}

describe("analysisInputHash", () => {
  it("ignores operational timestamps but changes with actual criteria", () => {
    const details = listingFixture();
    const deterministic = { category: "gpu" as const, data: { normalizedModel: "NVIDIA GeForce RTX 3060 TI" }, extractionConfidence: 0.9 };
    const market = calculateMarketStatistics([
      { id: "a", source: "olx", price: 1_500 },
      { id: "b", source: "mercadolivre", price: 1_600 },
    ]);
    const history = [{ price: 1_500, observedAt: new Date("2026-08-01T00:00:00Z") }];
    const pipeline = { pipelineVersion: 2, extractionModel: "extract-v1", analysisModel: "analyze-v1" };
    const initial = analysisInputHash(searchFixture(), details, deterministic, deterministic, market, history, pipeline);
    const afterRun = analysisInputHash(searchFixture({
      updatedAt: new Date("2026-08-02T00:00:00Z"),
      lastRunAt: new Date("2026-08-02T00:00:00Z"),
    }), details, deterministic, deterministic, market, history, pipeline);
    const changedCriteria = analysisInputHash(searchFixture({ minimumScore: 80 }), details, deterministic, deterministic, market, history, pipeline);
    const changedHistory = analysisInputHash(searchFixture(), details, deterministic, deterministic, market, [
      ...history,
      { price: 1_400, observedAt: new Date("2026-08-02T00:00:00Z") },
    ], pipeline);
    const changedModel = analysisInputHash(searchFixture(), details, deterministic, deterministic, market, history, {
      ...pipeline,
      analysisModel: "analyze-v2",
    });
    expect(afterRun).toBe(initial);
    expect(changedCriteria).not.toBe(initial);
    expect(changedHistory).not.toBe(initial);
    expect(changedModel).not.toBe(initial);
  });
});

describe("SearchRunner provider isolation", () => {
  it("skips providers that were disabled after a search was created", async () => {
    mocks.updateSearch.mockReset().mockResolvedValue({ count: 1 });
    const runner = new SearchRunner(
      new MarketplaceRegistry(),
      new CategoryAnalyzerRegistry(),
      new ListingRepository(),
      null,
      null,
      pino({ level: "silent" }),
      { detailConcurrency: 2, defaultLimit: 5, comparableMaxAgeDays: 30 },
    );
    await expect(runner.run(searchFixture({ providers: ["facebook"] }))).resolves.toBeUndefined();
    expect(mocks.updateSearch).toHaveBeenCalledTimes(2);
    expect(mocks.updateSearch).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ runLeaseId: null, runLeaseExpiresAt: null, lastRunAt: expect.any(Date) }),
    }));
  });

  it("does not start or mark a run complete after shutdown begins", async () => {
    mocks.updateSearch.mockReset().mockResolvedValue({ count: 1 });
    const runner = new SearchRunner(
      new MarketplaceRegistry(),
      new CategoryAnalyzerRegistry(),
      new ListingRepository(),
      null,
      null,
      pino({ level: "silent" }),
      { detailConcurrency: 2, defaultLimit: 5, comparableMaxAgeDays: 30 },
    );
    runner.requestStop();
    await runner.run(searchFixture());
    expect(mocks.updateSearch).not.toHaveBeenCalled();
  });

  it("skips a run when another process owns the durable lease", async () => {
    mocks.updateSearch.mockReset().mockResolvedValueOnce({ count: 0 });
    const runner = new SearchRunner(
      new MarketplaceRegistry(),
      new CategoryAnalyzerRegistry(),
      new ListingRepository(),
      null,
      null,
      pino({ level: "silent" }),
      { detailConcurrency: 2, defaultLimit: 5, comparableMaxAgeDays: 30 },
    );
    await runner.run(searchFixture());
    expect(mocks.updateSearch).toHaveBeenCalledOnce();
  });
});

describe("provider detail validation", () => {
  it("rejects a detail response that changes identity, source, or marketplace domain", () => {
    const summary = listingFixture();
    const valid = validateProviderDetails(summary, summary);
    expect(valid.url).toBe(summary.url);
    expect(() => validateProviderDetails(summary, { ...summary, url: "https://phishing.example/item/1" }))
      .toThrow("provider_listing_details_invalid");
    expect(() => validateProviderDetails(summary, { ...summary, source: "facebook" }))
      .toThrow("provider_listing_details_invalid");
    expect(() => validateProviderDetails(summary, { ...summary, externalId: "different-id" }))
      .toThrow("provider_listing_details_invalid");
  });
});
