import { z } from "zod";

export const genericDataSchema = z.object({
  brand: z.string().nullable(),
  model: z.string().nullable(),
  condition: z.enum(["new", "used", "refurbished", "damaged", "unknown"]),
  warranty: z.string().nullable(),
  defects: z.array(z.string()),
  features: z.array(z.string()),
});
