'use strict';

/**
 * excelWriter.js — append invoice records to a local .xlsx file, skipping any
 * that are already present (deduplication by supplier + invoice number).
 *
 * The workbook has a single sheet ("Invoices") with a fixed header row. On
 * every run we load the existing file (if any), build a set of keys already
 * present, and only append rows whose key is new — both against the file and
 * against other records in the same batch.
 */

const fs = require('fs');
const ExcelJS = require('exceljs');
const { dedupeKey } = require('./parseInvoice');

const SHEET_NAME = 'Invoices';
const HEADERS = [
  { header: 'Supplier', key: 'supplier', width: 26 },
  { header: 'Shop', key: 'shop', width: 18 },
  { header: 'Invoice No', key: 'invoiceNumber', width: 16 },
  { header: 'Invoice Date', key: 'invoiceDate', width: 14 },
  { header: 'Total (AUD)', key: 'total', width: 14 },
  { header: 'Source File', key: 'sourceFile', width: 34 },
  { header: 'Processed At', key: 'processedAt', width: 22 },
];

async function loadOrCreateWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  if (filePath && fs.existsSync(filePath)) {
    await workbook.xlsx.readFile(filePath);
  }
  let sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) {
    sheet = workbook.addWorksheet(SHEET_NAME);
    sheet.columns = HEADERS;
    sheet.getRow(1).font = { bold: true };
  }
  return { workbook, sheet };
}

/**
 * Build the set of dedupe keys already present in the sheet. We reconstruct a
 * minimal record from each row so we can reuse the same dedupeKey() logic.
 */
function existingKeys(sheet) {
  const keys = new Set();
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const supplier = cellText(row.getCell(1));
    const shop = cellText(row.getCell(2));
    const invoiceNumber = cellText(row.getCell(3));
    const invoiceDate = cellText(row.getCell(4));
    const totalRaw = row.getCell(5).value;
    const total =
      typeof totalRaw === 'number'
        ? totalRaw
        : totalRaw != null
        ? parseFloat(String(totalRaw).replace(/[^0-9.\-]/g, ''))
        : null;
    const key = dedupeKey({
      supplier: supplier || null,
      shop: shop || null,
      invoiceNumber: invoiceNumber || null,
      invoiceDate: invoiceDate || null,
      total: Number.isFinite(total) ? total : null,
    });
    if (key) keys.add(key);
  });
  return keys;
}

function cellText(cell) {
  const v = cell && cell.value;
  if (v == null) return '';
  if (typeof v === 'object' && v.text) return String(v.text).trim();
  return String(v).trim();
}

/**
 * Append records to an Excel file, skipping duplicates.
 *
 * @param {Object} opts
 * @param {string} opts.filePath           Destination .xlsx (created if absent).
 * @param {Array<Object>} opts.records      Records from parseInvoice (status ok).
 * @param {string} [opts.processedAt]        Timestamp string stamped on new rows.
 * @returns {Promise<{added: Array, duplicates: Array}>}
 */
async function appendRecords({ filePath, records, processedAt }) {
  const { workbook, sheet } = await loadOrCreateWorkbook(filePath);
  const seen = existingKeys(sheet);
  const stamp = processedAt || new Date().toISOString();

  const added = [];
  const duplicates = [];

  for (const record of records || []) {
    const key = dedupeKey(record);
    if (key && seen.has(key)) {
      duplicates.push({ record, key });
      continue;
    }
    if (key) seen.add(key);
    sheet.addRow({
      supplier: record.supplier || '',
      shop: record.shop || '',
      invoiceNumber: record.invoiceNumber || '',
      invoiceDate: record.invoiceDate || '',
      total: record.total != null ? record.total : '',
      sourceFile: record.sourceFile || '',
      processedAt: stamp,
    });
    added.push(record);
  }

  // Format the total column as currency for anything present.
  sheet.getColumn(5).numFmt = '#,##0.00';

  if (filePath) {
    await workbook.xlsx.writeFile(filePath);
  }
  return { added, duplicates };
}

module.exports = { appendRecords, loadOrCreateWorkbook, existingKeys, SHEET_NAME, HEADERS };
