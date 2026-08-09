import { z } from "zod";

export const notebookDataSchema = z.object({
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  cpu: z.string().nullable(),
  cpuGeneration: z.number().int().positive().nullable(),
  ramGb: z.number().positive().nullable(),
  storageGb: z.number().positive().nullable(),
  storageType: z.enum(["ssd", "hdd", "unknown"]),
  gpu: z.string().nullable(),
  screenInches: z.number().positive().nullable(),
  resolution: z.string().nullable(),
  battery: z.string().nullable(),
  condition: z.enum(["new", "used", "damaged", "unknown"]),
  defects: z.array(z.string()),
});
