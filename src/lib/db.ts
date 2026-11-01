import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { selectDatabaseUrl } from './database-url';

const globalDatabase = globalThis as unknown as { prisma?: PrismaClient };
export const db = globalDatabase.prisma ?? new PrismaClient({
  adapter: new PrismaPg({ connectionString: selectDatabaseUrl(), max: 1, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000 }),
  // Cold serverless connections can take longer than Prisma's default 2s acquisition wait.
  transactionOptions: { maxWait: 15000, timeout: 15000 },
});
globalDatabase.prisma = db;
