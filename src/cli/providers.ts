import { chmod, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createApplication } from "../app.js";
import { loadConfig } from "../config/env.js";
import { disconnectDatabase } from "../db/client.js";
import { FacebookMarketplaceProvider } from "../marketplaces/facebook/provider.js";
import { MercadoLivreWebProvider } from "../marketplaces/mercadolivre/web-provider.js";
import { OlxProvider } from "../marketplaces/olx/provider.js";
import { marketplaceNames, marketplaceNameSchema } from "../marketplaces/types.js";

function flag(values: readonly string[], name: string): string | undefined {
  const index = values.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = values[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing_flag_value:${name}`);
  return value;
}

async function main(): Promise<void> {
  const [command, providerArgument, ...flags] = process.argv.slice(2);
  const config = loadConfig();
  const app = createApplication(config);
  try {
    if (command === "list") {
      const enabled = new Set(app.marketplaces.list());
      console.table(marketplaceNames.map((name) => ({
        provider: name,
        enabled: enabled.has(name),
        mode: name === "mercadolivre" ? config.MERCADOLIVRE_MODE : "web",
      })));
      return;
    }
    if (command !== "test") throw new Error("Uso: npm run providers:list | npm run provider:test -- <facebook|olx|mercadolivre> [--query texto] [--inspect]");
    const providerName = marketplaceNameSchema.parse(providerArgument);
    if (!app.marketplaces.has(providerName)) throw new Error(`provider_disabled:${providerName}`);
    const provider = app.marketplaces.get(providerName);
    const query = flag(flags, "query") ?? "RTX 3060 Ti";
    const listings = await provider.search({ query, maxPrice: null, minPrice: null, location: null, radiusKm: null, limit: 5 });
    const details = listings[0] ? await provider.getListingDetails(listings[0]) : null;
    console.dir({ provider: providerName, count: listings.length, listings, firstDetails: details }, { depth: 6 });
    if (flags.includes("--inspect") && listings[0]) {
      const debugDirectory = resolve("data/debug");
      await mkdir(debugDirectory, { recursive: true, mode: 0o700 });
      await chmod(debugDirectory, 0o700);
      const path = resolve(debugDirectory, `${providerName}-${Date.now()}.png`);
      if (provider instanceof FacebookMarketplaceProvider || provider instanceof OlxProvider || provider instanceof MercadoLivreWebProvider) {
        await provider.inspect(listings[0].url, path);
        await chmod(path, 0o600);
        console.log(`Screenshot de inspeção salvo em ${path} (diretório ignorado pelo Git).`);
      } else console.warn("--inspect está disponível somente para providers web.");
    }
  } finally { await app.shutdown(); }
}

try { await main(); }
catch (error) {
  console.error(error instanceof Error ? error.message : "Falha inesperada.");
  process.exitCode = 1;
} finally { await disconnectDatabase(); }
