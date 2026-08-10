import type { ListingDetails } from "../../marketplaces/types.js";
import type { CategoryAnalyzer } from "../analyzer.js";
import { containsDefect, includesTerm, listingText, numberValue, stringValue } from "../helpers.js";
import type { AnalysisContext, CategoryAnalysis, StructuredListing } from "../types.js";
import { normalizeGpuModel } from "../gpu/analyzer.js";
import { notebookDataSchema } from "./schema.js";

const MAKERS = ["apple", "dell", "lenovo", "asus", "acer", "samsung", "hp", "positivo", "avell", "lg"];

function intelCpuGeneration(cpu: string | null): number | null {
  const digits = cpu?.match(/i[3579][ -]?(\d{4,5})/)?.[1];
  if (!digits) return null;
  const firstTwo = Number(digits.slice(0, 2));
  return firstTwo >= 10 && firstTwo <= 14 ? firstTwo : Number(digits[0]);
}

export class NotebookAnalyzer implements CategoryAnalyzer {
  readonly category = "notebook" as const;

  async extract(listing: ListingDetails): Promise<StructuredListing> {
    const text = listingText(listing);
    const rawText = `${listing.title} ${listing.description ?? ""}`.toLowerCase();
    const cpu = text.match(/\b(i[3579][ -]?\d{4,5}[a-z0-9]{0,3}|ryzen\s*[3579]\s*\d{4}[a-z]{0,2}|m[1-5](?:\s*(?:pro|max|ultra))?)\b/)?.[1] ?? null;
    const ram = text.match(/\b(\d{1,2})\s*gb\s*(?:de\s*)?ram\b/)?.[1];
    const storage = text.match(/\b(\d{3,4})\s*gb\s*(ssd|hd|hdd)?\b|\b(\d)\s*tb\s*(ssd|hd|hdd)?\b/);
    const storageGb = storage?.[1] ? Number(storage[1]) : storage?.[3] ? Number(storage[3]) * 1024 : null;
    const gpu = normalizeGpuModel(text);
    const defects = containsDefect(text) ? ["O anúncio menciona defeito ou avaria"] : [];
    const data = notebookDataSchema.parse({
      manufacturer: MAKERS.find((maker) => includesTerm(text, maker)) ?? null,
      model: null,
      cpu,
      cpuGeneration: intelCpuGeneration(cpu),
      ramGb: ram ? Number(ram) : null,
      storageGb,
      storageType: /\bssd\b/.test(text) ? "ssd" : /\bhdd?\b/.test(text) ? "hdd" : "unknown",
      gpu: gpu.normalized,
      screenInches: rawText.match(/(\d{2}(?:[.,]\d)?)\s*(?:polegadas|pol|\")/)?.[1]
        ? Number(rawText.match(/(\d{2}(?:[.,]\d)?)\s*(?:polegadas|pol|\")/)?.[1]?.replace(",", "."))
        : null,
      resolution: text.match(/\b(\d{3,4}\s*x\s*\d{3,4}|full hd|4k|qhd)\b/)?.[1] ?? null,
      battery: text.match(/bateria\s+([\w\s%]{1,30})/)?.[1]?.trim() ?? null,
      condition: defects.length ? "damaged" : /novo|lacrado|sem uso/.test(text) ? "new" : /usado/.test(text) ? "used" : "unknown",
      defects,
    });
    const known = [data.manufacturer, data.cpu, data.ramGb, data.storageGb].filter((value) => value !== null).length;
    return { category: this.category, data, extractionConfidence: 0.35 + known * 0.14 };
  }

  isComparable(a: StructuredListing, b: StructuredListing): boolean {
    const aMaker = stringValue(a.data, "manufacturer");
    const bMaker = stringValue(b.data, "manufacturer");
    if (aMaker && bMaker && aMaker !== bMaker) return false;
    const aCpu = stringValue(a.data, "cpu");
    const bCpu = stringValue(b.data, "cpu");
    if (!aCpu || !bCpu || aCpu !== bCpu) return false;
    const aRam = numberValue(a.data, "ramGb");
    const bRam = numberValue(b.data, "ramGb");
    const aStorage = numberValue(a.data, "storageGb");
    const bStorage = numberValue(b.data, "storageGb");
    return (aRam === null || bRam === null || aRam === bRam) && (aStorage === null || bStorage === null || aStorage === bStorage);
  }

  async analyze(input: AnalysisContext): Promise<CategoryAnalysis> {
    const defects = input.structured.data["defects"];
    const risks = Array.isArray(defects) ? defects.filter((item): item is string => typeof item === "string") : [];
    if (!input.structured.data["battery"]) risks.push("Estado da bateria não informado");
    const advantages = input.structured.data["storageType"] === "ssd" ? ["Possui armazenamento SSD"] : [];
    return { featureScore: Math.min(15, 8 + advantages.length * 3), riskScore: Math.max(0, 13 - risks.length * 3), advantages, risks };
  }
}
