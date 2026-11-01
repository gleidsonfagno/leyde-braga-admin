import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, ClientError, errorMessage } from '../src/lib/admin-client';

type ExpectedRequest = {
  path: string;
  method?: string;
  token?: string;
  body?: unknown;
  response?: unknown;
  status?: number;
  failure?: Error;
  jsonResponse?: () => Promise<unknown>;
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((fulfill) => { resolve = fulfill; });
  return { promise, resolve };
}

test('cliente administrativo usa CSRF por operação e repete somente CSRF_DENIED uma vez', async (t) => {
  const expectedRequests: ExpectedRequest[] = [];
  const redirects: string[] = [];
  let storageAccesses = 0;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  function denyStorage(): never {
    storageAccesses++;
    throw new Error('O cliente não deve acessar localStorage.');
  }

  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
    assert.equal(storageAccesses, 0, 'Nenhum token deve ser lido ou persistido em localStorage.');
    assert.equal(expectedRequests.length, 0, 'Todas as requisições previstas devem ocorrer.');
  });

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { replace: (path: string) => { redirects.push(path); } },
      get localStorage() { return denyStorage(); },
    },
  });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: denyStorage });

  const fetchMock = t.mock.method(globalThis, 'fetch', async (input: Parameters<typeof fetch>[0], options?: RequestInit) => {
    const expected = expectedRequests.shift();
    assert.ok(expected, `Requisição inesperada: ${String(input)}`);
    assert.equal(String(input), `/api/v1/admin${expected.path}`);
    assert.equal(options?.method, expected.method ?? 'GET');
    assert.equal(options?.credentials, 'same-origin');
    assert.equal(options?.cache, 'no-store');
    assert.equal(options?.body, expected.body === undefined ? undefined : JSON.stringify(expected.body));
    const headers = new Headers(options?.headers);
    const expectedHeaders = new Headers();
    if (expected.body !== undefined) expectedHeaders.set('Content-Type', 'application/json');
    if (expected.token !== undefined) expectedHeaders.set('X-CSRF-Token', expected.token);
    assert.deepEqual([...headers.entries()].sort(), [...expectedHeaders.entries()].sort());
    if (expected.failure) throw expected.failure;
    const response = Response.json(expected.response ?? {}, { status: expected.status ?? 200 });
    if (expected.jsonResponse) response.json = expected.jsonResponse;
    return response;
  });

  function expectRequests(...requests: ExpectedRequest[]) {
    assert.equal(expectedRequests.length, 0, 'A sequência anterior deve estar concluída.');
    expectedRequests.push(...requests);
  }

  async function rejectsClientError(promise: Promise<unknown>, status: number, message: string, code?: string) {
    await assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof ClientError);
      assert.equal(error.status, status);
      assert.equal(error.code, code);
      assert.equal(error.message, message);
      assert.equal(errorMessage(error), message);
      return true;
    });
  }

  await t.test('GET usa credenciais e cache corretos sem buscar sessão nem enviar CSRF', async () => {
    const products = { data: [], pagination: { page: 1, pageSize: 20, total: 0 } };
    expectRequests({ path: '/products?page=1&pageSize=20', response: products });
    assert.deepEqual(await api('/products?page=1&pageSize=20'), products);
    expectRequests({ path: '/brands', response: { data: [] } });
    assert.deepEqual(await api('/brands', { method: 'GET' }), { data: [] });
  });

  await t.test('cada POST, PATCH e DELETE consulta sessão e usa somente o token dessa operação', async () => {
    const body = { name: 'Café', slug: 'cafe', active: true };
    expectRequests(
      { path: '/auth/session', response: { csrfToken: 'session-token-1' } },
      { path: '/brands', method: 'POST', token: 'session-token-1', body, response: { data: { id: 'brand-1', ...body } } },
    );
    assert.deepEqual(await api('/brands', { method: 'POST', body }), { data: { id: 'brand-1', ...body } });

    expectRequests(
      { path: '/auth/session', response: { csrfToken: 'session-token-2' } },
      { path: '/brands/brand-1', method: 'PATCH', token: 'session-token-2', body: { name: 'Café novo' } },
    );
    await api('/brands/brand-1', { method: 'PATCH', body: { name: 'Café novo' } });
    expectRequests(
      { path: '/auth/session', response: { csrfToken: 'session-token-3' } },
      { path: '/brands/brand-1', method: 'DELETE', token: 'session-token-3' },
    );
    await api('/brands/brand-1', { method: 'DELETE' });
  });

  await t.test('GET continua sem CSRF depois de mutações', async () => {
    expectRequests({ path: '/products' });
    await api('/products');
    expectRequests({ path: '/categories' });
    await api('/categories', { method: 'GET' });
  });

  await t.test('GET de sessão devolve o token sem guardá-lo para a próxima mutação', async () => {
    expectRequests({ path: '/auth/session', response: { csrfToken: 'manual-session-token' } });
    assert.deepEqual(await api('/auth/session'), { csrfToken: 'manual-session-token' });
    expectRequests(
      { path: '/auth/session', response: { csrfToken: 'fresh-session-token' } },
      { path: '/brands/brand-1', method: 'PATCH', token: 'fresh-session-token', body: { active: true } },
    );
    await api('/brands/brand-1', { method: 'PATCH', body: { active: true } });
  });

  await t.test('logout consulta sessão e a próxima mutação também obtém um token próprio', async () => {
    expectRequests(
      { path: '/auth/session', response: { csrfToken: 'logout-token-1' } },
      { path: '/auth/logout', method: 'POST', token: 'logout-token-1', response: { ok: true } },
    );
    assert.deepEqual(await api('/auth/logout', { method: 'POST' }), { ok: true });

    const body = { name: 'Categoria', slug: 'categoria' };
    expectRequests(
      { path: '/auth/session', response: { csrfToken: 'category-token' } },
      { path: '/categories', method: 'POST', token: 'category-token', body },
    );
    await api('/categories', { method: 'POST', body });
    expectRequests(
      { path: '/auth/session', response: { csrfToken: 'logout-token-2' } },
      { path: '/auth/logout', method: 'POST', token: 'logout-token-2', response: { ok: true } },
    );
    await api('/auth/logout', { method: 'POST' });
  });

  await t.test('login não consulta sessão e 401 de credenciais não redireciona', async () => {
    const body = { email: 'admin@example.test', password: 'senha-de-teste' };
    expectRequests({ path: '/auth/login', method: 'POST', body, status: 401, response: { error: { message: 'Credenciais inválidas.' } } });
    await rejectsClientError(api('/auth/login', { method: 'POST', body }), 401, 'Credenciais inválidas.');
    assert.deepEqual(redirects, []);

    expectRequests({ path: '/auth/login', method: 'POST', body, response: { csrfToken: 'login-token' } });
    assert.deepEqual(await api('/auth/login', { method: 'POST', body }), { csrfToken: 'login-token' });
    expectRequests(
      { path: '/auth/session', response: { csrfToken: 'after-login-token' } },
      { path: '/products/product-1', method: 'PATCH', token: 'after-login-token', body: { stock: 0 } },
    );
    await api('/products/product-1', { method: 'PATCH', body: { stock: 0 } });
  });

  await t.test('401 autenticado redireciona sem repetir e falha de sessão impede a mutação', async () => {
    expectRequests(
      { path: '/auth/session', response: { csrfToken: 'expired-session-token' } },
      { path: '/products/product-1', method: 'DELETE', token: 'expired-session-token', status: 401, response: { error: { message: 'Sessão expirada.' } } },
    );
    await rejectsClientError(api('/products/product-1', { method: 'DELETE' }), 401, 'Sessão expirada.');
    assert.deepEqual(redirects, ['/login?motivo=sessao']);

    expectRequests({ path: '/auth/session', status: 401, response: { error: { message: 'Sessão inválida.' } } });
    await rejectsClientError(api('/brands/brand-1', { method: 'DELETE' }), 401, 'Sessão inválida.');
    assert.equal(expectedRequests.length, 0, 'Falha na sessão deve impedir a mutação.');
    assert.deepEqual(redirects, ['/login?motivo=sessao', '/login?motivo=sessao']);

    expectRequests(
      { path: '/auth/session', response: { csrfToken: 'renewed-token' } },
      { path: '/brands/brand-1', method: 'DELETE', token: 'renewed-token' },
    );
    await api('/brands/brand-1', { method: 'DELETE' });
  });

  await t.test('campos de validação são traduzidos e deduplicados em português', async () => {
    const fields = ['name', 'slug', 'code', 'brandId', 'categoryId', 'cost', 'price', 'stock', 'description', 'active', 'url', 'alt', 'order', 'email', 'password', 'name', 'unknown', 'otherUnknown'];
    expectRequests(
      { path: '/auth/session', response: { csrfToken: 'validation-token' } },
      { path: '/products/product-1', method: 'PATCH', token: 'validation-token', body: { name: '' }, status: 400, response: { error: { message: 'Validation failed', fields } } },
    );
    await rejectsClientError(
      api('/products/product-1', { method: 'PATCH', body: { name: '' } }),
      400,
      'Confira os campos: nome, endereço (slug), código, marca, categoria, custo, preço de venda, estoque, descrição, status, URL da imagem, texto alternativo, ordem, email, senha, campos informados.',
    );
    assert.equal(redirects.length, 2, 'Erros de validação não devem redirecionar.');
  });

  await t.test('mensagens da API e mensagens padrão preservam o contrato de erro', async () => {
    expectRequests({ path: '/brands', status: 409, response: { error: { message: 'Este slug já está em uso.', fields: [] } } });
    await rejectsClientError(api('/brands'), 409, 'Este slug já está em uso.');
    expectRequests({ path: '/categories', status: 500 });
    await rejectsClientError(api('/categories'), 500, 'Não foi possível concluir a operação.');

    const failure = new Error('Detalhe interno da conexão');
    expectRequests({ path: '/products', failure });
    await assert.rejects(api('/products'), (error: unknown) => {
      assert.equal(error, failure);
      assert.equal(errorMessage(error), 'Não foi possível concluir. Verifique sua conexão e tente novamente.');
      return true;
    });
    for (const error of [null, undefined, 'erro desconhecido', {}]) {
      assert.equal(errorMessage(error), 'Não foi possível concluir. Verifique sua conexão e tente novamente.');
    }
    assert.equal(redirects.length, 2);
  });

  await t.test('duas mutações concorrentes não sobrescrevem os tokens uma da outra', async () => {
    const firstSession = deferred<{ csrfToken: string }>();
    const secondSession = deferred<{ csrfToken: string }>();
    const firstWaiting = deferred<void>();
    const secondWaiting = deferred<void>();
    const firstBody = { name: 'Primeira marca', slug: 'primeira-marca' };
    const secondBody = { name: 'Segunda categoria', slug: 'segunda-categoria' };
    const before = fetchMock.mock.callCount();
    expectRequests(
      { path: '/auth/session', jsonResponse: () => { firstWaiting.resolve(); return firstSession.promise; } },
      { path: '/auth/session', jsonResponse: () => { secondWaiting.resolve(); return secondSession.promise; } },
      { path: '/brands', method: 'POST', token: 'concurrent-token-a', body: firstBody, response: { data: { id: 'brand-a' } } },
      { path: '/categories', method: 'POST', token: 'concurrent-token-b', body: secondBody, response: { data: { id: 'category-b' } } },
    );
    const mutations = Promise.all([
      api('/brands', { method: 'POST', body: firstBody }),
      api('/categories', { method: 'POST', body: secondBody }),
    ]);
    await Promise.all([firstWaiting.promise, secondWaiting.promise]);
    assert.equal(fetchMock.mock.callCount() - before, 2, 'As duas sessões devem estar em andamento antes das mutações.');
    firstSession.resolve({ csrfToken: 'concurrent-token-a' });
    secondSession.resolve({ csrfToken: 'concurrent-token-b' });
    assert.deepEqual(await mutations, [{ data: { id: 'brand-a' } }, { data: { id: 'category-b' } }]);
    assert.equal(fetchMock.mock.callCount() - before, 4);
    assert.equal(expectedRequests.length, 0);
  });

  await t.test('403 CSRF_DENIED refaz a sessão e repete a mutação com o mesmo corpo e o novo token', async () => {
    const body = { price: '29.90', stock: 4 };
    const before = fetchMock.mock.callCount();
    expectRequests(
      { path: '/auth/session', response: { csrfToken: 'csrf-before-retry' } },
      { path: '/products/product-1', method: 'PATCH', token: 'csrf-before-retry', body, status: 403, response: { error: { code: 'CSRF_DENIED', message: 'Token CSRF inválido.' } } },
      { path: '/auth/session', response: { csrfToken: 'csrf-after-retry' } },
      { path: '/products/product-1', method: 'PATCH', token: 'csrf-after-retry', body, response: { data: { id: 'product-1', ...body } } },
    );
    assert.deepEqual(await api('/products/product-1', { method: 'PATCH', body }), { data: { id: 'product-1', ...body } });
    assert.equal(fetchMock.mock.callCount() - before, 4);
    assert.equal(expectedRequests.length, 0);
    assert.equal(redirects.length, 2);
  });

  await t.test('um segundo 403 CSRF_DENIED é propagado sem terceira tentativa', async () => {
    const before = fetchMock.mock.callCount();
    expectRequests(
      { path: '/auth/session', response: { csrfToken: 'denied-token-1' } },
      { path: '/brands/brand-1', method: 'DELETE', token: 'denied-token-1', status: 403, response: { error: { code: 'CSRF_DENIED', message: 'Primeira recusa.' } } },
      { path: '/auth/session', response: { csrfToken: 'denied-token-2' } },
      { path: '/brands/brand-1', method: 'DELETE', token: 'denied-token-2', status: 403, response: { error: { code: 'CSRF_DENIED', message: 'Segunda recusa.' } } },
    );
    await rejectsClientError(api('/brands/brand-1', { method: 'DELETE' }), 403, 'Segunda recusa.', 'CSRF_DENIED');
    assert.equal(fetchMock.mock.callCount() - before, 4);
    assert.equal(expectedRequests.length, 0);
  });

  await t.test('falha ao buscar sessão na repetição interrompe a operação', async () => {
    const before = fetchMock.mock.callCount();
    expectRequests(
      { path: '/auth/session', response: { csrfToken: 'retry-session-token' } },
      { path: '/brands/brand-1', method: 'DELETE', token: 'retry-session-token', status: 403, response: { error: { code: 'CSRF_DENIED', message: 'CSRF recusado.' } } },
      { path: '/auth/session', status: 503, response: { error: { message: 'Sessão indisponível.' } } },
    );
    await rejectsClientError(api('/brands/brand-1', { method: 'DELETE' }), 503, 'Sessão indisponível.');
    assert.equal(fetchMock.mock.callCount() - before, 3);
    assert.equal(expectedRequests.length, 0);
  });

  await t.test('outros status ou códigos de erro em mutações não provocam repetição', async () => {
    const cases = [
      { status: 403, code: 'FORBIDDEN' },
      { status: 403, code: undefined },
      { status: 400, code: 'CSRF_DENIED' },
      { status: 401, code: 'CSRF_DENIED' },
      { status: 409, code: 'CONFLICT' },
      { status: 429, code: 'RATE_LIMITED' },
      { status: 500, code: 'CSRF_DENIED' },
    ];
    for (const { status, code } of cases) {
      const before = fetchMock.mock.callCount();
      const redirectsBefore = redirects.length;
      const message = `Erro ${status}: ${code ?? 'sem código'}.`;
      expectRequests(
        { path: '/auth/session', response: { csrfToken: 'non-retry-token' } },
        { path: '/categories/category-1', method: 'PATCH', token: 'non-retry-token', body: { active: false }, status, response: { error: { code, message } } },
      );
      await rejectsClientError(api('/categories/category-1', { method: 'PATCH', body: { active: false } }), status, message, code);
      assert.equal(fetchMock.mock.callCount() - before, 2);
      assert.equal(expectedRequests.length, 0);
      assert.equal(redirects.length, redirectsBefore + (status === 401 ? 1 : 0));
      if (status === 401) assert.equal(redirects.at(-1), '/login?motivo=sessao');
    }
  });

  await t.test('falhas de rede na sessão ou na mutação não provocam repetição', async () => {
    for (const failSession of [true, false]) {
      const before = fetchMock.mock.callCount();
      const failure = new Error('Conexão interrompida');
      expectRequests(...(failSession ? [
        { path: '/auth/session', failure },
      ] : [
        { path: '/auth/session', response: { csrfToken: 'network-token' } },
        { path: '/products/product-1', method: 'DELETE', token: 'network-token', failure },
      ]));
      await assert.rejects(api('/products/product-1', { method: 'DELETE' }), (error: unknown) => {
        assert.equal(error, failure);
        return true;
      });
      assert.equal(fetchMock.mock.callCount() - before, failSession ? 1 : 2);
      assert.equal(expectedRequests.length, 0);
    }
  });

  await t.test('GET e login não repetem nem buscam sessão quando recebem 403 CSRF_DENIED', async () => {
    for (const login of [false, true]) {
      const before = fetchMock.mock.callCount();
      const path = login ? '/auth/login' : '/products';
      const options = login ? { method: 'POST', body: { email: 'admin@example.test', password: 'senha-de-teste' } } : undefined;
      expectRequests({ path, ...options, status: 403, response: { error: { code: 'CSRF_DENIED', message: 'Sem nova tentativa.' } } });
      await rejectsClientError(api(path, options), 403, 'Sem nova tentativa.', 'CSRF_DENIED');
      assert.equal(fetchMock.mock.callCount() - before, 1);
      assert.equal(expectedRequests.length, 0);
    }
  });

  await t.test('nenhum acesso a localStorage ocorreu durante autenticação, mutações ou erros', () => {
    assert.equal(storageAccesses, 0);
    assert.equal(expectedRequests.length, 0);
  });
});
