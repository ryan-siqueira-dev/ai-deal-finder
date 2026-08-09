import type { ListingDetails } from "../../marketplaces/types.js";
import type { CategoryAnalyzer } from "../analyzer.js";
import { containsDefect, listingText, numberValue, stringValue } from "../helpers.js";
import type { AnalysisContext, CategoryAnalysis, StructuredListing } from "../types.js";
import { gpuDataSchema } from "./schema.js";

const BOARD_BRANDS = ["asus", "msi", "gigabyte", "galax", "zotac", "evga", "palit", "pny", "sapphire", "powercolor", "xfx"];

export function normalizeGpuModel(text: string): { vendor: "NVIDIA" | "AMD" | "Intel" | null; model: string | null; normalized: string | null } {
  const upperText = text.toUpperCase();
  const mentionsGeForce = upperText.includes("GEFORCE");
  const normalizedText = upperText.replace(/GEFORCE/g, "").replace(/RADEON/g, "").replace(/\s+/g, " ");
  const nvidia = normalizedText.match(/\b(RTX|GTX)\s*-?\s*(\d{3,4})\s*(TI|SUPER)?\b/);
  if (nvidia?.[1] && nvidia[2]) {
    const model = `${nvidia[1]} ${nvidia[2]}${nvidia[3] ? ` ${nvidia[3]}` : ""}`;
    return { vendor: "NVIDIA", model, normalized: `NVIDIA GeForce ${model}` };
  }
  const implicitNvidia = normalizedText.match(/\b(\d{4})\s*(TI|SUPER)\b/);
  if (implicitNvidia?.[1] || mentionsGeForce) {
    const modelMatch = implicitNvidia ?? normalizedText.match(/\b(\d{4})\s*(TI|SUPER)?\b/);
    if (modelMatch?.[1]) {
      const model = `RTX ${modelMatch[1]}${modelMatch[2] ? ` ${modelMatch[2]}` : ""}`;
      return { vendor: "NVIDIA", model, normalized: `NVIDIA GeForce ${model}` };
    }
  }
  const amd = normalizedText.match(/\bRX\s*-?\s*(\d{3,4})\s*(XT|XTX)?\b/);
  if (amd?.[1]) {
    const model = `RX ${amd[1]}${amd[2] ? ` ${amd[2]}` : ""}`;
    return { vendor: "AMD", model, normalized: `AMD Radeon ${model}` };
  }
  const intel = normalizedText.match(/\bARC\s+(A\d{3})\b/);
  if (intel?.[1]) return { vendor: "Intel", model: `Arc ${intel[1]}`, normalized: `Intel Arc ${intel[1]}` };
  return { vendor: null, model: null, normalized: null };
}

export class GPUAnalyzer implements CategoryAnalyzer {
  readonly category = "gpu" as const;

  async extract(listing: ListingDetails): Promise<StructuredListing> {
    const text = listingText(listing);
    const gpu = normalizeGpuModel(text);
    const vram = text.match(/\b(\d{1,2})\s*gb\b/)?.[1];
    const sellerClaimsNoMining = /nunca (?:foi )?usad[ao] (?:em|para) mineracao|nao (?:foi )?usad[ao] (?:em|para) mineracao|sem mineracao/.test(text);
    const miningMentioned = /mineracao|mining/.test(text);
    const defects = containsDefect(text) ? ["O anúncio menciona defeito ou problema"] : [];
    const data = gpuDataSchema.parse({
      gpuVendor: gpu.vendor,
      model: gpu.model,
      normalizedModel: gpu.normalized,
      boardBrand: BOARD_BRANDS.find((brand) => text.includes(brand)) ?? null,
      vramGb: vram ? Number(vram) : null,
      condition: containsDefect(text) ? "damaged" : /nova|lacrada|sem uso/.test(text) ? "new" : /usada|tempo de uso/.test(text) ? "used" : "unknown",
      usageTime: text.match(/(\d+\s*(?:meses?|anos?)\s*(?:de uso)?)/)?.[1] ?? null,
      warranty: text.match(/garantia\s+(?:de\s+)?([\w\s]{1,30})/)?.[1]?.trim() ?? null,
      hasBox: /com caixa|caixa original/.test(text) ? true : /sem caixa/.test(text) ? false : null,
      miningMentioned,
      sellerClaimsNoMining,
      defects,
      repairsMentioned: /reparo|reball|consert/.test(text),
    });
    return { category: this.category, data, extractionConfidence: gpu.normalized ? 0.9 : 0.35 };
  }

  isComparable(a: StructuredListing, b: StructuredListing): boolean {
    const aModel = stringValue(a.data, "normalizedModel");
    const bModel = stringValue(b.data, "normalizedModel");
    if (!aModel || aModel !== bModel) return false;
    const aVram = numberValue(a.data, "vramGb");
    const bVram = numberValue(b.data, "vramGb");
    return aVram === null || bVram === null || aVram === bVram;
  }

  async analyze(input: AnalysisContext): Promise<CategoryAnalysis> {
    const risks: string[] = [];
    if (input.structured.data["miningMentioned"] === true) risks.push("Há menção a mineração; o histórico deve ser verificado");
    if (input.structured.data["repairsMentioned"] === true) risks.push("O anúncio menciona reparo");
    if (input.structured.data["condition"] === "damaged") risks.push("A placa aparenta ter defeito ou avaria");
    const advantages: string[] = [];
    if (input.structured.data["warranty"]) advantages.push("O anúncio menciona garantia");
    if (input.structured.data["hasBox"] === true) advantages.push("Inclui caixa");
    return { featureScore: Math.min(15, 8 + advantages.length * 2), riskScore: Math.max(0, 13 - risks.length * 4), advantages, risks };
  }
}
