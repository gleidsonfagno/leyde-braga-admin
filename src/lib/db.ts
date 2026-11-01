import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { selectDatabaseUrl } from './database-url';

const globalDatabase = globalThis as unknown as { prisma?: PrismaClient; postgresPool?: Pool };

function createPool() {
  const pool = new Pool({
    connectionString: selectDatabaseUrl(), max: 5, min: 0,
    idleTimeoutMillis: 5000, connectionTimeoutMillis: 10000,
    keepAlive: true,
  });
  pool.on('error', (error: Error & { code?: string }) => {
    console.error('PostgreSQL pool failure', { code: typeof error.code === 'string' ? error.code : 'UNKNOWN' });
  });
  attachDatabasePool(pool);
  return pool;
}

const pool = globalDatabase.postgresPool ?? createPool();
globalDatabase.postgresPool = pool;
export const db = globalDatabase.prisma ?? new PrismaClient({
  adapter: new PrismaPg(pool, { disposeExternalPool: true }),
  transactionOptions: { maxWait: 15000, timeout: 15000 },
});
globalDatabase.prisma = db;
