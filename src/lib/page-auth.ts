import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { authenticate } from './auth';
import { ApiError } from './http';

export async function pageSession() {
  const cookie = (await cookies()).toString();
  try { return await authenticate(new Request('http://internal/session', { headers: { cookie } })); }
  catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw new Error('Não foi possível verificar a sessão. Tente novamente em instantes.');
  }
}
export async function requirePageSession() {
  if (!await pageSession()) redirect('/login');
}
