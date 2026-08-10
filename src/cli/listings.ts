import { createInterface, type Interface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Prisma } from "@prisma/client";
import { disconnectDatabase, prisma } from "../db/client.js";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing_flag_value:${name}`);
  return value;
}

function requiredFlag(name: string): string {
  const value = flag(name)?.trim();
  if (!value) throw new Error(`missing_required_flag:${name}`);
  return value;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function recentListings(): Promise<void> {
  const rawLimit = flag("limit");
  const limit = rawLimit === undefined ? 30 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("invalid_flag:limit");
  const listings = await prisma.listing.findMany({
    where: { suppressedAt: null },
    orderBy: { lastSeenAt: "desc" },
    take: limit,
    include: { analyses: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  console.table(listings.map((listing) => ({
    id: listing.id,
    source: listing.source,
    category: listing.category,
    title: listing.title,
    price: listing.price?.toNumber() ?? null,
    score: listing.analyses[0]?.score ?? null,
    lastSeenAt: listing.lastSeenAt,
  })));
}

async function deleteListing(): Promise<void> {
  const id = requiredFlag("id");
  const listing = await prisma.listing.findUnique({
    where: { id },
    select: { id: true, title: true, source: true, normalizedUrl: true, suppressedAt: true },
  });
  if (!listing) throw new Error(`listing_not_found:${id}`);
  if (listing.suppressedAt) {
    console.log(`Anúncio já está removido e sua identidade conhecida está suprimida: ${id}`);
    return;
  }
  let readline: Interface | null = null;
  try {
    if (!hasFlag("yes")) {
      if (!stdin.isTTY || !stdout.isTTY) throw new Error("delete_requires_yes_in_non_interactive_terminal");
      readline = createInterface({ input: stdin, output: stdout });
      const answer = await readline.question(`Remover “${listing.title}” (${listing.source}), apagar seus dados e suprimir a identidade conhecida? Digite EXCLUIR: `);
      if (answer !== "EXCLUIR") {
        console.log("Exclusão cancelada.");
        return;
      }
    }
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await prisma.$transaction(async (transaction) => {
          const [current] = await transaction.$queryRaw<Array<{ normalizedUrl: string; suppressedAt: Date | null }>>(Prisma.sql`
            SELECT "normalizedUrl", "suppressedAt"
            FROM "Listing"
            WHERE "id" = ${id}
            FOR UPDATE
          `);
          if (!current) throw new Error(`listing_not_found:${id}`);
          if (current.suppressedAt) return;
          await transaction.crossMarketplaceMatch.deleteMany({
            where: { OR: [{ listingAId: id }, { listingBId: id }] },
          });
          await transaction.notification.deleteMany({ where: { listingId: id } });
          await transaction.listingAnalysis.deleteMany({ where: { listingId: id } });
          await transaction.listingPriceHistory.deleteMany({ where: { listingId: id } });
          await transaction.structuredListingData.deleteMany({ where: { listingId: id } });
          await transaction.searchListing.deleteMany({ where: { listingId: id } });
          await transaction.listing.update({
            where: { id },
            data: {
              title: "[item removido]",
              description: null,
              price: null,
              currency: null,
              location: null,
              sellerName: null,
              url: current.normalizedUrl,
              imageUrl: null,
              images: [],
              attributes: Prisma.JsonNull,
              publishedAt: null,
              active: false,
              rawData: Prisma.JsonNull,
              contentHash: null,
              suppressedAt: new Date(),
            },
          });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        break;
      } catch (error) {
        const retryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
        if (!retryable || attempt === 3) throw error;
      }
    }
    console.log(`Anúncio removido, dados relacionados apagados e identidade conhecida suprimida: ${id}`);
  } finally { readline?.close(); }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "recent") await recentListings();
  else if (command === "delete") await deleteListing();
  else throw new Error("Uso: listings:recent [--limit N] | listings:delete --id ID [--yes]");
}

try { await main(); }
catch (error) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) console.error(`Falha no banco (${error.code}).`);
  else console.error(error instanceof Error ? error.message : "Falha inesperada.");
  process.exitCode = 1;
} finally { await disconnectDatabase(); }
