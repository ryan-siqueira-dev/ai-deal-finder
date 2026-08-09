import type { MarketplaceName } from "../marketplaces/types.js";

export type ReferenceConfidence = "low" | "medium" | "high";
export interface MarketReference { sampleSize: number; confidence: ReferenceConfidence; medianPrice: number | null }
export interface PriceStatistics extends MarketReference {
  meanPrice: number | null;
  minimumPrice: number | null;
  maximumPrice: number | null;
  percentiles: { p25: number | null; p75: number | null; p90: number | null };
}
export interface PricedListing { id: string; source: MarketplaceName; price: number }
export interface MarketStatistics {
  byProvider: Partial<Record<MarketplaceName, PriceStatistics>>;
  combined: PriceStatistics;
}

export function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function median(values: readonly number[]): number | null { return percentile(values, 50); }

export function percentile(values: readonly number[], value: number): number | null {
  if (!values.length) return null;
  if (value < 0 || value > 100) throw new RangeError("percentile_must_be_between_0_and_100");
  const sorted = [...values].sort((a, b) => a - b);
  const position = (value / 100) * (sorted.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === undefined || upper === undefined) return null;
  return lower + (upper - lower) * (position - lowerIndex);
}

export function percentageDifference(value: number, reference: number | null): number | null {
  return reference && reference !== 0 ? ((value - reference) / reference) * 100 : null;
}

export function referenceConfidence(sampleSize: number): ReferenceConfidence {
  if (sampleSize >= 10) return "high";
  if (sampleSize >= 5) return "medium";
  return "low";
}

export function calculatePriceStatistics(values: readonly number[]): PriceStatistics {
  const valid = values.filter((value) => Number.isFinite(value) && value >= 0);
  return {
    sampleSize: valid.length,
    confidence: referenceConfidence(valid.length),
    medianPrice: median(valid),
    meanPrice: mean(valid),
    minimumPrice: valid.length ? Math.min(...valid) : null,
    maximumPrice: valid.length ? Math.max(...valid) : null,
    percentiles: { p25: percentile(valid, 25), p75: percentile(valid, 75), p90: percentile(valid, 90) },
  };
}

export function calculateMarketStatistics(listings: readonly PricedListing[]): MarketStatistics {
  const byProvider: Partial<Record<MarketplaceName, PriceStatistics>> = {};
  for (const source of ["facebook", "olx", "mercadolivre"] as const) {
    const prices = listings.filter((listing) => listing.source === source).map((listing) => listing.price);
    if (prices.length) byProvider[source] = calculatePriceStatistics(prices);
  }
  return { byProvider, combined: calculatePriceStatistics(listings.map((listing) => listing.price)) };
}
