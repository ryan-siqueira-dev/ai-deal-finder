import type { Logger } from "pino";
import type { MarketplaceProvider } from "../provider.js";
import type { ListingDetails, ListingSummary, MarketplaceSearchCriteria } from "../types.js";
import { deduplicateListings } from "../../listings/deduplication.js";
import { MercadoLivreClient } from "./client.js";
import { mapMercadoLivreDetails, mapMercadoLivreSummary } from "./mapper.js";
import type { MercadoLivreTokenManagerOptions } from "./auth.js";

export class MercadoLivreProvider implements MarketplaceProvider {
  readonly name = "mercadolivre" as const;
  readonly #client: MercadoLivreClient;

  public constructor(tokenOptions: MercadoLivreTokenManagerOptions, timeoutMs: number, logger: Logger) {
    this.#client = new MercadoLivreClient(tokenOptions, timeoutMs, logger);
  }

  async search(criteria: MarketplaceSearchCriteria): Promise<ListingSummary[]> {
    return deduplicateListings((await this.#client.search(criteria)).map(mapMercadoLivreSummary));
  }

  async getListingDetails(listing: ListingSummary): Promise<ListingDetails> {
    if (!listing.externalId) throw new Error("mercadolivre_listing_missing_external_id");
    const [item, description] = await Promise.all([
      this.#client.getItem(listing.externalId),
      this.#client.getDescription(listing.externalId),
    ]);
    return mapMercadoLivreDetails(item, description);
  }
}
