'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/admin-client';

export function AdminShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const verify = () => { void api('/auth/session').catch(() => {}); };
    verify();
    window.addEventListener('focus', verify); window.addEventListener('pageshow', verify);
    return () => { window.removeEventListener('focus', verify); window.removeEventListener('pageshow', verify); };
  }, [path]);
  async function logout() {
    setBusy(true); setError('');
    try { await api('/auth/logout', { method: 'POST' }); window.location.assign('/login'); }
    catch (failure) { setError(errorMessage(failure)); setBusy(false); }
  }
  return <div className="admin-app"><a className="skip-link" href="#conteudo">Pular para o conteúdo</a><aside className="sidebar"><Link href="/produtos" className="brand-wordmark">LEYDE BRAGA<span>CATÁLOGO & GESTÃO</span></Link><div className="nav-label">ADMINISTRAÇÃO</div><nav aria-label="Navegação principal">{[{ href: '/produtos', label: 'Produtos', icon: '◇' }, { href: '/marcas', label: 'Marcas', icon: '◈' }, { href: '/categorias', label: 'Categorias', icon: '▦' }].map((item) => <Link key={item.href} href={item.href} className={`nav-link ${path.startsWith(item.href) ? 'selected' : ''}`} aria-current={path.startsWith(item.href) ? 'page' : undefined}><span aria-hidden="true">{item.icon}</span>{item.label}<span className="nav-arrow" aria-hidden="true">↗</span></Link>)}</nav><div className="sidebar-bottom"><div className="account"><span className="avatar">LB</span><div><strong>Administração</strong><span>Acesso protegido</span></div></div><button className="logout-button" onClick={logout} disabled={busy}>{busy ? 'Saindo…' : 'Sair do painel'} <span aria-hidden="true">↗</span></button>{error && <p role="alert" className="notice error">{error}</p>}</div></aside><div className="workspace"><header className="topbar"><span>PAINEL ADMINISTRATIVO</span><span className="session-indicator"><i /> Sessão protegida</span></header><main className="main-content" id="conteudo">{children}</main><footer className="workspace-footer">LEYDE BRAGA<span>Feito para cuidar de cada detalhe.</span></footer></div></div>;
}
