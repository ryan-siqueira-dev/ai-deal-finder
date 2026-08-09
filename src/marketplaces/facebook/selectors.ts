// Facebook changes its generated markup frequently. Keep semantic fallbacks here and
// validate them with `npm run provider:test -- facebook --inspect` using a local session.
export const FACEBOOK_SELECTORS = {
  resultLinks: ['a[href*="/marketplace/item/"]'],
  detailTitle: ["h1", 'meta[property="og:title"]'],
  detailMain: ["main", '[role="main"]'],
  loginMarkers: ['input[name="email"]', 'form[action*="login"]'],
} as const;
