'use strict';

/**
 * Real end-to-end test: generate genuine PDF files from the text fixtures,
 * then run the FULL pipeline (real pdf-parse extraction -> parse -> Excel).
 * No fake text extractor here — this proves the whole thing works on PDFs.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');

const { processInvoices } = require('../src/processInvoices');
const { writeTextPdf } = require('./helpers/makeFixturePdf');

const FIX = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(FIX, name), 'utf8');

const FILES = [
  ['always_fruit_fresh_ozeki_bowl.txt', 'Invoice (IN00121164)_1782091869.pdf'],
  ['maru_food_ozeki_bowl_mac.txt', 'Invoice INV-8810.pdf'],
  ['always_fruit_fresh_yatai_ozeki.txt', 'Invoice (IN00121153)_1782091877.pdf'],
  ['jfc_ozeki_bowl_macquarie.txt', '001832494.pdf'],
  ['socrates_yori_ozeki_sushi.txt', 'Invoice 1863874.pdf'],
  ['socrates_statement.txt', 'Statement 1024000.pdf'],
];

test('real PDFs: extract, parse and write Excel end-to-end', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'invoice-e2e-'));
  for (const [fixture, pdfName] of FILES) {
    await writeTextPdf(read(fixture), path.join(dir, pdfName));
  }
  const excelPath = path.join(dir, 'invoices.xlsx');

  // Uses the REAL pdf-parse extractor (no readText override).
  const summary = await processInvoices({
    inputs: dir,
    excelPath,
    processedAt: '2026-07-02T00:00:00.000Z',
  });

  assert.strictEqual(summary.errors.length, 0, `unexpected errors: ${JSON.stringify(summary.errors)}`);
  assert.strictEqual(summary.addedCount, 5, 'should add the 5 real invoices');

  // The statement must have been skipped.
  const statement = summary.skipped.find((s) => s.reason === 'statement');
  assert.ok(statement, 'statement should be skipped');

  // Read back and check the extracted values are exactly right.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(excelPath);
  const sheet = wb.getWorksheet('Invoices');

  const rows = [];
  sheet.eachRow((row, n) => {
    if (n === 1) return;
    rows.push({
      supplier: row.getCell(1).value,
      shop: row.getCell(2).value,
      invoiceNumber: String(row.getCell(3).value),
      invoiceDate: String(row.getCell(4).value),
      total: row.getCell(5).value,
    });
  });

  const byNumber = Object.fromEntries(rows.map((r) => [r.invoiceNumber, r]));

  assert.deepStrictEqual(byNumber['IN00121164'], {
    supplier: 'Always Fruit Fresh', shop: 'Ozeki Bowl',
    invoiceNumber: 'IN00121164', invoiceDate: '2026-06-22', total: 149.98,
  });
  assert.deepStrictEqual(byNumber['INV-8810'], {
    supplier: 'Maru Food', shop: 'Ozeki Bowl Mac',
    invoiceNumber: 'INV-8810', invoiceDate: '2026-06-18', total: 188.6,
  });
  assert.deepStrictEqual(byNumber['IN00121153'], {
    supplier: 'Always Fruit Fresh', shop: 'Yatai Ozeki',
    invoiceNumber: 'IN00121153', invoiceDate: '2026-06-22', total: 219.6,
  });
  assert.deepStrictEqual(byNumber['001832494'], {
    supplier: 'JFC Australia Co Pty Ltd', shop: 'Ozeki Bowl Mac',
    invoiceNumber: '001832494', invoiceDate: '2026-06-22', total: 759.85,
  });
  assert.deepStrictEqual(byNumber['1863874'], {
    supplier: 'Socrates Distributors', shop: 'Yori Ozeki Sushi',
    invoiceNumber: '1863874', invoiceDate: '2026-06-16', total: 611,
  });

  fs.rmSync(dir, { recursive: true, force: true });
});
