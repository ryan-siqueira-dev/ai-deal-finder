import type { ListingCategory } from "./types.js";
import { genericDataSchema } from "./generic/schema.js";
import { gpuDataSchema } from "./gpu/schema.js";
import { notebookDataSchema } from "./notebook/schema.js";
import { vehicleDataSchema } from "./vehicle/schema.js";

export function validateCategoryData(category: ListingCategory, data: Record<string, unknown>): Record<string, unknown> | null {
  const schema = category === "vehicle" ? vehicleDataSchema
    : category === "gpu" ? gpuDataSchema
    : category === "notebook" ? notebookDataSchema
    : genericDataSchema;
  const parsed = schema.safeParse(data);
  return parsed.success ? parsed.data : null;
}
