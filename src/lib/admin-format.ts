export function slugify(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 160).replace(/-$/, '');
}
export function parseMoneyInput(value: string): string | null {
  const normalized = value.trim().replace(/^R\$\s*/, '');
  let decimal: string;
  if (/^(?:0|[1-9]\d{0,9})(?:[.,]\d{1,2})?$/.test(normalized)) decimal = normalized.replace(',', '.');
  else if (/^[1-9]\d{0,2}(?:\.\d{3})+,\d{1,2}$/.test(normalized)) decimal = normalized.replace(/\./g, '').replace(',', '.');
  else return null;
  const [integer, fraction = ''] = decimal.split('.');
  if (integer.length > 10) return null;
  return `${integer}.${fraction.padEnd(2, '0')}`;
}
export function moneyInput(value: string) { return value.replace('.', ','); }
export function formatBRL(value: string) {
  if (!/^\d+\.\d{2}$/.test(value)) return '—';
  const [integer, fraction] = value.split('.');
  return `R$ ${BigInt(integer).toLocaleString('pt-BR')},${fraction}`;
}
