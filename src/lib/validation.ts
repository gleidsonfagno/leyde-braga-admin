import { z } from 'zod';

export const idSchema = z.uuid();
export const slugSchema = z.string().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const moneySchema = z.string().regex(/^(?:0|[1-9]\d{0,9})\.\d{2}$/);
export const taxonomySchema = z.object({
  name: z.string().trim().min(1).max(160), slug: slugSchema, active: z.boolean().optional(),
}).strict();
export const productSchema = z.object({
  code: z.string().trim().min(1).max(80), slug: slugSchema,
  name: z.string().trim().min(1).max(200), description: z.string().max(20000),
  brandId: idSchema, categoryId: idSchema, cost: moneySchema, price: moneySchema,
  stock: z.number().int().min(0).max(2147483647), active: z.boolean().optional(),
}).strict();
export const imageSchema = z.object({
  url: z.url().max(2048).refine((value) => new URL(value).protocol === 'https:', 'Use HTTPS'),
  alt: z.string().trim().max(300), order: z.number().int().min(0).max(2147483647),
}).strict();
export const loginSchema = z.object({ email: z.email().max(254).transform((value) => value.toLowerCase()), password: z.string().min(1).max(128) }).strict();
export const passwordSchema = z.string().min(12).max(128);
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(200).optional(), brand: slugSchema.optional(), category: slugSchema.optional(),
}).strict();
export const adminPaginationSchema = paginationSchema.extend({ active: z.enum(['true', 'false']).optional() });
export function nonEmptyPatch<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return schema.partial().refine((value) => Object.keys(value).length > 0, 'Informe ao menos um campo');
}
