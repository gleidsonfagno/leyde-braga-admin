import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { db } from '../src/lib/db';
import { slugSchema, moneySchema, imageSchema } from '../src/lib/validation';
import { slugify } from '../src/lib/admin-format';

const entrySchema = z.object({
  sourceRow: z.number().int().min(2), code: z.string().min(1).max(80), slug: slugSchema,
  name: z.string().min(1).max(200), description: z.string().max(20000),
  brand: z.string().min(1).max(160), category: z.string().min(1).max(160),
  cost: moneySchema, price: moneySchema, stock: z.number().int().min(0).max(2147483647),
  active: z.boolean(), images: z.array(imageSchema),
  reviewNotes: z.array(z.string()), sourceUrls: z.array(z.url()),
}).strict();

async function main() {
  const file = resolve(process.env.CATALOG_IMPORT_FILE ?? 'catalog/import-ready.json');
  const entries = z.array(entrySchema).min(1).parse(JSON.parse(readFileSync(file, 'utf8')));
  for (const field of ['code', 'slug', 'sourceRow'] as const) {
    if (new Set(entries.map((entry) => entry[field])).size !== entries.length) throw new Error('Duplicated import identifier');
  }
  if (entries.some((entry) => entry.active && entry.reviewNotes.length > 0)) throw new Error('Unreviewed active product');
  const summary = { products: entries.length, units: entries.reduce((total, entry) => total + entry.stock, 0), active: entries.filter((entry) => entry.active).length, inactive: entries.filter((entry) => !entry.active).length, images: entries.reduce((total, entry) => total + entry.images.length, 0) };
  if (!process.argv.includes('--apply')) { console.log(JSON.stringify({ mode: 'dry-run', ...summary })); return; }
  const result = await db.$transaction(async (transaction) => {
    let created = 0;
    let skipped = 0;
    for (const entry of entries) {
      const existing = await transaction.product.findFirst({ where: { OR: [{ code: entry.code }, { slug: entry.slug }] }, select: { code: true, slug: true } });
      if (existing) {
        if (existing.code !== entry.code || existing.slug !== entry.slug) throw new Error('Existing identifier belongs to another product');
        skipped++;
        continue;
      }
      const brand = await transaction.brand.upsert({ where: { slug: slugify(entry.brand) }, create: { name: entry.brand, slug: slugify(entry.brand) }, update: {} });
      const category = await transaction.category.upsert({ where: { slug: slugify(entry.category) }, create: { name: entry.category, slug: slugify(entry.category) }, update: {} });
      await transaction.product.create({ data: {
        code: entry.code, slug: entry.slug, name: entry.name, description: entry.description,
        cost: entry.cost, price: entry.price, stock: entry.stock, active: entry.active,
        brandId: brand.id, categoryId: category.id, images: { create: entry.images },
      } });
      created++;
    }
    return { created, skipped };
  }, { maxWait: 15000, timeout: 120000 });
  console.log(JSON.stringify({ mode: 'applied', ...summary, ...result }));
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({ error: 'CATALOG_IMPORT_FAILED', type: error instanceof Error ? error.name : 'UnknownError', code: error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined }));
  process.exitCode = 1;
}).finally(() => db.$disconnect());
