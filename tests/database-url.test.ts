import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectDatabaseUrl } from '../src/lib/database-url';

test('PostgreSQL runtime prefers pooled TCP and never sends Accelerate URLs to pg', () => {
  assert.equal(selectDatabaseUrl({ DATABASE_URL: 'prisma+postgres://example', DATABASE_URL_POOLED: 'postgresql://pool/db' }), 'postgresql://pool/db');
  assert.equal(selectDatabaseUrl({ DATABASE_URL: 'postgres://runtime/db' }), 'postgres://runtime/db');
  assert.equal(selectDatabaseUrl({ DATABASE_URL: 'prisma+postgres://example', POSTGRES_URL: 'postgres://direct/db' }), 'postgres://direct/db');
  assert.equal(selectDatabaseUrl({ DATABASE_URL: 'prisma+postgres://example' }), undefined);
});
test('migrations prefer the configured direct TCP URL', () => {
  assert.equal(selectDatabaseUrl({ DIRECT_URL: 'postgresql://direct/db', DATABASE_URL_POOLED: 'postgresql://pool/db' }, true), 'postgresql://direct/db');
  assert.equal(selectDatabaseUrl({ POSTGRES_URL: 'postgres://direct/db', DATABASE_URL_POOLED: 'postgresql://pool/db' }, true), 'postgres://direct/db');
});
