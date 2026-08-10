import { access, readFile } from "node:fs/promises";
import type { BrowserContext } from "playwright";
import { chromium } from "playwright";
import type { Logger } from "pino";
import { deduplicateListings } from "../../listings/deduplication.js";
import { normalizeTitle } from "../../utils/normalization.js";
import { progressiveScroll } from "../browser.js";
import { ProviderError, type MarketplaceProvider } from "../provider.js";
import type { ListingDetails, ListingSummary, MarketplaceSearchCriteria } from "../types.js";
import type { MercadoLivreTokenManagerOptions } from "./auth.js";
import { MercadoLivreClient } from "./client.js";
import { parseMercadoLivreWebCard, type MercadoLivreWebCard } from "./web-parser.js";

export class MercadoLivreWebProvider implements MarketplaceProvider {
  readonly name = "mercadolivre" as const;
  readonly #api: MercadoLivreClient;
  #context: BrowserContext | null = null;
  #initializing: Promise<BrowserContext> | null = null;
  #sessionRestored = false;
  #closed = false;

  public constructor(
    private readonly profilePath: string,
    private readonly storageStatePath: string,
    private readonly headless: boolean,
    private readonly maxListings: number,
    private readonly timeoutMs: number,
    private readonly logger: Logger,
    tokenOptions: MercadoLivreTokenManagerOptions,
    private readonly executablePath?: string,
  ) {
    this.#api = new MercadoLivreClient(tokenOptions, timeoutMs, logger);
  }

  async search(criteria: MarketplaceSearchCriteria): Promise<ListingSummary[]> {
    await this.requireProfile();
    const page = await (await this.context()).newPage();
    try {
      page.setDefaultTimeout(this.timeoutMs);
      const slug = normalizeTitle(criteria.query).replace(/\s+/g, "-");
      const response = await page.goto(`https://lista.mercadolivre.com.br/${encodeURIComponent(slug)}`, { waitUntil: "domcontentloaded" });
      const title = await page.title();
      if (response?.status() === 403 || /seguridad|security|entrar|login/i.test(title) || /\/(captcha|login)\//.test(page.url())) {
        throw new ProviderError("mercadolivre_web_challenge_required", "Mercado Livre requires a manual browser verification. Run npm run mercadolivre:web-login.");
      }
      await page.locator("li.ui-search-layout__item").first().waitFor({ state: "attached" });
      await progressiveScroll(page, 6, 700);
      const cards = await page.evaluate((): MercadoLivreWebCard[] =>
        [...document.querySelectorAll<HTMLElement>("li.ui-search-layout__item")].map((card) => {
          const link = card.querySelector<HTMLAnchorElement>("a.poly-component__title");
          const amount = card.querySelector<HTMLElement>(".poly-price__amount, .andes-money-amount");
          const location = card.querySelector<HTMLElement>(".poly-component__location, [class*=location]");
          return {
            href: link?.href ?? "",
            title: link?.textContent ?? null,
            priceText: amount?.getAttribute("aria-label") ?? amount?.textContent ?? null,
            image: card.querySelector<HTMLImageElement>("img")?.src ?? null,
            location: location?.textContent ?? null,
          };
        }));
      const parsed = deduplicateListings(cards.map(parseMercadoLivreWebCard).filter((item): item is ListingSummary => item !== null))
        .filter((item) => criteria.minPrice == null || item.price == null || item.price >= criteria.minPrice)
        .filter((item) => criteria.maxPrice == null || item.price == null || item.price <= criteria.maxPrice);
      return parsed.slice(0, Math.min(criteria.limit, this.maxListings));
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("mercadolivre_web_search_failed", "Mercado Livre web search failed; refresh the browser profile if verification is requested", true, { cause: error });
    } finally {
      await page.close().catch((error: unknown) => { this.logger.warn({ event: "browser_page_close_failed", provider: this.name, err: error }, "Browser page could not be closed cleanly"); });
    }
  }

  async getListingDetails(listing: ListingSummary): Promise<ListingDetails> {
    let description: string | null = null;
    if (listing.externalId) {
      try { description = await this.#api.getDescription(listing.externalId); }
      catch (error) {
        this.logger.warn({ event: "listing_details_partial", provider: this.name, externalId: listing.externalId, err: error }, "Mercado Livre description unavailable; summary retained");
      }
    }
    return {
      ...listing,
      description,
      sellerName: null,
      images: listing.imageUrl ? [listing.imageUrl] : [],
      attributes: {},
      publishedAt: null,
      rawData: undefined,
    };
  }

  async inspect(url: string, outputPath: string): Promise<void> {
    await this.requireProfile();
    const page = await (await this.context()).newPage();
    try {
      page.setDefaultTimeout(this.timeoutMs);
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.screenshot({ path: outputPath, fullPage: true });
    } finally { await page.close().catch((error: unknown) => { this.logger.warn({ event: "browser_page_close_failed", provider: this.name, err: error }, "Browser page could not be closed cleanly"); }); }
  }

  async close(): Promise<void> {
    this.#closed = true;
    await this.#initializing?.catch(() => undefined);
    const context = this.#context;
    this.#context = null;
    this.#initializing = null;
    this.#sessionRestored = false;
    await context?.close();
  }

  private async requireProfile(): Promise<void> {
    try { await access(this.profilePath); }
    catch { throw new ProviderError("mercadolivre_web_profile_missing", `Run npm run mercadolivre:web-login to create ${this.profilePath}`); }
  }

  private async context(): Promise<BrowserContext> {
    if (this.#closed) throw new ProviderError("mercadolivre_web_provider_closed", "Mercado Livre web provider is closed");
    if (this.#context) return this.#context;
    if (!this.#initializing) {
      this.#initializing = this.createContext().finally(() => { this.#initializing = null; });
    }
    return this.#initializing;
  }

  private async createContext(): Promise<BrowserContext> {
    const context = await chromium.launchPersistentContext(this.profilePath, {
      headless: this.headless,
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
      ...(this.executablePath ? { executablePath: this.executablePath } : {}),
    });
    if (this.#closed) {
      await context.close().catch(() => undefined);
      throw new ProviderError("mercadolivre_web_provider_closed", "Mercado Livre web provider is closed");
    }
    this.#context = context;
    if (!this.#sessionRestored) {
      try {
        const state = JSON.parse(await readFile(this.storageStatePath, "utf8")) as {
          cookies?: Parameters<BrowserContext["addCookies"]>[0];
        };
        if (Array.isArray(state.cookies) && state.cookies.length > 0) await context.addCookies(state.cookies);
      } catch (error) {
        this.logger.warn({ event: "mercadolivre_web_session_restore_failed", err: error }, "Mercado Livre web cookies could not be restored");
      }
      this.#sessionRestored = true;
    }
    return context;
  }
}
