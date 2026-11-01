'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/admin-client';

export function LoginForm() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('motivo') === 'sessao') setError('Sua sessão expirou. Entre novamente para continuar.');
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(''); setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      await api('/auth/login', { method: 'POST', body: { email: String(data.get('email')).trim(), password: String(data.get('password')) } });
      window.location.assign('/produtos');
    } catch (failure) { setError(errorMessage(failure)); setBusy(false); }
  }
  return <div className="login-form"><span className="eyebrow">BEM-VINDA DE VOLTA</span><h2>Acesse seu painel</h2><p className="muted">Entre para cuidar do seu catálogo.</p>{error && <div className="notice error" role="alert">{error}</div>}<form onSubmit={submit}><div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" placeholder="seu@email.com" required maxLength={254} /></div><div className="field"><label htmlFor="password">Senha</label><input id="password" name="password" type="password" autoComplete="current-password" placeholder="Sua senha" required maxLength={128} /></div><button className="button primary" disabled={busy}>{busy ? 'Entrando…' : 'Entrar no painel'}<span aria-hidden="true">↗</span></button></form><p className="login-help">Precisa de acesso? Solicite à pessoa responsável pela administração.</p></div>;
}
