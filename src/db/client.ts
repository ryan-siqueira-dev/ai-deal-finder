import "dotenv/config";
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  log: process.env.LOG_LEVEL === "debug" ? ["warn", "error"] : ["error"],
});

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
