import type { ListingDetails } from "../../marketplaces/types.js";
import { normalizeMileage } from "../../utils/normalization.js";
import type { CategoryAnalyzer } from "../analyzer.js";
import { containsDefect, listingText, numberValue, stringValue } from "../helpers.js";
import type { AnalysisContext, CategoryAnalysis, StructuredListing } from "../types.js";
import { vehicleDataSchema } from "./schema.js";

const BRANDS = ["bmw", "chevrolet", "fiat", "ford", "honda", "hyundai", "jeep", "kia", "mercedes benz", "nissan", "peugeot", "renault", "toyota", "volkswagen", "volvo"];
const MODELS = ["320i", "civic", "corolla", "gol", "polo", "onix", "cruze", "hb20", "creta", "compass", "renegade", "t cross", "nivus", "hilux", "amarok", "ranger"];

function detectTransmission(text: string): "manual" | "automatic" | "cvt" | "automated" | "unknown" {
  if (/\bcvt\b/.test(text)) return "cvt";
  if (/automatizad|dualogi|i motion/.test(text)) return "automated";
  if (/automatic/.test(text)) return "automatic";
  if (/manual/.test(text)) return "manual";
  return "unknown";
}

function detectFuel(text: string): "gasoline" | "ethanol" | "flex" | "diesel" | "electric" | "hybrid" | "unknown" {
  if (/hibrid/.test(text)) return "hybrid";
  if (/eletric/.test(text)) return "electric";
  if (/diesel/.test(text)) return "diesel";
  if (/flex/.test(text)) return "flex";
  if (/etanol|alcool/.test(text)) return "ethanol";
  if (/gasolina/.test(text)) return "gasoline";
  return "unknown";
}

export class VehicleAnalyzer implements CategoryAnalyzer {
  readonly category = "vehicle" as const;

  async extract(listing: ListingDetails): Promise<StructuredListing> {
    const text = listingText(listing);
    const rawText = `${listing.title} ${listing.description ?? ""} ${Object.values(listing.attributes).join(" ")}`.toLowerCase();
    const yearMatch = text.match(/\b(19[5-9]\d|20[0-3]\d)\b/);
    const mileageMatch = rawText.match(/([\d.,]+\s*(?:mil|k)?\s*(?:km|quil[oô]metros?))/);
    const sellerClaimsNoAuction = /nunca (?:foi )?de leilao|nao (?:e|foi) de leilao|sem leilao/.test(text);
    const sellerClaimsNoAccident = /nunca (?:foi )?batid|sem sinistro|nao (?:e|foi) sinistrad/.test(text);
    const data = vehicleDataSchema.parse({
      brand: BRANDS.find((brand) => text.includes(brand)) ?? null,
      model: MODELS.find((model) => text.includes(model)) ?? null,
      version: null,
      year: yearMatch?.[1] ? Number(yearMatch[1]) : null,
      mileage: normalizeMileage(mileageMatch?.[1]),
      transmission: detectTransmission(text),
      fuel: detectFuel(text),
      maintenanceMentioned: /revis|manutencao|oleo trocado/.test(text),
      auctionMentioned: /leilao/.test(text),
      sellerClaimsNoAuction,
      accidentMentioned: /sinistro|batid|colisao/.test(text),
      sellerClaimsNoAccident,
      tradeAccepted: /aceito troca|troco/.test(text),
      financingAvailable: /financi/.test(text),
      condition: containsDefect(text) ? "damaged" : /\b0\s*km\b|novo/.test(text) ? "new" : "used",
    });
    const knownFields = [data.brand, data.model, data.year, data.mileage].filter((value) => value !== null).length;
    return { category: this.category, data, extractionConfidence: 0.35 + knownFields * 0.14 };
  }

  isComparable(a: StructuredListing, b: StructuredListing): boolean {
    const aBrand = stringValue(a.data, "brand");
    const bBrand = stringValue(b.data, "brand");
    const aModel = stringValue(a.data, "model");
    const bModel = stringValue(b.data, "model");
    if (!aBrand || !aModel || aBrand !== bBrand || aModel !== bModel) return false;
    const aYear = numberValue(a.data, "year");
    const bYear = numberValue(b.data, "year");
    if (aYear !== null && bYear !== null && Math.abs(aYear - bYear) > 2) return false;
    const aMileage = numberValue(a.data, "mileage");
    const bMileage = numberValue(b.data, "mileage");
    return aMileage === null || bMileage === null || Math.abs(aMileage - bMileage) <= Math.max(30_000, aMileage * 0.35);
  }

  async analyze(input: AnalysisContext): Promise<CategoryAnalysis> {
    const data = input.structured.data;
    const risks: string[] = [];
    if (data["auctionMentioned"] === true && data["sellerClaimsNoAuction"] !== true) risks.push("Há menção a leilão");
    if (data["sellerClaimsNoAuction"] === true) risks.push("Ausência de leilão é apenas alegação do vendedor; consulte laudo e histórico");
    if (data["accidentMentioned"] === true && data["sellerClaimsNoAccident"] !== true) risks.push("Há menção a sinistro ou colisão");
    if (data["condition"] === "damaged") risks.push("O anúncio menciona problema ou avaria");
    const advantages = data["maintenanceMentioned"] === true ? ["O anúncio menciona manutenção ou revisões"] : [];
    return { featureScore: Math.min(15, 8 + advantages.length * 3), riskScore: Math.max(0, 14 - risks.length * 3), advantages, risks };
  }
}
