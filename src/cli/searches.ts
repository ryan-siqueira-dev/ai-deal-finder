import { createInterface, type Interface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { createApplication } from "../app.js";
import { loadConfig, type AppConfig } from "../config/env.js";
import { disconnectDatabase, prisma } from "../db/client.js";
import { marketplaceNames, type MarketplaceName } from "../marketplaces/types.js";
import { optionalNumber, searchDefinitionSchema } from "../searches/validation.js";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing_flag_value:${name}`);
  return value;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function requiredFlag(name: string): string {
  const value = flag(name)?.trim();
  if (!value) throw new Error(`missing_required_flag:${name}`);
  return value;
}

function enabledProviders(config: AppConfig): MarketplaceName[] {
  return marketplaceNames.filter((provider) => {
    if (provider === "facebook") return config.FACEBOOK_ENABLED;
    if (provider === "olx") return config.OLX_ENABLED;
    return config.MERCADOLIVRE_ENABLED;
  });
}

async function createSearch(): Promise<void> {
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const query = flag("query") ?? await readline.question("Consulta: ");
    const promptedName = flag("name") ?? await readline.question(`Nome [${query}]: `);
    const promptedCategory = flag("category") ?? await readline.question("Categoria [generic]: ");
    const config = loadConfig();
    const defaultProviders = enabledProviders(config);
    if (!defaultProviders.length && !flag("providers")) throw new Error("no_provider_enabled");
    const providers = (flag("providers") ?? defaultProviders.join(",")).split(",").map((item) => item.trim());
    const definition = searchDefinitionSchema.parse({
      name: promptedName || query,
      query,
      category: promptedCategory || "generic",
      providers,
      minPrice: optionalNumber(flag("min-price"), "min-price"),
      maxPrice: optionalNumber(flag("max-price"), "max-price"),
      minYear: optionalNumber(flag("min-year"), "min-year"),
      maxYear: optionalNumber(flag("max-year"), "max-year"),
      location: flag("location")?.trim() || null,
      radiusKm: optionalNumber(flag("radius-km"), "radius-km"),
      minimumScore: optionalNumber(flag("minimum-score"), "minimum-score") ?? 70,
      intervalMinutes: optionalNumber(flag("interval-minutes"), "interval-minutes") ?? 60,
      forbiddenWords: (flag("forbidden-words") ?? "").split(",").map((item) => item.trim()).filter(Boolean),
    });
    const disabled = definition.providers.filter((provider) => !defaultProviders.includes(provider));
    if (disabled.length) console.warn(`Aviso: providers atualmente desabilitados: ${disabled.join(", ")}`);
    const search = await prisma.search.create({ data: definition });
    console.log(`Pesquisa criada: ${search.id}`);
  } finally { readline.close(); }
}

async function listSearches(): Promise<void> {
  const rows = await prisma.search.findMany({ orderBy: { createdAt: "desc" } });
  console.table(rows.map((row) => ({
    id: row.id,
    name: row.name,
    query: row.query,
    category: row.category,
    providers: row.providers.join(","),
    minPrice: row.minPrice?.toNumber() ?? null,
    maxPrice: row.maxPrice?.toNumber() ?? null,
    years: row.minYear || row.maxYear ? `${row.minYear ?? "…"}–${row.maxYear ?? "…"}` : null,
    location: row.location,
    radiusKm: row.radiusKm,
    minimumScore: row.minimumScore,
    intervalMinutes: row.intervalMinutes,
    forbiddenWords: row.forbiddenWords.join(","),
    active: row.active,
    lastRunAt: row.lastRunAt,
  })));
}

async function setSearchActive(active: boolean): Promise<void> {
  const id = requiredFlag("id");
  const result = await prisma.search.updateMany({ where: { id }, data: { active } });
  if (!result.count) throw new Error(`search_not_found:${id}`);
  console.log(`Pesquisa ${active ? "ativada" : "desativada"}: ${id}`);
}

async function deleteSearch(): Promise<void> {
  const id = requiredFlag("id");
  const search = await prisma.search.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!search) throw new Error(`search_not_found:${id}`);
  let readline: Interface | null = null;
  try {
    if (!hasFlag("yes")) {
      if (!stdin.isTTY || !stdout.isTTY) throw new Error("delete_requires_yes_in_non_interactive_terminal");
      readline = createInterface({ input: stdin, output: stdout });
      const answer = await readline.question(`Excluir definitivamente “${search.name}” e seus vínculos/análises? Digite EXCLUIR: `);
      if (answer !== "EXCLUIR") {
        console.log("Exclusão cancelada.");
        return;
      }
    }
    await prisma.search.delete({ where: { id } });
    console.log(`Pesquisa excluída: ${id}`);
  } finally { readline?.close(); }
}

async function runSearches(): Promise<void> {
  const app = createApplication(loadConfig());
  try {
    const id = flag("id")?.trim();
    const searches = await prisma.search.findMany({ where: id ? { id } : { active: true } });
    if (!searches.length) throw new Error("Nenhuma pesquisa encontrada.");
    for (const search of searches) await app.runner.run(search);
  } finally { await app.shutdown(); }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "create") await createSearch();
  else if (command === "list") await listSearches();
  else if (command === "run") await runSearches();
  else if (command === "disable") await setSearchActive(false);
  else if (command === "enable") await setSearchActive(true);
  else if (command === "delete") await deleteSearch();
  else throw new Error("Uso: search:create | search:list | search:run [--id ID] | search:disable --id ID | search:enable --id ID | search:delete --id ID [--yes]");
}

try { await main(); }
catch (error) {
  if (error instanceof z.ZodError) {
    console.error(`Dados inválidos: ${error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
    console.error(`Falha no banco (${error.code}).`);
  } else console.error(error instanceof Error ? error.message : "Falha inesperada.");
  process.exitCode = 1;
} finally { await disconnectDatabase(); }
