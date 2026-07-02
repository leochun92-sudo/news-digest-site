'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');

const { processInvoices } = require('../src/processInvoices');

const FIX = path.join(__dirname, 'fixtures');
const read = (name) => fs.readFileSync(path.join(FIX, name), 'utf8');

// Map the fake PDF filenames we create in a temp dir to fixture text, so the
// whole pipeline runs without a real PDF parser.
const TEXT_BY_FILE = {
  'Invoice (IN00121164)_1782091869.pdf': read('always_fruit_fresh_ozeki_bowl.txt'),
  'Invoice INV-8810.pdf': read('maru_food_ozeki_bowl_mac.txt'),
  'Invoice (IN00121153)_1782091877.pdf': read('always_fruit_fresh_yatai_ozeki.txt'),
  '001832494.pdf': read('jfc_ozeki_bowl_macquarie.txt'),
  'Invoice 1863874.pdf': read('socrates_yori_ozeki_sushi.txt'),
  'Statement 1024000.pdf': read('socrates_statement.txt'),
  // A byte-for-byte duplicate of the Socrates invoice (same invoice, new file).
  'Invoice 1863874 (copy).pdf': read('socrates_yori_ozeki_sushi.txt'),
};

function makeTempWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'invoice-test-'));
  for (const name of Object.keys(TEXT_BY_FILE)) {
    fs.writeFileSync(path.join(dir, name), 'dummy pdf bytes');
  }
  return dir;
}

const fakeReadText = async (pdfPath) => {
  const name = path.basename(pdfPath);
  if (!(name in TEXT_BY_FILE)) throw new Error(`no fixture for ${name}`);
  return TEXT_BY_FILE[name];
};

test('end-to-end: writes invoices, skips statement + in-batch duplicate', async () => {
  const dir = makeTempWorkspace();
  const excelPath = path.join(dir, 'invoices.xlsx');

  const summary = await processInvoices({
    inputs: dir,
    excelPath,
    readText: fakeReadText,
    processedAt: '2026-07-02T00:00:00.000Z',
  });

  // 7 files: 5 unique invoices + 1 statement + 1 duplicate invoice.
  assert.strictEqual(summary.totalFiles, 7);
  assert.strictEqual(summary.addedCount, 5);

  const reasons = summary.skipped.map((s) => s.reason).sort();
  assert.deepStrictEqual(reasons, ['duplicate_in_batch', 'statement']);

  // Verify the workbook actually has 5 data rows + header.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(excelPath);
  const sheet = wb.getWorksheet('Invoices');
  assert.strictEqual(sheet.rowCount, 6); // 1 header + 5 rows

  const totals = [];
  sheet.eachRow((row, n) => {
    if (n === 1) return;
    totals.push(row.getCell(5).value);
  });
  assert.ok(totals.includes(611), 'Socrates total should be 611, not 7311.45');
  assert.ok(!totals.includes(7311.45), 'balance due must never be recorded');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('re-running against the same Excel adds nothing (dedupe across runs)', async () => {
  const dir = makeTempWorkspace();
  const excelPath = path.join(dir, 'invoices.xlsx');

  const first = await processInvoices({ inputs: dir, excelPath, readText: fakeReadText });
  assert.strictEqual(first.addedCount, 5);

  const second = await processInvoices({ inputs: dir, excelPath, readText: fakeReadText });
  assert.strictEqual(second.addedCount, 0);
  const dupReasons = second.skipped.filter((s) => s.reason === 'duplicate_in_excel');
  assert.strictEqual(dupReasons.length, 5);

  // Workbook still has exactly 5 data rows.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(excelPath);
  assert.strictEqual(wb.getWorksheet('Invoices').rowCount, 6);

  fs.rmSync(dir, { recursive: true, force: true });
});
