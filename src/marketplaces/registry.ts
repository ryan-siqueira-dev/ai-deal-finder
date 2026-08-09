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

  list(): MarketplaceName[] {
    return [...this.#providers.keys()];
  }

  async close(): Promise<void> {
    await Promise.all([...this.#providers.values()].map((provider) => provider.close?.()));
  }
}
