import type { Search } from "@prisma/client";
import type { Logger } from "pino";
import type { CategoryAnalyzer } from "../categories/analyzer.js";
import { detectCategory } from "../categories/detector.js";
import { CategoryAnalyzerRegistry } from "../categories/registry.js";
import { listingCategorySchema, type ListingCategory, type StructuredListing } from "../categories/types.js";
import { validateCategoryData } from "../categories/validation.js";
import type { LLMProvider, DealAnalysis } from "../llm/types.js";
import { MarketAnalysisService } from "../market-analysis/service.js";
import { findCrossMarketplaceMatch } from "../matching/cross-marketplace.js";
import { MarketplaceRegistry } from "../marketplaces/registry.js";
import { marketplaceNameSchema, type ListingDetails, type ListingSummary, type MarketplaceName } from "../marketplaces/types.js";
import { formatDealNotification, TelegramNotifier } from "../notifications/telegram.js";
import { calculateDeterministicScore, combineScores, verdictForScore } from "../scoring/hybrid.js";
import { applyDeterministicFilters } from "../scoring/filters.js";
import { mapWithConcurrency } from "../utils/collections.js";
import { listingContentHash, sha256 } from "../utils/hash.js";
import { ListingRepository, type ComparableRecord } from "../listings/repository.js";
import { prisma } from "../db/client.js";

export interface SearchRunnerOptions {
  detailConcurrency: number;
  defaultLimit: number;
}

export class SearchRunner {
  readonly #marketAnalysis = new MarketAnalysisService();

  public constructor(
    private readonly marketplaces: MarketplaceRegistry,
    private readonly analyzers: CategoryAnalyzerRegistry,
    private readonly listings: ListingRepository,
    private readonly llm: LLMProvider | null,
    private readonly telegram: TelegramNotifier | null,
    private readonly logger: Logger,
    private readonly options: SearchRunnerOptions,
  ) {}

  async run(search: Search): Promise<void> {
    const startedAt = Date.now();
    this.logger.info({ event: "search_started", searchId: search.id, query: search.query }, "Search started");
    let discovered = 0;
    let analyzed = 0;
    for (const providerValue of search.providers) {
      const parsedProvider = marketplaceNameSchema.safeParse(providerValue);
      if (!parsedProvider.success) {
        this.logger.warn({ event: "provider_search_failed", provider: providerValue, searchId: search.id }, "Unknown provider configured");
        continue;
      }
      const provider = this.marketplaces.get(parsedProvider.data);
      this.logger.info({ event: "provider_search_started", provider: provider.name, searchId: search.id }, "Provider search started");
      try {
        const summaries = await provider.search({
          query: search.query,
          minPrice: search.minPrice?.toNumber() ?? null,
          maxPrice: search.maxPrice?.toNumber() ?? null,
          minYear: search.minYear,
          maxYear: search.maxYear,
          location: search.location,
          radiusKm: search.radiusKm,
          limit: this.options.defaultLimit,
        });
        discovered += summaries.length;
        const results = await mapWithConcurrency(summaries, this.options.detailConcurrency, (summary) => this.processListing(search, provider.name, summary));
        analyzed += results.filter(Boolean).length;
        this.logger.info({ event: "provider_search_completed", provider: provider.name, searchId: search.id, listings: summaries.length }, "Provider search completed");
      } catch (error) {
        this.logger.error({ event: "provider_search_failed", provider: provider.name, searchId: search.id, err: error }, "Provider search failed");
      }
    }
    await prisma.search.update({ where: { id: search.id }, data: { lastRunAt: new Date() } });
    this.logger.info({ event: "search_completed", searchId: search.id, discovered, analyzed, durationMs: Date.now() - startedAt }, "Search completed");
  }

  private async processListing(search: Search, source: MarketplaceName, summary: ListingSummary): Promise<boolean> {
    const configuredCategory = listingCategorySchema.parse(search.category);
    const saved = await this.listings.upsertSummary(search.id, configuredCategory, summary);
    this.logger.debug({ event: saved.isNew ? "listing_discovered" : "listing_updated", listingId: saved.listing.id, source }, "Listing persisted");
    let details = this.listings.toDetails(saved.listing);
    let contentChanged = saved.isNew || saved.priceChanged;
    if (saved.needsDetails) {
      try {
        details = await this.marketplaces.get(source).getListingDetails(summary);
        const detected = detectCategory(details, configuredCategory);
        const updated = await this.listings.updateDetails(saved.listing.id, detected, details);
        contentChanged ||= updated.contentChanged;
        this.logger.debug({ event: "listing_details_fetched", listingId: saved.listing.id, source }, "Listing details fetched");
      } catch (error) {
        this.logger.warn({ event: "listing_details_failed", listingId: saved.listing.id, source, err: error }, "Listing details unavailable; summary retained");
      }
    }

    const category = detectCategory(details, configuredCategory);
    const analyzer = this.analyzers.get(category);
    this.logger.debug({ event: "listing_extraction_started", listingId: saved.listing.id, category }, "Listing extraction started");
    let structured = await analyzer.extract(details);
    if (this.llm && (saved.isNew || contentChanged)) structured = await this.enrichWithLlm(details, structured);
    await this.listings.saveStructured(saved.listing.id, structured);
    this.logger.debug({ event: "listing_extraction_completed", listingId: saved.listing.id, category }, "Listing extraction completed");

    const candidates = (await this.listings.findComparables(category, saved.listing.id))
      .filter((candidate) => analyzer.isComparable(structured, candidate.structured));
    const comparable = await this.collapseProbableCrossPosts(candidates);
    const market = this.#marketAnalysis.calculate(comparable.map(({ id, source: candidateSource, price }) => ({ id, source: candidateSource, price })));
    this.logger.debug({ event: "market_reference_calculated", listingId: saved.listing.id, sampleSize: market.combined.sampleSize, confidence: market.combined.confidence }, "Market reference calculated");

    await this.matchCurrentListing(saved.listing.id, details);
    const inputHash = sha256(JSON.stringify({ content: listingContentHash(details), data: structured.data, market: market.combined, search: search.updatedAt }));
    const alreadyAnalyzed = await this.listings.analysisExists(saved.listing.id, search.id, inputHash);
    const filter = applyDeterministicFilters({
      listing: details,
      structured,
      criteria: {
        category: configuredCategory,
        query: search.query,
        minPrice: search.minPrice?.toNumber() ?? null,
        maxPrice: search.maxPrice?.toNumber() ?? null,
        minYear: search.minYear,
        maxYear: search.maxYear,
        location: search.location,
        radiusKm: search.radiusKm,
        forbiddenWords: search.forbiddenWords,
      },
      alreadyAnalyzed,
      duplicate: false,
    });
    if (!filter.passed) return false;

    const categoryAnalysis = await analyzer.analyze({ listing: details, structured, comparableListings: comparable.map((item) => item.structured), marketMedianPrice: market.combined.medianPrice, source });
    const deterministic = calculateDeterministicScore(details, market, categoryAnalysis, search.maxPrice?.toNumber() ?? null);
    const qualifiesForLlm = deterministic.score >= Math.max(40, search.minimumScore - 10) && market.combined.sampleSize >= 2;
    this.logger.debug({ event: "deal_candidate_selected", listingId: saved.listing.id, deterministicScore: deterministic.score, qualifiesForLlm }, "Candidate scored");
    const priceHistory = await this.listings.getPriceHistory(saved.listing.id);
    let analysis = this.fallbackAnalysis(deterministic.score, categoryAnalysis.advantages, categoryAnalysis.risks);
    let analysisModel: string | null = null;
    if (this.llm && qualifiesForLlm) {
      try {
        this.logger.info({ event: "llm_analysis_started", listingId: saved.listing.id }, "LLM deal analysis started");
        const llmResult = await this.llm.analyzeDeal({
          listing: details, structured, marketplace: source, market, priceHistory,
          deterministicScore: deterministic.score,
          searchCriteria: { query: search.query, category: search.category, minPrice: search.minPrice?.toNumber() ?? null, maxPrice: search.maxPrice?.toNumber() ?? null, location: search.location, radiusKm: search.radiusKm },
        });
        analysis = { ...llmResult, advantages: [...new Set([...categoryAnalysis.advantages, ...llmResult.advantages])], risks: [...new Set([...categoryAnalysis.risks, ...llmResult.risks])] };
        analysisModel = this.llm.analysisModel;
        this.logger.info({ event: "llm_analysis_completed", listingId: saved.listing.id }, "LLM deal analysis completed");
      } catch (error) {
        this.logger.error({ event: "llm_analysis_failed", listingId: saved.listing.id, err: error }, "LLM deal analysis failed; deterministic fallback used");
      }
    }
    const finalScore = this.llm && qualifiesForLlm && analysisModel ? combineScores(deterministic.score, analysis.score) : deterministic.score;
    analysis = { ...analysis, score: finalScore, verdict: verdictForScore(finalScore) };
    const analysisId = await this.listings.createAnalysis({ listingId: saved.listing.id, searchId: search.id, finalScore, deterministic, analysis, market, analysisModel, inputHash });
    if (this.telegram && finalScore >= search.minimumScore) {
      await this.telegram.send(formatDealNotification(details, finalScore, analysis, market, deterministic.differencePercent));
      await this.listings.recordNotification(saved.listing.id, search.id, analysisId);
      this.logger.info({ event: "notification_sent", listingId: saved.listing.id, searchId: search.id }, "Telegram notification sent");
    }
    return true;
  }

  private async enrichWithLlm(details: ListingDetails, deterministic: StructuredListing): Promise<StructuredListing> {
    if (!this.llm) return deterministic;
    try {
      const extracted = await this.llm.extractListingData({ listing: details, category: deterministic.category, deterministicExtraction: deterministic });
      const merged = validateCategoryData(deterministic.category, { ...deterministic.data, ...extracted.data });
      return merged ? { category: deterministic.category, data: merged, extractionConfidence: Math.max(deterministic.extractionConfidence, extracted.confidence) } : deterministic;
    } catch (error) {
      this.logger.warn({ event: "llm_extraction_failed", source: details.source, externalId: details.externalId, err: error }, "LLM extraction failed; deterministic extraction retained");
      return deterministic;
    }
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

  private async matchCurrentListing(listingId: string, details: ListingDetails): Promise<void> {
    for (const candidate of await this.listings.recentCrossMarketplaceCandidates(details.source, listingId)) {
      const match = findCrossMarketplaceMatch({ id: listingId, source: details.source, title: details.title, price: details.price, location: details.location }, candidate);
      if (match) await this.listings.saveCrossMatch(match.listingAId, match.listingBId, match.confidence, match.reasons);
    }
  }

  private fallbackAnalysis(score: number, advantages: string[], risks: string[]): DealAnalysis {
    return { score, verdict: verdictForScore(score), advantages, risks, reason: "Score calculado por regras determinísticas; análise LLM não executada." };
  }
}
