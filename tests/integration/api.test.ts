import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const origin = 'http://localhost:3000';

type Taxonomy = { id: string; name: string; slug: string; active: boolean };
type Image = { id: string; productId: string; url: string; alt: string; order: number };
type Product = {
  id: string; code: string; slug: string; name: string; description: string;
  brandId: string; categoryId: string; cost: string; price: string;
  stock: number; active: boolean; createdAt: string; updatedAt: string;
  brand: Taxonomy; category: Taxonomy; images: Image[];
};
type ProductInput = Pick<Product,
  'code' | 'slug' | 'name' | 'description' | 'brandId' | 'categoryId' |
  'cost' | 'price' | 'stock' | 'active'>;
type RequestOptions = {
  method?: string;
  input?: unknown;
  cookie?: string | null;
  csrf?: string | null;
  origin?: string | null;
};

test('API integrada com PostgreSQL dedicado', {
  skip: testDatabaseUrl ? false : 'TEST_DATABASE_URL ausente: integração PostgreSQL não executada.',
  concurrency: false,
  timeout: 120_000,
}, async (t) => {
  assert.ok(testDatabaseUrl);
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.DATABASE_URL_POOLED = testDatabaseUrl;
  process.env.POSTGRES_URL = testDatabaseUrl;
  process.env.DIRECT_URL = process.env.TEST_DIRECT_URL || testDatabaseUrl;
  process.env.APP_ORIGIN = origin;
  process.env.AUTH_SECRET ||= 'integration-only-secret-at-least-32-characters-long';

  const { adminApi, publicApi } = await import('../../src/lib/api');
  const { db } = await import('../../src/lib/db');
  const { cookieName, digest, hashPassword } = await import('../../src/lib/auth');

  const runId = randomUUID();
  const adminId = randomUUID();
  const rateAdminId = randomUUID();
  const email = `api-${runId}@example.test`;
  const rateEmail = `rate-${runId}@example.test`;
  const password = `Integration-${runId}!`;
  const adminIds = [adminId, rateAdminId];
  const attemptKeys = [email, rateEmail].map((value) => digest(`email:${value}:ip:local`));
  const productSlugs = new Set<string>();
  const brandSlugs = new Set<string>();
  const categorySlugs = new Set<string>();
  let cookie: string | undefined;
  let csrf: string | undefined;

  t.after(async () => {
    try {
      await db.$transaction([
        db.session.deleteMany({ where: { adminId: { in: adminIds } } }),
        db.product.deleteMany({ where: { slug: { in: [...productSlugs] } } }),
        db.brand.deleteMany({ where: { slug: { in: [...brandSlugs] } } }),
        db.category.deleteMany({ where: { slug: { in: [...categorySlugs] } } }),
        db.loginAttempt.deleteMany({ where: { key: { in: attemptKeys } } }),
        db.admin.deleteMany({ where: { id: { in: adminIds } } }),
      ]);
    } finally {
      await db.$disconnect();
    }
  });

  function admin(path: string, options: RequestOptions = {}) {
    const headers = new Headers();
    const requestCookie = options.cookie === undefined ? cookie : options.cookie;
    const requestCsrf = options.csrf === undefined ? csrf : options.csrf;
    const requestOrigin = options.origin === undefined ? origin : options.origin;
    if (requestCookie) headers.set('cookie', requestCookie);
    if (requestCsrf) headers.set('x-csrf-token', requestCsrf);
    if (requestOrigin) headers.set('origin', requestOrigin);
    if (options.input !== undefined) headers.set('content-type', 'application/json');
    return adminApi(new Request(`${origin}/api/v1/admin/${path}`, {
      method: options.method ?? 'GET', headers,
      body: options.input === undefined ? undefined : JSON.stringify(options.input),
    }));
  }

  function storefront(path: string) {
    return publicApi(new Request(`${origin}/api/v1/${path}`));
  }

  async function json<T>(response: Response, status = 200): Promise<T> {
    assert.equal(response.status, status, await response.clone().text());
    return await response.json() as T;
  }

  async function data<T>(response: Response, status = 200): Promise<T> {
    return (await json<{ data: T }>(response, status)).data;
  }

  async function error(response: Response, status: number, code: string) {
    const result = await json<{ error: { code: string; message: string } }>(response, status);
    assert.equal(result.error.code, code);
    assert.equal(typeof result.error.message, 'string');
    assert.ok(result.error.message.length > 0);
  }

  function login(loginEmail: string, loginPassword: string, extra = {}) {
    return admin('auth/login', {
      method: 'POST', cookie: null, csrf: null,
      input: { email: loginEmail, password: loginPassword, ...extra },
    });
  }

  function ids(rows: { id: string }[]) {
    return rows.map((row) => row.id).sort();
  }

  function keys(value: object, expected: string[]) {
    assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
  }

  async function createTaxonomy(resource: 'brands' | 'categories', label: string, active = true) {
    const slug = `${resource}-${label}-${runId}`;
    (resource === 'brands' ? brandSlugs : categorySlugs).add(slug);
    const input = { name: `${runId} ${resource} ${label}`, slug, active };
    const result = await data<Taxonomy>(await admin(resource, { method: 'POST', input }), 201);
    assert.deepEqual(result, { id: result.id, ...input });
    assert.match(result.id, /^[a-f0-9-]{36}$/);
    return result;
  }

  async function createProduct(label: string, brand: Taxonomy, category: Taxonomy, active = true) {
    const slug = `product-${label}-${runId}`;
    productSlugs.add(slug);
    const input: ProductInput = {
      code: `${runId}-${label}`, slug, name: `${runId} product ${label}`,
      description: `Fixture ${runId}: ${label}`, brandId: brand.id, categoryId: category.id,
      cost: '12.30', price: '99.90', stock: 7, active,
    };
    const result = await data<Product>(await admin('products', { method: 'POST', input }), 201);
    for (const key of Object.keys(input) as (keyof ProductInput)[]) {
      assert.equal(result[key], input[key], key);
    }
    return { ...result, input };
  }

  const passwordHash = await hashPassword(password);
  await db.admin.createMany({ data: [
    { id: adminId, email, passwordHash },
    { id: rateAdminId, email: rateEmail, passwordHash },
  ] });

  await t.test('login falho, login correto e cookie de sessão', async () => {
    const failed = await login(email, 'wrong-password');
    await error(failed, 401, 'INVALID_CREDENTIALS');
    assert.equal(failed.headers.get('set-cookie'), null);
    assert.equal(await db.session.count({ where: { adminId } }), 0);

    const response = await login(email.toUpperCase(), password);
    const result = await json<{ csrfToken: string }>(response);
    assert.match(result.csrfToken, /^[a-f0-9]{64}$/);
    csrf = result.csrfToken;
    const setCookie = response.headers.get('set-cookie');
    assert.ok(setCookie);
    cookie = setCookie.split(';')[0];
    assert.ok(cookie.startsWith(`${cookieName()}=`));
    assert.match(cookie.slice(cookie.indexOf('=') + 1), /^[a-f0-9]{64}$/);
    assert.match(setCookie, /; Path=\//);
    assert.match(setCookie, /; HttpOnly/);
    assert.match(setCookie, /; SameSite=Strict/);
    assert.match(setCookie, /; Max-Age=28800/);
    const session = await db.session.findUnique({
      where: { tokenHash: digest(cookie.slice(cookie.indexOf('=') + 1)) },
    });
    assert.ok(session);
    assert.equal(session.adminId, adminId);
    assert.equal(session.csrfHash, digest(csrf));
  });

  await t.test('sem cookie: 401; GET sessão fornece o mesmo CSRF', async () => {
    await error(await admin('products', { cookie: null }), 401, 'UNAUTHORIZED');
    await error(await admin('auth/session', { cookie: null }), 401, 'UNAUTHORIZED');
    const session = await json<{ csrfToken: string }>(await admin('auth/session', { csrf: null }));
    keys(session, ['csrfToken']);
    assert.equal(session.csrfToken, csrf);
  });

  await t.test('POST sem CSRF ou com origem incorreta: 403 sem criar registro', async () => {
    const slug = `denied-${runId}`;
    brandSlugs.add(slug);
    const input = { name: `Denied ${runId}`, slug };
    await error(await admin('brands', { method: 'POST', input, csrf: null }), 403, 'CSRF_DENIED');
    await error(await admin('brands', {
      method: 'POST', input, origin: 'https://untrusted.example.test',
    }), 403, 'ORIGIN_DENIED');
    assert.equal(await db.brand.count({ where: { slug } }), 0);
  });

  const brand = await createTaxonomy('brands', 'primary');
  const otherBrand = await createTaxonomy('brands', 'other');
  const inactiveBrand = await createTaxonomy('brands', 'inactive', false);
  const category = await createTaxonomy('categories', 'primary');
  const otherCategory = await createTaxonomy('categories', 'other');
  const inactiveCategory = await createTaxonomy('categories', 'inactive', false);

  await t.test('marcas e categorias: leitura, alteração e filtros de ativos/inativos', async () => {
    for (const [resource, activeRows, inactiveRow] of [
      ['brands', [brand, otherBrand], inactiveBrand],
      ['categories', [category, otherCategory], inactiveCategory],
    ] as const) {
      assert.deepEqual(await data<Taxonomy>(await admin(`${resource}/${inactiveRow.id}`)), inactiveRow);
      const name = `${runId} renamed ${resource}`;
      const updated = await data<Taxonomy>(await admin(`${resource}/${activeRows[1].id}`, {
        method: 'PATCH', input: { name },
      }));
      assert.equal(updated.name, name);
      assert.equal(updated.slug, activeRows[1].slug);
      assert.equal((await data<Taxonomy>(await admin(`${resource}/${updated.id}`))).name, name);
      for (const active of [true, false]) {
        const rows = await data<Taxonomy[]>(await admin(`${resource}?q=${runId}&active=${active}&pageSize=100`));
        assert.deepEqual(ids(rows), ids(active ? [...activeRows] : [inactiveRow]));
        assert.ok(rows.every((row) => row.active === active));
      }
    }
  });

  const product = await createProduct('primary', brand, category);
  const otherProduct = await createProduct('other', otherBrand, otherCategory);
  const inactiveProduct = await createProduct('inactive', brand, category, false);
  const hiddenBrandProduct = await createProduct('hidden-brand', inactiveBrand, category);
  const hiddenCategoryProduct = await createProduct('hidden-category', brand, inactiveCategory);
  const allProducts = [product, otherProduct, inactiveProduct, hiddenBrandProduct, hiddenCategoryProduct];

  await t.test('produtos: leitura administrativa e alteração com custo/preço em strings', async () => {
    const before = await data<Product>(await admin(`products/${product.id}`));
    assert.equal(before.cost, '12.30');
    assert.equal(before.price, '99.90');
    assert.equal(before.brand.id, brand.id);
    assert.equal(before.category.id, category.id);
    const patch = { cost: '14.20', price: '112.00', stock: 17, description: `Updated ${runId}` };
    const updated = await data<Product>(await admin(`products/${product.id}`, { method: 'PATCH', input: patch }));
    const reread = await data<Product>(await admin(`products/${product.id}`));
    for (const row of [updated, reread]) {
      assert.equal(typeof row.cost, 'string');
      assert.equal(typeof row.price, 'string');
      for (const key of Object.keys(patch) as (keyof typeof patch)[]) assert.equal(row[key], patch[key]);
    }
    await error(await admin(`products/${product.id}`, {
      method: 'PATCH', input: { cost: 14.2 },
    }), 400, 'VALIDATION_ERROR');
    assert.equal((await data<Product>(await admin(`products/${inactiveProduct.id}`))).active, false);
  });

  await t.test('cache público invalida preço, imagens e desativação sem armazenar dados administrativos', async () => {
    const originalPrice = (await data<Product>(await admin(`products/${product.id}`))).price;
    const query = `products?q=${encodeURIComponent(product.code)}`;
    await storefront(query);
    const hit = await storefront(query);
    assert.equal(hit.headers.get('X-Catalog-Cache'), 'HIT');
    assert.equal((await admin('products')).headers.get('X-Catalog-Cache'), null);
    await json(await admin(`products/${product.id}`, { method: 'PATCH', input: { price: '178.90' } }));
    const refreshed = await storefront(query);
    assert.equal(refreshed.headers.get('X-Catalog-Cache'), 'MISS');
    const products = await data<Product[]>(refreshed);
    assert.equal(products.find((p) => p.id === product.id)?.price, '178.90');
    assert.equal('cost' in products[0], false);
    const detailPath = `products/${product.slug}`;
    await storefront(detailPath);
    const image = await data<Image>(await admin(`products/${product.id}/images`, { method: 'POST', input: { url: 'https://example.com/cache-test.jpg', alt: 'Teste de invalidação', order: 0 } }), 201);
    const withImage = await storefront(detailPath);
    assert.equal(withImage.headers.get('X-Catalog-Cache'), 'MISS');
    assert.ok((await data<Product>(withImage)).images.some((entry) => entry.id === image.id));
    await json(await admin(`products/${product.id}/images/${image.id}`, { method: 'DELETE' }));
    await json(await admin(`products/${product.id}`, { method: 'DELETE' }));
    assert.equal((await storefront(detailPath)).status, 404);
    assert.equal((await storefront(detailPath)).headers.get('X-Catalog-Cache'), null);
    assert.equal((await storefront('products?pageSize=101')).headers.get('X-Catalog-Cache'), null);
    await json(await admin(`products/${product.id}`, { method: 'PATCH', input: { active: true, price: originalPrice } }));
  });

  await t.test('produtos administrativos: filtros active, brand e category combinados', async () => {
    for (const [filter, expected] of [
      ['', allProducts],
      ['&active=true', allProducts.filter((row) => row.active)],
      ['&active=false', [inactiveProduct]],
      [`&brand=${brand.slug}`, [product, inactiveProduct, hiddenCategoryProduct]],
      [`&category=${category.slug}`, [product, inactiveProduct, hiddenBrandProduct]],
      [`&brand=${brand.slug}&category=${category.slug}`, [product, inactiveProduct]],
      [`&active=true&brand=${brand.slug}&category=${category.slug}`, [product]],
    ] as const) {
      const result = await json<{ data: Product[]; pagination: { page: number; pageSize: number; total: number } }>(
        await admin(`products?q=${runId}&pageSize=100${filter}`),
      );
      assert.deepEqual(ids(result.data), ids([...expected]), filter);
      assert.deepEqual(result.pagination, { page: 1, pageSize: 100, total: expected.length });
    }
  });

  await t.test('catálogo público: filtros respeitam produto, marca e categoria ativos', async () => {
    for (const [filter, expected] of [
      ['', [product, otherProduct]],
      [`&brand=${brand.slug}`, [product]],
      [`&category=${category.slug}`, [product]],
      [`&brand=${brand.slug}&category=${category.slug}`, [product]],
      [`&brand=${brand.slug}&category=${otherCategory.slug}`, []],
      [`&brand=${inactiveBrand.slug}`, []],
      [`&category=${inactiveCategory.slug}`, []],
    ] as const) {
      const result = await json<{ data: Product[]; pagination: { total: number } }>(
        await storefront(`products?q=${runId}&pageSize=100${filter}`),
      );
      assert.deepEqual(ids(result.data), ids([...expected]), filter);
      assert.equal(result.pagination.total, expected.length);
    }
    for (const hidden of [inactiveProduct, hiddenBrandProduct, hiddenCategoryProduct]) {
      await error(await storefront(`products/${hidden.slug}`), 404, 'NOT_FOUND');
    }
    for (const [resource, activeRows, inactiveRow] of [
      ['brands', [brand, otherBrand], inactiveBrand],
      ['categories', [category, otherCategory], inactiveCategory],
    ] as const) {
      const rows = await data<Taxonomy[]>(await storefront(resource));
      assert.ok(!rows.some((row) => row.id === inactiveRow.id));
      assert.deepEqual(ids(rows.filter((row) => activeRows.some((fixture) => fixture.id === row.id))), ids([...activeRows]));
      for (const row of rows) keys(row, ['id', 'name', 'slug']);
    }
  });

  await t.test('unicidade de código/slug: 409 para produtos, marcas e categorias', async () => {
    const duplicateCodeSlug = `duplicate-code-${runId}`;
    productSlugs.add(duplicateCodeSlug);
    await error(await admin('products', {
      method: 'POST', input: { ...product.input, slug: duplicateCodeSlug },
    }), 409, 'CONFLICT');
    await error(await admin('products', {
      method: 'POST', input: { ...product.input, code: `different-${runId}` },
    }), 409, 'CONFLICT');
    await error(await admin(`products/${otherProduct.id}`, {
      method: 'PATCH', input: { code: product.code },
    }), 409, 'CONFLICT');
    for (const [resource, row] of [['brands', brand], ['categories', category]] as const) {
      await error(await admin(resource, {
        method: 'POST', input: { name: `Duplicate ${runId}`, slug: row.slug },
      }), 409, 'CONFLICT');
    }
  });

  await t.test('corpos com campos desconhecidos: 400', async () => {
    await error(await login(email, password, { unknown: true }), 400, 'VALIDATION_ERROR');
    for (const [resource, row] of [['brands', brand], ['categories', category]] as const) {
      const slug = `unknown-${resource}-${runId}`;
      (resource === 'brands' ? brandSlugs : categorySlugs).add(slug);
      await error(await admin(resource, {
        method: 'POST', input: { name: `Unknown ${runId}`, slug, unknown: true },
      }), 400, 'VALIDATION_ERROR');
      await error(await admin(`${resource}/${row.id}`, {
        method: 'PATCH', input: { name: 'Must not change', unknown: true },
      }), 400, 'VALIDATION_ERROR');
    }
    const slug = `unknown-product-${runId}`;
    productSlugs.add(slug);
    await error(await admin('products', {
      method: 'POST', input: { ...product.input, code: `unknown-${runId}`, slug, unknown: true },
    }), 400, 'VALIDATION_ERROR');
    await error(await admin(`products/${product.id}`, {
      method: 'PATCH', input: { cost: '1.00', unknown: true },
    }), 400, 'VALIDATION_ERROR');
    await error(await admin(`products/${product.id}/images`, {
      method: 'POST', input: { url: 'https://example.test/invalid.jpg', alt: '', order: 0, unknown: true },
    }), 400, 'VALIDATION_ERROR');
  });

  await t.test('imagens: adicionar, ordenar, associação incorreta 404 e remover', async () => {
    const path = `products/${product.id}/images`;
    const first = await data<Image>(await admin(path, {
      method: 'POST', input: { url: `https://example.test/${runId}/first.jpg`, alt: 'First', order: 20 },
    }), 201);
    const second = await data<Image>(await admin(path, {
      method: 'POST', input: { url: `https://example.test/${runId}/second.jpg`, alt: 'Second', order: 10 },
    }), 201);
    assert.equal(first.productId, product.id);
    assert.equal(second.productId, product.id);
    assert.deepEqual((await data<Image[]>(await admin(path))).map((row) => row.id), [second.id, first.id]);
    const updated = await data<Image>(await admin(`${path}/${first.id}`, {
      method: 'PATCH', input: { order: 0, alt: 'First reordered' },
    }));
    assert.equal(updated.order, 0);
    assert.equal(updated.alt, 'First reordered');
    const expectedOrder = [first.id, second.id];
    assert.deepEqual((await data<Image[]>(await admin(path))).map((row) => row.id), expectedOrder);
    assert.deepEqual((await data<Product>(await admin(`products/${product.id}`))).images.map((row) => row.id), expectedOrder);
    assert.deepEqual((await data<Product>(await storefront(`products/${product.slug}`))).images.map((row) => row.id), expectedOrder);

    for (const method of ['PATCH', 'DELETE']) {
      await error(await admin(`products/${otherProduct.id}/images/${first.id}`, {
        method, input: method === 'PATCH' ? { order: 99 } : undefined,
      }), 404, 'NOT_FOUND');
    }
    const stillAssociated = await db.productImage.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(stillAssociated.productId, product.id);
    assert.equal(stillAssociated.order, 0);
    await error(await admin(`${path}/${first.id}`, {
      method: 'PATCH', input: { order: 1, unknown: true },
    }), 400, 'VALIDATION_ERROR');

    assert.deepEqual(await json(await admin(`${path}/${first.id}`, { method: 'DELETE' })), { ok: true });
    assert.equal(await db.productImage.findUnique({ where: { id: first.id } }), null);
    assert.deepEqual((await data<Image[]>(await admin(path))).map((row) => row.id), [second.id]);
    await error(await admin(`${path}/${first.id}`, { method: 'DELETE' }), 404, 'NOT_FOUND');
  });

  await t.test('allowlist pública exata, sem cost, stock, active ou createdAt', async () => {
    const detail = await data<Product>(await storefront(`products/${product.slug}`));
    const listing = await data<Product[]>(await storefront(`products?q=${runId}&brand=${brand.slug}&category=${category.slug}`));
    assert.equal(listing.length, 1);
    for (const row of [detail, ...listing]) {
      keys(row, ['id', 'code', 'slug', 'name', 'description', 'price', 'brand', 'category', 'images']);
      for (const privateField of ['cost', 'stock', 'active', 'createdAt', 'updatedAt', 'brandId', 'categoryId']) {
        assert.equal(Object.hasOwn(row, privateField), false, privateField);
      }
      assert.equal(row.id, product.id);
      assert.equal(row.price, '112.00');
      keys(row.brand, ['id', 'name', 'slug']);
      keys(row.category, ['id', 'name', 'slug']);
      assert.equal(row.images.length, 1);
      for (const image of row.images) keys(image, ['id', 'url', 'alt', 'order']);
    }
  });

  await t.test('DELETE desativa produtos, marcas e categorias e permite leitura administrativa', async () => {
    const removed = await data<Product>(await admin(`products/${otherProduct.id}`, { method: 'DELETE' }));
    assert.equal(removed.active, false);
    assert.equal((await data<Product>(await admin(`products/${otherProduct.id}`))).active, false);
    await error(await storefront(`products/${otherProduct.slug}`), 404, 'NOT_FOUND');

    for (const [resource, row] of [['brands', brand], ['categories', category]] as const) {
      const deleted = await data<Taxonomy>(await admin(`${resource}/${row.id}`, { method: 'DELETE' }));
      assert.equal(deleted.active, false);
      assert.equal((await data<Taxonomy>(await admin(`${resource}/${row.id}`))).active, false);
      assert.ok(!(await data<Taxonomy[]>(await storefront(resource))).some((item) => item.id === row.id));
      await error(await storefront(`products/${product.slug}`), 404, 'NOT_FOUND');
      assert.deepEqual(await data<Product[]>(await storefront(`products?q=${runId}&brand=${brand.slug}&category=${category.slug}`)), []);
      const restored = await data<Taxonomy>(await admin(`${resource}/${row.id}`, {
        method: 'PATCH', input: { active: true },
      }));
      assert.equal(restored.active, true);
      assert.equal((await data<Product>(await storefront(`products/${product.slug}`))).id, product.id);
    }
  });

  await t.test('sessão expirada e administrador inativo: 401', async () => {
    const expiredToken = randomBytes(32).toString('hex');
    assert.ok(csrf);
    await db.session.create({ data: {
      adminId, tokenHash: digest(expiredToken), csrfHash: digest(csrf),
      expiresAt: new Date(Date.now() - 60_000),
    } });
    await error(await admin('auth/session', {
      cookie: `${cookieName()}=${expiredToken}`,
    }), 401, 'UNAUTHORIZED');
    await error(await admin('products', {
      cookie: `${cookieName()}=${expiredToken}`,
    }), 401, 'UNAUTHORIZED');

    await db.admin.update({ where: { id: adminId }, data: { active: false } });
    try {
      await error(await admin('auth/session'), 401, 'UNAUTHORIZED');
      await error(await admin('products'), 401, 'UNAUTHORIZED');
      await error(await login(email, password), 401, 'INVALID_CREDENTIALS');
    } finally {
      await db.admin.update({ where: { id: adminId }, data: { active: true } });
    }
    assert.equal((await json<{ csrfToken: string }>(await admin('auth/session'))).csrfToken, csrf);
  });

  await t.test('logout remove sessão e invalida o token anterior', async () => {
    assert.ok(cookie);
    const tokenHash = digest(cookie.slice(cookie.indexOf('=') + 1));
    const response = await admin('auth/logout', { method: 'POST' });
    assert.deepEqual(await json(response), { ok: true });
    const clearedCookie = response.headers.get('set-cookie');
    assert.ok(clearedCookie);
    assert.ok(clearedCookie.startsWith(`${cookieName()}=;`));
    assert.match(clearedCookie, /; Max-Age=0(?:;|$)/);
    assert.equal(await db.session.findUnique({ where: { tokenHash } }), null);
    await error(await admin('auth/session'), 401, 'UNAUTHORIZED');
    await error(await admin('products'), 401, 'UNAUTHORIZED');
    await error(await admin('auth/logout', { method: 'POST' }), 401, 'UNAUTHORIZED');
  });

  await t.test('rate limit: cinco falhas permitidas e sexta tentativa bloqueada', async () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      await error(await login(rateEmail, 'wrong-password'), 401, 'INVALID_CREDENTIALS');
      const counter = await db.loginAttempt.findUniqueOrThrow({ where: { key: digest(`email:${rateEmail}:ip:local`) } });
      assert.equal(counter.attempts, attempt);
    }
    const blocked = await login(rateEmail, password);
    await error(blocked, 429, 'RATE_LIMITED');
    assert.equal(blocked.headers.get('set-cookie'), null);
    assert.equal(await db.session.count({ where: { adminId: rateAdminId } }), 0);
    const counter = await db.loginAttempt.findUniqueOrThrow({ where: { key: digest(`email:${rateEmail}:ip:local`) } });
    assert.equal(counter.attempts, 6);
  });

  await t.test('rate limit por IP: 100 tentativas, isolamento e remoção de expiradas', async () => {
    const { consumeLoginAttempt } = await import('../../src/lib/auth');
    const previousVercel = process.env.VERCEL;
    const fixtureId = randomUUID();
    const limitedIp = '192.0.2.40';
    const otherIp = '192.0.2.41';
    const emails = Array.from({ length: 100 }, (_, index) => `ip-${fixtureId}-${index}@example.test`);
    const blockedEmail = `ip-blocked-${fixtureId}@example.test`;
    const limitedIpKey = digest(`ip:${limitedIp}`);
    const otherIpKey = digest(`ip:${otherIp}`);
    const emailKeys = emails.map((value) => digest(`email:${value}:ip:${limitedIp}`));
    const blockedEmailKey = digest(`email:${blockedEmail}:ip:${limitedIp}`);
    const otherEmailKey = digest(`email:${blockedEmail}:ip:${otherIp}`);
    const expiredKey = digest(`email:expired-${fixtureId}@example.test:ip:${limitedIp}`);
    const fixtureKeys = [limitedIpKey, otherIpKey, ...emailKeys, blockedEmailKey, otherEmailKey, expiredKey];

    function request(ip: string) {
      return new Request(`${origin}/api/v1/admin/auth/login`, {
        method: 'POST', headers: { 'x-vercel-forwarded-for': ip },
      });
    }

    try {
      process.env.VERCEL = '1';
      await db.loginAttempt.create({ data: {
        key: expiredKey, attempts: 1, windowStart: new Date(Date.now() - 16 * 60 * 1000),
      } });
      assert.ok(await db.loginAttempt.findUnique({ where: { key: expiredKey } }));

      for (const [index, loginEmail] of emails.entries()) {
        await consumeLoginAttempt(loginEmail, request(limitedIp));
        if (index === 0) {
          assert.equal(await db.loginAttempt.findUnique({ where: { key: expiredKey } }), null);
        }
      }
      const fullCounter = await db.loginAttempt.findUniqueOrThrow({ where: { key: limitedIpKey } });
      assert.equal(fullCounter.attempts, 100);
      const allowedEmailCounters = await db.loginAttempt.findMany({ where: { key: { in: emailKeys } } });
      assert.equal(allowedEmailCounters.length, 100);
      assert.ok(allowedEmailCounters.every((row) => row.attempts === 1));

      await assert.rejects(consumeLoginAttempt(blockedEmail, request(limitedIp)), {
        status: 429, code: 'RATE_LIMITED',
      });
      const blockedCounter = await db.loginAttempt.findUniqueOrThrow({ where: { key: limitedIpKey } });
      assert.equal(blockedCounter.attempts, 101);
      assert.equal(await db.loginAttempt.findUnique({ where: { key: blockedEmailKey } }), null);
      assert.equal(await db.loginAttempt.count({ where: { key: { in: [...emailKeys, blockedEmailKey] } } }), 100);

      await consumeLoginAttempt(blockedEmail, request(otherIp));
      const otherIpCounter = await db.loginAttempt.findUniqueOrThrow({ where: { key: otherIpKey } });
      const otherEmailCounter = await db.loginAttempt.findUniqueOrThrow({ where: { key: otherEmailKey } });
      assert.equal(otherIpCounter.attempts, 1);
      assert.equal(otherEmailCounter.attempts, 1);
      assert.equal(await db.loginAttempt.findUnique({ where: { key: blockedEmailKey } }), null);
      assert.equal((await db.loginAttempt.findUniqueOrThrow({ where: { key: limitedIpKey } })).attempts, 101);
    } finally {
      if (previousVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = previousVercel;
      await db.loginAttempt.deleteMany({ where: { key: { in: fixtureKeys } } });
    }
  });
});
