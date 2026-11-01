'use client';
import { useEffect, useRef } from 'react';

export function ConfirmDialog({ open, title, description, onConfirm, onCancel, busy = false, confirmLabel = 'Desativar registro' }: { open: boolean; title: string; description: string; onConfirm: () => void; onCancel: () => void; busy?: boolean; confirmLabel?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    if (!open && ref.current?.open) ref.current?.close();
  }, [open]);
  return <dialog ref={ref} className="confirm-dialog" aria-labelledby="confirm-title" aria-describedby="confirm-description" onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}><div className="dialog-symbol" aria-hidden="true">!</div><h2 id="confirm-title">{title}</h2><p id="confirm-description">{description}</p><div className="form-actions"><button className="button secondary" autoFocus onClick={onCancel} disabled={busy}>Cancelar</button><button className="button danger" onClick={onConfirm} disabled={busy}>{busy ? 'Aguarde…' : confirmLabel}</button></div></dialog>;
}
export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <div className="pagination"><span>{total ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} de ${total} registros` : 'Nenhum registro'}</span><div><button className="button secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Página anterior">←</button><span>Página {page} de {pages}</span><button className="button secondary" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Próxima página">→</button></div></div>;
}
