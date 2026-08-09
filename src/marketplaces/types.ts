import { z } from "zod";

export const marketplaceNames = ["facebook", "olx", "mercadolivre"] as const;
export const marketplaceNameSchema = z.enum(marketplaceNames);
export type MarketplaceName = z.infer<typeof marketplaceNameSchema>;

export const marketplaceSearchCriteriaSchema = z.object({
  query: z.string().trim().min(1),
  minPrice: z.number().nonnegative().nullable().optional(),
  maxPrice: z.number().positive().nullable().optional(),
  minYear: z.number().int().min(1900).max(2200).nullable().optional(),
  maxYear: z.number().int().min(1900).max(2200).nullable().optional(),
  location: z.string().trim().min(1).nullable().optional(),
  radiusKm: z.number().int().positive().nullable().optional(),
  limit: z.number().int().positive().max(200).default(50),
});
export type MarketplaceSearchCriteria = z.infer<typeof marketplaceSearchCriteriaSchema>;

export const listingSummarySchema = z.object({
  source: marketplaceNameSchema,
  externalId: z.string().min(1).nullable(),
  title: z.string().trim().min(1),
  price: z.number().nonnegative().nullable(),
  currency: z.string().trim().min(1).nullable(),
  location: z.string().trim().min(1).nullable(),
  url: z.string().url(),
  imageUrl: z.string().url().nullable(),
});
export type ListingSummary = z.infer<typeof listingSummarySchema>;

export const listingDetailsSchema = listingSummarySchema.extend({
  description: z.string().nullable(),
  sellerName: z.string().nullable(),
  images: z.array(z.string().url()),
  attributes: z.record(z.unknown()),
  publishedAt: z.date().nullable().optional(),
  rawData: z.unknown().optional(),
});
export type ListingDetails = z.infer<typeof listingDetailsSchema>;
