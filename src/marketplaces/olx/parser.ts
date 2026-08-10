import type { ListingDetails, ListingSummary } from "../types.js";
import { nullableText, parseBRLPrice } from "../../utils/normalization.js";

export interface OlxSearchCard {
  href: string;
  title: string | null;
  text: string;
  priceText?: string | null;
  image: string | null;
}

function parseOlxPriceCandidates(values: readonly (string | number | null | undefined)[]): number | null {
  for (const value of values) {
    if (typeof value === "number") {
      const parsed = parseBRLPrice(value);
      if (parsed !== null) return parsed;
      continue;
    }
    for (const line of value?.split(/\r?\n/) ?? []) {
      const normalized = nullableText(line);
      if (!normalized) continue;
      if (/\b\d+\s*x\s*(?:de\s*)?R\$/i.test(normalized) || /parcel(?:a|amento)/i.test(normalized)) continue;
      const candidate = normalized.match(/R\$\s*[\d.]+(?:,\d{2})?/i)?.[0]
        ?? (/^[\d.]+(?:,\d{2})?$/.test(normalized) ? normalized : null);
      const parsed = parseBRLPrice(candidate);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

export function parseOlxExternalId(url: string): string | null {
  const match = new URL(url).pathname.match(/-(\d{6,})(?:\/)?$/);
  return match?.[1] ?? null;
}

export function parseOlxSearchCard(card: OlxSearchCard): ListingSummary | null {
  const title = nullableText(card.title) ?? nullableText(card.text.split("\n")[0]);
  if (!title) return null;
  const price = parseOlxPriceCandidates([card.priceText, card.text]);
  const locationLines = card.text.split("\n").map((line) => line.trim()).filter(Boolean);
  const location = locationLines.find((line) => /(?:,|\s-\s)\s*[A-Z]{2}\b/.test(line) && !line.includes("R$")) ?? null;
  return {
    source: "olx",
    externalId: parseOlxExternalId(card.href),
    title,
    price,
    currency: price === null ? null : "BRL",
    location,
    url: card.href,
    imageUrl: card.image && /^https?:\/\//i.test(card.image) ? card.image : null,
  };
}

export interface OlxDetailDocument {
  title: string | null;
  description: string | null;
  priceText: string | null;
  priceCandidates?: Array<string | number>;
  location: string | null;
  sellerName: string | null;
  images: string[];
  attributes: Record<string, unknown>;
  publishedAt: string | null;
}

export function mapOlxDetails(summary: ListingSummary, detail: OlxDetailDocument, storeRawData = false): ListingDetails {
  const parsedDate = detail.publishedAt ? new Date(detail.publishedAt) : null;
  const images = [...new Set(detail.images.filter((image) => /^https?:\/\//i.test(image)))].slice(0, 50);
  const detailPrice = parseOlxPriceCandidates([...(detail.priceCandidates ?? []), detail.priceText]);
  return {
    ...summary,
    title: nullableText(detail.title) ?? summary.title,
    price: detailPrice ?? summary.price,
    currency: detailPrice !== null ? "BRL" : summary.currency,
    location: nullableText(detail.location) ?? summary.location,
    description: nullableText(detail.description)?.slice(0, 100_000) ?? null,
    sellerName: nullableText(detail.sellerName)?.slice(0, 500) ?? null,
    images,
    imageUrl: images[0] ?? summary.imageUrl,
    attributes: Object.fromEntries(Object.entries(detail.attributes).slice(0, 200)),
    publishedAt: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null,
    ...(storeRawData ? { rawData: detail } : {}),
  };
}
