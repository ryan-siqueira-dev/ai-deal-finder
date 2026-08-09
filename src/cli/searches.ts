import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createApplication } from "../app.js";
import { loadConfig } from "../config/env.js";
import { disconnectDatabase, prisma } from "../db/client.js";
import { listingCategorySchema } from "../categories/types.js";
import { marketplaceNameSchema } from "../marketplaces/types.js";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const command = process.argv[2];
if (command === "create") {
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const query = flag("query") ?? await readline.question("Consulta: ");
    const promptedName = flag("name") ?? await readline.question(`Nome [${query}]: `);
    const name = promptedName || query;
    const promptedCategory = flag("category") ?? await readline.question("Categoria [generic]: ");
    const category = listingCategorySchema.parse(promptedCategory || "generic");
    const providers = (flag("providers") ?? "facebook,olx,mercadolivre").split(",").map((item) => marketplaceNameSchema.parse(item.trim()));
    const search = await prisma.search.create({ data: {
      name, query, category, providers,
      minPrice: flag("min-price") ? Number(flag("min-price")) : null,
      maxPrice: flag("max-price") ? Number(flag("max-price")) : null,
      minYear: flag("min-year") ? Number(flag("min-year")) : null,
      maxYear: flag("max-year") ? Number(flag("max-year")) : null,
      location: flag("location") ?? null,
      radiusKm: flag("radius-km") ? Number(flag("radius-km")) : null,
      minimumScore: flag("minimum-score") ? Number(flag("minimum-score")) : 70,
      intervalMinutes: flag("interval-minutes") ? Number(flag("interval-minutes")) : 60,
      forbiddenWords: (flag("forbidden-words") ?? "").split(",").map((item) => item.trim()).filter(Boolean),
    } });
    console.log(`Pesquisa criada: ${search.id}`);
  } finally { readline.close(); await disconnectDatabase(); }
} else if (command === "list") {
  const rows = await prisma.search.findMany({ orderBy: { createdAt: "desc" } });
  console.table(rows.map((row) => ({ id: row.id, name: row.name, query: row.query, category: row.category, providers: row.providers.join(","), active: row.active, lastRunAt: row.lastRunAt })));
  await disconnectDatabase();
} else if (command === "run") {
  const app = createApplication(loadConfig());
  try {
    const id = flag("id");
    const searches = await prisma.search.findMany({ where: id ? { id } : { active: true } });
    if (!searches.length) throw new Error("Nenhuma pesquisa encontrada.");
    for (const search of searches) await app.runner.run(search);
  } finally { await app.shutdown(); await disconnectDatabase(); }
} else {
  console.error("Uso: npm run search:create -- [--query ...] | npm run search:list | npm run search:run -- [--id ID]");
  process.exitCode = 1;
}
