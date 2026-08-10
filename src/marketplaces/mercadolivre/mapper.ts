import type { ListingDetails, ListingSummary } from "../types.js";
import type { MlItem, MlSearchItem } from "./schemas.js";

function location(city?: string | null, state?: string | null): string | null {
  return [city, state].filter(Boolean).join(", ") || null;
}

export function mapMercadoLivreSummary(item: MlSearchItem): ListingSummary {
  return {
    source: "mercadolivre",
    externalId: item.id,
    title: item.title,
    price: item.price,
    currency: item.currency_id,
    location: location(item.address?.city_name, item.address?.state_name),
    url: item.permalink,
    imageUrl: item.thumbnail ?? null,
  };
}

export function mapMercadoLivreDetails(item: MlItem, description: string | null, storeRawData = false): ListingDetails {
  const images = item.pictures
    .flatMap((picture) => picture.secure_url ?? picture.url ?? [])
    .filter((image) => /^https?:\/\//i.test(image))
    .slice(0, 50);
  const attributes = Object.fromEntries(item.attributes.slice(0, 200).map((attribute) => [attribute.name, attribute.value_name ?? attribute.value_id ?? null]));
  const publishedAt = item.date_created ? new Date(item.date_created) : null;
  return {
    source: "mercadolivre",
    externalId: item.id,
    title: item.title,
    price: item.price,
    currency: item.currency_id,
    location: location(item.seller_address?.city?.name, item.seller_address?.state?.name),
    url: item.permalink,
    imageUrl: item.thumbnail ?? images[0] ?? null,
    description: description?.slice(0, 100_000) ?? null,
    sellerName: null,
    images,
    attributes,
    publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
    ...(storeRawData ? { rawData: item } : {}),
  };
}
