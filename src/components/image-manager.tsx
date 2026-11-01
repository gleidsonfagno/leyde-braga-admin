'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api, errorMessage, type ProductImage } from '../lib/admin-client';
import { ConfirmDialog } from './ui';

type ImageInput = Pick<ProductImage, 'url' | 'alt' | 'order'>;
type ImageDraft = { url: string; alt: string; order: string };
type ImageErrors = Partial<Record<keyof ImageDraft, string>>;

function httpsUrl(value: string): boolean {
  try {
    return value.length <= 2048 && new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function ImagePreview({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="image-preview">
      {failed ? <p className="notice error" role="status">Não foi possível carregar a imagem. Verifique a URL e o acesso ao arquivo.</p> : (
        <img src={url} alt={alt} referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(true)} />
      )}
    </div>
  );
}

function ImageForm({ image, disabled, saving, onSave, onRemove }: {
  image?: ProductImage;
  disabled: boolean;
  saving: boolean;
  onSave: (input: ImageInput) => Promise<boolean>;
  onRemove?: () => void;
}) {
  const prefix = useId();
  const [draft, setDraft] = useState<ImageDraft>(() => ({ url: image?.url ?? '', alt: image?.alt ?? '', order: String(image?.order ?? 0) }));
  const [errors, setErrors] = useState<ImageErrors>({});

  useEffect(() => {
    setDraft({ url: image?.url ?? '', alt: image?.alt ?? '', order: String(image?.order ?? 0) });
    setErrors({});
  }, [image]);

  function change(name: keyof ImageDraft, value: string) {
    setDraft((previous) => ({ ...previous, [name]: value }));
    setErrors((previous) => ({ ...previous, [name]: undefined }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    const url = draft.url.trim();
    const alt = draft.alt.trim();
    const order = Number(draft.order);
    const next: ImageErrors = {};
    if (!httpsUrl(url)) next.url = 'Informe uma URL HTTPS válida com até 2.048 caracteres.';
    if (alt.length > 300) next.alt = 'O texto alternativo deve ter até 300 caracteres.';
    if (!/^\d+$/.test(draft.order) || !Number.isInteger(order) || order > 2147483647) {
      next.order = 'Informe uma ordem inteira de 0 a 2.147.483.647.';
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    if (await onSave({ url, alt, order }) && !image) setDraft({ url: '', alt: '', order: '0' });
  }

  const accessibility = (name: keyof ImageDraft) => ({
    'aria-invalid': Boolean(errors[name]),
    'aria-describedby': errors[name] ? `${prefix}-${name}-error` : undefined,
  });
  const previewUrl = draft.url.trim();

  return (
    <form className="form-grid" onSubmit={submit} noValidate aria-label={image ? `Editar imagem ${image.alt || image.order}` : 'Adicionar imagem'} aria-busy={saving}>
      <div className="field full">
        <label htmlFor={`${prefix}-url`}>URL HTTPS *</label>
        <input id={`${prefix}-url`} type="url" value={draft.url} maxLength={2048} required disabled={disabled} placeholder="https://exemplo.com/imagem.jpg" onChange={(event) => change('url', event.target.value)} {...accessibility('url')} />
        {errors.url && <span id={`${prefix}-url-error`} className="error" role="alert">{errors.url}</span>}
      </div>
      <div className="field full">
        <label htmlFor={`${prefix}-alt`}>Texto alternativo</label>
        <input id={`${prefix}-alt`} value={draft.alt} maxLength={300} disabled={disabled} onChange={(event) => change('alt', event.target.value)} {...accessibility('alt')} />
        {errors.alt && <span id={`${prefix}-alt-error`} className="error" role="alert">{errors.alt}</span>}
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-order`}>Ordem *</label>
        <input id={`${prefix}-order`} type="number" value={draft.order} min={0} max={2147483647} step={1} required disabled={disabled} onChange={(event) => change('order', event.target.value)} {...accessibility('order')} />
        <span className="muted">Menores números aparecem primeiro.</span>
        {errors.order && <span id={`${prefix}-order-error`} className="error" role="alert">{errors.order}</span>}
      </div>
      <div className="full">
        {httpsUrl(previewUrl) ? <ImagePreview key={previewUrl} url={previewUrl} alt={draft.alt} /> : <div className="image-preview"><p className="muted">Informe uma URL HTTPS para visualizar a imagem.</p></div>}
      </div>
      <div className="form-actions full">
        <button className="button primary" type="submit" disabled={disabled}>{saving ? 'Salvando…' : image ? 'Salvar imagem' : 'Adicionar imagem'}</button>
        {onRemove && <button className="button danger" type="button" disabled={disabled} onClick={onRemove}>Remover imagem</button>}
      </div>
    </form>
  );
}

export function ImageManager({ productId }: { productId: string }) {
  return <ProductImages key={productId} productId={productId} />;
}

function ProductImages({ productId }: { productId: string }) {
  const [images, setImages] = useState<ProductImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ProductImage | null>(null);
  const mutating = useRef(false);
  const basePath = `/products/${encodeURIComponent(productId)}/images`;

  useEffect(() => {
    let current = true;
    setLoading(true);
    setLoadError('');
    async function load() {
      try {
        const { data } = await api<{ data: ProductImage[] }>(basePath);
        if (current) setImages(data);
      } catch (cause) {
        if (current) setLoadError(errorMessage(cause));
      } finally {
        if (current) setLoading(false);
      }
    }
    void load();
    return () => { current = false; };
  }, [basePath, attempt]);

  async function save(input: ImageInput, imageId?: string): Promise<boolean> {
    if (mutating.current) return false;
    mutating.current = true;
    setBusy(imageId ?? 'new');
    setError('');
    setSuccess('');
    try {
      const { data } = await api<{ data: ProductImage }>(imageId ? `${basePath}/${encodeURIComponent(imageId)}` : basePath, {
        method: imageId ? 'PATCH' : 'POST', body: input,
      });
      setImages((previous) => imageId ? previous.map((item) => item.id === imageId ? data : item) : [...previous, data]);
      setSuccess(imageId ? 'Imagem atualizada com sucesso.' : 'Imagem adicionada com sucesso.');
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      return false;
    } finally {
      mutating.current = false;
      setBusy(null);
    }
  }

  async function remove() {
    if (!removing || mutating.current) return;
    const image = removing;
    mutating.current = true;
    setBusy(image.id);
    setError('');
    setSuccess('');
    try {
      await api<{ ok: boolean }>(`${basePath}/${encodeURIComponent(image.id)}`, { method: 'DELETE' });
      setImages((previous) => previous.filter((item) => item.id !== image.id));
      setSuccess('Imagem removida com sucesso.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      mutating.current = false;
      setBusy(null);
      setRemoving(null);
    }
  }

  const disabled = busy !== null || removing !== null;
  const orderedImages = [...images].sort((firstImage, secondImage) => firstImage.order - secondImage.order || firstImage.id.localeCompare(secondImage.id));

  return (
    <section className="card" aria-label="Imagens do produto">
      <header className="card-header">
        <div><h2>Imagens do produto</h2><p className="muted">Adicione imagens por URL HTTPS e salve a ordem desejada.</p></div>
        <span className="badge">{images.length} {images.length === 1 ? 'imagem' : 'imagens'}</span>
      </header>
      {loading ? <p className="muted" role="status">Carregando imagens…</p> : loadError ? (
        <div className="notice error" role="alert">
          <p>{loadError}</p>
          <button className="button secondary" type="button" onClick={() => setAttempt((value) => value + 1)}>Tentar novamente</button>
        </div>
      ) : (
        <>
          {error && <p className="notice error" role="alert">{error}</p>}
          {success && <p className="notice success" role="status">{success}</p>}
          {!images.length && <p className="empty-state">Este produto ainda não tem imagens.</p>}
          <div className="image-grid">
            {orderedImages.map((image) => (
              <article key={image.id} className="image-card">
                <h3>{image.alt || 'Imagem do produto'}</h3>
                <ImageForm image={image} disabled={disabled} saving={busy === image.id && removing === null} onSave={(input) => save(input, image.id)} onRemove={() => {
                  setError('');
                  setSuccess('');
                  setRemoving(image);
                }} />
              </article>
            ))}
          </div>
          <section className="image-card" aria-label="Nova imagem">
            <h3>Adicionar imagem</h3>
            <ImageForm disabled={disabled} saving={busy === 'new'} onSave={(input) => save(input)} />
          </section>
        </>
      )}
      {removing && <ConfirmDialog open title="Remover imagem?" description={`A imagem${removing.alt ? ` “${removing.alt}”` : ''} será removida deste produto. Esta ação não pode ser desfeita.`} confirmLabel="Remover imagem" busy={busy !== null} onCancel={() => { if (!mutating.current) setRemoving(null); }} onConfirm={() => { void remove(); }} />}
    </section>
  );
}
