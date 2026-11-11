import { PrismaClient } from "@/lib/generated/prisma/client";
import { AccessPrismaPg } from "@/lib/access-adapter";

const globalForPrisma = globalThis as unknown as {
  accessScopedPrisma: PrismaClient | undefined;
};

function createClient() {
  const adapter = new AccessPrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma = globalForPrisma.accessScopedPrisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.accessScopedPrisma = prisma;
