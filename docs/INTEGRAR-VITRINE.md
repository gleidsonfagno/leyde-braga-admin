# Instruções para a IA que mantém a vitrine

Integre a vitrine existente à API abaixo, preservando o layout, as rotas e a identidade visual. Substitua os produtos fixos pelos dados reais; não crie produtos de exemplo nem acesse o banco diretamente.

## Configuração

```env
NEXT_PUBLIC_CATALOG_API_URL=https://leyde-braga-admin.vercel.app/api/v1
```

Essa URL é pública. Nunca copie `DATABASE_URL`, `AUTH_SECRET`, senha administrativa, cookies ou tokens para a vitrine. O painel administrativo é separado: https://leyde-braga-admin.vercel.app/login.

O domínio `https://leyde-braga.vercel.app` já está autorizado no CORS. Se a vitrine mudar de domínio, atualize `CORS_ORIGINS` na API com a origem exata e republique a API. Para desenvolvimento, estão permitidos `http://localhost:3000` e `http://localhost:3001`.

## Rotas públicas

| GET | Uso |
| --- | --- |
| `/products?page=1&pageSize=20` | Catálogo paginado; `pageSize` aceita até 100. |
| `/products?q=floratta&brand=o-boticario&category=perfumes&page=1&pageSize=20` | Busca e filtros combinados; os filtros usam os slugs recebidos da API. |
| `/products/:slug` | Página de um produto. |
| `/brands` | Marcas ativas para os filtros. |
| `/categories` | Categorias ativas para os filtros. |
| `/health` | Verificação básica da API. |

Listagem: `{ data: Product[], pagination: { page, pageSize, total } }`. Detalhe: `{ data: Product }`. Marcas e categorias: `{ data: [{ id, name, slug }] }`.

Um produto contém `id`, `code`, `slug`, `name`, `description`, `price`, `brand`, `category` e `images`. Cada imagem contém `id`, `url`, `alt` e `order`. O preço é uma string decimal, como `"79.90"`. Formate com `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`. Use `id` como chave dos cards e `slug` nas URLs.

## Comportamento esperado

- Faça requisições sem credenciais (`credentials: 'omit'`), sem cabeçalhos administrativos. Use `URLSearchParams` para montar a busca e os filtros; ao alterá-los, volte à página 1.
- Use debounce de aproximadamente 300 ms na busca e cancele requisições anteriores com `AbortController` para que resultados antigos não sobrescrevam a pesquisa atual.
- Calcule o total de páginas com `Math.ceil(total / pageSize)`. Não corte o catálogo na primeira página. Não adicione novamente os itens ao trocar de página nem esconda produtos por não terem imagem.
- Ordene as imagens por `order`, use `alt` e apresente uma imagem neutra quando o array estiver vazio ou uma URL falhar. Não invente foto, variante, fragrância, volume ou promessa de benefício.
- Configure os hosts HTTPS de imagens retornados pela API no carregador da vitrine, se ela usar `next/image`; permita somente os hosts necessários ou use `<img>` com fallback adequado.
- Exiba carregamento, falha com opção de tentar novamente e estado vazio em português. Em 404 no detalhe, exiba “Produto não encontrado”. Em falha da API, nunca substitua o catálogo por dados fictícios.
- A API não expõe custo nem quantidade em estoque. Um produto ativo não garante disponibilidade: não invente estoque nem confirme venda sem conferir disponibilidade com a loja. Esta API é de catálogo e não possui checkout, pagamento ou reserva de estoque.
- A API mantém cache dos dados públicos por 60 segundos e o invalida após alterações administrativas. As respostas HTTP usam `Cache-Control: no-store`; evite cache próprio prolongado, Service Worker ou geração estática que congele preços e produtos. Em renderização no servidor, use `fetch(url, { cache: 'no-store' })`.

## Exemplo de consumo

```ts
const base = process.env.NEXT_PUBLIC_CATALOG_API_URL;
const params = new URLSearchParams({ page: String(page), pageSize: '20' });
if (search.trim()) params.set('q', search.trim());
if (brandSlug) params.set('brand', brandSlug);
if (categorySlug) params.set('category', categorySlug);
const response = await fetch(`${base}/products?${params}`, {
  credentials: 'omit', cache: 'no-store', signal,
});
if (!response.ok) throw new Error('Não foi possível carregar os produtos.');
const { data, pagination } = await response.json();
```

## Validação antes de publicar

Confira catálogo completo, paginação, busca, filtros combinados, detalhe, preços em reais, fotos e fallback sem foto no desktop e no celular. Confirme no navegador que não há erro de CORS. Confira também carregamento, busca sem resultados, falha da API e produto inexistente. Custos, senhas e tokens não podem aparecer no HTML, bundle ou armazenamento do navegador. Execute os testes e o build da vitrine e apresente o resultado.
