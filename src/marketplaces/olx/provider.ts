import { access } from "node:fs/promises";
import type { Logger } from "pino";
import type { Page } from "playwright";
import { BrowserSession, progressiveScroll } from "../browser.js";
import { ProviderError, type MarketplaceProvider } from "../provider.js";
import type { ListingDetails, ListingSummary, MarketplaceSearchCriteria } from "../types.js";
import { deduplicateListings } from "../../listings/deduplication.js";
import { OLX_SELECTORS } from "./selectors.js";
import { mapOlxDetails, parseOlxSearchCard, type OlxDetailDocument, type OlxSearchCard } from "./parser.js";

export class OlxProvider implements MarketplaceProvider {
  readonly name = "olx" as const;
  readonly #browser: BrowserSession;

  public constructor(
    private readonly storageStatePath: string,
    headless: boolean,
    private readonly maxListings: number,
    private readonly timeoutMs: number,
    private readonly logger: Logger,
    private readonly storeRawData: boolean,
    executablePath?: string,
  ) {
    this.#browser = new BrowserSession({ headless, storageStatePath, ...(executablePath ? { executablePath } : {}) });
  }

  async search(criteria: MarketplaceSearchCriteria): Promise<ListingSummary[]> {
    await this.requireSession();
    const page = await this.#browser.page();
    try {
      page.setDefaultTimeout(this.timeoutMs);
      const url = new URL("https://www.olx.com.br/brasil");
      url.searchParams.set("q", criteria.query);
      if (criteria.minPrice != null) url.searchParams.set("ps", String(Math.round(criteria.minPrice)));
      if (criteria.maxPrice != null) url.searchParams.set("pe", String(Math.round(criteria.maxPrice)));
      await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
      await this.assertNotBlocked(page);
      await this.waitForAnySelector(page, OLX_SELECTORS.resultLinks);
      await progressiveScroll(page, 8);
      const cards = await page.evaluate((selectors): OlxSearchCard[] => {
        const elements = selectors.resultLinks.flatMap((selector) => [...document.querySelectorAll<HTMLAnchorElement>(selector)]);
        return [...new Set(elements)].map((element) => {
          const card = element.closest<HTMLElement>(selectors.resultCards.join(",")) ?? element;
          const pricePattern = /R\$\s*[\d.]+(?:,\d{2})?/i;
          const priceText = [
            card.innerText,
            ...[...card.querySelectorAll<HTMLElement>(selectors.resultPrice.join(","))]
              .map((candidate) => candidate.textContent?.trim() ?? ""),
          ]
            .flatMap((candidate) => candidate.split("\n").map((line) => line.trim()).filter(Boolean))
            .filter((candidate) => !/\b\d+\s*x\s*(?:de\s*)?R\$/i.test(candidate) && !/parcel(?:a|amento)/i.test(candidate))
            .map((candidate) => candidate.match(pricePattern)?.[0] ?? null)
            .find((candidate): candidate is string => candidate !== null)
            ?? null;
          return {
            href: element.href,
            title: element.querySelector("h2")?.textContent ?? element.getAttribute("title"),
            text: card.innerText,
            priceText,
            image: card.querySelector("img")?.src ?? null,
          };
        });
      }, OLX_SELECTORS);
      const parsed = cards.map(parseOlxSearchCard).filter((item): item is ListingSummary => item !== null);
      return deduplicateListings(parsed).slice(0, Math.min(criteria.limit, this.maxListings));
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("olx_search_failed", "OLX web search failed; inspect current layout", true, { cause: error });
    } finally {
      await page.close().catch((error: unknown) => { this.logger.warn({ event: "browser_page_close_failed", provider: this.name, err: error }, "Browser page could not be closed cleanly"); });
    }
  }

  async getListingDetails(listing: ListingSummary): Promise<ListingDetails> {
    await this.requireSession();
    const page = await this.#browser.page();
    try {
      page.setDefaultTimeout(this.timeoutMs);
      await page.goto(listing.url, { waitUntil: "domcontentloaded" });
      await this.assertNotBlocked(page);
      await page.locator([
        'script[type="application/ld+json"]',
        ...OLX_SELECTORS.detailTitle,
        ...OLX_SELECTORS.detailDescription,
      ].join(",")).first().waitFor({ state: "attached" });
      const detail = await page.evaluate((selectors): OlxDetailDocument => {
        const firstText = (candidates: readonly string[]): string | null => {
          for (const selector of candidates) {
            const text = document.querySelector(selector)?.textContent?.trim();
            if (text) return text;
          }
          return null;
        };
        const jsonLdValues = [...document.querySelectorAll('script[type="application/ld+json"]')]
          .flatMap((script): Record<string, unknown>[] => {
            try {
              const parsed = JSON.parse(script.textContent ?? "null") as unknown;
              const roots = Array.isArray(parsed) ? parsed : [parsed];
              return roots.flatMap((root) => {
                if (!root || typeof root !== "object" || Array.isArray(root)) return [];
                const record = root as Record<string, unknown>;
                const graph = Array.isArray(record["@graph"]) ? record["@graph"] : [];
                return [record, ...graph.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))];
              });
            } catch { return []; }
          });
        const jsonLd = jsonLdValues.find((value) => {
          const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
          return types.includes("Product") || types.includes("Vehicle");
        });
        const offersValue = jsonLd?.["offers"];
        const offers = (Array.isArray(offersValue) ? offersValue : [offersValue])
          .filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value));
        const structuredPriceCandidates = offers.flatMap((offer): Array<string | number> => {
          const priceSpecificationValue = offer["priceSpecification"];
          const priceSpecifications = (Array.isArray(priceSpecificationValue) ? priceSpecificationValue : [priceSpecificationValue])
            .filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value));
          return [offer["price"], offer["lowPrice"], ...priceSpecifications.map((value) => value["price"])]
            .filter((value): value is string | number => typeof value === "string" || typeof value === "number");
        });
        const visiblePriceCandidates = [...document.querySelectorAll<HTMLElement>(selectors.detailPrice.join(","))]
          .flatMap((element): string[] => {
            const value = element.getAttribute("content") ?? element.getAttribute("value") ?? element.textContent?.trim();
            return value && !/\b\d+\s*x\s*(?:de\s*)?R\$/i.test(value) && !/parcel(?:a|amento)/i.test(value) ? [value] : [];
          });
        const mainText = document.querySelector("main")?.innerText ?? "";
        const priceCandidates = [
          ...structuredPriceCandidates,
          ...visiblePriceCandidates,
          ...(mainText.match(/R\$\s*[\d.]+(?:,\d{2})?/gi) ?? []),
        ];
        const imageData = jsonLd?.["image"];
        const jsonImages = Array.isArray(imageData) ? imageData.filter((item): item is string => typeof item === "string") : typeof imageData === "string" ? [imageData] : [];
        const attributes: Record<string, unknown> = {};
        for (const element of document.querySelectorAll(selectors.detailAttributes.join(","))) {
          const text = element.textContent?.trim();
          if (!text) continue;
          const [key, ...rest] = text.split(":");
          if (key && rest.length) attributes[key.trim()] = rest.join(":").trim();
        }
        return {
          title: (jsonLd?.["name"] as string | undefined) ?? firstText(selectors.detailTitle),
          description: (jsonLd?.["description"] as string | undefined) ?? firstText(selectors.detailDescription),
          priceText: priceCandidates[0] === undefined ? null : String(priceCandidates[0]),
          priceCandidates,
          location: firstText(["[aria-label*=Localização]", "[class*=location]"]),
          sellerName: firstText(selectors.detailSeller),
          images: [...new Set([...jsonImages, ...[...document.querySelectorAll<HTMLImageElement>("main img")].map((image) => image.src).filter((src) => /^https:\/\//.test(src))])],
          attributes,
          publishedAt: typeof jsonLd?.["datePosted"] === "string" ? jsonLd["datePosted"] : null,
        };
      }, OLX_SELECTORS);
      return mapOlxDetails(listing, detail, this.storeRawData);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      this.logger.warn({ event: "listing_details_failed", provider: this.name, url: listing.url, err: error }, "OLX detail failed");
      throw new ProviderError("olx_listing_details_failed", "Could not parse OLX listing details", true, { cause: error });
    } finally {
      await page.close().catch((error: unknown) => { this.logger.warn({ event: "browser_page_close_failed", provider: this.name, err: error }, "Browser page could not be closed cleanly"); });
    }
  }

  async inspect(url: string, outputPath: string): Promise<void> {
    await this.requireSession();
    const page = await this.#browser.page();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.screenshot({ path: outputPath, fullPage: true });
    } finally {
      await page.close().catch((error: unknown) => { this.logger.warn({ event: "browser_page_close_failed", provider: this.name, err: error }, "Browser page could not be closed cleanly"); });
    }
  }

  async close(): Promise<void> { await this.#browser.close(); }

  private async requireSession(): Promise<void> {
    try { await access(this.storageStatePath); }
    catch { throw new ProviderError("olx_session_missing", `Run npm run olx:login to create ${this.storageStatePath}`); }
  }

  private async waitForAnySelector(page: Page, selectors: readonly string[]): Promise<void> {
    for (const selector of selectors) {
      if (await page.locator(selector).first().isVisible().catch(() => false)) return;
    }
    await page.locator(selectors.join(",")).first().waitFor({ state: "attached" });
  }

  private async assertNotBlocked(page: Page): Promise<void> {
    const title = await page.title();
    const blocked = /cloudflare|attention required/i.test(title)
      || await page.getByText(/sorry, you have been blocked|unable to access olx\.com\.br/i).first().isVisible().catch(() => false);
    if (blocked) {
      this.logger.warn({ event: "provider_access_blocked", provider: this.name }, "OLX blocked this host; no bypass will be attempted");
      this.#browser.reloadOnNextPage();
      throw new ProviderError("olx_access_blocked", "OLX/Cloudflare blocked this host. Use an authorized normal-access environment; bypass is intentionally not implemented.");
    }
  }
}
