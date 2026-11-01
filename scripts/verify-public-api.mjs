import assert from 'node:assert/strict';

const base = process.env.API_BASE_URL ?? 'https://leyde-braga-admin.vercel.app';
const storefront = process.env.STOREFRONT_ORIGIN ?? 'https://leyde-braga.vercel.app';
const health = await fetch(`${base}/api/v1/health`);
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), { status: 'ok' });
const list = await fetch(`${base}/api/v1/products?pageSize=100`, { headers: { Origin: storefront } });
assert.equal(list.status, 200);
assert.equal(list.headers.get('access-control-allow-origin'), storefront);
assert.equal(list.headers.get('access-control-allow-credentials'), null);
const catalog = await list.json();
assert.ok(['HIT', 'MISS'].includes(list.headers.get('x-catalog-cache')));
assert.equal(list.headers.get('cache-control'), 'no-store');
const repeated = await fetch(`${base}/api/v1/products?pageSize=100`, { headers: { Origin: storefront } });
assert.equal(repeated.status, 200);
assert.equal(repeated.headers.get('x-catalog-cache'), 'HIT');
assert.deepEqual(await repeated.json(), catalog);
assert.ok(catalog.pagination.total > 0);
assert.ok(catalog.data.length > 0);
const serialized = JSON.stringify(catalog);
for (const field of ['cost', 'stock', 'active', 'passwordHash', 'tokenHash', 'csrfHash']) assert.equal(serialized.includes(`"${field}":`), false);
for (const product of catalog.data) {
  assert.match(product.price, /^\d+\.\d{2}$/);
  assert.ok(Array.isArray(product.images));
  for (const [index, image] of product.images.entries()) {
    assert.equal(new URL(image.url).protocol, 'https:');
    assert.ok(image.alt.length > 0);
    assert.ok(Number.isInteger(image.order) && image.order >= 0);
    if (index > 0) assert.ok(product.images[index - 1].order <= image.order);
  }
}
const firstProduct = catalog.data[0];
const detail = await fetch(`${base}/api/v1/products/${encodeURIComponent(firstProduct.slug)}`);
assert.equal(detail.status, 200);
assert.equal((await detail.json()).data.id, firstProduct.id);
const search = await fetch(`${base}/api/v1/products?q=${encodeURIComponent(firstProduct.code)}&brand=${encodeURIComponent(firstProduct.brand.slug)}&category=${encodeURIComponent(firstProduct.category.slug)}`);
assert.equal(search.status, 200);
assert.ok((await search.json()).data.some((product) => product.id === firstProduct.id));
for (const resource of ['brands', 'categories']) {
  const response = await fetch(`${base}/api/v1/${resource}`);
  assert.equal(response.status, 200);
  assert.ok((await response.json()).data.length > 0);
}
const admin = await fetch(`${base}/api/v1/admin/products`);
assert.equal(admin.status, 401);
assert.equal(admin.headers.get('x-catalog-cache'), null);
const sourceFile = await fetch(`${base}/catalog/import-ready.json`);
assert.equal(sourceFile.status, 404);
const protectedPage = await fetch(`${base}/produtos`, { redirect: 'manual' });
assert.equal(protectedPage.status, 307);
assert.equal(protectedPage.headers.get('location'), '/login');
console.log(JSON.stringify({ result: 'passed', base, products: catalog.pagination.total, checks: ['health', 'catalog', 'images', 'money-strings', 'public-fields', 'details', 'search-and-filters', 'brands', 'categories', 'cors', 'admin-authorization', 'private-file', 'protected-pages'] }));
