import { access } from "node:fs/promises";
import type { Logger } from "pino";
import type { Page } from "playwright";
import { BrowserSession, progressiveScroll } from "../browser.js";
import { ProviderError, type MarketplaceProvider } from "../provider.js";
import type { ListingDetails, ListingSummary, MarketplaceSearchCriteria } from "../types.js";
import { deduplicateListings } from "../../listings/deduplication.js";
import { FACEBOOK_SELECTORS } from "./selectors.js";
import { mapFacebookDetails, parseFacebookSearchCard, type FacebookDetailDocument, type FacebookSearchCard } from "./parser.js";

export class FacebookMarketplaceProvider implements MarketplaceProvider {
  readonly name = "facebook" as const;
  readonly #browser: BrowserSession;

  public constructor(
    private readonly storageStatePath: string,
    headless: boolean,
    private readonly maxListings: number,
    private readonly timeoutMs: number,
    private readonly logger: Logger,
    executablePath?: string,
  ) {
    this.#browser = new BrowserSession({ headless, storageStatePath, ...(executablePath ? { executablePath } : {}) });
  }

  async search(criteria: MarketplaceSearchCriteria): Promise<ListingSummary[]> {
    await this.requireSession();
    const page = await this.#browser.page();
    try {
      page.setDefaultTimeout(this.timeoutMs);
      const url = new URL("https://www.facebook.com/marketplace/search/");
      url.searchParams.set("query", criteria.query);
      if (criteria.minPrice != null) url.searchParams.set("minPrice", String(Math.round(criteria.minPrice)));
      if (criteria.maxPrice != null) url.searchParams.set("maxPrice", String(Math.round(criteria.maxPrice)));
      if (criteria.radiusKm != null) url.searchParams.set("radius", String(criteria.radiusKm));
      await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
      await this.assertAuthenticated(page);
      await page.locator(FACEBOOK_SELECTORS.resultLinks.join(",")).first().waitFor({ state: "attached" });
      await progressiveScroll(page, 8, 900);
      const cards = await page.evaluate((selector): FacebookSearchCard[] =>
        [...document.querySelectorAll<HTMLAnchorElement>(selector)].map((element) => ({
          href: element.href,
          text: element.innerText,
          ariaLabel: element.getAttribute("aria-label"),
          image: element.querySelector("img")?.src ?? null,
        })), FACEBOOK_SELECTORS.resultLinks[0]);
      const parsed = cards.map(parseFacebookSearchCard).filter((item): item is ListingSummary => item !== null);
      return deduplicateListings(parsed).slice(0, Math.min(criteria.limit, this.maxListings));
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("facebook_search_failed", "Facebook Marketplace search failed; inspect the current layout", true, { cause: error });
    } finally {
      await page.close();
    }
  }

  async getListingDetails(listing: ListingSummary): Promise<ListingDetails> {
    await this.requireSession();
    const page = await this.#browser.page();
    try {
      page.setDefaultTimeout(this.timeoutMs);
      await page.goto(listing.url, { waitUntil: "domcontentloaded" });
      await this.assertAuthenticated(page);
      await page.locator(FACEBOOK_SELECTORS.detailMain.join(",")).first().waitFor({ state: "attached" });
      const detail = await page.evaluate((selectors): FacebookDetailDocument => {
        const main = document.querySelector<HTMLElement>(selectors.detailMain.join(","));
        const text = main?.innerText ?? "";
        const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
        const metaTitle = document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content ?? null;
        const title = metaTitle ?? document.querySelector("h1")?.textContent?.trim() ?? null;
        const priceText = lines.find((line) => /^R\$\s*[\d.]+(?:,\d{2})?/.test(line)) ?? null;
        const location = lines.find((line) => /,\s*[A-Z]{2}\b/.test(line)) ?? null;
        const descriptionIndex = lines.findIndex((line) => /^(descrição|description)$/i.test(line));
        const description = descriptionIndex >= 0 ? lines.slice(descriptionIndex + 1, descriptionIndex + 8).join("\n") : null;
        const sellerIndex = lines.findIndex((line) => /informações do vendedor|seller information/i.test(line));
        const sellerName = sellerIndex >= 0 ? lines[sellerIndex + 1] ?? null : null;
        const images = [...document.querySelectorAll<HTMLImageElement>('img[src^="https://"]')]
          .map((image) => image.src)
          .filter((src) => !src.includes("emoji") && !src.includes("profile"));
        const attributes: Record<string, unknown> = {};
        for (let index = 0; index < lines.length - 1; index += 1) {
          const key = lines[index];
          const value = lines[index + 1];
          if (key && value && /^(ano|quilometragem|transmissão|combustível|condição|marca|modelo)$/i.test(key)) attributes[key] = value;
        }
        return { title, text, description, priceText, location, sellerName, images, attributes };
      }, FACEBOOK_SELECTORS);
      return mapFacebookDetails(listing, detail);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      this.logger.warn({ event: "listing_details_failed", provider: this.name, url: listing.url, err: error }, "Facebook detail failed");
      throw new ProviderError("facebook_listing_details_failed", "Could not parse Facebook listing details", true, { cause: error });
    } finally {
      await page.close();
    }
  }

  async inspect(url: string, outputPath: string): Promise<void> {
    await this.requireSession();
    const page = await this.#browser.page();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await this.assertAuthenticated(page);
      await page.screenshot({ path: outputPath, fullPage: true });
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> { await this.#browser.close(); }

  private async requireSession(): Promise<void> {
    try { await access(this.storageStatePath); }
    catch { throw new ProviderError("facebook_session_missing", `Run npm run facebook:login to create ${this.storageStatePath}`); }
  }

  private async assertAuthenticated(page: Page): Promise<void> {
    const onLoginUrl = /facebook\.com\/(login|checkpoint)/.test(page.url());
    const hasLoginForm = await page.locator(FACEBOOK_SELECTORS.loginMarkers.join(",")).first().isVisible().catch(() => false);
    if (onLoginUrl || hasLoginForm) {
      this.logger.warn({ event: "facebook_session_expired" }, "Facebook session expired");
      throw new ProviderError("facebook_session_expired", "Run npm run facebook:login to refresh the session");
    }
  }
}
