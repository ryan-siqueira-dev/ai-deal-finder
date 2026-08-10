import { z } from "zod";
import { MAX_STORED_MONEY } from "../utils/money.js";

export const marketplaceNames = ["facebook", "olx", "mercadolivre"] as const;
export const marketplaceNameSchema = z.enum(marketplaceNames);
export type MarketplaceName = z.infer<typeof marketplaceNameSchema>;

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch { return false; }
}

export function isMarketplaceUrl(source: MarketplaceName, value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (url.username || url.password || url.port) return false;
    const hostname = url.hostname.toLowerCase();
    if (source === "facebook") return hostname === "facebook.com" || hostname.endsWith(".facebook.com");
    if (source === "olx") return hostname === "olx.com.br" || hostname.endsWith(".olx.com.br");
    return hostname === "mercadolivre.com.br"
      || hostname.endsWith(".mercadolivre.com.br")
      || hostname === "mercadolibre.com"
      || hostname.endsWith(".mercadolibre.com");
  } catch { return false; }
}

const httpUrlSchema = z.string().trim().max(4_096).url().refine(isHttpUrl, "URL must use HTTP or HTTPS");

export const marketplaceSearchCriteriaSchema = z.object({
  query: z.string().trim().min(1),
  minPrice: z.number().finite().nonnegative().max(MAX_STORED_MONEY).nullable().optional(),
  maxPrice: z.number().finite().positive().max(MAX_STORED_MONEY).nullable().optional(),
  minYear: z.number().int().min(1900).max(2200).nullable().optional(),
  maxYear: z.number().int().min(1900).max(2200).nullable().optional(),
  location: z.string().trim().min(1).nullable().optional(),
  radiusKm: z.number().int().positive().nullable().optional(),
  limit: z.number().int().positive().max(200).default(50),
});
export type MarketplaceSearchCriteria = z.infer<typeof marketplaceSearchCriteriaSchema>;

export const listingSummarySchema = z.object({
  source: marketplaceNameSchema,
  externalId: z.string().trim().min(1).max(300).nullable(),
  title: z.string().trim().min(1).max(1_000),
  price: z.number().finite().nonnegative().max(MAX_STORED_MONEY).nullable(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()).nullable(),
  location: z.string().trim().min(1).max(500).nullable(),
  url: httpUrlSchema,
  imageUrl: httpUrlSchema.nullable(),
});
export type ListingSummary = z.infer<typeof listingSummarySchema>;

export const listingDetailsSchema = listingSummarySchema.extend({
  description: z.string().max(100_000).nullable(),
  sellerName: z.string().trim().max(500).nullable(),
  images: z.array(httpUrlSchema).max(50),
  attributes: z.record(z.unknown()).refine((value) => Object.keys(value).length <= 200, "too many attributes"),
  publishedAt: z.date().nullable().optional(),
  rawData: z.unknown().optional(),
});
export type ListingDetails = z.infer<typeof listingDetailsSchema>;
