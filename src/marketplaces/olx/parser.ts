import type { ListingDetails, ListingSummary } from "../types.js";
import { nullableText, parseBRLPrice } from "../../utils/normalization.js";

export interface OlxSearchCard {
  href: string;
  title: string | null;
  text: string;
  image: string | null;
}

export function parseOlxExternalId(url: string): string | null {
  const match = new URL(url).pathname.match(/-(\d{6,})(?:\/)?$/);
  return match?.[1] ?? null;
}

export function parseOlxSearchCard(card: OlxSearchCard): ListingSummary | null {
  const title = nullableText(card.title) ?? nullableText(card.text.split("\n")[0]);
  if (!title) return null;
  const priceMatch = card.text.match(/R\$\s*[\d.]+(?:,\d{2})?/i);
  const locationLines = card.text.split("\n").map((line) => line.trim()).filter(Boolean);
  const location = locationLines.find((line) => /\b[A-Z]{2}\b/.test(line) && !line.includes("R$")) ?? null;
  return {
    source: "olx",
    externalId: parseOlxExternalId(card.href),
    title,
    price: parseBRLPrice(priceMatch?.[0]),
    currency: priceMatch ? "BRL" : null,
    location,
    url: card.href,
    imageUrl: card.image && /^https?:\/\//i.test(card.image) ? card.image : null,
  };
}

export interface OlxDetailDocument {
  title: string | null;
  description: string | null;
  priceText: string | null;
  location: string | null;
  sellerName: string | null;
  images: string[];
  attributes: Record<string, unknown>;
  publishedAt: string | null;
}

export function mapOlxDetails(summary: ListingSummary, detail: OlxDetailDocument, storeRawData = false): ListingDetails {
  const parsedDate = detail.publishedAt ? new Date(detail.publishedAt) : null;
  const images = [...new Set(detail.images.filter((image) => /^https?:\/\//i.test(image)))].slice(0, 50);
  return {
    ...summary,
    title: nullableText(detail.title) ?? summary.title,
    price: parseBRLPrice(detail.priceText) ?? summary.price,
    currency: parseBRLPrice(detail.priceText) != null ? "BRL" : summary.currency,
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
