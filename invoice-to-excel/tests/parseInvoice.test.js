'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  parseInvoice,
  dedupeKey,
  normaliseDate,
  isStatement,
} = require('../src/parseInvoice');

const FIX = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(FIX, name), 'utf8');

/* ------------------------------------------------------------------ *
 *  Per-invoice extraction — the four suppliers + the tricky Socrates
 * ------------------------------------------------------------------ */

test('Always Fruit Fresh / Ozeki Bowl', () => {
  const r = parseInvoice({
    text: read('always_fruit_fresh_ozeki_bowl.txt'),
    filename: 'Invoice (IN00121164)_1782091869.pdf',
  });
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.record.supplier, 'Always Fruit Fresh');
  assert.strictEqual(r.record.shop, 'Ozeki Bowl');
  assert.strictEqual(r.record.invoiceNumber, 'IN00121164');
  assert.strictEqual(r.record.invoiceDate, '2026-06-22');
  assert.strictEqual(r.record.total, 149.98);
});

test('Maru Food / Ozeki Bowl Mac', () => {
  const r = parseInvoice({
    text: read('maru_food_ozeki_bowl_mac.txt'),
    filename: 'Invoice INV-8810.pdf',
  });
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.record.supplier, 'Maru Food');
  assert.strictEqual(r.record.shop, 'Ozeki Bowl Mac');
  assert.strictEqual(r.record.invoiceNumber, 'INV-8810');
  assert.strictEqual(r.record.invoiceDate, '2026-06-18');
  assert.strictEqual(r.record.total, 188.6);
});

test('Always Fruit Fresh / Yatai Ozeki', () => {
  const r = parseInvoice({
    text: read('always_fruit_fresh_yatai_ozeki.txt'),
    filename: 'Invoice (IN00121153)_1782091877.pdf',
  });
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.record.supplier, 'Always Fruit Fresh');
  assert.strictEqual(r.record.shop, 'Yatai Ozeki');
  assert.strictEqual(r.record.invoiceNumber, 'IN00121153');
  assert.strictEqual(r.record.invoiceDate, '2026-06-22');
  assert.strictEqual(r.record.total, 219.6);
});

test('JFC Australia / Ozeki Bowl Macquarie', () => {
  const r = parseInvoice({
    text: read('jfc_ozeki_bowl_macquarie.txt'),
    filename: '001832494.pdf',
  });
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.record.supplier, 'JFC Australia Co Pty Ltd');
  assert.strictEqual(r.record.shop, 'Ozeki Bowl Mac');
  assert.strictEqual(r.record.invoiceNumber, '001832494');
  assert.strictEqual(r.record.invoiceDate, '2026-06-22');
  assert.strictEqual(r.record.total, 759.85);
});

test('Socrates / Yori Ozeki Sushi — uses CURRENT INVOICE TOTAL, not balance due', () => {
  const r = parseInvoice({
    text: read('socrates_yori_ozeki_sushi.txt'),
    filename: 'Invoice 1863874.pdf',
  });
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.record.supplier, 'Socrates Distributors');
  assert.strictEqual(r.record.shop, 'Yori Ozeki Sushi');
  assert.strictEqual(r.record.invoiceNumber, '1863874');
  assert.strictEqual(r.record.invoiceDate, '2026-06-16');
  // The critical assertion: NOT 7311.45 (TOTAL BALANCE DUE).
  assert.strictEqual(r.record.total, 611.0);
});

/* ------------------------------------------------------------------ *
 *  Statements are disregarded
 * ------------------------------------------------------------------ */

test('Socrates statement is skipped', () => {
  const r = parseInvoice({
    text: read('socrates_statement.txt'),
    filename: 'Statement 1024000.pdf',
  });
  assert.strictEqual(r.status, 'skipped');
  assert.strictEqual(r.reason, 'statement');
});

test('isStatement flags statement text and not real invoices', () => {
  assert.strictEqual(isStatement(read('socrates_statement.txt')), true);
  assert.strictEqual(isStatement(read('socrates_yori_ozeki_sushi.txt')), false);
  assert.strictEqual(isStatement(read('jfc_ozeki_bowl_macquarie.txt')), false);
});

/* ------------------------------------------------------------------ *
 *  Date normalisation
 * ------------------------------------------------------------------ */

test('normaliseDate handles the supplier date formats', () => {
  assert.strictEqual(normaliseDate('22/06/2026'), '2026-06-22');
  assert.strictEqual(normaliseDate('18 Jun 2026'), '2026-06-18');
  assert.strictEqual(normaliseDate('22-Jun-26'), '2026-06-22');
  assert.strictEqual(normaliseDate('16/06/2026'), '2026-06-16');
  assert.strictEqual(normaliseDate('not a date'), null);
});

/* ------------------------------------------------------------------ *
 *  Deduplication keys
 * ------------------------------------------------------------------ */

test('dedupeKey is stable per supplier+invoice and differs across invoices', () => {
  const a = parseInvoice({
    text: read('always_fruit_fresh_ozeki_bowl.txt'),
    filename: 'Invoice (IN00121164)_1782091869.pdf',
  }).record;
  const aAgain = parseInvoice({
    text: read('always_fruit_fresh_ozeki_bowl.txt'),
    filename: 'copy-of-same-invoice.pdf',
  }).record;
  const b = parseInvoice({
    text: read('always_fruit_fresh_yatai_ozeki.txt'),
    filename: 'Invoice (IN00121153)_1782091877.pdf',
  }).record;

  assert.strictEqual(dedupeKey(a), dedupeKey(aAgain)); // same invoice, diff filename
  assert.notStrictEqual(dedupeKey(a), dedupeKey(b)); // different invoices
});

/* ------------------------------------------------------------------ *
 *  Empty / no-total documents
 * ------------------------------------------------------------------ */

test('empty text is skipped', () => {
  const r = parseInvoice({ text: '   ', filename: 'blank.pdf' });
  assert.strictEqual(r.status, 'skipped');
  assert.strictEqual(r.reason, 'empty');
});

test('invoice with no recognisable total is skipped', () => {
  const r = parseInvoice({
    text: 'TAX INVOICE\nInvoice No 999\nOzeki Bowl\nsome items but no total line',
    filename: 'weird.pdf',
  });
  assert.strictEqual(r.status, 'skipped');
  assert.strictEqual(r.reason, 'no_total');
});
