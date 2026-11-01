'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, allTaxonomies, errorMessage, type Product, type Taxonomy } from '../lib/admin-client';
import { moneyInput, parseMoneyInput, slugify } from '../lib/admin-format';
import { ImageManager } from './image-manager';
import { ConfirmDialog } from './ui';

type ProductInput = Pick<Product, 'code' | 'slug' | 'name' | 'description' | 'brandId' | 'categoryId' | 'cost' | 'price' | 'stock' | 'active'>;
type FormValues = Omit<ProductInput, 'stock'> & { stock: string };
type Errors = Partial<Record<keyof FormValues, string>>;

const emptyForm: FormValues = {
  code: '', slug: '', name: '', description: '', brandId: '', categoryId: '',
  cost: '', price: '', stock: '0', active: true,
};

function formValues(product: Product): FormValues {
  return {
    code: product.code, slug: product.slug, name: product.name, description: product.description,
    brandId: product.brandId, categoryId: product.categoryId, cost: moneyInput(product.cost),
    price: moneyInput(product.price), stock: String(product.stock), active: product.active,
  };
}

function FieldError({ name, message }: { name: string; message?: string }) {
  return message ? <span id={`product-${name}-error`} className="error">{message}</span> : null;
}

export function ProductEditor({ id }: { id?: string }) {
  return <ProductEditorForm key={id ?? 'new'} id={id} />;
}

function ProductEditorForm({ id }: { id?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [form, setForm] = useState<FormValues>(emptyForm);
  const [product, setProduct] = useState<Product | null>(null);
  const [brands, setBrands] = useState<Taxonomy[]>([]);
  const [categories, setCategories] = useState<Taxonomy[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(() => id && searchParams.get('criado') === '1' ? 'Produto criado com sucesso.' : '');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [slugEdited, setSlugEdited] = useState(Boolean(id));
  const [pending, setPending] = useState<ProductInput | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setLoadError('');
    async function load() {
      try {
        const [brandList, categoryList, result] = await Promise.all([
          allTaxonomies('brands'), allTaxonomies('categories'),
          id ? api<{ data: Product }>(`/products/${encodeURIComponent(id)}`) : Promise.resolve(null),
        ]);
        if (!current) return;
        setBrands(brandList);
        setCategories(categoryList);
        setProduct(result?.data ?? null);
        setForm(result ? formValues(result.data) : { ...emptyForm });
      } catch (cause) {
        if (current) setLoadError(errorMessage(cause));
      } finally {
        if (current) setLoading(false);
      }
    }
    void load();
    return () => { current = false; };
  }, [id, attempt]);

  function change<K extends keyof FormValues>(name: K, value: FormValues[K]) {
    setForm((previous) => ({ ...previous, [name]: value }));
    setErrors((previous) => ({ ...previous, [name]: undefined }));
    setError('');
    setSuccess('');
  }

  function validate(): ProductInput | null {
    const next: Errors = {};
    const code = form.code.trim();
    const name = form.name.trim();
    const cost = parseMoneyInput(form.cost.trim());
    const price = parseMoneyInput(form.price.trim());
    const stock = Number(form.stock);
    if (!code || code.length > 80) next.code = 'Informe um código com até 80 caracteres.';
    if (!name || name.length > 200) next.name = 'Informe um nome com até 200 caracteres.';
    if (form.slug.length > 160 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug)) {
      next.slug = 'Use até 160 caracteres: letras minúsculas, números e hífens entre palavras.';
    }
    if (form.description.length > 20000) next.description = 'A descrição deve ter até 20.000 caracteres.';
    if (!brands.some((brand) => brand.id === form.brandId)) next.brandId = 'Selecione uma marca.';
    if (!categories.some((category) => category.id === form.categoryId)) next.categoryId = 'Selecione uma categoria.';
    const validMoney = /^(?:0|[1-9]\d{0,9})\.\d{2}$/;
    if (cost === null || !validMoney.test(cost)) next.cost = 'Informe um custo de 0,00 a 9.999.999.999,99, com até duas casas decimais.';
    if (price === null || !validMoney.test(price)) next.price = 'Informe um preço de 0,00 a 9.999.999.999,99, com até duas casas decimais.';
    if (!/^\d+$/.test(form.stock) || !Number.isInteger(stock) || stock > 2147483647) {
      next.stock = 'Informe um estoque inteiro de 0 a 2.147.483.647.';
    }
    setErrors(next);
    if (Object.keys(next).length || cost === null || price === null) {
      setError('Revise os campos indicados antes de salvar.');
      return null;
    }
    return {
      code, slug: form.slug, name, description: form.description, brandId: form.brandId,
      categoryId: form.categoryId, cost, price, stock, active: form.active,
    };
  }

  async function save(input: ProductInput) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const { data } = await api<{ data: Product }>(id ? `/products/${encodeURIComponent(id)}` : '/products', {
        method: id ? 'PATCH' : 'POST', body: input,
      });
      if (!id) {
        router.push(`/produtos/${encodeURIComponent(data.id)}?criado=1`);
      } else {
        setProduct(data);
        setForm(formValues(data));
        setSuccess('Produto atualizado com sucesso.');
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      saving.current = false;
      setBusy(false);
      setPending(null);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || pending || loading) return;
    setError('');
    setSuccess('');
    const input = validate();
    if (!input) return;
    if (product?.active && !input.active) setPending(input);
    else void save(input);
  }

  const disabled = busy || pending !== null;
  const accessibility = (name: keyof FormValues) => ({
    'aria-invalid': Boolean(errors[name]),
    'aria-describedby': errors[name] ? `product-${name}-error` : undefined,
  });

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Catálogo</p>
          <h1 className="page-title">{id ? 'Editar produto' : 'Novo produto'}</h1>
          <p className="page-description">Cadastre os dados, valores e disponibilidade do produto.</p>
        </div>
        <Link className="button secondary" href="/produtos">Voltar para produtos</Link>
      </header>
      {loading ? <p className="muted" role="status">Carregando dados do formulário…</p> : loadError ? (
        <div className="notice error" role="alert">
          <p>{loadError}</p>
          <button type="button" className="button secondary" onClick={() => setAttempt((value) => value + 1)}>Tentar novamente</button>
        </div>
      ) : (
        <>
          {error && <p className="notice error" role="alert">{error}</p>}
          {success && <p className="notice success" role="status">{success}</p>}
          <section className="card" aria-labelledby="product-details-title">
            <header className="card-header"><h2 id="product-details-title">Dados do produto</h2></header>
            <form className="form-grid" onSubmit={submit} noValidate aria-busy={busy}>
              <div className="field">
                <label htmlFor="product-code">Código *</label>
                <input id="product-code" value={form.code} maxLength={80} required disabled={disabled} onChange={(event) => change('code', event.target.value)} {...accessibility('code')} />
                <FieldError name="code" message={errors.code} />
              </div>
              <div className="field">
                <label htmlFor="product-name">Nome *</label>
                <input id="product-name" value={form.name} maxLength={200} required disabled={disabled} onChange={(event) => {
                  const name = event.target.value;
                  change('name', name);
                  if (!id && !slugEdited) change('slug', slugify(name).slice(0, 160).replace(/-+$/, ''));
                }} {...accessibility('name')} />
                <FieldError name="name" message={errors.name} />
              </div>
              <div className="field full">
                <label htmlFor="product-slug">Slug *</label>
                <input id="product-slug" value={form.slug} maxLength={160} required disabled={disabled} onChange={(event) => {
                  setSlugEdited(true);
                  change('slug', event.target.value);
                }} {...accessibility('slug')} />
                <span className="muted">Identificador usado na URL. A sugestão do nome pode ser editada.</span>
                <FieldError name="slug" message={errors.slug} />
              </div>
              <div className="field full">
                <label htmlFor="product-description">Descrição</label>
                <textarea id="product-description" value={form.description} rows={6} maxLength={20000} disabled={disabled} onChange={(event) => change('description', event.target.value)} {...accessibility('description')} />
                <FieldError name="description" message={errors.description} />
              </div>
              <div className="field">
                <label htmlFor="product-brandId">Marca *</label>
                <select id="product-brandId" value={form.brandId} required disabled={disabled} onChange={(event) => change('brandId', event.target.value)} {...accessibility('brandId')}>
                  <option value="">Selecione uma marca</option>
                  {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}{brand.active ? '' : ' (inativa)'}</option>)}
                </select>
                {!brands.length && <span className="muted">Cadastre uma marca antes de salvar o produto.</span>}
                <FieldError name="brandId" message={errors.brandId} />
              </div>
              <div className="field">
                <label htmlFor="product-categoryId">Categoria *</label>
                <select id="product-categoryId" value={form.categoryId} required disabled={disabled} onChange={(event) => change('categoryId', event.target.value)} {...accessibility('categoryId')}>
                  <option value="">Selecione uma categoria</option>
                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.active ? '' : ' (inativa)'}</option>)}
                </select>
                {!categories.length && <span className="muted">Cadastre uma categoria antes de salvar o produto.</span>}
                <FieldError name="categoryId" message={errors.categoryId} />
              </div>
              <div className="field">
                <label htmlFor="product-cost">Custo (R$) *</label>
                <input id="product-cost" type="text" inputMode="decimal" value={form.cost} required disabled={disabled} placeholder="0,00" onChange={(event) => change('cost', event.target.value)} {...accessibility('cost')} />
                <FieldError name="cost" message={errors.cost} />
              </div>
              <div className="field">
                <label htmlFor="product-price">Preço de venda (R$) *</label>
                <input id="product-price" type="text" inputMode="decimal" value={form.price} required disabled={disabled} placeholder="0,00" onChange={(event) => change('price', event.target.value)} {...accessibility('price')} />
                <FieldError name="price" message={errors.price} />
              </div>
              <div className="field">
                <label htmlFor="product-stock">Estoque *</label>
                <input id="product-stock" type="number" min={0} max={2147483647} step={1} value={form.stock} required disabled={disabled} onChange={(event) => change('stock', event.target.value)} {...accessibility('stock')} />
                <FieldError name="stock" message={errors.stock} />
              </div>
              <div className="field">
                <label htmlFor="product-active"><input id="product-active" type="checkbox" checked={form.active} disabled={disabled} onChange={(event) => change('active', event.target.checked)} /> Produto ativo</label>
                <span className="muted">Produtos inativos não aparecem no catálogo público.</span>
              </div>
              <div className="form-actions full">
                <button className="button primary" type="submit" disabled={disabled}>{busy ? 'Salvando…' : id ? 'Salvar alterações' : 'Criar produto'}</button>
              </div>
            </form>
          </section>
          {id && product ? <ImageManager productId={product.id} /> : <p className="notice muted">Salve o produto para gerenciar suas imagens por URL HTTPS.</p>}
        </>
      )}
      {pending && <ConfirmDialog open title="Desativar produto?" description="O produto deixará de aparecer no catálogo público. As demais alterações também serão salvas." confirmLabel="Desativar e salvar" busy={busy} onCancel={() => { if (!saving.current) setPending(null); }} onConfirm={() => { void save(pending); }} />}
    </>
  );
}

export default ProductEditor;
