import { readFileSync, writeFileSync } from 'node:fs';

const entries = JSON.parse(readFileSync('catalog/import-ready.json', 'utf8'));
const queue = entries.flatMap((entry) => entry.images.map((image) => ({ sourceRow: entry.sourceRow, url: image.url })));
const results = [];
async function worker() {
  while (queue.length) {
    const image = queue.shift();
    try {
      const response = await fetch(image.url, { method: 'HEAD', signal: AbortSignal.timeout(12000) });
      const contentType = response.headers.get('content-type') ?? '';
      results.push({ ...image, status: response.status, valid: response.ok && contentType.startsWith('image/'), contentType });
    } catch { results.push({ ...image, valid: false, status: null }); }
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
results.sort((first, second) => first.sourceRow - second.sourceRow);
writeFileSync('catalog/image-check.json', JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify({ checked: results.length, valid: results.filter((item) => item.valid).length, failedRows: results.filter((item) => !item.valid).map((item) => ({ row: item.sourceRow, status: item.status })) }));
