import { Prisma, type ListingAnalysis } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ListingRepository, listingFenceFor, type NotificationClaim } from "../src/listings/repository.js";

const mocks = vi.hoisted(() => ({
  analysisUpsert: vi.fn(),
  claimAnalysis: vi.fn(),
  claimUpsert: vi.fn(),
  claimUpdateMany: vi.fn(),
  claimedNotification: vi.fn(),
  notificationFindFirst: vi.fn(),
  notificationUpdateMany: vi.fn(),
  recordNotification: vi.fn(),
  lockRow: vi.fn(),
  lockedListing: vi.fn(),
}));

vi.mock("../src/db/client.js", () => {
  const transactionClient = {
    $queryRaw: mocks.lockRow,
    listing: { findUnique: mocks.lockedListing },
    listingAnalysis: { findUniqueOrThrow: mocks.claimAnalysis, upsert: mocks.analysisUpsert },
    notification: {
      upsert: mocks.claimUpsert,
      updateMany: mocks.claimUpdateMany,
      findUniqueOrThrow: mocks.claimedNotification,
    },
  };
  return {
    prisma: {
      $transaction: vi.fn((operation: (transaction: typeof transactionClient) => unknown) => operation(transactionClient)),
      listingAnalysis: { upsert: mocks.analysisUpsert },
      notification: {
        findFirst: mocks.notificationFindFirst,
        updateMany: mocks.notificationUpdateMany,
        upsert: mocks.recordNotification,
      },
    },
  };
});

const claim: NotificationClaim = {
  id: "notification-1",
  listingId: "listing-1",
  searchId: "search-1",
  analysisId: "analysis-1",
  channel: "telegram",
  claimedAt: new Date("2026-08-09T12:00:00.000Z"),
  attempt: 2,
};

const listingGeneration = {
  id: claim.listingId,
  suppressedAt: null,
  updatedAt: new Date("2026-08-09T12:00:00.000Z"),
  fingerprint: "listing-fingerprint",
  contentHash: "listing-content",
};
const listingFence = listingFenceFor(listingGeneration);

function analysisInput() {
  return {
    listingId: claim.listingId,
    listingFence,
    searchId: claim.searchId,
    finalScore: 80,
    deterministic: {
      score: 70,
      components: { priceVsMarket: 35, absolutePrice: 10, features: 10, listingQuality: 5, risks: 5, statisticalConfidence: 5 },
      differencePercent: -20,
    },
    analysis: { score: 80, verdict: "good" as const, advantages: ["local"], risks: [], reason: "local loser" },
    market: {
      byProvider: {},
      combined: {
        sampleSize: 1,
        confidence: "low" as const,
        medianPrice: 1_000,
        meanPrice: 1_000,
        minimumPrice: 1_000,
        maximumPrice: 1_000,
        percentiles: { p25: 1_000, p75: 1_000, p90: 1_000 },
      },
    },
    analysisModel: null,
    llmAttempted: false,
    inputHash: "hash",
  };
}

describe("ListingRepository notification delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claimAnalysis.mockResolvedValue({ listingId: claim.listingId, searchId: claim.searchId });
    mocks.lockRow.mockResolvedValue([{ id: claim.listingId }]);
    mocks.lockedListing.mockResolvedValue(listingGeneration);
    mocks.claimUpsert.mockResolvedValue({ id: claim.id });
    mocks.claimUpdateMany.mockResolvedValue({ count: 1 });
    mocks.claimedNotification.mockResolvedValue({
      id: claim.id,
      listingId: claim.listingId,
      searchId: claim.searchId,
      analysisId: claim.analysisId,
      channel: claim.channel,
      claimedAt: claim.claimedAt,
      attempts: claim.attempt,
    });
    mocks.notificationUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("atomically claims pending, failed, or expired delivery work", async () => {
    const repository = new ListingRepository();
    await expect(repository.claimNotification({
      analysisId: claim.analysisId,
      channel: ` ${claim.channel} `,
      listingFence,
      leaseMs: 60_000,
      now: claim.claimedAt,
    })).resolves.toEqual(claim);

    expect(mocks.claimUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { analysisId_channel: { analysisId: claim.analysisId, channel: claim.channel } },
      create: expect.objectContaining({ listingId: claim.listingId, searchId: claim.searchId, status: "pending" }),
    }));
    expect(mocks.claimUpdateMany).toHaveBeenCalledWith({
      where: {
        id: claim.id,
        OR: [
          { status: { in: ["pending", "failed"] } },
          { status: "sending", claimedAt: { lte: new Date("2026-08-09T11:59:00.000Z") } },
        ],
      },
      data: {
        status: "sending",
        attempts: { increment: 1 },
        claimedAt: claim.claimedAt,
        sentAt: null,
        lastError: null,
      },
    });
  });

  it("does not claim a sent delivery or an unexpired lease", async () => {
    mocks.claimUpdateMany.mockResolvedValueOnce({ count: 0 });
    const repository = new ListingRepository();
    await expect(repository.claimNotification({ analysisId: claim.analysisId, channel: claim.channel, listingFence })).resolves.toBeNull();
    expect(mocks.claimedNotification).not.toHaveBeenCalled();
  });

  it("uses the claim timestamp as a fencing token when completing work", async () => {
    const repository = new ListingRepository();
    const sentAt = new Date("2026-08-09T12:00:01.000Z");
    await expect(repository.markNotificationSent(claim, sentAt)).resolves.toBe(true);
    expect(mocks.notificationUpdateMany).toHaveBeenLastCalledWith({
      where: { id: claim.id, status: "sending", claimedAt: claim.claimedAt, attempts: claim.attempt },
      data: { status: "sent", claimedAt: null, sentAt, lastError: null },
    });

    await expect(repository.markNotificationFailed(claim, new Error("telegram_down"))).resolves.toBe(true);
    expect(mocks.notificationUpdateMany).toHaveBeenLastCalledWith({
      where: { id: claim.id, status: "sending", claimedAt: claim.claimedAt, attempts: claim.attempt },
      data: { status: "failed", claimedAt: null, sentAt: null, lastError: "Error: telegram_down" },
    });

    await repository.markNotificationFailed(claim, new Error("bot123456789:VERY_SECRET_TELEGRAM_TOKEN_EXAMPLE"));
    expect(mocks.notificationUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lastError: "Error: bot[REDACTED]" }),
    }));
  });

  it("returns the analysis row that won the idempotent upsert", async () => {
    const persisted = {
      id: claim.analysisId,
      listingId: claim.listingId,
      searchId: claim.searchId,
      score: 70,
      deterministicScore: 65,
      verdict: "good",
      marketMedianPrice: new Prisma.Decimal(1_000),
      estimatedMarketPrice: new Prisma.Decimal(1_000),
      priceDifferencePercent: new Prisma.Decimal(-10),
      advantages: [],
      risks: [],
      reason: "persisted winner",
      analysisModel: null,
      llmAttemptedAt: null,
      inputHash: "hash",
      createdAt: new Date("2026-08-09T12:00:00.000Z"),
    } satisfies ListingAnalysis;
    mocks.analysisUpsert.mockResolvedValueOnce(persisted);

    const result = await new ListingRepository().createAnalysis(analysisInput());

    expect(result).toBe(persisted);
  });

  it("rejects stale analysis persistence and notification claims", async () => {
    mocks.lockedListing.mockResolvedValue({
      ...listingGeneration,
      updatedAt: new Date("2026-08-09T12:00:01.000Z"),
      contentHash: "new-content",
    });
    const repository = new ListingRepository();

    await expect(repository.createAnalysis(analysisInput())).resolves.toBeNull();
    await expect(repository.claimNotification({
      analysisId: claim.analysisId,
      channel: claim.channel,
      listingFence,
    })).resolves.toBeNull();

    expect(mocks.analysisUpsert).not.toHaveBeenCalled();
    expect(mocks.claimUpsert).not.toHaveBeenCalled();
  });
});
