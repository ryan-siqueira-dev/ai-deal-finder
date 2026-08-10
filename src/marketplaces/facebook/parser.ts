import type { ListingDetails, ListingSummary } from "../types.js";
import { nullableText, parseBRLPrice } from "../../utils/normalization.js";

export interface FacebookSearchCard {
  href: string;
  text: string;
  ariaLabel: string | null;
  image: string | null;
}

export function parseFacebookExternalId(url: string): string | null {
  return new URL(url).pathname.match(/\/marketplace\/item\/(\d+)/)?.[1] ?? null;
}

export function parseFacebookSearchCard(card: FacebookSearchCard): ListingSummary | null {
  const lines = card.text.split("\n").map((line) => line.trim()).filter(Boolean);
  const priceLine = lines.find((line) => /R\$\s*[\d.]+(?:,\d{2})?/i.test(line));
  const title = nullableText(card.ariaLabel)
    ?? lines.find((line) => line !== priceLine && !/^R\$/.test(line) && line.length > 2)
    ?? null;
  if (!title) return null;
  const location = lines.find((line) => /,\s*[A-Z]{2}\b/.test(line)) ?? null;
  return {
    source: "facebook",
    externalId: parseFacebookExternalId(card.href),
    title,
    price: parseBRLPrice(priceLine),
    currency: priceLine ? "BRL" : null,
    location,
    url: card.href,
    imageUrl: card.image && /^https?:\/\//i.test(card.image) ? card.image : null,
  };
}

export interface FacebookDetailDocument {
  title: string | null;
  text: string;
  description: string | null;
  priceText: string | null;
  location: string | null;
  sellerName: string | null;
  images: string[];
  attributes: Record<string, unknown>;
}

function usableDetailTitle(value: string | null): string | null {
  const title = nullableText(value)?.replace(/\s*[|·]\s*Facebook(?: Marketplace)?\s*$/i, "").trim() ?? null;
  if (!title || /^(notifica[cç][oõ]es|notifications|facebook|marketplace)$/i.test(title)) return null;
  return title;
}

export function mapFacebookDetails(summary: ListingSummary, detail: FacebookDetailDocument, storeRawData = false): ListingDetails {
  const images = [...new Set(detail.images.filter((image) => /^https?:\/\//i.test(image)))].slice(0, 50);
  return {
    ...summary,
    title: usableDetailTitle(detail.title) ?? summary.title,
    price: parseBRLPrice(detail.priceText) ?? summary.price,
    currency: parseBRLPrice(detail.priceText) != null ? "BRL" : summary.currency,
    location: nullableText(detail.location) ?? summary.location,
    description: nullableText(detail.description)?.slice(0, 100_000) ?? null,
    sellerName: nullableText(detail.sellerName)?.slice(0, 500) ?? null,
    images,
    imageUrl: images[0] ?? summary.imageUrl,
    attributes: Object.fromEntries(Object.entries(detail.attributes).slice(0, 200)),
    publishedAt: null,
    ...(storeRawData ? { rawData: { visibleText: detail.text.slice(0, 20_000) } } : {}),
  };
}
