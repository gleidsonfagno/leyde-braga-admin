import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatBRL, moneyInput, parseMoneyInput, slugify } from '../src/lib/admin-format';

test('valores em reais preservam centavos sem ponto flutuante', () => {
  for (const [input, expected] of [['12,30', '12.30'], ['0,1', '0.10'], ['12.30', '12.30'], ['1.234,56', '1234.56'], ['9999999999,99', '9999999999.99'], ['R$ 29,90', '29.90'], ['0', '0.00']]) assert.equal(parseMoneyInput(input), expected);
  for (const input of ['-1', '1.001', '1e2', 'NaN', '1,234', '10000000000,00', '', '01,00', '1.23,00']) assert.equal(parseMoneyInput(input), null);
  assert.equal(formatBRL('1234.56'), 'R$ 1.234,56');
  assert.equal(formatBRL('9999999999.99'), 'R$ 9.999.999.999,99');
  assert.equal(formatBRL('0.10'), 'R$ 0,10');
  assert.equal(moneyInput('0.10'), '0,10');
});
test('slug normaliza acentos e mantém somente caracteres permitidos', () => {
  assert.equal(slugify('  Edição São João & Café! '), 'edicao-sao-joao-cafe');
  assert.equal(slugify('á'.repeat(200)).length, 160);
  assert.equal(slugify('<script>'), 'script');
});
