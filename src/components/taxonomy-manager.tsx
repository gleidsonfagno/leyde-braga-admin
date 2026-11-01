'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, errorMessage, type Paginated, type Taxonomy } from '../lib/admin-client';
import { slugify } from '../lib/admin-format';
import { ConfirmDialog, Pagination } from './ui';

type Resource = 'brands' | 'categories';
type TaxonomyInput = { name: string; slug: string; active: boolean };
type Confirmation = { kind: 'save'; input: TaxonomyInput } | { kind: 'deactivate'; item: Taxonomy };
const pageSize = 20;

export function TaxonomyManager({ resource }: { resource: Resource }) {
  return <TaxonomyEditor key={resource} resource={resource} />;
}

function TaxonomyEditor({ resource }: { resource: Resource }) {
  const singular = resource === 'brands' ? 'Marca' : 'Categoria';
  const plural = resource === 'brands' ? 'Marcas' : 'Categorias';
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ q: '', active: '', page: 1 });
  const [result, setResult] = useState<Paginated<Taxonomy> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [success, setSuccess] = useState('');
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<Taxonomy | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [active, setActive] = useState(true);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(false);
  const mutationPending = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ page: String(filters.page), pageSize: String(pageSize) });
    if (filters.q) query.set('q', filters.q);
    if (filters.active) query.set('active', filters.active);
    setLoading(true);
    setLoadError('');
    api<Paginated<Taxonomy>>(`/${resource}?${query}`)
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
  }, [resource, filters, reload]);

  function resetForm() {
    setEditing(null);
    setName('');
    setSlug('');
    setSlugEdited(false);
    setActive(true);
  }

  function edit(item: Taxonomy) {
    if (busy) return;
    setEditing(item);
    setName(item.name);
    setSlug(item.slug);
    setSlugEdited(true);
    setActive(item.active);
    setActionError('');
    setSuccess('');
    nameInput.current?.focus();
  }

  async function save(input: TaxonomyInput) {
    if (mutationPending.current) return;
    mutationPending.current = true;
    setBusy(true);
    setActionError('');
    setSuccess('');
    try {
      await api(`/${resource}${editing ? `/${encodeURIComponent(editing.id)}` : ''}`, {
        method: editing ? 'PATCH' : 'POST', body: input,
      });
      if (!mounted.current) return;
      setSuccess(`${singular} ${editing ? 'atualizada' : 'criada'} com sucesso.`);
      setConfirmation(null);
      resetForm();
      setReload((current) => current + 1);
    } catch (error) {
      if (mounted.current) {
        setConfirmation(null);
        setActionError(errorMessage(error));
      }
    } finally {
      mutationPending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || mutationPending.current) return;
    const input = { name: name.trim(), slug: slug.trim(), active };
    if (!input.name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)) {
      setActionError('Informe um nome e um slug válido, com letras minúsculas, números e hífens entre palavras.');
      return;
    }
    setActionError('');
    if (editing?.active && !input.active) {
      setConfirmation({ kind: 'save', input });
      return;
    }
    void save(input);
  }

  async function deactivate(item: Taxonomy) {
    if (mutationPending.current) return;
    mutationPending.current = true;
    setBusy(true);
    setActionError('');
    setSuccess('');
    try {
      await api(`/${resource}/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      if (!mounted.current) return;
      if (editing?.id === item.id) {
        setEditing({ ...editing, active: false });
        setActive(false);
      }
      setSuccess(`${singular} “${item.name}” desativada.`);
      setConfirmation(null);
      setReload((current) => current + 1);
    } catch (error) {
      if (mounted.current) {
        setConfirmation(null);
        setActionError(errorMessage(error));
      }
    } finally {
      mutationPending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const confirmationName = confirmation?.kind === 'deactivate' ? confirmation.item.name : name.trim();

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Catálogo</p>
          <h1 className="page-title">{plural}</h1>
          <p className="page-description">Cadastre e gerencie {plural.toLowerCase()}, incluindo as inativas.</p>
        </div>
        <button className="button primary" type="button" disabled={busy} onClick={() => { resetForm(); setActionError(''); setSuccess(''); nameInput.current?.focus(); }}>Nova {singular.toLowerCase()}</button>
      </header>

      {actionError && <p className="notice error" role="alert">{actionError}</p>}
      {success && <p className="notice success" role="status">{success}</p>}

      <div className="taxonomy-layout">
        <section className="card" aria-label={`Lista de ${plural.toLowerCase()}`}>
          <div className="card-header">
            <form className="filters" role="search" aria-label={`Filtrar ${plural.toLowerCase()}`} onSubmit={(event) => {
              event.preventDefault();
              setFilters((current) => ({ ...current, q: search.trim(), page: 1 }));
            }}>
              <label className="field">
                <span>Buscar por nome</span>
                <input type="search" value={search} maxLength={200} disabled={busy} onChange={(event) => setSearch(event.target.value)} placeholder={`Nome da ${singular.toLowerCase()}`} />
              </label>
              <label className="field">
                <span>Status</span>
                <select value={filters.active} disabled={busy} onChange={(event) => setFilters((current) => ({ ...current, active: event.target.value, page: 1 }))}>
                  <option value="">Todos</option><option value="true">Ativa</option><option value="false">Inativa</option>
                </select>
              </label>
              <button className="button primary" type="submit" disabled={busy}>Buscar</button>
              <button className="button secondary" type="button" disabled={busy} onClick={() => { setSearch(''); setFilters({ q: '', active: '', page: 1 }); }}>Limpar filtros</button>
            </form>
          </div>

          <div aria-busy={loading}>
            {loading ? <p className="empty-state" role="status">Carregando {plural.toLowerCase()}…</p> : loadError ? (
              <div className="notice error" role="alert">
                <p>Não foi possível carregar {plural.toLowerCase()}: {loadError}</p>
                <button className="button secondary" type="button" onClick={() => setReload((current) => current + 1)}>Tentar novamente</button>
              </div>
            ) : result && result.data.length > 0 ? (
              <>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th scope="col">Nome</th><th scope="col">Slug</th><th scope="col">Status</th><th scope="col">Ações</th></tr></thead>
                    <tbody>
                      {result.data.map((item) => (
                        <tr key={item.id}>
                          <td>{item.name}</td><td className="muted">{item.slug}</td>
                          <td><span className={`badge ${item.active ? 'active' : 'inactive'}`}>{item.active ? 'Ativa' : 'Inativa'}</span></td>
                          <td><div className="actions">
                            <button className="button secondary" type="button" disabled={busy} onClick={() => edit(item)} aria-label={`Editar ${item.name}`}>Editar</button>
                            <button className="button danger" type="button" disabled={busy || !item.active} onClick={() => { setActionError(''); setConfirmation({ kind: 'deactivate', item }); }} aria-label={`Desativar ${item.name}`}>Desativar</button>
                          </div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pagination page={filters.page} pageSize={pageSize} total={result.pagination.total} onPage={(page) => { if (!busy) setFilters((current) => ({ ...current, page })); }} />
              </>
            ) : <div className="empty-state"><p>Nenhuma {singular.toLowerCase()} encontrada.</p><p className="muted">Ajuste os filtros ou use o formulário para cadastrar.</p></div>}
          </div>
        </section>

        <section className="card" aria-labelledby={`${resource}-form-title`}>
          <div className="card-header"><h2 id={`${resource}-form-title`}>{editing ? 'Editar' : 'Nova'} {singular.toLowerCase()}</h2></div>
          <form className="form-grid" onSubmit={submitForm} aria-busy={busy}>
            <label className="field">
              <span>Nome</span>
              <input ref={nameInput} type="text" value={name} required maxLength={160} disabled={busy} onChange={(event) => {
                setName(event.target.value);
                if (!editing && !slugEdited) setSlug(slugify(event.target.value).slice(0, 160).replace(/-+$/, ''));
              }} />
            </label>
            <label className="field">
              <span>Slug</span>
              <input type="text" value={slug} required maxLength={160} pattern="[a-z0-9]+(-[a-z0-9]+)*" aria-describedby={`${resource}-slug-help`} disabled={busy} onChange={(event) => { setSlugEdited(true); setSlug(event.target.value); }} />
              <span id={`${resource}-slug-help`} className="muted">Use letras minúsculas, números e hífens entre palavras. Você pode alterar a sugestão.</span>
            </label>
            <label className="field"><span><input type="checkbox" checked={active} disabled={busy} onChange={(event) => setActive(event.target.checked)} /> Ativa</span></label>
            <p className="muted">Ao desativar esta {singular.toLowerCase()}, seus produtos também deixam de aparecer no catálogo público.</p>
            <div className="form-actions">
              <button className="button primary" type="submit" disabled={busy}>{busy ? 'Salvando…' : editing ? 'Salvar alterações' : `Criar ${singular.toLowerCase()}`}</button>
              <button className="button secondary" type="button" disabled={busy} onClick={() => { resetForm(); setActionError(''); }}>{editing ? 'Cancelar edição' : 'Limpar formulário'}</button>
            </div>
          </form>
        </section>
      </div>

      <ConfirmDialog open={confirmation !== null} title={`Desativar ${singular.toLowerCase()}`} description={`Deseja desativar “${confirmationName}”? Os produtos vinculados também deixarão de aparecer no catálogo público.${confirmation?.kind === 'save' ? ' As demais alterações do formulário também serão salvas.' : ''}`} onConfirm={() => {
        if (confirmation?.kind === 'save') return save(confirmation.input);
        if (confirmation?.kind === 'deactivate') return deactivate(confirmation.item);
      }} onCancel={() => { if (!busy) setConfirmation(null); }} busy={busy} confirmLabel={confirmation?.kind === 'save' ? 'Salvar e desativar' : `Desativar ${singular.toLowerCase()}`} />
    </>
  );
}
