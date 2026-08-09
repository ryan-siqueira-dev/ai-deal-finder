import { z } from "zod";

export const gpuDataSchema = z.object({
  gpuVendor: z.enum(["NVIDIA", "AMD", "Intel"]).nullable(),
  model: z.string().nullable(),
  normalizedModel: z.string().nullable(),
  boardBrand: z.string().nullable(),
  vramGb: z.number().positive().nullable(),
  condition: z.enum(["new", "used", "refurbished", "damaged", "unknown"]),
  usageTime: z.string().nullable(),
  warranty: z.string().nullable(),
  hasBox: z.boolean().nullable(),
  miningMentioned: z.boolean(),
  sellerClaimsNoMining: z.boolean(),
  defects: z.array(z.string()),
  repairsMentioned: z.boolean(),
});
