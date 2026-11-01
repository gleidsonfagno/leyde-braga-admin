'use client';

export type Taxonomy = { id: string; name: string; slug: string; active: boolean };
export type ProductImage = { id: string; productId: string; url: string; alt: string; order: number };
export type Product = {
  id: string; code: string; slug: string; name: string; description: string;
  brandId: string; categoryId: string; brand: Taxonomy; category: Taxonomy;
  cost: string; price: string; stock: number; active: boolean; images: ProductImage[];
};
export type Paginated<T> = { data: T[]; pagination: { page: number; pageSize: number; total: number } };
export class ClientError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}
const fieldNames: Record<string, string> = { name: 'nome', slug: 'endereço (slug)', code: 'código', brandId: 'marca', categoryId: 'categoria', cost: 'custo', price: 'preço de venda', stock: 'estoque', description: 'descrição', active: 'status', url: 'URL da imagem', alt: 'texto alternativo', order: 'ordem', email: 'email', password: 'senha' };
export function errorMessage(error: unknown) {
  return error instanceof ClientError ? error.message : 'Não foi possível concluir. Verifique sua conexão e tente novamente.';
}
async function request<T>(path: string, options: { method?: string; body?: unknown } = {}, csrfToken?: string): Promise<T> {
  const method = options.method ?? 'GET';
  const response = await fetch(`/api/v1/admin${path}`, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: { ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(csrfToken && method !== 'GET' ? { 'X-CSRF-Token': csrfToken } : {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login') {
      window.location.replace('/login?motivo=sessao');
    }
    const fields = result.error?.fields?.map((field: string) => fieldNames[field] ?? 'campos informados');
    const message = fields?.length ? `Confira os campos: ${[...new Set(fields)].join(', ')}.` : result.error?.message ?? 'Não foi possível concluir a operação.';
    throw new ClientError(message, response.status, result.error?.code);
  }
  return result as T;
}
export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!options.method || options.method === 'GET' || path === '/auth/login') return request<T>(path, options);
  async function mutate() {
    const { csrfToken } = await request<{ csrfToken: string }>('/auth/session');
    return request<T>(path, options, csrfToken);
  }
  try { return await mutate(); }
  catch (error) {
    if (error instanceof ClientError && error.status === 403 && error.code === 'CSRF_DENIED') return mutate();
    throw error;
  }
}
export async function allTaxonomies(resource: 'brands' | 'categories') {
  const items: Taxonomy[] = [];
  let page = 1;
  while (true) {
    const result = await api<Paginated<Taxonomy>>(`/${resource}?page=${page}&pageSize=100`);
    items.push(...result.data);
    if (page * result.pagination.pageSize >= result.pagination.total) return items;
    page++;
  }
}
