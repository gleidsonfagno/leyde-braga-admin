import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { db } from './db';
import { ApiError, requireSameOrigin } from './http';

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}
const sessionSeconds = 8 * 60 * 60;
export function digest(value: string) { return createHash('sha256').update(value).digest('hex'); }
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt);
  return `scrypt$32768$8$1$${salt}$${hash.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, cost, blockSize, parallel, salt, expected] = encoded.split('$');
  if (algorithm !== 'scrypt' || cost !== '32768' || blockSize !== '8' || parallel !== '1' || !/^[a-f0-9]{32}$/.test(salt ?? '') || !/^[a-f0-9]{128}$/.test(expected ?? '')) return false;
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
function csrfToken(token: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error('Invalid AUTH_SECRET');
  return createHmac('sha256', secret).update(token).digest('hex');
}
export function cookieName() { return process.env.NODE_ENV === 'production' ? '__Host-admin_session' : 'admin_session'; }
export function sessionCookie(token: string, maxAge = sessionSeconds) {
  return `${cookieName()}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
export function readSessionToken(request: Request) {
  const value = request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${cookieName()}=`))?.slice(cookieName().length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}
export async function authenticate(request: Request) {
  const token = readSessionToken(request);
  if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'Autenticação necessária.');
  const session = await db.session.findUnique({ where: { tokenHash: digest(token) }, include: { admin: true } });
  if (!session || session.expiresAt <= new Date() || !session.admin.active) throw new ApiError(401, 'UNAUTHORIZED', 'Sessão inválida.');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    requireSameOrigin(request);
    const supplied = request.headers.get('x-csrf-token') ?? '';
    if (!/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(digest(supplied), 'hex'), Buffer.from(session.csrfHash, 'hex'))) {
      throw new ApiError(403, 'CSRF_DENIED', 'Token CSRF inválido.');
    }
  }
  return { session, csrfToken: csrfToken(token) };
}
export async function createSession(adminId: string, previousToken?: string) {
  const token = randomBytes(32).toString('hex');
  const csrf = csrfToken(token);
  await db.$transaction(async (transaction) => {
    if (previousToken) await transaction.session.deleteMany({ where: { tokenHash: digest(previousToken) } });
    await transaction.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    await transaction.session.create({ data: { tokenHash: digest(token), csrfHash: digest(csrf), adminId, expiresAt: new Date(Date.now() + sessionSeconds * 1000) } });
  });
  return { token, csrfToken: csrf };
}
export function loginClient(request: Request) {
  if (process.env.VERCEL !== '1') return 'local';
  const address = request.headers.get('x-vercel-forwarded-for')?.trim();
  if (!address || !isIP(address)) throw new ApiError(503, 'CLIENT_UNAVAILABLE', 'Não foi possível identificar a conexão.');
  return address;
}
export async function consumeLoginAttempt(email: string, request: Request) {
  const client = loginClient(request);
  await db.loginAttempt.deleteMany({ where: { windowStart: { lt: new Date(Date.now() - 15 * 60 * 1000) } } });
  const keys = [{ key: digest(`ip:${client}`), limit: 100 }, { key: digest(`email:${email}:ip:${client}`), limit: 5 }];
  for (const item of keys) {
    const rows = await db.$queryRaw<{ attempts: number }[]>`
      INSERT INTO "LoginAttempt" ("key", "attempts", "windowStart") VALUES (${item.key}, 1, NOW())
      ON CONFLICT ("key") DO UPDATE SET
        "attempts" = CASE WHEN "LoginAttempt"."windowStart" < NOW() - INTERVAL '15 minutes' THEN 1 ELSE "LoginAttempt"."attempts" + 1 END,
        "windowStart" = CASE WHEN "LoginAttempt"."windowStart" < NOW() - INTERVAL '15 minutes' THEN NOW() ELSE "LoginAttempt"."windowStart" END
      RETURNING "attempts"`;
    if (rows[0].attempts > item.limit) throw new ApiError(429, 'RATE_LIMITED', 'Limite de tentativas. Aguarde 15 minutos.');
  }
}
