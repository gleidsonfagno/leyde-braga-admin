import { db } from './db';
import { authenticate, consumeLoginAttempt, createSession, readSessionToken, sessionCookie, verifyPassword } from './auth';
import { ApiError, body, endpoint, json, requireSameOrigin } from './http';
import { adminPaginationSchema, idSchema, imageSchema, loginSchema, nonEmptyPatch, paginationSchema, productSchema, slugSchema, taxonomySchema } from './validation';
import { productFilter, publicProductSelect, publicTaxonomySelect, publicVisibility, serializeProduct } from './catalog';
import { publicCatalogCache } from './public-cache';

const missing = () => { throw new ApiError(404, 'NOT_FOUND', 'Registro não encontrado.'); };
const methodDenied = () => { throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.'); };
const dummyHash = 'scrypt$32768$8$1$00000000000000000000000000000000$' + '00'.repeat(64);

export const publicApi = endpoint(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'GET') return methodDenied();
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean).slice(2).map(decodeURIComponent);
  if (parts.length === 1 && parts[0] === 'health') return json({ status: 'ok' });
  if (parts.length === 1 && parts[0] === 'products') {
    const query = paginationSchema.parse(Object.fromEntries(url.searchParams));
    return publicCatalogCache.response(`products:${JSON.stringify(query)}`, async () => {
      const where = productFilter(query, true);
      const [products, total] = await Promise.all([
        db.product.findMany({ where, select: publicProductSelect, skip: (query.page - 1) * query.pageSize, take: query.pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }),
        db.product.count({ where }),
      ]);
      return { data: products.map(serializeProduct), pagination: { page: query.page, pageSize: query.pageSize, total } };
    });
  }
  if (parts.length === 2 && parts[0] === 'products') {
    const slug = slugSchema.parse(parts[1]);
    return publicCatalogCache.response(`product:${slug}`, async () => {
      const product = await db.product.findFirst({ where: { ...publicVisibility, slug }, select: publicProductSelect });
      return product ? { data: serializeProduct(product) } : missing();
    });
  }
  if (parts.length === 1 && (parts[0] === 'brands' || parts[0] === 'categories')) {
    const args = { where: { active: true }, select: publicTaxonomySelect, orderBy: { name: 'asc' as const } };
    return publicCatalogCache.response(parts[0], async () => ({ data: parts[0] === 'brands' ? await db.brand.findMany(args) : await db.category.findMany(args) }));
  }
  return missing();
}, true);

const adminHandler = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean).slice(3).map(decodeURIComponent);
  const method = request.method;
  if (parts.length === 2 && parts[0] === 'auth' && parts[1] === 'login') {
    if (method !== 'POST') return methodDenied();
    requireSameOrigin(request);
    const input = loginSchema.parse(await body(request));
    await consumeLoginAttempt(input.email, request);
    const admin = await db.admin.findUnique({ where: { email: input.email } });
    const valid = await verifyPassword(input.password, admin?.passwordHash ?? dummyHash);
    if (!admin?.active || !valid) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Credenciais inválidas.');
    const session = await createSession(admin.id, readSessionToken(request));
    const response = json({ csrfToken: session.csrfToken });
    response.headers.set('Set-Cookie', sessionCookie(session.token));
    return response;
  }
  const auth = await authenticate(request);
  if (parts.length === 2 && parts[0] === 'auth') {
    if (parts[1] === 'session' && method === 'GET') return json({ csrfToken: auth.csrfToken });
    if (parts[1] === 'logout' && method === 'POST') {
      await db.session.delete({ where: { id: auth.session.id } });
      const response = json({ ok: true });
      response.headers.set('Set-Cookie', sessionCookie('', 0));
      return response;
    }
    return methodDenied();
  }
  const [resource, rawId, subresource, rawImageId] = parts;
  if (!['products', 'brands', 'categories'].includes(resource)) return missing();
  const id = rawId ? idSchema.parse(rawId) : undefined;
  if (resource === 'products' && id && subresource === 'images' && parts.length <= 4) {
    if (!await db.product.findUnique({ where: { id }, select: { id: true } })) return missing();
    const imageId = rawImageId ? idSchema.parse(rawImageId) : undefined;
    if (!imageId && method === 'GET') return json({ data: await db.productImage.findMany({ where: { productId: id }, orderBy: [{ order: 'asc' }, { id: 'asc' }] }) });
    if (!imageId && method === 'POST') return json({ data: await db.productImage.create({ data: { ...imageSchema.parse(await body(request)), productId: id } }) }, 201);
    if (imageId) {
      const image = await db.productImage.findFirst({ where: { id: imageId, productId: id } });
      if (!image) return missing();
      if (method === 'PATCH') return json({ data: await db.productImage.update({ where: { id: imageId }, data: nonEmptyPatch(imageSchema).parse(await body(request)) }) });
      if (method === 'DELETE') { await db.productImage.delete({ where: { id: imageId } }); return json({ ok: true }); }
    }
    return methodDenied();
  }
  if (parts.length > 2) return missing();
  if (resource === 'products') {
    if (!id && method === 'GET') {
      const query = adminPaginationSchema.parse(Object.fromEntries(url.searchParams));
      const where = { ...productFilter(query, false), ...(query.active !== undefined ? { active: query.active === 'true' } : {}) };
      const [products, total] = await Promise.all([
        db.product.findMany({ where, include: { brand: true, category: true, images: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }), db.product.count({ where }),
      ]);
      return json({ data: products.map(serializeProduct), pagination: { page: query.page, pageSize: query.pageSize, total } });
    }
    if (id && method === 'GET') {
      const product = await db.product.findUnique({ where: { id }, include: { brand: true, category: true, images: { orderBy: [{ order: 'asc' }, { id: 'asc' }] } } });
      return product ? json({ data: serializeProduct(product) }) : missing();
    }
    if (!id && method === 'POST') return json({ data: serializeProduct(await db.product.create({ data: productSchema.parse(await body(request)) })) }, 201);
    if (id && method === 'PATCH') return json({ data: serializeProduct(await db.product.update({ where: { id }, data: nonEmptyPatch(productSchema).parse(await body(request)) })) });
    if (id && method === 'DELETE') return json({ data: serializeProduct(await db.product.update({ where: { id }, data: { active: false } })) });
    return methodDenied();
  }
  if (!id && method === 'GET') {
    const query = adminPaginationSchema.parse(Object.fromEntries(url.searchParams));
    const args = { where: { ...(query.active !== undefined ? { active: query.active === 'true' } : {}), ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}) }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, orderBy: [{ name: 'asc' as const }, { id: 'asc' as const }] };
    const [data, total] = resource === 'brands' ? await Promise.all([db.brand.findMany(args), db.brand.count({ where: args.where })]) : await Promise.all([db.category.findMany(args), db.category.count({ where: args.where })]);
    return json({ data, pagination: { page: query.page, pageSize: query.pageSize, total } });
  }
  if (id && method === 'GET') {
    const data = resource === 'brands' ? await db.brand.findUnique({ where: { id } }) : await db.category.findUnique({ where: { id } });
    return data ? json({ data }) : missing();
  }
  if (!id && method === 'POST') {
    const data = taxonomySchema.parse(await body(request));
    return json({ data: resource === 'brands' ? await db.brand.create({ data }) : await db.category.create({ data }) }, 201);
  }
  if (id && (method === 'PATCH' || method === 'DELETE')) {
    const data = method === 'DELETE' ? { active: false } : nonEmptyPatch(taxonomySchema).parse(await body(request));
    return json({ data: resource === 'brands' ? await db.brand.update({ where: { id }, data }) : await db.category.update({ where: { id }, data }) });
  }
  return methodDenied();
};

export const adminApi = endpoint(async (request) => {
  const response = await adminHandler(request);
  if (response.ok && ['POST', 'PATCH', 'DELETE'].includes(request.method)
    && /^\/api\/v1\/admin\/(products|brands|categories)(?:\/|$)/.test(new URL(request.url).pathname)) {
    await publicCatalogCache.invalidate();
  }
  return response;
});
