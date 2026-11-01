import { Prisma } from '@prisma/client';

export const publicTaxonomySelect = { id: true, name: true, slug: true } satisfies Prisma.BrandSelect;
export const publicProductSelect = {
  id: true, code: true, slug: true, name: true, description: true, price: true,
  brand: { select: publicTaxonomySelect }, category: { select: publicTaxonomySelect },
  images: { select: { id: true, url: true, alt: true, order: true }, orderBy: [{ order: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.ProductSelect;
export const publicVisibility = { active: true, brand: { active: true }, category: { active: true } } satisfies Prisma.ProductWhereInput;
export function productFilter(query: { q?: string; brand?: string; category?: string }, publicOnly: boolean): Prisma.ProductWhereInput {
  return {
    ...(publicOnly ? publicVisibility : {}),
    ...(query.brand ? { brand: { ...(publicOnly ? { active: true } : {}), slug: query.brand } } : {}),
    ...(query.category ? { category: { ...(publicOnly ? { active: true } : {}), slug: query.category } } : {}),
    ...(query.q ? { OR: ['name', 'description', 'code'].map((field) => ({ [field]: { contains: query.q, mode: 'insensitive' } })) } : {}),
  };
}
export function serializeProduct<T extends { price: Prisma.Decimal; cost?: Prisma.Decimal }>(product: T) {
  return { ...product, price: product.price.toFixed(2), ...(product.cost !== undefined ? { cost: product.cost.toFixed(2) } : {}) };
}
