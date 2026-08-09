import { z } from "zod";

export const vehicleDataSchema = z.object({
  brand: z.string().nullable(),
  model: z.string().nullable(),
  version: z.string().nullable(),
  year: z.number().int().min(1900).max(2200).nullable(),
  mileage: z.number().int().nonnegative().nullable(),
  transmission: z.enum(["manual", "automatic", "cvt", "automated", "unknown"]),
  fuel: z.enum(["gasoline", "ethanol", "flex", "diesel", "electric", "hybrid", "unknown"]),
  maintenanceMentioned: z.boolean(),
  auctionMentioned: z.boolean(),
  sellerClaimsNoAuction: z.boolean(),
  accidentMentioned: z.boolean(),
  sellerClaimsNoAccident: z.boolean(),
  tradeAccepted: z.boolean(),
  financingAvailable: z.boolean(),
  condition: z.enum(["new", "used", "damaged", "unknown"]),
});
