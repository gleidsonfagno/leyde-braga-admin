# Leyde Braga — painel administrativo e API de catálogo

Painel administrativo e API com Next.js 16, Prisma 7.10.1, `@prisma/adapter-pg` e PostgreSQL. O cadastro de administradores é feito pelo terminal; produtos, marcas, categorias e imagens são gerenciados pelo painel, que consome a API administrativa. A vitrine pública está fora do escopo. O projeto não inclui seeds.

## Preparação local

Requisitos: Node.js >= 22.12, npm e PostgreSQL disponível. Execute na raiz do projeto, com o `package-lock.json` versionado disponível (`npm ci` exige esse arquivo):

```powershell
npm ci
Copy-Item .env.example .env
```

No Linux/macOS, use `cp .env.example .env`. Preencha o `.env` antes de acessar o banco:

| Variável | Configuração |
| --- | --- |
| `DATABASE_URL` | Conexão PostgreSQL utilizada pela aplicação via `@prisma/adapter-pg`; em produção, use a URL com pool do provedor e `sslmode=verify-full`. |
| `DIRECT_URL` | Conexão PostgreSQL direta, sem pool, utilizada pela CLI do Prisma via `prisma.config.ts`, inclusive nas migrations. Configure também no desenvolvimento; pode apontar para o mesmo banco de `DATABASE_URL`. |
| `APP_ORIGIN` | Origem exata da aplicação administrativa, incluindo protocolo e porta, sem caminho ou barra final. Local: `http://localhost:3000`. |
| `CORS_ORIGINS` | Allowlist de origens exatas do catálogo público, separadas por vírgulas. Local, por exemplo: `http://localhost:3001`. |
| `AUTH_SECRET` | Segredo aleatório com pelo menos 32 caracteres. Nunca versione seu valor nem o exponha ao cliente. |

O `prisma.config.ts` carrega o `.env` com `dotenv/config` e configura `datasource.url` com `DIRECT_URL` para a CLI. No runtime, `src/lib/db.ts` utiliza `DATABASE_URL` com `PrismaPg`; o pool do adapter está configurado com `max: 1`, `idleTimeoutMillis: 10000` (10 segundos) e `connectionTimeoutMillis: 10000` (10 segundos).

Para gerar um `AUTH_SECRET` de 64 caracteres hexadecimais:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Aplique as migrations de desenvolvimento, crie o administrador e inicie a API:

```sh
npx prisma migrate dev
npm run admin:create
npm run dev
```

`prisma migrate dev` é destinado ao desenvolvimento e pode exigir um shadow database ou permissão para criá-lo. Em produção, aplique somente migrations versionadas com `prisma migrate deploy`.

## Criação de administrador

```sh
npm run admin:create
```

Execute na raiz, em um terminal interativo com entrada e saída TTY. O primeiro import do script é `dotenv/config`, que carrega o `.env`, quando presente, antes da inicialização do pool de banco. O script solicita email, senha oculta e confirmação. O email é normalizado para minúsculas e validado; a senha deve ter de 12 a 128 caracteres e é validada por `passwordSchema` e `loginSchema` antes do cadastro.

Não passe senha por argumentos, variáveis de ambiente, pipes ou redirecionamento. O script não aceita argumentos, não lê senha do ambiente e não imprime senha nem hash. Use Backspace para corrigir a senha ou Ctrl+C para cancelar. A senha é processada por `hashPassword` de `src/lib/auth.ts`; o cadastro usa `db.admin.create`, sem `upsert`. Um email já cadastrado provoca falha, sem substituir suas credenciais. A conexão é encerrada em `finally`, inclusive em erros de validação ou de banco.

## Painel administrativo

Após iniciar a aplicação, acesse `/login` e entre com o administrador criado pelo terminal. A raiz `/` redireciona para `/produtos`.

| Página | Função |
| --- | --- |
| `/login` | Autenticação por email e senha; uma sessão já válida redireciona para `/produtos`. |
| `/produtos` | Listagem com busca textual, filtros por marca, categoria e status, e paginação de 20 registros. |
| `/produtos/novo` | Cadastro de produto com código, nome, slug, descrição, marca, categoria, custo, preço, estoque e status. |
| `/produtos/:id` | Edição do produto e gerenciamento de suas imagens; `:id` é o UUID do produto. |
| `/marcas` | Listagem, busca, filtro por status, cadastro e edição de marcas, com paginação de 20 registros. |
| `/categorias` | Listagem, busca, filtro por status, cadastro e edição de categorias, com paginação de 20 registros. |

As páginas administrativas têm um guard no servidor que valida a sessão antes de renderizar o painel e redireciona para `/login` quando ela está ausente ou inválida. As operações do cliente usam a API na mesma origem, com o cookie de sessão HttpOnly enviado pelo navegador. O JavaScript não lê esse cookie. Antes de cada mutação autenticada, o cliente consulta `/api/v1/admin/auth/session` e usa o token CSRF apenas na memória daquela operação, no cabeçalho `X-CSRF-Token`. Isso evita que respostas concorrentes sobrescrevam o token de outra operação. Uma rejeição `403 CSRF_DENIED` permite uma única nova consulta de sessão e repetição; outros erros não repetem a mutação. Uma resposta 401 redireciona ao login. Nenhum token é persistido em localStorage.

Custo e preço são informados e exibidos em reais, por exemplo `R$ 1.234,56`. A normalização usa strings decimais com duas casas e a formatação usa a parte inteira como `BigInt`, sem conversão monetária para ponto flutuante. O slug é sugerido a partir do nome nos novos cadastros e permanece editável nos formulários de produtos, marcas e categorias.

A desativação de produtos, marcas e categorias exige confirmação, inclusive ao salvar uma mudança de status de ativo para inativo. Ela preserva o registro por soft delete; desativar uma marca ou categoria também retira seus produtos da API pública.

Na edição de um produto já salvo, as imagens são cadastradas e editadas por URL HTTPS, com prévia, texto alternativo e ordem numérica. A ordem é crescente, com desempate por ID. A remoção exige confirmação e exclui a referência da imagem no produto. O painel não faz upload de arquivos.

## Contrato da API pública

Todas as rotas abaixo usam o prefixo `/api/v1` e não exigem sessão administrativa:

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/api/v1/health` | Liveness: confirma que a API responde, sem consultar ou verificar a conexão com o banco de dados. |
| `GET` | `/api/v1/products?q=&brand=slug&category=slug&page=1&pageSize=20` | Lista produtos com busca, filtros por slug e paginação. |
| `GET` | `/api/v1/products/:slug` | Consulta um produto pelo slug. |
| `GET` | `/api/v1/brands` | Lista marcas ativas. |
| `GET` | `/api/v1/categories` | Lista categorias ativas. |

Na listagem de produtos, os filtros `q`, `brand` e `category` são opcionais. A paginação começa em `page=1`, com `pageSize=20` por padrão e limite de 100 itens por página. Listagem e detalhe só expõem produtos ativos cuja marca e categoria também estejam ativas.

O campo `code` do produto é público. O custo (`cost`) é privado. As respostas públicas também excluem `stock`, `active` e timestamps internos, como `createdAt` e `updatedAt`. Valores monetários são strings com exatamente duas casas decimais, como `"129.90"`; envie esse mesmo formato nos campos administrativos `cost` e `price`.

## Autenticação administrativa

Envie corpos JSON com `Content-Type: application/json`. As rotas de autenticação são:

| Método | Rota | Requisição e resposta |
| --- | --- | --- |
| `POST` | `/api/v1/admin/auth/login` | Corpo com `email` e `password`; exige `Origin` igual a `APP_ORIGIN`. Emite cookie de sessão e devolve `csrfToken` no JSON. |
| `GET` | `/api/v1/admin/auth/session` | Exige cookie de sessão válido e devolve `csrfToken` no JSON. |
| `POST` | `/api/v1/admin/auth/logout` | Exige cookie, `Origin` igual a `APP_ORIGIN` e `X-CSRF-Token` válido; encerra a sessão. |

As sessões expiram após 8 horas. O cookie de sessão é HttpOnly; em produção, trafega por HTTPS com `Secure`. O cliente deve preservar o cookie, obter o `csrfToken` no login ou na consulta de sessão e enviá-lo no cabeçalho `X-CSRF-Token` de toda mutação administrativa autenticada (`POST`, `PATCH` e `DELETE`), junto com `Origin: <APP_ORIGIN>`. O token CSRF é vinculado à sessão. O login exige `Origin`, mas não exige um token CSRF prévio.

O rate limit de login é persistido no PostgreSQL: 100 tentativas por IP em uma janela de 15 minutos e 5 tentativas por par email normalizado + IP em 15 minutos, com contadores compartilhados entre as instâncias da aplicação. Não há contador global para todos os IPs, evitando que um atacante esgote um limite único e bloqueie o login de todos. Ao exceder um limite, a API responde com HTTP 429. Contadores cuja janela de 15 minutos expirou são excluídos.

Na Vercel, o IP é obtido do cabeçalho confiável `x-vercel-forwarded-for` apenas quando `VERCEL=1`. Fora da Vercel, as requisições usam um bucket local compartilhado; cabeçalhos de IP encaminhado são ignorados para impedir que valores forjados contornem o limite.

## Produtos, marcas e categorias

Todas as rotas administrativas exigem sessão válida. Para cada recurso `products`, `brands` e `categories`, as rotas seguem este padrão:

| Método | Rota | Operação |
| --- | --- | --- |
| `GET` | `/api/v1/admin/{recurso}` | Listar registros. |
| `POST` | `/api/v1/admin/{recurso}` | Criar registro. |
| `GET` | `/api/v1/admin/{recurso}/:id` | Consultar registro por ID. |
| `PATCH` | `/api/v1/admin/{recurso}/:id` | Atualizar os campos enviados. |
| `DELETE` | `/api/v1/admin/{recurso}/:id` | Desativar registro por soft delete (`active=false`). |

Substitua `{recurso}` por `products`, `brands` ou `categories`; IDs são UUIDs. O `DELETE` desses recursos preserva o registro no banco. A desativação de marca ou categoria também retira seus produtos das consultas públicas.

Marcas e categorias recebem `name`, `slug` e, opcionalmente, `active`. Produtos recebem `code`, `slug`, `name`, `description`, `brandId`, `categoryId`, `cost`, `price`, `stock` e, opcionalmente, `active`. `stock` é inteiro não negativo; `cost` e `price` usam strings monetárias com duas casas. `PATCH` exige ao menos um campo válido.

## Imagens de produtos

| Método | Rota | Operação |
| --- | --- | --- |
| `GET` | `/api/v1/admin/products/:id/images` | Listar imagens do produto. |
| `POST` | `/api/v1/admin/products/:id/images` | Cadastrar imagem com `url`, `alt` e `order`. |
| `PATCH` | `/api/v1/admin/products/:id/images/:imageId` | Atualizar os campos enviados da imagem. |
| `DELETE` | `/api/v1/admin/products/:id/images/:imageId` | Remover a imagem do produto. |

Imagens são referências a URLs HTTPS; o corpo contém metadados, sem upload de arquivo. `order` é inteiro não negativo. As imagens são ordenadas por `order` crescente, com desempate por `id` crescente. As mutações exigem o mesmo cookie, `Origin` e token CSRF das demais operações administrativas.

## CORS e CSRF

CORS se aplica apenas às rotas públicas, com origens da allowlist `CORS_ORIGINS`, métodos `GET` e preflight `OPTIONS`, sem credenciais. Não há liberação CORS para rotas administrativas. A allowlist pública não autoriza mutações administrativas: elas verificam a origem exata configurada em `APP_ORIGIN` e, após autenticação, o token CSRF da sessão.

## Content Security Policy (CSP)

As rotas `/api/*` mantêm a CSP restritiva `default-src 'none'; frame-ancestors 'none'`. As páginas usam uma política própria com nonce gerado por requisição para scripts e `strict-dynamic`, permitindo as imagens HTTPS exibidas nas prévias. O proxy aplica a política das páginas sem incluir as rotas da API; em desenvolvimento há permissões adicionais para as ferramentas do Next.js.

## Vercel e produção

Configure `DATABASE_URL`, `DIRECT_URL`, `APP_ORIGIN`, `CORS_ORIGINS` e `AUTH_SECRET` nas variáveis do ambiente correspondente da Vercel. Use `DATABASE_URL` com pool para o runtime serverless e `DIRECT_URL` direta para a CLI e migrations via `prisma.config.ts`, ambas apontando para o mesmo banco. Exija TLS nas conexões de produção com `sslmode=verify-full`, validando certificado e hostname. Não exponha essas variáveis com prefixo `NEXT_PUBLIC_`.

Use a URL com pool fornecida pelo provedor, como `postgresql://USER:PASSWORD@POOLED_HOST:5432/DATABASE?sslmode=verify-full`, conforme o `.env.example`. O limite de conexões e os timeouts são definidos nas opções do adapter em `src/lib/db.ts`: uma conexão por pool, 10 segundos de inatividade e 10 segundos para estabelecer a conexão. Use HTTPS para `APP_ORIGIN` e origens públicas de produção.

No fluxo de implantação, execute as migrations versionadas com credenciais do ambiente de destino e depois o build:

```sh
npx prisma migrate deploy
npm run build
```

O build executa `prisma generate && next build`; ele não aplica migrations. Cadastre o primeiro administrador em um terminal confiável com a configuração do banco de destino, usando `npm run admin:create`. A implantação não executa seeds nem cria administrador automaticamente.

## Comandos e verificações

| Comando | Finalidade |
| --- | --- |
| `npm run dev` | Iniciar o desenvolvimento. |
| `npm run build` | Gerar o Prisma Client e compilar a aplicação. |
| `npm start` | Executar o build em produção fora da Vercel. |
| `npm run typecheck` | Verificar tipos TypeScript. |
| `npm test` | Executar testes unitários. |
| `npm run test:integration` | Executar testes de integração contra banco dedicado. |
| `npm run db:generate` | Gerar o Prisma Client. |
| `npm run db:migrate` | Executar `prisma migrate dev`. |
| `npm run db:deploy` | Executar `prisma migrate deploy`. |
| `npm run admin:create` | Criar administrador interativamente. |

Os testes de integração exigem `TEST_DATABASE_URL` apontando para um PostgreSQL dedicado e descartável, separado dos bancos de desenvolvimento e produção, com as migrations já aplicadas. Os testes não migram o banco automaticamente. `TEST_DIRECT_URL` é opcional para uma conexão direta de teste; quando ausente, utiliza-se `TEST_DATABASE_URL` também como conexão direta. Para conexões de teste com pool, informe `TEST_DIRECT_URL` para migrations.

Exemplo em PowerShell, usando um banco exclusivo de testes. Como a CLI lê `DIRECT_URL` via `prisma.config.ts`, o bloco aponta essa variável temporariamente para o banco de testes e restaura seu valor ao finalizar:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://USER:PASSWORD@localhost:5432/leyde_test'
# Opcional, se houver uma URL direta distinta:
$env:TEST_DIRECT_URL = 'postgresql://USER:PASSWORD@localhost:5432/leyde_test'
$previousDirectUrl = $env:DIRECT_URL
try {
  $env:DIRECT_URL = if ($env:TEST_DIRECT_URL) { $env:TEST_DIRECT_URL } else { $env:TEST_DATABASE_URL }
  npx prisma migrate deploy
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao migrar o banco de testes.' }
  npm run test:integration
} finally {
  $env:DIRECT_URL = $previousDirectUrl
}
```

Os testes de integração usam fixtures temporárias e as removem ao finalizar. Fixtures de QA devem ser criadas somente em banco dedicado e descartável, nunca nos bancos de desenvolvimento ou produção. Isso não constitui seed de dados da aplicação. Execute os comandos de build, tipos e testes no seu ambiente para verificar o projeto; esta documentação não atesta sua execução nem aprovação.
