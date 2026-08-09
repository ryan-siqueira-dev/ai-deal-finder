import type { Logger } from "pino";
import { ProviderError } from "../provider.js";
import type { MarketplaceSearchCriteria } from "../types.js";
import { fetchWithRetry } from "../../utils/http.js";
import { mlDescriptionSchema, mlItemSchema, mlSearchResponseSchema, type MlItem, type MlSearchItem } from "./schemas.js";
import { MercadoLivreTokenManager, type MercadoLivreTokenManagerOptions } from "./auth.js";

export class MercadoLivreClient {
  readonly #baseUrl = "https://api.mercadolibre.com";
  readonly #tokens: MercadoLivreTokenManager;

  public constructor(
    tokenOptions: MercadoLivreTokenManagerOptions,
    private readonly timeoutMs: number,
    private readonly logger: Logger,
  ) {
    this.#tokens = new MercadoLivreTokenManager(tokenOptions);
  }

  async search(criteria: MarketplaceSearchCriteria): Promise<MlSearchItem[]> {
    const results: MlSearchItem[] = [];
    let offset = 0;
    while (results.length < criteria.limit) {
      const pageLimit = Math.min(50, criteria.limit - results.length);
      const url = new URL("/sites/MLB/search", this.#baseUrl);
      url.searchParams.set("q", criteria.query);
      url.searchParams.set("limit", String(pageLimit));
      url.searchParams.set("offset", String(offset));
      if (criteria.minPrice != null || criteria.maxPrice != null) {
        url.searchParams.set("price", `${criteria.minPrice ?? "*"}-${criteria.maxPrice ?? "*"}`);
      }
      const response = await this.request(url);
      const parsed = mlSearchResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new ProviderError("mercadolivre_invalid_response", parsed.error.message);
      results.push(...parsed.data.results);
      offset += parsed.data.results.length;
      if (parsed.data.results.length === 0 || offset >= parsed.data.paging.total) break;
    }
    return results.slice(0, criteria.limit);
  }

  async getItem(id: string): Promise<MlItem> {
    const response = await this.request(new URL(`/items/${encodeURIComponent(id)}`, this.#baseUrl));
    const parsed = mlItemSchema.safeParse(await response.json());
    if (!parsed.success) throw new ProviderError("mercadolivre_invalid_item", parsed.error.message);
    return parsed.data;
  }

  async getDescription(id: string): Promise<string | null> {
    const response = await this.request(new URL(`/items/${encodeURIComponent(id)}/description`, this.#baseUrl), true);
    if (response.status === 404) return null;
    const parsed = mlDescriptionSchema.safeParse(await response.json());
    if (!parsed.success) return null;
    return parsed.data.plain_text ?? parsed.data.text ?? null;
  }

  private async request(url: URL, allowNotFound = false): Promise<Response> {
    let accessToken = await this.#tokens.getAccessToken();
    let response = await this.requestOnce(url, accessToken);
    if (response.status === 401 && accessToken) {
      try {
        accessToken = await this.#tokens.refreshAccessToken();
        response = await this.requestOnce(url, accessToken);
      } catch (error) {
        this.logger.warn({ event: "mercadolivre_token_refresh_failed", err: error }, "Mercado Livre token refresh failed");
      }
    }
    if (allowNotFound && response.status === 404) return response;
    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);
      this.logger.warn({ event: "provider_search_failed", provider: "mercadolivre", status: response.status }, "Mercado Livre API error");
      const code = response.status === 401 || response.status === 403
        ? "mercadolivre_auth_required_or_invalid"
        : "mercadolivre_http_error";
      throw new ProviderError(code, `Mercado Livre API returned ${response.status}: ${body}`, response.status >= 500);
    }
    return response;
  }

  private async requestOnce(url: URL, accessToken: string | undefined): Promise<Response> {
    const headers = new Headers({ Accept: "application/json" });
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    return fetchWithRetry(url, { headers }, { timeoutMs: this.timeoutMs, retries: 2 });
  }
}
