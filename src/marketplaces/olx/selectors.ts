// Candidate selectors are intentionally centralized. Run `npm run provider:test -- olx --inspect`
// after layout changes; no selector is treated as a private/stable OLX API contract.
export const OLX_SELECTORS = {
  resultCards: [
    "section.olx-adcard",
    '[data-ds-component="DS-AdCard"]',
    "article",
    "li",
  ],
  resultLinks: [
    "a.olx-adcard__link",
    'a[data-ds-component="DS-AdCard"]',
    '[data-ds-component="DS-AdCard"] a[href]',
    'a[href*="/item/"]',
  ],
  resultTitle: ["h2", "[aria-label*=Título]", "[data-ds-component=DS-Text]"],
  resultPrice: ["[data-ds-component=DS-Text]", "span"],
  resultLocation: ["[aria-label*=Localização]", "[data-ds-component=DS-Text]"],
  detailTitle: ["h1", "[data-ds-component=DS-Text][class*=title]"],
  detailPrice: [
    '[data-testid="ad-price"]',
    '[data-testid*="price"]',
    '[itemprop="price"]',
    'meta[property="product:price:amount"]',
    "[class*=price]",
  ],
  detailDescription: ['[data-ds-component="DS-AdDescription"]', "[class*=description]"],
  detailSeller: ['[data-ds-component="DS-SellerInfo"]', "[class*=seller]"],
  detailAttributes: ['[data-ds-component="DS-AdDetails"] li', "main li"],
} as const;
