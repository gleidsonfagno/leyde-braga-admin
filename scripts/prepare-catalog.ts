import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { slugify } from '../src/lib/admin-format';
import { imageSchema, moneySchema } from '../src/lib/validation';

const sourceSchema = z.object({ sourceRow: z.number().int(), originalCode: z.string().nullable(), originalName: z.string(), originalBrand: z.string(), originalCategory: z.string(), cost: moneySchema, price: moneySchema, stock: z.number().int().nonnegative() });
const researchSchema = z.object({ sourceRow: z.number().int(), name: z.string(), brand: z.string(), category: z.string(), description: z.string(), sourceUrl: z.url().nullable(), status: z.enum(['verified', 'needs_confirmation']), images: z.array(z.object({ url: z.url(), alt: z.string() })), notes: z.array(z.string()) });
const directory = 'catalog';
const source = z.array(sourceSchema).parse(JSON.parse(readFileSync(join(directory, 'stock-source.json'), 'utf8')));
const research = ['research-hinode.json', 'research-boticario.json', 'research-other.json'].flatMap((file) => z.array(researchSchema).parse(JSON.parse(readFileSync(join(directory, file), 'utf8'))));
if (new Set(research.map((item) => item.sourceRow)).size !== source.length || research.length !== source.length) throw new Error('A pesquisa precisa cobrir cada linha exatamente uma vez.');
const categories: Record<string, string> = { Perfume: 'Perfumes', Perfumaria: 'Perfumes', Hidratante: 'Hidratantes corporais', 'Óleo corporal': 'Óleos corporais', Capilar: 'Cuidados capilares', Corpo: 'Cuidados corporais', Baton: 'Maquiagem', 'Protetor solar': 'Proteção solar', Desodorante: 'Desodorantes', 'Kit perfume': 'Kits de perfumaria', Sabonete: 'Sabonetes', Acessório: 'Acessórios' };
const originalCodes = new Set(source.map((row) => row.originalCode).filter(Boolean));
const catalog = source.map((row) => {
  const result = research.find((item) => item.sourceRow === row.sourceRow);
  if (!result) throw new Error('Pesquisa incompleta.');
  const duplicateCode = source.filter((item) => item.originalCode && item.originalCode === row.originalCode).length > 1;
  const code = row.originalCode && (!duplicateCode || row.sourceRow === 39) ? row.originalCode : `LB-EST-${String(row.sourceRow).padStart(4, '0')}`;
  if (code !== row.originalCode && originalCodes.has(code)) throw new Error('Código interno em conflito.');
  const reviewNotes = result.status === 'needs_confirmation' ? [...result.notes] : [];
  if (!result.images.length) reviewNotes.push('Imagem oficial específica ainda não confirmada.');
  const images = result.images.map((image, order) => imageSchema.parse({ url: image.url, alt: image.alt, order }));
  return {
    sourceRow: row.sourceRow, code, slug: `${slugify(result.name).slice(0, 130).replace(/-$/, '')}-${slugify(code)}`,
    name: result.name, description: result.status === 'verified' ? result.description : `Cadastro em revisão. ${result.description}`,
    brand: result.brand, category: categories[result.category] ?? result.category,
    cost: row.cost, price: row.price, stock: row.stock,
    active: row.stock > 0 && result.status === 'verified' && reviewNotes.length === 0,
    images, reviewNotes, sourceUrls: result.sourceUrl ? [result.sourceUrl] : [],
  };
});
if (new Set(catalog.map((entry) => entry.code)).size !== catalog.length) throw new Error('Código duplicado.');
for (const entry of catalog) {
  const original = source.find((row) => row.sourceRow === entry.sourceRow)!;
  if (entry.cost !== original.cost || entry.price !== original.price || entry.stock !== original.stock) throw new Error('Valor original alterado.');
}
writeFileSync(join(directory, 'import-ready.json'), JSON.stringify(catalog, null, 2) + '\n');
const report = ['# Conferência do estoque real', '', `Itens: ${catalog.length}. Unidades em estoque: ${catalog.reduce((total, entry) => total + entry.stock, 0)}.`, '', 'Custos, preços e estoque atual foram preservados. O preço do óleo Joli Ameixa & Jasmine foi confirmado em R$ 79,90 pelo usuário. Itens sem variante ou imagem oficial confirmada ficam inativos para revisão. Códigos internos LB-EST não são referências de fabricantes. A importação não sobrescreve produtos existentes nem repõe estoque em reexecuções.', '', '| Linha | Código interno | Produto | Venda | Estoque | Publicação |', '| --- | --- | --- | --- | --- | --- |', ...catalog.map((entry) => `| ${entry.sourceRow} | ${entry.code} | ${entry.name.replaceAll('|', '/')} | R$ ${entry.price.replace('.', ',')} | ${entry.stock} | ${entry.active ? 'Ativo' : 'Inativo'} |`), '', '## Pendências', ...catalog.filter((entry) => entry.reviewNotes.length).flatMap((entry) => ['', `### Linha ${entry.sourceRow}: ${entry.name}`, ...entry.reviewNotes.map((note) => `- ${note}`), ...entry.sourceUrls.map((url) => `- Fonte: ${url}`)]), '', '## Fontes e correções', ...research.flatMap((entry) => ['', `### Linha ${entry.sourceRow}: ${entry.name}`, ...entry.notes.map((note) => `- ${note}`), ...(entry.sourceUrl ? [`- Fonte: ${entry.sourceUrl}`] : [])])].join('\n');
writeFileSync(join(directory, 'conferencia.md'), report + '\n');
console.log(JSON.stringify({ products: catalog.length, active: catalog.filter((entry) => entry.active).length, inactive: catalog.filter((entry) => !entry.active).length, images: catalog.reduce((total, entry) => total + entry.images.length, 0), financialValuesPreserved: true }));
