import { Prisma, type Listing, type ListingAnalysis, type Search } from "@prisma/client";
import type { ListingCategory, StructuredListing } from "../categories/types.js";
import type { DealAnalysis } from "../llm/types.js";
import type { ListingDetails, ListingSummary, MarketplaceName } from "../marketplaces/types.js";
import type { MarketStatistics } from "../market-analysis/statistics.js";
import type { DeterministicScoreResult } from "../scoring/hybrid.js";
import { listingContentHash, listingFingerprint } from "../utils/hash.js";
import { normalizeUrl } from "../utils/normalization.js";
import { prisma } from "../db/client.js";
import { sanitizeLogText } from "../config/logger.js";

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function notificationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return sanitizeLogText(message).slice(0, 2_000);
}

export interface UpsertSummaryResult {
  listing: Listing;
  isNew: boolean;
  priceChanged: boolean;
  contentChanged: boolean;
  needsDetails: boolean;
  suppressed: boolean;
}
export interface ListingFence {
  updatedAt: Date;
  fingerprint: string;
  contentHash: string | null;
}
export interface ComparableRecord { id: string; source: MarketplaceName; title: string; location: string | null; price: number; structured: StructuredListing }
export interface StoredExtractions {
  enriched: StructuredListing;
  deterministic: StructuredListing;
  extractionModel: string | null;
  extractionAttemptModel: string | null;
  extractionAttemptedAt: Date | null;
  sourceContentHash: string | null;
}
export interface ClaimNotificationInput {
  analysisId: string;
  channel: string;
  listingFence: ListingFence;
  leaseMs?: number;
  now?: Date;
}
export interface NotificationClaim {
  id: string;
  listingId: string;
  searchId: string;
  analysisId: string;
  channel: string;
  claimedAt: Date;
  attempt: number;
}

export function listingFenceFor(listing: Pick<Listing, "updatedAt" | "fingerprint" | "contentHash">): ListingFence {
  return {
    updatedAt: new Date(listing.updatedAt.getTime()),
    fingerprint: listing.fingerprint,
    contentHash: listing.contentHash,
  };
}

function matchesListingFence(
  listing: Pick<Listing, "updatedAt" | "fingerprint" | "contentHash">,
  expected: ListingFence,
): boolean {
  return listing.updatedAt.getTime() === expected.updatedAt.getTime()
    && listing.fingerprint === expected.fingerprint
    && listing.contentHash === expected.contentHash;
}

export class ListingRepository {
  async upsertSummary(searchId: string, category: ListingCategory, summary: ListingSummary): Promise<UpsertSummaryResult> {
    const normalizedUrl = normalizeUrl(summary.url);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await prisma.$transaction(async (transaction) => {
          let existing = await this.findExisting(transaction, summary.source, summary.externalId, normalizedUrl);
          if (existing) existing = await this.lockListing(transaction, existing.id);
          if (existing?.suppressedAt) {
            if (!existing.externalId && summary.externalId) {
              existing = await transaction.listing.update({
                where: { id: existing.id },
                data: { externalId: summary.externalId },
              });
            }
            return {
              listing: existing,
              isNew: false,
              priceChanged: false,
              contentChanged: false,
              needsDetails: false,
              suppressed: true,
            };
          }
          const priceChanged = existing?.price?.toNumber() !== summary.price && !(existing?.price === null && summary.price === null);
          const contentChanged = !existing || priceChanged
            || existing.title !== summary.title
            || existing.location !== summary.location
            || existing.imageUrl !== summary.imageUrl
            || existing.normalizedUrl !== normalizedUrl;
          const listing = existing
            ? await transaction.listing.update({
              where: { id: existing.id },
              data: {
                externalId: existing.externalId ?? summary.externalId,
                fingerprint: listingFingerprint(summary),
                category,
                title: summary.title,
                price: summary.price,
                currency: summary.currency,
                location: summary.location,
                url: summary.url,
                normalizedUrl,
                imageUrl: summary.imageUrl,
                lastSeenAt: new Date(),
                active: true,
                ...(contentChanged ? {
                  description: null,
                  sellerName: null,
                  images: summary.imageUrl ? [summary.imageUrl] : [],
                  attributes: {},
                  publishedAt: null,
                  rawData: Prisma.DbNull,
                  contentHash: null,
                } : {}),
              },
            })
            : await transaction.listing.create({
              data: {
                source: summary.source,
                category,
                externalId: summary.externalId,
                fingerprint: listingFingerprint(summary),
                title: summary.title,
                price: summary.price,
                currency: summary.currency,
                location: summary.location,
                url: summary.url,
                normalizedUrl,
                imageUrl: summary.imageUrl,
                images: summary.imageUrl ? [summary.imageUrl] : [],
                attributes: {},
              },
            });
          await transaction.searchListing.upsert({
            where: { searchId_listingId: { searchId, listingId: listing.id } },
            create: { searchId, listingId: listing.id },
            update: { lastMatchedAt: new Date() },
          });
          if (summary.price !== null && (!existing || priceChanged)) {
            await transaction.listingPriceHistory.create({ data: { listingId: listing.id, price: summary.price } });
          }
          const refreshBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
          return {
            listing,
            isNew: !existing,
            priceChanged,
            contentChanged,
            needsDetails: !existing || existing.lastCheckedAt < refreshBefore || contentChanged,
            suppressed: false,
          };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        const conflict = error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034");
        if (!conflict || attempt === 3) throw error;
      }
    }
    throw new Error("listing_upsert_failed");
  }

  async updateDetails(
    id: string,
    category: ListingCategory,
    details: ListingDetails,
    expectedFence: ListingFence,
  ): Promise<{ listing: Listing; contentChanged: boolean } | null> {
    const contentHash = listingContentHash(details);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await prisma.$transaction(async (transaction) => {
          const existing = await this.lockListing(transaction, id);
          if (!existing || existing.suppressedAt || !matchesListingFence(existing, expectedFence)) return null;
          const listing = await transaction.listing.update({
            where: { id },
            data: {
              category,
              title: details.title,
              description: details.description,
              price: details.price,
              currency: details.currency,
              location: details.location,
              sellerName: details.sellerName,
              url: details.url,
              normalizedUrl: normalizeUrl(details.url),
              imageUrl: details.imageUrl,
              images: details.images,
              attributes: toJson(details.attributes),
              publishedAt: details.publishedAt ?? null,
              rawData: details.rawData === undefined ? Prisma.JsonNull : toJson(details.rawData),
              contentHash,
              lastCheckedAt: new Date(),
              lastSeenAt: new Date(),
            },
          });
          if (details.price !== null && existing.price?.toNumber() !== details.price) {
            await transaction.listingPriceHistory.create({ data: { listingId: id, price: details.price } });
          }
          return { listing, contentChanged: existing.contentHash !== contentHash };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        const conflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
        if (!conflict || attempt === 3) throw error;
      }
    }
    throw new Error("listing_details_update_failed");
  }

  async markDetailsChecked(id: string, expectedFence: ListingFence): Promise<Listing | null> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await prisma.$transaction(async (transaction) => {
          const listing = await this.lockListing(transaction, id);
          if (!listing || listing.suppressedAt || !matchesListingFence(listing, expectedFence)) return null;
          return transaction.listing.update({ where: { id }, data: { lastCheckedAt: new Date() } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        const conflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
        if (!conflict || attempt === 3) throw error;
      }
    }
    throw new Error("listing_details_check_failed");
  }

  async saveStructured(
    id: string,
    structured: StructuredListing,
    deterministic: StructuredListing = structured,
    extractionModel: string | null = null,
    extractionAttemptModel: string | null = null,
    extractionAttemptedAt: Date | null = null,
    sourceContentHash: string | null = null,
    expectedFence: ListingFence,
  ): Promise<Listing | null> {
    const data = toJson({
      ...structured.data,
      extractionConfidence: structured.extractionConfidence,
      deterministicData: deterministic.data,
      deterministicExtractionConfidence: deterministic.extractionConfidence,
      extractionModel,
      extractionAttemptModel,
      extractionAttemptedAt: extractionAttemptedAt?.toISOString() ?? null,
      sourceContentHash,
    });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await prisma.$transaction(async (transaction) => {
          let dataToPersist = data;
          const listing = await this.lockListing(transaction, id);
          if (!listing || listing.suppressedAt || !matchesListingFence(listing, expectedFence)) return null;
          if (listing.contentHash !== null && sourceContentHash !== listing.contentHash) return null;
          const current = await transaction.structuredListingData.findUnique({ where: { listingId: id } });
          const currentData = toRecord(current?.data ?? null);
          const incomingAttemptFailed = Boolean(extractionAttemptModel && extractionModel !== extractionAttemptModel);
          const currentHasSuccessfulExtraction = typeof currentData["extractionModel"] === "string";
          const sameSourceContent = Boolean(sourceContentHash && currentData["sourceContentHash"] === sourceContentHash);
          if (incomingAttemptFailed && currentHasSuccessfulExtraction && sameSourceContent && current?.category === structured.category) {
            dataToPersist = toJson({
              ...currentData,
              extractionAttemptModel,
              extractionAttemptedAt: extractionAttemptedAt?.toISOString() ?? null,
            });
          }
          const persistedListing = listing.category === structured.category
            ? listing
            : await transaction.listing.update({ where: { id }, data: { category: structured.category } });
          await transaction.structuredListingData.upsert({
            where: { listingId: id },
            create: { listingId: id, category: structured.category, data: dataToPersist, schemaVersion: 2 },
            update: { category: structured.category, data: dataToPersist, schemaVersion: 2, extractedAt: new Date() },
          });
          return persistedListing;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        const conflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
        if (!conflict || attempt === 3) throw error;
      }
    }
    throw new Error("structured_listing_save_failed");
  }

  async getStructured(id: string): Promise<StoredExtractions | null> {
    const row = await prisma.structuredListingData.findUnique({ where: { listingId: id } });
    if (!row) return null;
    const stored = toRecord(row.data);
    const enrichedData = { ...stored };
    delete enrichedData["extractionConfidence"];
    delete enrichedData["deterministicData"];
    delete enrichedData["deterministicExtractionConfidence"];
    delete enrichedData["extractionModel"];
    delete enrichedData["extractionAttemptModel"];
    delete enrichedData["extractionAttemptedAt"];
    delete enrichedData["sourceContentHash"];
    const deterministicData = toRecord(stored["deterministicData"] as Prisma.JsonValue | null);
    return {
      enriched: {
        category: row.category as ListingCategory,
        data: enrichedData,
        extractionConfidence: typeof stored["extractionConfidence"] === "number" ? stored["extractionConfidence"] : 0.5,
      },
      deterministic: {
        category: row.category as ListingCategory,
        data: Object.keys(deterministicData).length ? deterministicData : enrichedData,
        extractionConfidence: typeof stored["deterministicExtractionConfidence"] === "number"
          ? stored["deterministicExtractionConfidence"]
          : typeof stored["extractionConfidence"] === "number" ? stored["extractionConfidence"] : 0.5,
      },
      extractionModel: typeof stored["extractionModel"] === "string" ? stored["extractionModel"] : null,
      extractionAttemptModel: typeof stored["extractionAttemptModel"] === "string" ? stored["extractionAttemptModel"] : null,
      extractionAttemptedAt: typeof stored["extractionAttemptedAt"] === "string"
        && Number.isFinite(Date.parse(stored["extractionAttemptedAt"]))
        ? new Date(stored["extractionAttemptedAt"])
        : null,
      sourceContentHash: typeof stored["sourceContentHash"] === "string" ? stored["sourceContentHash"] : null,
    };
  }

  async findComparables(category: ListingCategory, excludeId: string, seenAfter: Date, currency: string | null, limit = 250): Promise<ComparableRecord[]> {
    const rows = await prisma.listing.findMany({
      where: {
        id: { not: excludeId }, category, active: true, suppressedAt: null, lastSeenAt: { gte: seenAfter },
        price: { gt: 0 }, structuredData: { isNot: null },
        currency,
      },
      select: { id: true, source: true, title: true, location: true, price: true, structuredData: { select: { category: true, data: true } } },
      orderBy: { lastSeenAt: "desc" },
      take: limit,
    });
    return rows.flatMap((row) => {
      if (!row.price || !row.structuredData) return [];
      const stored = toRecord(row.structuredData.data);
      const deterministic = toRecord(stored["deterministicData"] as Prisma.JsonValue | null);
      const data = Object.keys(deterministic).length ? deterministic : { ...stored };
      delete data["extractionConfidence"];
      delete data["deterministicData"];
      delete data["deterministicExtractionConfidence"];
      delete data["extractionModel"];
      delete data["extractionAttemptModel"];
      delete data["extractionAttemptedAt"];
      delete data["sourceContentHash"];
      const confidence = typeof stored["deterministicExtractionConfidence"] === "number"
        ? stored["deterministicExtractionConfidence"]
        : typeof stored["extractionConfidence"] === "number" ? stored["extractionConfidence"] : 0.5;
      return [{ id: row.id, source: row.source as MarketplaceName, title: row.title, location: row.location, price: row.price.toNumber(), structured: { category: row.structuredData.category as ListingCategory, data, extractionConfidence: confidence } }];
    });
  }

  async getPriceHistory(id: string): Promise<Array<{ price: number; observedAt: Date }>> {
    const rows = await prisma.listingPriceHistory.findMany({ where: { listingId: id }, orderBy: { observedAt: "asc" } });
    return rows.map((row) => ({ price: row.price.toNumber(), observedAt: row.observedAt }));
  }

  async findAnalysis(listingId: string, searchId: string, inputHash: string) {
    return prisma.listingAnalysis.findFirst({ where: { listingId, searchId, inputHash }, orderBy: { createdAt: "desc" } });
  }

  async notificationExists(analysisId: string, channel: string): Promise<boolean> {
    return Boolean(await prisma.notification.findFirst({ where: { analysisId, channel, status: "sent" }, select: { id: true } }));
  }

  async createAnalysis(input: {
    listingId: string;
    listingFence: ListingFence;
    searchId: string;
    finalScore: number;
    deterministic: DeterministicScoreResult;
    analysis: DealAnalysis;
    market: MarketStatistics;
    analysisModel: string | null;
    llmAttempted: boolean;
    inputHash: string;
  }): Promise<ListingAnalysis | null> {
    const llmAttemptedAt = input.llmAttempted ? new Date() : null;
    const analysisData = {
      score: input.finalScore,
      deterministicScore: input.deterministic.score,
      verdict: input.analysis.verdict,
      marketMedianPrice: input.market.combined.medianPrice,
      estimatedMarketPrice: input.market.combined.medianPrice,
      priceDifferencePercent: input.deterministic.differencePercent,
      advantages: input.analysis.advantages,
      risks: input.analysis.risks,
      reason: input.analysis.reason,
      analysisModel: input.analysisModel,
      llmAttemptedAt,
    };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await prisma.$transaction(async (transaction) => {
          const listing = await this.lockListing(transaction, input.listingId);
          if (!listing || listing.suppressedAt || !matchesListingFence(listing, input.listingFence)) return null;
          return transaction.listingAnalysis.upsert({
            where: { listingId_searchId_inputHash: { listingId: input.listingId, searchId: input.searchId, inputHash: input.inputHash } },
            update: input.analysisModel ? analysisData : input.llmAttempted ? { llmAttemptedAt } : {},
            create: {
              listingId: input.listingId,
              searchId: input.searchId,
              ...analysisData,
              inputHash: input.inputHash,
            },
          });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        const conflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
        if (!conflict || attempt === 3) throw error;
      }
    }
    throw new Error("listing_analysis_save_failed");
  }

  async claimNotification(input: ClaimNotificationInput): Promise<NotificationClaim | null> {
    const channel = input.channel.trim();
    if (!channel) throw new RangeError("notification_channel_required");
    const leaseMs = input.leaseMs ?? 15 * 60_000;
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new RangeError("notification_lease_must_be_positive");
    const claimedAt = new Date(input.now?.getTime() ?? Date.now());
    const expiredBefore = new Date(claimedAt.getTime() - leaseMs);

    return prisma.$transaction(async (transaction) => {
      const analysis = await transaction.listingAnalysis.findUniqueOrThrow({
        where: { id: input.analysisId },
        select: { listingId: true, searchId: true },
      });
      const listing = await this.lockListing(transaction, analysis.listingId);
      if (!listing || listing.suppressedAt || !matchesListingFence(listing, input.listingFence)) return null;
      const notification = await transaction.notification.upsert({
        where: { analysisId_channel: { analysisId: input.analysisId, channel } },
        create: {
          listingId: analysis.listingId,
          searchId: analysis.searchId,
          analysisId: input.analysisId,
          channel,
          status: "pending",
        },
        update: {},
        select: { id: true },
      });
      const claimed = await transaction.notification.updateMany({
        where: {
          id: notification.id,
          OR: [
            { status: { in: ["pending", "failed"] } },
            { status: "sending", claimedAt: { lte: expiredBefore } },
          ],
        },
        data: {
          status: "sending",
          attempts: { increment: 1 },
          claimedAt,
          sentAt: null,
          lastError: null,
        },
      });
      if (claimed.count !== 1) return null;
      const row = await transaction.notification.findUniqueOrThrow({
        where: { id: notification.id },
        select: {
          id: true,
          listingId: true,
          searchId: true,
          analysisId: true,
          channel: true,
          claimedAt: true,
          attempts: true,
        },
      });
      if (!row.claimedAt) throw new Error("notification_claim_missing_timestamp");
      return {
        id: row.id,
        listingId: row.listingId,
        searchId: row.searchId,
        analysisId: row.analysisId,
        channel: row.channel,
        claimedAt: row.claimedAt,
        attempt: row.attempts,
      };
    });
  }

  async markNotificationSent(claim: NotificationClaim, sentAt = new Date()): Promise<boolean> {
    const updated = await prisma.notification.updateMany({
      where: { id: claim.id, status: "sending", claimedAt: claim.claimedAt, attempts: claim.attempt },
      data: { status: "sent", claimedAt: null, sentAt, lastError: null },
    });
    return updated.count === 1;
  }

  async markNotificationFailed(claim: NotificationClaim, error: unknown): Promise<boolean> {
    const updated = await prisma.notification.updateMany({
      where: { id: claim.id, status: "sending", claimedAt: claim.claimedAt, attempts: claim.attempt },
      data: { status: "failed", claimedAt: null, sentAt: null, lastError: notificationErrorMessage(error) },
    });
    return updated.count === 1;
  }

  async recordNotification(listingId: string, searchId: string, analysisId: string): Promise<void> {
    const sentAt = new Date();
    await prisma.notification.upsert({
      where: { analysisId_channel: { analysisId, channel: "telegram" } },
      create: { listingId, searchId, analysisId, channel: "telegram", status: "sent", attempts: 1, sentAt },
      update: { status: "sent", attempts: { increment: 1 }, claimedAt: null, sentAt, lastError: null },
    });
  }

  async recentCrossMarketplaceCandidates(source: MarketplaceName, category: ListingCategory, listingId: string): Promise<Array<{ id: string; source: MarketplaceName; title: string; price: number | null; location: string | null }>> {
    const rows = await prisma.listing.findMany({
      where: { id: { not: listingId }, source: { not: source }, category, active: true, suppressedAt: null, lastSeenAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      select: { id: true, source: true, title: true, price: true, location: true },
      orderBy: { lastSeenAt: "desc" },
      take: 100,
    });
    return rows.map((row) => ({ ...row, source: row.source as MarketplaceName, price: row.price?.toNumber() ?? null }));
  }

  async saveCrossMatch(listingAId: string, listingBId: string, confidence: number, reasons: string[]): Promise<void> {
    const [a, b] = [listingAId, listingBId].sort();
    if (!a || !b || a === b) return;
    await prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ id: string; suppressedAt: Date | null }>>(Prisma.sql`
        SELECT "id", "suppressedAt"
        FROM "Listing"
        WHERE "id" IN (${a}, ${b})
        ORDER BY "id"
        FOR UPDATE
      `);
      if (rows.length !== 2 || rows.some((row) => row.suppressedAt !== null)) return;
      await transaction.crossMarketplaceMatch.upsert({
        where: { listingAId_listingBId: { listingAId: a, listingBId: b } },
        create: { listingAId: a, listingBId: b, confidence, reasons },
        update: { confidence, reasons },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  toDetails(listing: Listing): ListingDetails {
    return {
      source: listing.source as MarketplaceName,
      externalId: listing.externalId,
      title: listing.title,
      price: listing.price?.toNumber() ?? null,
      currency: listing.currency,
      location: listing.location,
      url: listing.url,
      imageUrl: listing.imageUrl,
      description: listing.description,
      sellerName: listing.sellerName,
      images: listing.images,
      attributes: toRecord(listing.attributes),
      publishedAt: listing.publishedAt,
      rawData: listing.rawData,
    };
  }

  private async findExisting(transaction: Prisma.TransactionClient, source: MarketplaceName, externalId: string | null, normalizedUrl: string): Promise<Listing | null> {
    if (externalId) {
      const byId = await transaction.listing.findUnique({ where: { source_externalId: { source, externalId } } });
      if (byId) return byId;
      return transaction.listing.findFirst({ where: { source, normalizedUrl, externalId: null } });
    }
    return transaction.listing.findFirst({ where: { source, normalizedUrl, externalId: null } });
  }

  private async lockListing(transaction: Prisma.TransactionClient, id: string): Promise<Listing | null> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "Listing" WHERE "id" = ${id} FOR UPDATE
    `);
    if (!rows.length) return null;
    return transaction.listing.findUnique({ where: { id } });
  }
}

export type SearchRecord = Search;
