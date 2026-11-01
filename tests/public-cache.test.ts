import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalogCacheSeconds, createPublicCatalogCache } from '../src/lib/public-cache';

function store() {
  const values = new Map<string, unknown>();
  return { values, async get(key: string) { return values.get(key) ?? null; },
    async set(key: string, value: unknown, options?: { ttl?: number }) { assert.equal(options?.ttl, catalogCacheSeconds); values.set(key, value); },
    async expireTag() { values.clear(); },
  };
}

test('cache separates filters, reuses public data and expires without serving stale values', async () => {
  const storage = store(); let now = 1000; let calls = 0;
  const cache = createPublicCatalogCache(storage, () => now);
  const load = async () => ({ data: [{ price: `${++calls}.00` }] });
  assert.equal((await cache.response('products:brand-a', load)).headers.get('X-Catalog-Cache'), 'MISS');
  const hit = await cache.response('products:brand-a', load);
  assert.equal(hit.headers.get('X-Catalog-Cache'), 'HIT');
  assert.equal(hit.headers.get('Cache-Control'), 'no-store');
  assert.equal(calls, 1);
  await cache.response('products:brand-b', load);
  assert.equal(calls, 2);
  now += catalogCacheSeconds * 1000;
  assert.equal((await cache.response('products:brand-a', load)).headers.get('X-Catalog-Cache'), 'MISS');
  assert.equal(calls, 3);
});

test('database failures are never cached, and cache outages do not hide fresh data', async () => {
  const storage = store(); const cache = createPublicCatalogCache(storage);
  await assert.rejects(cache.response('missing', async () => { throw new Error('not found'); }));
  assert.equal(storage.values.size, 0);
  const unavailable = createPublicCatalogCache({ async get() { throw new Error(); }, async set() { throw new Error(); }, async expireTag() { throw new Error(); } });
  assert.deepEqual(await (await unavailable.response('products', async () => ({ data: [] }))).json(), { data: [] });
  await unavailable.invalidate();
});

test('mutations clear the cache and prevent an older in-flight read from filling it again', async () => {
  const storage = store(); const cache = createPublicCatalogCache(storage);
  await cache.response('products', async () => ({ data: ['before'] }));
  let finish!: (value: unknown) => void;
  const loading = cache.response('detail', () => new Promise((resolve) => { finish = resolve; }));
  await Promise.resolve();
  await cache.invalidate();
  finish({ data: 'old detail' });
  await loading;
  assert.equal(storage.values.size, 0);
  const next = await cache.response('products', async () => ({ data: ['after'] }));
  assert.equal(next.headers.get('X-Catalog-Cache'), 'MISS');
  assert.deepEqual(await next.json(), { data: ['after'] });
});
