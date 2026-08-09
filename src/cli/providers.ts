import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createApplication } from "../app.js";
import { loadConfig } from "../config/env.js";
import { marketplaceNameSchema } from "../marketplaces/types.js";
import { FacebookMarketplaceProvider } from "../marketplaces/facebook/provider.js";
import { OlxProvider } from "../marketplaces/olx/provider.js";
import { disconnectDatabase } from "../db/client.js";

const [command, providerArgument, ...flags] = process.argv.slice(2);
const app = createApplication(loadConfig());
try {
  if (command === "list") {
    console.table(app.marketplaces.list().map((name) => ({ provider: name, enabled: true })));
  } else if (command === "test") {
    const providerName = marketplaceNameSchema.parse(providerArgument);
    const provider = app.marketplaces.get(providerName);
    const queryIndex = flags.indexOf("--query");
    const query = queryIndex >= 0 ? flags[queryIndex + 1] ?? "RTX 3060 Ti" : "RTX 3060 Ti";
    const listings = await provider.search({ query, maxPrice: null, minPrice: null, location: null, radiusKm: null, limit: 5 });
    const details = listings[0] ? await provider.getListingDetails(listings[0]) : null;
    console.dir({ provider: providerName, count: listings.length, listings, firstDetails: details }, { depth: 6 });
    if (flags.includes("--inspect") && listings[0]) {
      await mkdir(resolve("data/debug"), { recursive: true });
      const path = resolve(`data/debug/${providerName}-${Date.now()}.png`);
      if (provider instanceof FacebookMarketplaceProvider || provider instanceof OlxProvider) {
        await provider.inspect(listings[0].url, path);
        console.log(`Screenshot de inspeção salvo em ${path} (diretório ignorado pelo Git).`);
      }
    }
  } else {
    throw new Error("Uso: npm run providers:list | npm run provider:test -- <facebook|olx|mercadolivre> [--query texto] [--inspect]");
  }
} finally {
  await app.shutdown();
  await disconnectDatabase();
}
