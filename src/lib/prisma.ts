import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPlanetScale } from "@prisma/adapter-planetscale";
import mysql from "mysql2/promise";

const globalForPrisma = global as unknown as { prisma?: PrismaClient };

function resolvePrismaClient() {
  // Prisma 7 + engineType="client" braucht entweder accelerateUrl ODER adapter.
  // Wir unterstützen beides, damit Deployments flexibel sind.
  const accelerateUrl = process.env.PRISMA_ACCELERATE_URL;
  const databaseUrl = process.env.DATABASE_URL;

  // 1) Accelerate/Data Proxy (prisma://...)
  if (accelerateUrl && accelerateUrl.trim().length > 0) {
    return new PrismaClient({
      accelerateUrl: accelerateUrl.trim(),
      log: ["error", "warn"],
    });
  }

  // 2) Driver Adapter (MySQL via mysql2 pool)
  if (!databaseUrl || databaseUrl.trim().length === 0) {
    throw new Error(
      "Prisma: Missing DATABASE_URL. Provide DATABASE_URL for driver adapter usage or PRISMA_ACCELERATE_URL for Accelerate."
    );
  }

  const pool = mysql.createPool(databaseUrl);
  const adapter = new PrismaPlanetScale(pool);

  return new PrismaClient({
    adapter,
    log: ["error", "warn"],
  });
}

export const prisma = globalForPrisma.prisma || resolvePrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;
