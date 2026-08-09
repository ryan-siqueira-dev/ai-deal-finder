import { describe, expect, it } from "vitest";
import { mapMercadoLivreDetails, mapMercadoLivreSummary } from "../src/marketplaces/mercadolivre/mapper.js";
import { parseMercadoLivreWebCard, parseMercadoLivreWebExternalId } from "../src/marketplaces/mercadolivre/web-parser.js";
import { mapOlxDetails, parseOlxExternalId, parseOlxSearchCard } from "../src/marketplaces/olx/parser.js";
import { mapFacebookDetails, parseFacebookExternalId, parseFacebookSearchCard } from "../src/marketplaces/facebook/parser.js";

describe("Mercado Livre mapper", () => {
  const item = {
    id: "MLB123", title: "RTX 3060 Ti", price: 1500, currency_id: "BRL", permalink: "https://produto.mercadolivre.com.br/MLB-123",
    thumbnail: "https://http2.mlstatic.com/a.jpg", address: { city_name: "Itajaí", state_name: "Santa Catarina" },
    attributes: [{ id: "BRAND", name: "Marca", value_name: "Galax", value_id: null }],
  };
  it("maps search summaries", () => {
    expect(mapMercadoLivreSummary(item)).toMatchObject({ source: "mercadolivre", externalId: "MLB123", location: "Itajaí, Santa Catarina" });
  });
  it("maps API item details and attributes", () => {
    const details = mapMercadoLivreDetails({
      ...item, seller_id: 1, seller_address: { city: { name: "Itajaí" }, state: { name: "SC" } },
      pictures: [{ secure_url: "https://http2.mlstatic.com/full.jpg" }], date_created: "2026-08-01T12:00:00.000Z",
    }, "Descrição completa");
    expect(details.attributes).toEqual({ Marca: "Galax" });
    expect(details.images).toEqual(["https://http2.mlstatic.com/full.jpg"]);
  });
  it("parses current web result cards and tracking ids", () => {
    const href = "https://click1.mercadolivre.com.br/path?pdp_filters=item_id%3AMLB6972021044#wid=MLB6972021044";
    expect(parseMercadoLivreWebExternalId(href)).toBe("MLB6972021044");
    expect(parseMercadoLivreWebCard({ href, title: "Notebook Dell", priceText: "R$ 3.599", image: "https://http2.mlstatic.com/a.jpg", location: null }))
      .toMatchObject({ externalId: "MLB6972021044", price: 3599, currency: "BRL" });
  });
});

describe("OLX parser and mapper", () => {
  it("parses a result card", () => {
    const summary = parseOlxSearchCard({ href: "https://www.olx.com.br/item/rtx-3060-ti-123456789", title: "RTX 3060 Ti", text: "RTX 3060 Ti\nR$ 1.300\nItajaí, SC", image: "https://img.olx.com.br/a.jpg" });
    expect(summary).toMatchObject({ externalId: "123456789", price: 1300, location: "Itajaí, SC" });
    expect(parseOlxExternalId("https://olx.com.br/item/x-123456789")).toBe("123456789");
  });
  it("maps structured detail data", () => {
    const summary = parseOlxSearchCard({ href: "https://www.olx.com.br/item/x-123456789", title: "RTX", text: "RTX\nR$ 1.300", image: null });
    if (!summary) throw new Error("fixture_invalid");
    const details = mapOlxDetails(summary, { title: "RTX detalhada", description: "Texto", priceText: "R$ 1.250", location: "Itajaí, SC", sellerName: "João", images: ["https://img.olx.com.br/1.jpg"], attributes: { Marca: "Galax" }, publishedAt: "2026-08-01T00:00:00Z" });
    expect(details).toMatchObject({ title: "RTX detalhada", price: 1250, sellerName: "João" });
  });
});

describe("Facebook parser", () => {
  it("parses listing cards and ids", () => {
    const summary = parseFacebookSearchCard({ href: "https://www.facebook.com/marketplace/item/987654321/", text: "R$ 1.300\nRTX 3060 Ti\nItajaí, SC", ariaLabel: null, image: "https://scontent.example/a.jpg" });
    expect(summary).toMatchObject({ externalId: "987654321", title: "RTX 3060 Ti", price: 1300, location: "Itajaí, SC" });
    expect(parseFacebookExternalId("https://facebook.com/marketplace/item/987654321/")).toBe("987654321");
  });
  it("maps visible detail data", () => {
    const summary = parseFacebookSearchCard({ href: "https://facebook.com/marketplace/item/1", text: "R$ 1.300\nRTX", ariaLabel: "RTX", image: null });
    if (!summary) throw new Error("fixture_invalid");
    const details = mapFacebookDetails(summary, { title: "RTX 3060 Ti", text: "...", description: "Usada", priceText: "R$ 1.200", location: "Itajaí, SC", sellerName: "Maria", images: [], attributes: {} });
    expect(details.price).toBe(1200);
    expect(details.sellerName).toBe("Maria");
  });
  it("keeps the search title when Facebook exposes a navigation heading", () => {
    const summary = parseFacebookSearchCard({ href: "https://facebook.com/marketplace/item/2", text: "R$ 52.000\nBMW 320i 2010", ariaLabel: "BMW 320i 2010", image: null });
    if (!summary) throw new Error("fixture_invalid");
    const details = mapFacebookDetails(summary, { title: "Notificações", text: "...", description: null, priceText: null, location: null, sellerName: null, images: [], attributes: {} });
    expect(details.title).toBe("BMW 320i 2010");
  });
});
