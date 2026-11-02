import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword, loginClient, sessionCookie, verifyPassword } from '../src/lib/auth';
import { body, endpoint, json, publicCors, requireSameOrigin } from '../src/lib/http';
import { productFilter, publicProductSelect, serializeProduct, serializePublicProduct } from '../src/lib/catalog';
import { Prisma } from '@prisma/client';
import { imageSchema, moneySchema, nonEmptyPatch, paginationSchema, productSchema } from '../src/lib/validation';

test('money requires exact decimal strings and rejects rounding, exponents and negatives', () => {
  for (const value of ['0.00', '0.10', '9999999999.99']) assert.equal(moneySchema.safeParse(value).success, true);
  for (const value of [0.1, '1', '1.001', '-1.00', '1e2', '10000000000.00', 'NaN']) assert.equal(moneySchema.safeParse(value).success, false);
  assert.equal(serializeProduct({ price: new Prisma.Decimal('0.10') }).price, '0.10');
});
test('validation rejects unknown fields, empty changes, bad pagination and unsafe image URLs', () => {
  assert.equal(nonEmptyPatch(productSchema).safeParse({}).success, false);
  assert.equal(nonEmptyPatch(productSchema).safeParse({ passwordHash: 'secret' }).success, false);
  assert.equal(nonEmptyPatch(productSchema).safeParse({ stock: -1 }).success, false);
  for (const query of [{ page: '0' }, { pageSize: '101' }, { page: '1.5' }, { active: 'true' }]) assert.equal(paginationSchema.safeParse(query).success, false);
  for (const url of ['http://example.com/a.jpg', 'file:///tmp/a', 'data:image/png;base64,a', 'javascript:alert(1)']) assert.equal(imageSchema.safeParse({ url, alt: '', order: 0 }).success, false);
  assert.equal(imageSchema.safeParse({ url: 'https://cdn.example.com/a.jpg', alt: '', order: 0 }).success, true);
});
test('public database selection excludes private fields at every level', () => {
  const selection = JSON.stringify(publicProductSelect);
  for (const field of ['cost', 'stock', 'passwordHash', 'active', 'createdAt', 'updatedAt']) assert.equal(selection.includes(`"${field}"`), false);
  const where = productFilter({ brand: 'brand', category: 'category', q: 'shoe' }, true);
  assert.equal(where.active, true);
  assert.deepEqual(where.brand, { active: true, slug: 'brand' });
  assert.deepEqual(where.category, { active: true, slug: 'category' });
});
test('public availability follows stock and never serializes private fields', () => {
  const taxonomy = { id: 'tax', name: 'Taxonomy', slug: 'taxonomy', active: true };
  const row = {
    id: 'product', code: 'CODE', slug: 'product', name: 'Product', description: 'Description',
    price: new Prisma.Decimal('12.30'), cost: new Prisma.Decimal('1.00'), stock: 9, active: true,
    createdAt: 'private', passwordHash: 'private', brand: taxonomy, category: taxonomy,
    images: [{ id: 'image', url: 'https://example.com/image.jpg', alt: 'Product', order: 0, productId: 'private' }],
  };
  for (const stock of [0, 1, 9]) {
    const result = serializePublicProduct({ ...row, stock });
    assert.equal(result.inStock, stock > 0);
    assert.equal(result.price, '12.30');
    assert.deepEqual(Object.keys(result).sort(), ['id', 'code', 'slug', 'name', 'description', 'price', 'inStock', 'brand', 'category', 'images'].sort());
    for (const field of ['cost', 'stock', 'active', 'createdAt', 'passwordHash', 'productId']) {
      assert.equal(JSON.stringify(result).includes('"' + field + '":'), false);
    }
  }
});

test('password hashes have random salts and verify without plaintext storage', async () => {
  const password = 'long-test-password-123';
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.equal(first.includes(password), false);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('incorrect', first), false);
  assert.equal(await verifyPassword(password, 'invalid'), false);
});
test('cookie is HttpOnly, same-site and host scoped', () => {
  const cookie = sessionCookie('test');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
  assert.equal(cookie.includes('Domain='), false);
  assert.match(sessionCookie('', 0), /Max-Age=0/);
});
test('client rate limit trusts platform headers only on Vercel', () => {
  const previous = process.env.VERCEL;
  try {
    delete process.env.VERCEL;
    const request = new Request('http://localhost', { headers: { 'x-vercel-forwarded-for': '192.0.2.1' } });
    assert.equal(loginClient(request), 'local');
    process.env.VERCEL = '1';
    assert.equal(loginClient(request), '192.0.2.1');
    assert.throws(() => loginClient(new Request('http://localhost')));
    assert.throws(() => loginClient(new Request('http://localhost', { headers: { 'x-vercel-forwarded-for': 'spoofed' } })));
  } finally {
    if (previous === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous;
  }
});
test('origin protection fails closed and CORS only permits exact configured origins', () => {
  process.env.APP_ORIGIN = 'http://localhost:3000';
  process.env.CORS_ORIGINS = 'https://shop.example.com';
  assert.doesNotThrow(() => requireSameOrigin(new Request('http://localhost:3000', { headers: { origin: 'http://localhost:3000' } })));
  for (const origin of [undefined, 'null', 'https://evil.example', 'http://localhost:3000.evil.example']) {
    assert.throws(() => requireSameOrigin(new Request('http://localhost:3000', { headers: origin ? { origin } : {} })));
  }
  for (const origin of ['https://evil.example', 'https://shop.example.com.evil.example']) assert.equal(publicCors(new Request('http://localhost', { headers: { origin } }), json({})).headers.has('Access-Control-Allow-Origin'), false);
  const response = publicCors(new Request('http://localhost', { headers: { origin: 'https://shop.example.com' } }), json({}));
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://shop.example.com');
  assert.equal(response.headers.has('Access-Control-Allow-Credentials'), false);
});
test('JSON size, content type and malformed JSON errors are sanitized', async () => {
  const handler = endpoint(async (request) => json(await body(request)));
  const request = (payload: string, type = 'application/json') => new Request('http://localhost', { method: 'POST', headers: { 'content-type': type }, body: payload });
  assert.equal((await handler(request('{'))).status, 400);
  assert.equal((await handler(request('{}', 'text/plain'))).status, 415);
  assert.equal((await handler(request('x'.repeat(65537)))).status, 413);
  const failure = await endpoint(async () => { throw new Error('postgresql://secret:password@host'); })(new Request('http://localhost'));
  assert.equal(failure.status, 500);
  assert.equal((await failure.text()).includes('password'), false);
});
