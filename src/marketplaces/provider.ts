import type { ListingDetails, ListingSummary, MarketplaceName, MarketplaceSearchCriteria } from "./types.js";

export interface MarketplaceProvider {
  readonly name: MarketplaceName;
  search(criteria: MarketplaceSearchCriteria): Promise<ListingSummary[]>;
  getListingDetails(listing: ListingSummary): Promise<ListingDetails>;
  close?(): Promise<void>;
}

export class ProviderError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProviderError";
  }
}
