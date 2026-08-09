import type { ListingSummary } from "../types.js";
import { nullableText, parseBRLPrice } from "../../utils/normalization.js";

export interface MercadoLivreWebCard {
  href: string;
  title: string | null;
  priceText: string | null;
  image: string | null;
  location: string | null;
}

export function parseMercadoLivreWebExternalId(href: string): string | null {
  let decoded = href;
  try { decoded = decodeURIComponent(href); } catch { /* Keep the original URL. */ }
  const match = decoded.match(/(?:item_id:|[?&#]wid=)(MLB-?\d{6,})/i)
    ?? decoded.match(/\b(MLB-?\d{6,})\b/i);
  return match?.[1]?.replace("-", "").toUpperCase() ?? null;
}

export function parseMercadoLivreWebCard(card: MercadoLivreWebCard): ListingSummary | null {
  const title = nullableText(card.title);
  const externalId = parseMercadoLivreWebExternalId(card.href);
  if (!title || !externalId) return null;
  const price = parseBRLPrice(card.priceText);
  return {
    source: "mercadolivre",
    externalId,
    title,
    price,
    currency: price == null ? null : "BRL",
    location: nullableText(card.location),
    url: card.href,
    imageUrl: card.image && /^https?:\/\//.test(card.image) ? card.image : null,
  };
}
