import { redirect } from 'next/navigation';
import { pageSession } from '../../lib/page-auth';
import { LoginForm } from '../../components/login-form';

export default async function Login() {
  if (await pageSession()) redirect('/produtos');
  return <main className="login-page"><section className="login-story"><a className="brand-wordmark" href="/login">LEYDE BRAGA<span>CATÁLOGO & GESTÃO</span></a><div><span className="eyebrow">SEU CATÁLOGO, BEM CUIDADO.</span><h1>Cada detalhe<br />faz a diferença.</h1><p>Um espaço para organizar seus produtos<br />e manter tudo pronto para a vitrine.</p></div><span className="login-footer">PAINEL ADMINISTRATIVO · ACESSO RESTRITO</span></section><section className="login-panel"><LoginForm /></section></main>;
}
