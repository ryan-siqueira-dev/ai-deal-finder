import { z } from "zod";
import { listingCategorySchema } from "../categories/types.js";
import { marketplaceNameSchema } from "../marketplaces/types.js";
import { MAX_STORED_MONEY } from "../utils/money.js";

const nullableMoney = z.number().finite().nonnegative().max(MAX_STORED_MONEY).nullable();
const nullableYear = z.number().int().min(1900).max(2200).nullable();

export const searchDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  query: z.string().trim().min(1).max(300),
  category: listingCategorySchema,
  providers: z.array(marketplaceNameSchema).min(1).transform((values) => [...new Set(values)]),
  minPrice: nullableMoney,
  maxPrice: nullableMoney,
  minYear: nullableYear,
  maxYear: nullableYear,
  location: z.string().trim().min(1).max(200).nullable(),
  radiusKm: z.number().int().positive().max(2_000).nullable(),
  minimumScore: z.number().int().min(0).max(100),
  intervalMinutes: z.number().int().positive().max(525_600),
  forbiddenWords: z.array(z.string().trim().min(1).max(100)).max(50)
    .transform((values) => [...new Set(values)]),
}).superRefine((value, context) => {
  if (value.minPrice !== null && value.maxPrice !== null && value.minPrice > value.maxPrice) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["minPrice"], message: "must not exceed maxPrice" });
  }
  if (value.minYear !== null && value.maxYear !== null && value.minYear > value.maxYear) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["minYear"], message: "must not exceed maxYear" });
  }
  if (value.radiusKm !== null && value.location === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["radiusKm"], message: "requires location" });
  }
});

export type SearchDefinition = z.infer<typeof searchDefinitionSchema>;

export function optionalNumber(value: string | undefined, name: string): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid_flag:${name}`);
  return parsed;
}
