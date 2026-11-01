'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { allTaxonomies, api, errorMessage, type Paginated, type Product, type Taxonomy } from '../lib/admin-client';
import { formatBRL } from '../lib/admin-format';
import { ConfirmDialog, Pagination } from './ui';

const pageSize = 20;

export function ProductList() {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ q: '', brand: '', category: '', active: '', page: 1 });
  const [brands, setBrands] = useState<Taxonomy[]>([]);
  const [categories, setCategories] = useState<Taxonomy[]>([]);
  const [taxonomiesLoading, setTaxonomiesLoading] = useState(true);
  const [taxonomiesError, setTaxonomiesError] = useState('');
  const [result, setResult] = useState<Paginated<Product> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [success, setSuccess] = useState('');
  const [reload, setReload] = useState(0);
  const [taxonomyReload, setTaxonomyReload] = useState(0);
  const [selected, setSelected] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  const mutationPending = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setTaxonomiesLoading(true);
    setTaxonomiesError('');
    Promise.all([allTaxonomies('brands'), allTaxonomies('categories')])
      .then(([nextBrands, nextCategories]) => {
        if (cancelled) return;
        setBrands(nextBrands);
        setCategories(nextCategories);
      })
      .catch((error: unknown) => {
        if (!cancelled) setTaxonomiesError(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setTaxonomiesLoading(false);
      });
    return () => { cancelled = true; };
  }, [taxonomyReload]);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ page: String(filters.page), pageSize: String(pageSize) });
    if (filters.q) query.set('q', filters.q);
    if (filters.brand) query.set('brand', filters.brand);
    if (filters.category) query.set('category', filters.category);
    if (filters.active) query.set('active', filters.active);
    setLoading(true);
    setLoadError('');
    api<Paginated<Product>>(`/products?${query}`)
      .then((data) => {
        if (cancelled) return;
        const lastPage = Math.max(1, Math.ceil(data.pagination.total / pageSize));
        if (filters.page > lastPage) {
          setFilters((current) => ({ ...current, page: lastPage }));
          return;
        }
        setResult(data);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [filters, reload]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilters((current) => ({ ...current, q: search.trim(), page: 1 }));
  }

  async function deactivate() {
    if (!selected || mutationPending.current) return;
    mutationPending.current = true;
    setBusy(true);
    setActionError('');
    setSuccess('');
    try {
      await api(`/products/${encodeURIComponent(selected.id)}`, { method: 'DELETE' });
      if (!mounted.current) return;
      setSuccess(`Produto “${selected.name}” desativado.`);
      setSelected(null);
      setReload((current) => current + 1);
    } catch (error) {
      if (mounted.current) {
        setSelected(null);
        setActionError(errorMessage(error));
      }
    } finally {
      mutationPending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Catálogo</p>
          <h1 className="page-title">Produtos</h1>
          <p className="page-description">Consulte e gerencie os produtos do catálogo.</p>
        </div>
        <Link className="button primary" href="/produtos/novo">Novo produto</Link>
      </header>

      {actionError && <p className="notice error" role="alert">{actionError}</p>}
      {success && <p className="notice success" role="status">{success}</p>}
      {taxonomiesError && (
        <div className="notice error" role="alert">
          <p>Não foi possível carregar as marcas e categorias: {taxonomiesError}</p>
          <button type="button" className="button secondary" onClick={() => setTaxonomyReload((current) => current + 1)}>
            Tentar carregar filtros novamente
          </button>
        </div>
      )}

      <section className="card" aria-label="Lista de produtos">
        <div className="card-header">
          <form className="filters" onSubmit={submitSearch} role="search" aria-label="Filtrar produtos">
            <label className="field">
              <span>Buscar produto</span>
              <input type="search" value={search} maxLength={200} placeholder="Nome, código ou descrição" disabled={busy} onChange={(event) => setSearch(event.target.value)} />
            </label>
            <label className="field">
              <span>Marca</span>
              <select value={filters.brand} disabled={busy || taxonomiesLoading || Boolean(taxonomiesError)} onChange={(event) => setFilters((current) => ({ ...current, brand: event.target.value, page: 1 }))}>
                <option value="">Todas as marcas</option>
                {brands.map((brand) => <option key={brand.id} value={brand.slug}>{brand.name}{brand.active ? '' : ' (inativa)'}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Categoria</span>
              <select value={filters.category} disabled={busy || taxonomiesLoading || Boolean(taxonomiesError)} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value, page: 1 }))}>
                <option value="">Todas as categorias</option>
                {categories.map((category) => <option key={category.id} value={category.slug}>{category.name}{category.active ? '' : ' (inativa)'}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Status</span>
              <select value={filters.active} disabled={busy} onChange={(event) => setFilters((current) => ({ ...current, active: event.target.value, page: 1 }))}>
                <option value="">Todos</option>
                <option value="true">Ativo</option>
                <option value="false">Inativo</option>
              </select>
            </label>
            <button className="button primary" type="submit" disabled={busy}>Buscar</button>
            <button className="button secondary" type="button" disabled={busy} onClick={() => {
              setSearch('');
              setFilters({ q: '', brand: '', category: '', active: '', page: 1 });
            }}>Limpar filtros</button>
          </form>
          {taxonomiesLoading && <p className="muted" role="status">Carregando marcas e categorias…</p>}
        </div>

        <div aria-busy={loading}>
          {loading ? <p className="empty-state" role="status">Carregando produtos…</p> : loadError ? (
            <div className="notice error" role="alert">
              <p>Não foi possível carregar os produtos: {loadError}</p>
              <button className="button secondary" type="button" onClick={() => setReload((current) => current + 1)}>Tentar novamente</button>
            </div>
          ) : result && result.data.length > 0 ? (
            <>
              <div className="table-wrap">
                <table>
                  <thead><tr>
                    <th scope="col">Produto</th><th scope="col">Marca</th><th scope="col">Categoria</th>
                    <th scope="col">Custo</th><th scope="col">Preço</th><th scope="col">Estoque</th>
                    <th scope="col">Status</th><th scope="col">Ações</th>
                  </tr></thead>
                  <tbody>
                    {result.data.map((product) => {
                      const thumbnail = product.images[0];
                      return (
                        <tr key={product.id}>
                          <td>
                            <div className="product-cell">
                              {thumbnail ? <img className="thumbnail" src={thumbnail.url} alt={thumbnail.alt || product.name} width={56} height={56} loading="lazy" /> : <span className="thumbnail muted" aria-label="Sem imagem">Sem imagem</span>}
                              <div><strong>{product.name}</strong><div className="muted">{product.code}</div></div>
                            </div>
                          </td>
                          <td>{product.brand.name}</td><td>{product.category.name}</td>
                          <td>{formatBRL(product.cost)}</td><td>{formatBRL(product.price)}</td><td>{product.stock}</td>
                          <td><span className={`badge ${product.active ? 'active' : 'inactive'}`}>{product.active ? 'Ativo' : 'Inativo'}</span></td>
                          <td><div className="actions">
                            <Link className="button secondary" href={`/produtos/${encodeURIComponent(product.id)}`} aria-label={`Editar ${product.name}`}>Editar</Link>
                            <button className="button danger" type="button" disabled={!product.active || busy} onClick={() => { setActionError(''); setSelected(product); }} aria-label={`Desativar ${product.name}`}>Desativar</button>
                          </div></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pagination page={filters.page} pageSize={pageSize} total={result.pagination.total} onPage={(page) => { if (!busy) setFilters((current) => ({ ...current, page })); }} />
            </>
          ) : <div className="empty-state"><p>Nenhum produto encontrado.</p><p className="muted">Ajuste os filtros ou cadastre um novo produto.</p></div>}
        </div>
      </section>

      <ConfirmDialog open={selected !== null} title="Desativar produto" description={`Deseja desativar “${selected?.name ?? ''}”? O produto deixará de aparecer no catálogo público e poderá ser reativado na edição.`} onConfirm={deactivate} onCancel={() => { if (!busy) setSelected(null); }} busy={busy} confirmLabel="Desativar produto" />
    </>
  );
}
