import { Prisma, type Listing, type Search } from "@prisma/client";
import type { ListingCategory, StructuredListing } from "../categories/types.js";
import type { DealAnalysis } from "../llm/types.js";
import type { ListingDetails, ListingSummary, MarketplaceName } from "../marketplaces/types.js";
import type { MarketStatistics } from "../market-analysis/statistics.js";
import type { DeterministicScoreResult } from "../scoring/hybrid.js";
import { listingContentHash, listingFingerprint } from "../utils/hash.js";
import { normalizeUrl } from "../utils/normalization.js";
import { prisma } from "../db/client.js";

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export interface UpsertSummaryResult { listing: Listing; isNew: boolean; priceChanged: boolean; needsDetails: boolean }
export interface ComparableRecord { id: string; source: MarketplaceName; title: string; location: string | null; price: number; structured: StructuredListing }

export class ListingRepository {
  async upsertSummary(searchId: string, category: ListingCategory, summary: ListingSummary): Promise<UpsertSummaryResult> {
    const normalizedUrl = normalizeUrl(summary.url);
    const existing = await this.findExisting(summary.source, summary.externalId, normalizedUrl, listingFingerprint(summary));
    const priceChanged = existing?.price?.toNumber() !== summary.price && !(existing?.price === null && summary.price === null);
    let listing: Listing;
    if (existing) {
      listing = await prisma.listing.update({
        where: { id: existing.id },
        data: {
          externalId: existing.externalId ?? summary.externalId,
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
        },
      });
    } else {
      listing = await prisma.listing.create({
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
    }
    await prisma.searchListing.upsert({
      where: { searchId_listingId: { searchId, listingId: listing.id } },
      create: { searchId, listingId: listing.id },
      update: { lastMatchedAt: new Date() },
    });
    if (summary.price !== null && (!existing || priceChanged)) {
      await prisma.listingPriceHistory.create({ data: { listingId: listing.id, price: summary.price } });
    }
    const refreshBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return { listing, isNew: !existing, priceChanged, needsDetails: !existing?.description || existing.lastCheckedAt < refreshBefore || priceChanged };
  }

  async updateDetails(id: string, category: ListingCategory, details: ListingDetails): Promise<{ listing: Listing; contentChanged: boolean }> {
    const existing = await prisma.listing.findUniqueOrThrow({ where: { id } });
    const contentHash = listingContentHash(details);
    const listing = await prisma.listing.update({
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
        ...(details.rawData === undefined ? {} : { rawData: toJson(details.rawData) }),
        contentHash,
        lastCheckedAt: new Date(),
        lastSeenAt: new Date(),
      },
    });
    if (details.price !== null && existing.price?.toNumber() !== details.price) {
      await prisma.listingPriceHistory.create({ data: { listingId: id, price: details.price } });
    }
    return { listing, contentChanged: existing.contentHash !== contentHash };
  }

  async saveStructured(id: string, structured: StructuredListing): Promise<void> {
    await prisma.structuredListingData.upsert({
      where: { listingId: id },
      create: { listingId: id, category: structured.category, data: toJson({ ...structured.data, extractionConfidence: structured.extractionConfidence }) },
      update: { category: structured.category, data: toJson({ ...structured.data, extractionConfidence: structured.extractionConfidence }), schemaVersion: 1, extractedAt: new Date() },
    });
  }

  async findComparables(category: ListingCategory, excludeId: string, limit = 250): Promise<ComparableRecord[]> {
    const rows = await prisma.listing.findMany({
      where: { id: { not: excludeId }, category, active: true, price: { not: null }, structuredData: { isNot: null } },
      select: { id: true, source: true, title: true, location: true, price: true, structuredData: { select: { category: true, data: true } } },
      orderBy: { lastSeenAt: "desc" },
      take: limit,
    });
    return rows.flatMap((row) => {
      if (!row.price || !row.structuredData) return [];
      const data = toRecord(row.structuredData.data);
      const confidence = typeof data["extractionConfidence"] === "number" ? data["extractionConfidence"] : 0.5;
      delete data["extractionConfidence"];
      return [{ id: row.id, source: row.source as MarketplaceName, title: row.title, location: row.location, price: row.price.toNumber(), structured: { category: row.structuredData.category as ListingCategory, data, extractionConfidence: confidence } }];
    });
  }

  async getPriceHistory(id: string): Promise<Array<{ price: number; observedAt: Date }>> {
    const rows = await prisma.listingPriceHistory.findMany({ where: { listingId: id }, orderBy: { observedAt: "asc" } });
    return rows.map((row) => ({ price: row.price.toNumber(), observedAt: row.observedAt }));
  }

  async analysisExists(listingId: string, searchId: string, inputHash: string): Promise<boolean> {
    return Boolean(await prisma.listingAnalysis.findFirst({ where: { listingId, searchId, inputHash }, select: { id: true } }));
  }

  async createAnalysis(input: {
    listingId: string;
    searchId: string;
    finalScore: number;
    deterministic: DeterministicScoreResult;
    analysis: DealAnalysis;
    market: MarketStatistics;
    analysisModel: string | null;
    inputHash: string;
  }): Promise<string> {
    const created = await prisma.listingAnalysis.create({ data: {
      listingId: input.listingId,
      searchId: input.searchId,
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
      inputHash: input.inputHash,
    } });
    return created.id;
  }

  async recordNotification(listingId: string, searchId: string, analysisId: string): Promise<void> {
    await prisma.notification.create({ data: { listingId, searchId, analysisId, channel: "telegram" } });
  }

  async recentCrossMarketplaceCandidates(source: MarketplaceName, listingId: string): Promise<Array<{ id: string; source: MarketplaceName; title: string; price: number | null; location: string | null }>> {
    const rows = await prisma.listing.findMany({
      where: { id: { not: listingId }, source: { not: source }, active: true, lastSeenAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      select: { id: true, source: true, title: true, price: true, location: true }, take: 100,
    });
    return rows.map((row) => ({ ...row, source: row.source as MarketplaceName, price: row.price?.toNumber() ?? null }));
  }

  async saveCrossMatch(listingAId: string, listingBId: string, confidence: number, reasons: string[]): Promise<void> {
    const [a, b] = [listingAId, listingBId].sort();
    if (!a || !b) return;
    await prisma.crossMarketplaceMatch.upsert({
      where: { listingAId_listingBId: { listingAId: a, listingBId: b } },
      create: { listingAId: a, listingBId: b, confidence, reasons },
      update: { confidence, reasons },
    });
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

  private async findExisting(source: MarketplaceName, externalId: string | null, normalizedUrl: string, fingerprint: string): Promise<Listing | null> {
    if (externalId) {
      const byId = await prisma.listing.findUnique({ where: { source_externalId: { source, externalId } } });
      if (byId) return byId;
    }
    const byUrl = await prisma.listing.findUnique({ where: { source_normalizedUrl: { source, normalizedUrl } } });
    if (byUrl) return byUrl;
    return prisma.listing.findFirst({ where: { source, fingerprint }, orderBy: { lastSeenAt: "desc" } });
  }
}

export type SearchRecord = Search;
