import { Prisma } from '@prisma/client';

export const publicTaxonomySelect = { id: true, name: true, slug: true } satisfies Prisma.BrandSelect;
export const publicProductSelect = {
  id: true, code: true, slug: true, name: true, description: true, price: true,
  brand: { select: publicTaxonomySelect }, category: { select: publicTaxonomySelect },
  images: { select: { id: true, url: true, alt: true, order: true }, orderBy: [{ order: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.ProductSelect;
// Apenas a leitura no servidor inclui stock; a resposta pública usa a allowlist abaixo.
export function serializePublicProduct(product: Prisma.ProductGetPayload<{ select: typeof publicProductSelect }> & { stock: number }) {
  return {
    id: product.id, code: product.code, slug: product.slug, name: product.name,
    description: product.description, price: product.price.toFixed(2), inStock: product.stock > 0,
    brand: { id: product.brand.id, name: product.brand.name, slug: product.brand.slug },
    category: { id: product.category.id, name: product.category.name, slug: product.category.slug },
    images: product.images.map((image) => ({ id: image.id, url: image.url, alt: image.alt, order: image.order })),
  };
}
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
