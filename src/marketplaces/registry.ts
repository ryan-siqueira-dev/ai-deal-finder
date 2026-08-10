import type { MarketplaceProvider } from "./provider.js";
import type { MarketplaceName } from "./types.js";

export class MarketplaceRegistry {
  readonly #providers = new Map<MarketplaceName, MarketplaceProvider>();

  register(provider: MarketplaceProvider): void {
    if (this.#providers.has(provider.name)) {
      throw new Error(`marketplace_provider_already_registered: ${provider.name}`);
    }
    this.#providers.set(provider.name, provider);
  }

  get(name: MarketplaceName): MarketplaceProvider {
    const provider = this.#providers.get(name);
    if (!provider) throw new Error(`marketplace_provider_not_registered: ${name}`);
    return provider;
  }

  has(name: MarketplaceName): boolean {
    return this.#providers.has(name);
  }

  list(): MarketplaceName[] {
    return [...this.#providers.keys()];
  }

  async close(): Promise<void> {
    const operations = [...this.#providers.values()].flatMap((provider) => provider.close ? [provider.close()] : []);
    const results = await Promise.allSettled(operations);
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map((failure) => failure.reason), "marketplace_shutdown_failed");
  }
}
