import { prisma, disconnectDatabase } from "../db/client.js";

const command = process.argv[2];
if (command !== "recent") {
  console.error("Uso: npm run listings:recent");
  process.exitCode = 1;
} else {
  const listings = await prisma.listing.findMany({ orderBy: { lastSeenAt: "desc" }, take: 30, include: { analyses: { orderBy: { createdAt: "desc" }, take: 1 } } });
  console.table(listings.map((listing) => ({
    id: listing.id, source: listing.source, category: listing.category, title: listing.title,
    price: listing.price?.toNumber() ?? null, score: listing.analyses[0]?.score ?? null, lastSeenAt: listing.lastSeenAt,
  })));
  await disconnectDatabase();
}
