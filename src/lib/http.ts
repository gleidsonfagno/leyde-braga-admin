import { Prisma } from '@prisma/client';
import { z } from 'zod';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}
export async function body(request: Request) {
  if (!request.headers.get('content-type')?.split(';')[0].trim().match(/^application\/json$/i)) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Envie JSON.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'INVALID_JSON', 'JSON inválido.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.length;
    if (length > 65536) { await reader.cancel(); throw new ApiError(413, 'BODY_TOO_LARGE', 'Corpo excede 64 KiB.'); }
    chunks.push(chunk.value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'INVALID_JSON', 'JSON inválido.'); }
}
export function requireSameOrigin(request: Request) {
  const expected = process.env.APP_ORIGIN;
  if (!expected || new URL(expected).origin !== expected) throw new Error('Invalid APP_ORIGIN');
  if (request.headers.get('origin') !== expected || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new ApiError(403, 'ORIGIN_DENIED', 'Origem não permitida.');
  }
}
export function publicCors(request: Request, response: Response) {
  response.headers.set('Vary', 'Origin');
  const origin = request.headers.get('origin');
  const allowed = (process.env.CORS_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (origin && allowed.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  }
  return response;
}
export function endpoint(handler: (request: Request) => Promise<Response>, isPublic = false) {
  return async (request: Request) => {
    let response: Response;
    try { response = await handler(request); }
    catch (error) {
      if (error instanceof z.ZodError) response = json({ error: { code: 'VALIDATION_ERROR', message: 'Entrada inválida.', fields: error.issues.map((issue) => issue.path.join('.')) } }, 400);
      else if (error instanceof ApiError) response = json({ error: { code: error.code, message: error.message } }, error.status);
      else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') response = json({ error: { code: 'CONFLICT', message: 'Código ou slug já cadastrado.' } }, 409);
      else if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2025', 'P2003'].includes(error.code)) response = json({ error: { code: 'INVALID_REFERENCE', message: 'Registro ou referência não encontrado.' } }, 404);
      else response = json({ error: { code: 'INTERNAL_ERROR', message: 'Não foi possível concluir a operação.' } }, 500);
    }
    return isPublic ? publicCors(request, response) : response;
  };
}
