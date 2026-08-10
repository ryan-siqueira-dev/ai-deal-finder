import type { ListingAnalysis, Search } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { CategoryAnalyzer } from "../categories/analyzer.js";
import { detectCategory } from "../categories/detector.js";
import { CategoryAnalyzerRegistry } from "../categories/registry.js";
import { listingCategorySchema, type ListingCategory, type StructuredListing } from "../categories/types.js";
import { validateCategoryData } from "../categories/validation.js";
import type { DealAnalysis, ExtractedListingData, LLMProvider } from "../llm/types.js";
import {
  ListingRepository,
  listingFenceFor,
  type ComparableRecord,
  type ListingFence,
} from "../listings/repository.js";
import { deduplicateListings } from "../listings/deduplication.js";
import { MarketAnalysisService } from "../market-analysis/service.js";
import type { MarketStatistics } from "../market-analysis/statistics.js";
import { findCrossMarketplaceMatch } from "../matching/cross-marketplace.js";
import { MarketplaceRegistry } from "../marketplaces/registry.js";
import {
  listingSummarySchema,
  listingDetailsSchema,
  isMarketplaceUrl,
  marketplaceNameSchema,
  marketplaceSearchCriteriaSchema,
  type ListingDetails,
  type ListingSummary,
  type MarketplaceName,
} from "../marketplaces/types.js";
import { formatDealNotification, TelegramNotifier } from "../notifications/telegram.js";
import { applyDeterministicFilters } from "../scoring/filters.js";
import { calculateDeterministicScore, combineScores, verdictForScore } from "../scoring/hybrid.js";
import { mapWithConcurrency } from "../utils/collections.js";
import { listingContentHash, sha256, stableStringify } from "../utils/hash.js";
import { prisma } from "../db/client.js";

export interface SearchRunnerOptions {
  detailConcurrency: number;
  defaultLimit: number;
  comparableMaxAgeDays: number;
}

interface PreparedListing {
  listingId: string;
  listingFence: ListingFence;
  source: MarketplaceName;
  category: ListingCategory;
  details: ListingDetails;
  analyzer: CategoryAnalyzer;
  deterministic: StructuredListing;
  enriched: StructuredListing;
  extractionModel: string | null;
}

const ANALYSIS_PIPELINE_VERSION = 2;
const SEARCH_RUN_LEASE_MS = 30 * 60_000;
const SEARCH_RUN_HEARTBEAT_MS = 60_000;
const LLM_RETRY_BACKOFF_MS = 60 * 60_000;

interface AnalysisPipelineIdentity {
  pipelineVersion: number;
  extractionModel: string | null;
  analysisModel: string | null;
}

function searchCriteriaSnapshot(search: Search): Record<string, unknown> {
  return {
    query: search.query,
    category: search.category,
    minPrice: search.minPrice?.toNumber() ?? null,
    maxPrice: search.maxPrice?.toNumber() ?? null,
    minYear: search.minYear,
    maxYear: search.maxYear,
    location: search.location,
    radiusKm: search.radiusKm,
    minimumScore: search.minimumScore,
    providers: [...search.providers].sort(),
    forbiddenWords: [...search.forbiddenWords].sort(),
  };
}

export function validateProviderDetails(summary: ListingSummary, value: unknown): ListingDetails {
  const parsed = listingDetailsSchema.safeParse(value);
  if (!parsed.success
    || parsed.data.source !== summary.source
    || (summary.externalId !== null && parsed.data.externalId !== summary.externalId)
    || !isMarketplaceUrl(summary.source, parsed.data.url)) {
    throw new Error("provider_listing_details_invalid");
  }
  return parsed.data;
}

export function analysisInputHash(
  search: Search,
  details: ListingDetails,
  deterministic: StructuredListing,
  enriched: StructuredListing,
  market: MarketStatistics,
  priceHistory: Array<{ price: number; observedAt: Date }>,
  pipeline: AnalysisPipelineIdentity,
): string {
  return sha256(stableStringify({
    listing: {
      contentHash: listingContentHash(details),
      currency: details.currency,
      location: details.location,
      source: details.source,
    },
    deterministic,
    enriched,
    market,
    priceHistory,
    pipeline,
    search: searchCriteriaSnapshot(search),
  }));
}

export class SearchRunner {
  readonly #marketAnalysis = new MarketAnalysisService();
  #stopRequested = false;

  public constructor(
    private readonly marketplaces: MarketplaceRegistry,
    private readonly analyzers: CategoryAnalyzerRegistry,
    private readonly listings: ListingRepository,
    private readonly llm: LLMProvider | null,
    private readonly telegram: TelegramNotifier | null,
    private readonly logger: Logger,
    private readonly options: SearchRunnerOptions,
  ) {}

  requestStop(): void {
    this.#stopRequested = true;
  }

  async run(search: Search): Promise<void> {
    if (this.#stopRequested) {
      this.logger.info({ event: "search_skipped_shutdown", searchId: search.id }, "Search skipped because shutdown has started");
      return;
    }
    const leaseId = randomUUID();
    if (!await this.acquireRunLease(search, leaseId)) {
      this.logger.info({ event: "search_skipped_leased", searchId: search.id }, "Search is already running or the scheduler snapshot is stale");
      return;
    }
    const startedAt = Date.now();
    const heartbeat = this.startRunLeaseHeartbeat(search.id, leaseId);
    this.logger.info({ event: "search_started", searchId: search.id, query: search.query }, "Search started");
    let discovered = 0;
    let analyzed = 0;
    let completed = false;
    try {
      const collected: ListingSummary[] = [];
      const searchCriteria = marketplaceSearchCriteriaSchema.parse({
        query: search.query,
        minPrice: search.minPrice?.toNumber() ?? null,
        maxPrice: search.maxPrice?.toNumber() ?? null,
        minYear: search.minYear,
        maxYear: search.maxYear,
        location: search.location,
        radiusKm: search.radiusKm,
        limit: this.options.defaultLimit,
      });

      for (const providerValue of search.providers) {
        if (this.#stopRequested) break;
        const parsedProvider = marketplaceNameSchema.safeParse(providerValue);
        if (!parsedProvider.success || !this.marketplaces.has(parsedProvider.data)) {
          this.logger.warn({ event: "provider_skipped", provider: providerValue, searchId: search.id }, "Provider is unknown or disabled");
          continue;
        }
        const provider = this.marketplaces.get(parsedProvider.data);
        await this.renewRunLease(search.id, leaseId);
        this.logger.info({ event: "provider_search_started", provider: provider.name, searchId: search.id }, "Provider search started");
        try {
          const rawSummaries = await provider.search(searchCriteria);
          await this.renewRunLease(search.id, leaseId);
          const validSummaries: ListingSummary[] = [];
          for (const [index, rawSummary] of rawSummaries.entries()) {
            const parsed = listingSummarySchema.safeParse(rawSummary);
            if (!parsed.success || parsed.data.source !== provider.name || !isMarketplaceUrl(provider.name, parsed.data.url)) {
              this.logger.warn({
                event: "provider_listing_invalid",
                provider: provider.name,
                searchId: search.id,
                index,
                issues: parsed.success ? [parsed.data.source !== provider.name ? "source_mismatch" : "untrusted_marketplace_url"] : parsed.error.issues,
              }, "Provider returned an invalid listing");
              continue;
            }
            validSummaries.push(parsed.data);
          }
          const summaries = deduplicateListings(validSummaries);
          collected.push(...summaries);
          discovered += summaries.length;
          this.logger.info({ event: "provider_search_completed", provider: provider.name, searchId: search.id, listings: summaries.length }, "Provider search completed");
        } catch (error) {
          this.logger.error({ event: "provider_search_failed", provider: provider.name, searchId: search.id, err: error }, "Provider search failed");
        }
      }

      const summaries = deduplicateListings(collected);
      const prepared = (await mapWithConcurrency(summaries, this.options.detailConcurrency, (summary, index) =>
        this.prepareListingSafely(search, summary, index, leaseId))).filter((item): item is PreparedListing => item !== null);

      const results = await mapWithConcurrency(prepared, this.options.detailConcurrency, (item, index) =>
        this.analyzeListingSafely(search, item, index, leaseId));
      analyzed = results.filter(Boolean).length;
      completed = true;
    } finally {
      await heartbeat.stop();
      await this.releaseRunLease(search.id, leaseId, completed && !this.#stopRequested);
    }
    this.logger.info({ event: "search_completed", searchId: search.id, discovered, analyzed, durationMs: Date.now() - startedAt }, "Search completed");
  }

  private async prepareListingSafely(search: Search, summary: ListingSummary, index: number, leaseId: string): Promise<PreparedListing | null> {
    if (this.#stopRequested) return null;
    try {
      await this.renewRunLease(search.id, leaseId);
      return await this.prepareListing(search, summary, leaseId);
    }
    catch (error) {
      this.logger.error({
        event: "listing_preparation_failed",
        searchId: search.id,
        provider: summary.source,
        externalId: summary.externalId,
        index,
        err: error,
      }, "Listing preparation failed; remaining listings will continue");
      return null;
    }
  }

  private async prepareListing(search: Search, summary: ListingSummary, leaseId: string): Promise<PreparedListing | null> {
    const configuredCategory = listingCategorySchema.parse(search.category);
    const saved = await this.listings.upsertSummary(search.id, configuredCategory, summary);
    if (saved.suppressed) {
      this.logger.debug({ event: "listing_suppressed", listingId: saved.listing.id, source: summary.source }, "Suppressed listing was ignored");
      return null;
    }
    this.logger.debug({ event: saved.isNew ? "listing_discovered" : "listing_updated", listingId: saved.listing.id, source: summary.source }, "Listing persisted");
    let details = this.listings.toDetails(saved.listing);
    let currentFence = listingFenceFor(saved.listing);
    let contentChanged = saved.contentChanged;
    if (saved.needsDetails) {
      let fetchedDetails: ListingDetails | null = null;
      try {
        fetchedDetails = validateProviderDetails(summary, await this.marketplaces.get(summary.source).getListingDetails(summary));
      } catch (error) {
        const checked = await this.listings.markDetailsChecked(saved.listing.id, currentFence);
        this.logger.warn({ event: "listing_details_failed", listingId: saved.listing.id, source: summary.source, err: error }, "Listing details unavailable; summary retained");
        if (!checked) return null;
        currentFence = listingFenceFor(checked);
      }
      if (fetchedDetails) {
        const detected = detectCategory(fetchedDetails, configuredCategory);
        const updated = await this.listings.updateDetails(saved.listing.id, detected, fetchedDetails, currentFence);
        if (!updated) return null;
        details = fetchedDetails;
        currentFence = listingFenceFor(updated.listing);
        contentChanged ||= updated.contentChanged;
        this.logger.debug({ event: "listing_details_fetched", listingId: saved.listing.id, source: summary.source }, "Listing details fetched");
      }
    }
    if (this.#stopRequested) return null;

    const category = detectCategory(details, configuredCategory);
    const analyzer = this.analyzers.get(category);
    this.logger.debug({ event: "listing_extraction_started", listingId: saved.listing.id, category }, "Listing extraction started");
    const deterministic = await analyzer.extract(details);
    const stored = await this.listings.getStructured(saved.listing.id);
    let enriched = deterministic;
    const storedMatchesContent = Boolean(stored?.enriched.category === category && !contentChanged);
    let extractionModel = storedMatchesContent ? stored?.extractionModel ?? null : null;
    let extractionAttemptModel = stored?.extractionAttemptModel ?? null;
    let extractionAttemptedAt = stored?.extractionAttemptedAt ?? null;
    const failedRecently = Boolean(
      this.llm
      && stored
      && stored.extractionModel !== this.llm.extractionModel
      && stored.extractionAttemptModel === this.llm.extractionModel
      && stored.extractionAttemptedAt
      && Date.now() - stored.extractionAttemptedAt.getTime() < LLM_RETRY_BACKOFF_MS,
    );
    const shouldAttemptExtraction = Boolean(this.llm
      && (saved.isNew || contentChanged || stored?.enriched.category !== category || stored?.extractionModel !== this.llm.extractionModel)
      && (!failedRecently || saved.isNew || contentChanged));
    if (this.llm && shouldAttemptExtraction) {
      extractionAttemptModel = this.llm.extractionModel;
      extractionAttemptedAt = new Date();
      const extraction = await this.enrichWithLlm(details, deterministic);
      if (extraction.succeeded) {
        enriched = extraction.structured;
        extractionModel = this.llm.extractionModel;
      } else if (storedMatchesContent && stored) {
        enriched = this.mergeSupplementalExtraction(deterministic, {
          data: stored.enriched.data,
          confidence: stored.enriched.extractionConfidence,
        });
      }
    } else if (storedMatchesContent && stored) {
      enriched = this.mergeSupplementalExtraction(deterministic, {
        data: stored.enriched.data,
        confidence: stored.enriched.extractionConfidence,
      });
    }
    await this.renewRunLease(search.id, leaseId);
    const structuredListing = await this.listings.saveStructured(
      saved.listing.id,
      enriched,
      deterministic,
      extractionModel,
      extractionAttemptModel,
      extractionAttemptedAt,
      listingContentHash(details),
      currentFence,
    );
    if (!structuredListing) return null;
    currentFence = listingFenceFor(structuredListing);
    this.logger.debug({ event: "listing_extraction_completed", listingId: saved.listing.id, category }, "Listing extraction completed");
    return { listingId: saved.listing.id, listingFence: currentFence, source: summary.source, category, details, analyzer, deterministic, enriched, extractionModel };
  }

  private async analyzeListingSafely(search: Search, prepared: PreparedListing, index: number, leaseId: string): Promise<boolean> {
    if (this.#stopRequested) return false;
    try {
      await this.renewRunLease(search.id, leaseId);
      return await this.analyzeListing(search, prepared, leaseId);
    }
    catch (error) {
      this.logger.error({
        event: "listing_analysis_failed",
        searchId: search.id,
        listingId: prepared.listingId,
        provider: prepared.source,
        index,
        err: error,
      }, "Listing analysis failed; remaining listings will continue");
      return false;
    }
  }

  private async analyzeListing(search: Search, prepared: PreparedListing, leaseId: string): Promise<boolean> {
    const seenAfter = new Date(Date.now() - this.options.comparableMaxAgeDays * 24 * 60 * 60 * 1000);
    const candidates = (await this.listings.findComparables(
      prepared.category,
      prepared.listingId,
      seenAfter,
      prepared.details.currency,
    ))
      .filter((candidate) => candidate.structured.data["condition"] !== "damaged")
      .filter((candidate) => prepared.analyzer.isComparable(prepared.deterministic, candidate.structured));
    const withoutCurrentCrossPosts = await this.excludeCurrentCrossPosts(prepared, candidates);
    const comparable = await this.collapseProbableCrossPosts(withoutCurrentCrossPosts);
    const market = this.#marketAnalysis.calculate(comparable.map(({ id, source, price }) => ({ id, source, price })));
    this.logger.debug({ event: "market_reference_calculated", listingId: prepared.listingId, sampleSize: market.combined.sampleSize, confidence: market.combined.confidence }, "Market reference calculated");

    await this.matchCurrentListing(prepared.listingId, prepared.category, prepared.details);
    const priceHistory = await this.listings.getPriceHistory(prepared.listingId);
    const inputHash = analysisInputHash(
      search,
      prepared.details,
      prepared.deterministic,
      prepared.enriched,
      market,
      priceHistory,
      {
        pipelineVersion: ANALYSIS_PIPELINE_VERSION,
        extractionModel: prepared.extractionModel,
        analysisModel: this.llm?.analysisModel ?? null,
      },
    );
    const filter = applyDeterministicFilters({
      listing: prepared.details,
      structured: prepared.deterministic,
      criteria: {
        category: listingCategorySchema.parse(search.category),
        query: search.query,
        minPrice: search.minPrice?.toNumber() ?? null,
        maxPrice: search.maxPrice?.toNumber() ?? null,
        minYear: search.minYear,
        maxYear: search.maxYear,
        location: search.location,
        radiusKm: search.radiusKm,
        forbiddenWords: search.forbiddenWords,
      },
      alreadyAnalyzed: false,
      duplicate: false,
    });
    if (!filter.passed) return false;

    const categoryAnalysis = await prepared.analyzer.analyze({
      listing: prepared.details,
      structured: prepared.deterministic,
      comparableListings: comparable.map((item) => item.structured),
      marketMedianPrice: market.combined.medianPrice,
      source: prepared.source,
    });
    const deterministicScore = calculateDeterministicScore(prepared.details, market, categoryAnalysis, search.maxPrice?.toNumber() ?? null);
    const qualifiesForLlm = deterministicScore.score >= Math.max(40, search.minimumScore - 10) && market.combined.sampleSize >= 2;
    this.logger.debug({ event: "deal_candidate_selected", listingId: prepared.listingId, deterministicScore: deterministicScore.score, qualifiesForLlm }, "Candidate scored");
    const existing = await this.listings.findAnalysis(prepared.listingId, search.id, inputHash);
    const retryFailedLlm = Boolean(
      existing
      && this.llm
      && qualifiesForLlm
      && existing.analysisModel === null
      && Date.now() - (existing.llmAttemptedAt ?? existing.createdAt).getTime() >= LLM_RETRY_BACKOFF_MS,
    );
    if (existing && !retryFailedLlm) {
      await this.renewRunLease(search.id, leaseId);
      await this.notifyIfNeeded(search, prepared.details, prepared.listingFence, existing.id, this.dealAnalysisFromRecord(existing), market, existing.priceDifferencePercent?.toNumber() ?? null);
      return false;
    }

    let analysis = this.fallbackAnalysis(deterministicScore.score, categoryAnalysis.advantages, categoryAnalysis.risks);
    let analysisModel: string | null = null;
    let llmAttempted = false;
    if (this.llm && qualifiesForLlm) {
      llmAttempted = true;
      try {
        this.logger.info({ event: "llm_analysis_started", listingId: prepared.listingId }, "LLM deal analysis started");
        const llmResult = await this.llm.analyzeDeal({
          listing: prepared.details,
          structured: prepared.enriched,
          marketplace: prepared.source,
          market,
          priceHistory,
          deterministicScore: deterministicScore.score,
          searchCriteria: searchCriteriaSnapshot(search),
        });
        analysis = {
          ...llmResult,
          advantages: [...new Set([...categoryAnalysis.advantages, ...llmResult.advantages])].slice(0, 10),
          risks: [...new Set([...categoryAnalysis.risks, ...llmResult.risks])].slice(0, 10),
        };
        analysisModel = this.llm.analysisModel;
        this.logger.info({ event: "llm_analysis_completed", listingId: prepared.listingId }, "LLM deal analysis completed");
      } catch (error) {
        this.logger.error({ event: "llm_analysis_failed", listingId: prepared.listingId, err: error }, "LLM deal analysis failed; deterministic fallback used");
      }
    }
    const finalScore = this.llm && qualifiesForLlm && analysisModel ? combineScores(deterministicScore.score, analysis.score) : deterministicScore.score;
    analysis = { ...analysis, score: finalScore, verdict: verdictForScore(finalScore) };
    await this.renewRunLease(search.id, leaseId);
    const persistedAnalysis = await this.listings.createAnalysis({
      listingId: prepared.listingId,
      listingFence: prepared.listingFence,
      searchId: search.id,
      finalScore,
      deterministic: deterministicScore,
      analysis,
      market,
      analysisModel,
      llmAttempted,
      inputHash,
    });
    if (!persistedAnalysis) return false;
    await this.renewRunLease(search.id, leaseId);
    await this.notifyIfNeeded(
      search,
      prepared.details,
      prepared.listingFence,
      persistedAnalysis.id,
      this.dealAnalysisFromRecord(persistedAnalysis),
      market,
      persistedAnalysis.priceDifferencePercent?.toNumber() ?? null,
    );
    return true;
  }

  private async notifyIfNeeded(
    search: Search,
    details: ListingDetails,
    listingFence: ListingFence,
    analysisId: string,
    analysis: DealAnalysis,
    market: MarketStatistics,
    differencePercent: number | null,
  ): Promise<void> {
    if (this.#stopRequested || !this.telegram || analysis.score < search.minimumScore) return;
    const claim = await this.listings.claimNotification({ analysisId, channel: "telegram", listingFence });
    if (!claim) return;
    try {
      await this.telegram.send(formatDealNotification(details, analysis.score, analysis, market, differencePercent));
      if (!await this.listings.markNotificationSent(claim)) {
        throw new Error("notification_claim_lost_after_send");
      }
    } catch (error) {
      await this.listings.markNotificationFailed(claim, error).catch((markError: unknown) => {
        this.logger.error({ event: "notification_failure_state_failed", analysisId, err: markError }, "Could not persist notification failure state");
      });
      throw error;
    }
    this.logger.info({ event: "notification_sent", analysisId, searchId: search.id }, "Telegram notification sent");
  }

  private dealAnalysisFromRecord(record: ListingAnalysis): DealAnalysis {
    return {
      score: record.score,
      verdict: verdictForScore(record.score),
      advantages: record.advantages,
      risks: record.risks,
      reason: record.reason,
    };
  }

  private async enrichWithLlm(
    details: ListingDetails,
    deterministic: StructuredListing,
  ): Promise<{ structured: StructuredListing; succeeded: boolean }> {
    if (!this.llm) return { structured: deterministic, succeeded: false };
    try {
      const extracted = await this.llm.extractListingData({ listing: details, category: deterministic.category, deterministicExtraction: deterministic });
      const structured = this.mergeSupplementalExtraction(deterministic, extracted);
      return { structured, succeeded: structured !== deterministic };
    } catch (error) {
      this.logger.warn({ event: "llm_extraction_failed", source: details.source, externalId: details.externalId, err: error }, "LLM extraction failed; deterministic extraction retained");
      return { structured: deterministic, succeeded: false };
    }
  }

  private mergeSupplementalExtraction(deterministic: StructuredListing, supplemental: ExtractedListingData): StructuredListing {
    const merged: Record<string, unknown> = { ...deterministic.data };
    for (const [key, proposed] of Object.entries(supplemental.data)) {
      const current = merged[key];
      if (current === null || current === undefined || current === "unknown") merged[key] = proposed;
      else if (Array.isArray(current) && Array.isArray(proposed)) merged[key] = [...new Set([...current, ...proposed])];
    }
    const validated = validateCategoryData(deterministic.category, merged);
    return validated
      ? { category: deterministic.category, data: validated, extractionConfidence: Math.max(deterministic.extractionConfidence, supplemental.confidence) }
      : deterministic;
  }

  private async collapseProbableCrossPosts(records: ComparableRecord[]): Promise<ComparableRecord[]> {
    const excluded = new Set<string>();
    for (let left = 0; left < records.length; left += 1) {
      const a = records[left];
      if (!a || excluded.has(a.id)) continue;
      for (let right = left + 1; right < records.length; right += 1) {
        const b = records[right];
        if (!b || excluded.has(b.id)) continue;
        const match = findCrossMarketplaceMatch(a, b);
        if (match) {
          excluded.add(b.id);
          await this.listings.saveCrossMatch(match.listingAId, match.listingBId, match.confidence, match.reasons);
        }
      }
    }
    return records.filter((record) => !excluded.has(record.id));
  }

  private async excludeCurrentCrossPosts(prepared: PreparedListing, records: ComparableRecord[]): Promise<ComparableRecord[]> {
    const current = {
      id: prepared.listingId,
      source: prepared.source,
      title: prepared.details.title,
      price: prepared.details.price,
      location: prepared.details.location,
    };
    const retained: ComparableRecord[] = [];
    for (const candidate of records) {
      const match = findCrossMarketplaceMatch(current, candidate);
      if (!match) {
        retained.push(candidate);
        continue;
      }
      await this.listings.saveCrossMatch(match.listingAId, match.listingBId, match.confidence, match.reasons);
    }
    return retained;
  }

  private async matchCurrentListing(listingId: string, category: ListingCategory, details: ListingDetails): Promise<void> {
    for (const candidate of await this.listings.recentCrossMarketplaceCandidates(details.source, category, listingId)) {
      const match = findCrossMarketplaceMatch({ id: listingId, source: details.source, title: details.title, price: details.price, location: details.location }, candidate);
      if (match) await this.listings.saveCrossMatch(match.listingAId, match.listingBId, match.confidence, match.reasons);
    }
  }

  private fallbackAnalysis(score: number, advantages: string[], risks: string[]): DealAnalysis {
    return { score, verdict: verdictForScore(score), advantages, risks, reason: "Score calculado por regras determinísticas; análise LLM não executada." };
  }

  private async acquireRunLease(search: Search, leaseId: string): Promise<boolean> {
    const now = new Date();
    const claimed = await prisma.search.updateMany({
      where: {
        id: search.id,
        active: true,
        lastRunAt: search.lastRunAt,
        OR: [
          { runLeaseId: null, runLeaseExpiresAt: null },
          { runLeaseExpiresAt: { lte: now } },
        ],
      },
      data: { runLeaseId: leaseId, runLeaseExpiresAt: new Date(now.getTime() + SEARCH_RUN_LEASE_MS) },
    });
    return claimed.count === 1;
  }

  private startRunLeaseHeartbeat(searchId: string, leaseId: string): { stop(): Promise<void> } {
    let stopped = false;
    let inFlight = Promise.resolve();
    const timer = setInterval(() => {
      if (stopped) return;
      inFlight = inFlight
        .then(() => this.renewRunLease(searchId, leaseId))
        .catch((error: unknown) => {
          this.logger.error({ event: "search_run_lease_heartbeat_failed", searchId, err: error }, "Search run lease heartbeat failed");
        });
    }, SEARCH_RUN_HEARTBEAT_MS);
    timer.unref();
    return {
      stop: async (): Promise<void> => {
        stopped = true;
        clearInterval(timer);
        await inFlight;
      },
    };
  }

  private async renewRunLease(searchId: string, leaseId: string): Promise<void> {
    const renewed = await prisma.search.updateMany({
      where: { id: searchId, runLeaseId: leaseId },
      data: { runLeaseExpiresAt: new Date(Date.now() + SEARCH_RUN_LEASE_MS) },
    });
    if (renewed.count !== 1) throw new Error("search_run_lease_lost");
  }

  private async releaseRunLease(searchId: string, leaseId: string, completed: boolean): Promise<void> {
    const released = await prisma.search.updateMany({
      where: { id: searchId, runLeaseId: leaseId },
      data: {
        runLeaseId: null,
        runLeaseExpiresAt: null,
        ...(completed ? { lastRunAt: new Date() } : {}),
      },
    });
    if (released.count !== 1) this.logger.warn({ event: "search_run_lease_release_missed", searchId }, "Search run lease was no longer owned during release");
  }
}
