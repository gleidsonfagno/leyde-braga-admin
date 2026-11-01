import { createHash } from 'node:crypto';
import { getCache } from '@vercel/functions';
import { json } from './http';

export const catalogCacheSeconds = 60;
const namespace = `${process.env.VERCEL_PROJECT_ID ?? 'leyde-braga-admin'}:public-catalog:v1`;
const tag = `${namespace}:catalog`;
type Store = Pick<ReturnType<typeof getCache>, 'get' | 'set' | 'expireTag'>;

export function createPublicCatalogCache(store: Store, clock = Date.now) {
  let generation = 0;
  return {
    async response(key: string, load: () => Promise<unknown>) {
      const version = generation;
      try {
        const cached = await store.get(key) as { data?: unknown; expiresAt?: number } | null;
        if (cached && typeof cached.expiresAt === 'number' && cached.expiresAt > clock() && 'data' in cached) {
          const response = json(cached.data);
          response.headers.set('X-Catalog-Cache', 'HIT');
          return response;
        }
      } catch { console.warn('Catalog cache unavailable', { operation: 'read' }); }
      // Only successful, explicitly selected public data reaches the cache.
      const data = await load();
      if (version === generation) {
        try {
          await store.set(key, { data, expiresAt: clock() + catalogCacheSeconds * 1000 }, {
            ttl: catalogCacheSeconds, tags: [tag], name: 'public-catalog',
          });
        } catch { console.warn('Catalog cache unavailable', { operation: 'write' }); }
      }
      const response = json(data);
      response.headers.set('X-Catalog-Cache', 'MISS');
      return response;
    },
    async invalidate() {
      generation++;
      try { await store.expireTag(tag); }
      catch { console.warn('Catalog cache unavailable', { operation: 'invalidate' }); }
    },
  };
}

export const publicCatalogCache = createPublicCatalogCache(getCache({
  namespace, keyHashFunction: (key) => createHash('sha256').update(key).digest('hex'),
}));
