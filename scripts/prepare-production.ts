import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { db } from '../src/lib/db';
import { publicCatalogCache } from '../src/lib/public-cache';

const schema = z.object({
  products: z.array(z.object({ code: z.string().min(1), slug: z.string().min(1) }).strict()).min(1),
  admin: z.object({ email: z.email().transform((email) => email.toLowerCase()),
    passwordHash: z.string().regex(/^scrypt\$32768\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/),
  }).strict(),
}).strict();

async function main() {
  const input = schema.parse(JSON.parse(readFileSync(resolve(process.env.PRODUCTION_SETUP_FILE ?? 'catalog/production-setup.json'), 'utf8')));
  if (new Set(input.products.map((product) => product.code)).size !== input.products.length) throw new Error('Duplicate product code');
  const result = await db.$transaction(async (tx) => {
    const products = await tx.product.findMany({ where: { code: { in: input.products.map((p) => p.code) } }, select: { code: true, slug: true, brandId: true, categoryId: true } });
    if (products.length !== input.products.length || products.some((product) => !input.products.some((p) => p.code === product.code && p.slug === product.slug))) {
      throw new Error('Catalog differs from reviewed batch');
    }
    const existing = await tx.admin.findUnique({ where: { email: input.admin.email } });
    if (existing && (!existing.active || existing.passwordHash !== input.admin.passwordHash)) throw new Error('Administrator already exists with other credentials');
    if (!existing) await tx.admin.create({ data: input.admin });
    const brands = await tx.brand.updateMany({ where: { id: { in: products.map((p) => p.brandId) } }, data: { active: true } });
    const categories = await tx.category.updateMany({ where: { id: { in: products.map((p) => p.categoryId) } }, data: { active: true } });
    const activated = await tx.product.updateMany({ where: { code: { in: products.map((p) => p.code) }, active: false }, data: { active: true } });
    return { products: products.length, activated: activated.count, brands: brands.count, categories: categories.count, adminCreated: !existing };
  }, { maxWait: 15000, timeout: 120000 });
  await publicCatalogCache.invalidate();
  console.log(JSON.stringify({ productionSetup: 'complete', ...result }));
}
void main().catch((error: unknown) => {
  console.error(JSON.stringify({ error: 'PRODUCTION_SETUP_FAILED', type: error instanceof Error ? error.name : 'UnknownError' }));
  process.exitCode = 1;
}).finally(() => db.$disconnect());
