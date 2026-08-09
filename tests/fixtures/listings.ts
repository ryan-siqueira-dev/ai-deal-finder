import type { ListingDetails } from "../../src/marketplaces/types.js";

export function listingFixture(overrides: Partial<ListingDetails> = {}): ListingDetails {
  return {
    source: "olx",
    externalId: "123456789",
    title: "Produto de teste",
    price: 1_300,
    currency: "BRL",
    location: "Itajaí, SC",
    url: "https://www.olx.com.br/item/produto-123456789",
    imageUrl: "https://images.example.com/1.jpg",
    description: "Produto usado, bem conservado e funcionando perfeitamente.",
    sellerName: "Vendedor",
    images: ["https://images.example.com/1.jpg", "https://images.example.com/2.jpg", "https://images.example.com/3.jpg"],
    attributes: { Condição: "Usado" },
    publishedAt: null,
    rawData: {},
    ...overrides,
  };
}
