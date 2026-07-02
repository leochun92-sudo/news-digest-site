'use strict';

/**
 * processInvoices.js — orchestration layer.
 *
 * Given one or more PDF files (or a directory), extract text, parse each into
 * a record, drop statements / unrecognised documents, deduplicate, and append
 * the survivors to the destination Excel file. Returns a JSON-friendly summary
 * (handy for logging inside n8n).
 */

const fs = require('fs');
const path = require('path');
const { extractTextFromFile, extractTextFromBuffer } = require('./pdfText');
const { parseInvoice, dedupeKey } = require('./parseInvoice');
const { appendRecords } = require('./excelWriter');

/** Expand inputs (files and/or directories) into a flat list of .pdf paths. */
function collectPdfPaths(inputs) {
  const out = [];
  for (const input of [].concat(inputs)) {
    if (!input) continue;
    const stat = fs.statSync(input);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(input)) {
        if (/\.pdf$/i.test(name)) out.push(path.join(input, name));
      }
    } else if (/\.pdf$/i.test(input)) {
      out.push(input);
    }
  }
  return out;
}

/**
 * Process a set of PDF inputs and write the results to Excel.
 *
 * @param {Object} opts
 * @param {string|string[]} opts.inputs  PDF file path(s) and/or directory path(s).
 * @param {string} opts.excelPath        Destination .xlsx file.
 * @param {Function} [opts.readText]     Override text extractor (used in tests).
 * @param {string} [opts.processedAt]    Timestamp for new rows.
 * @returns {Promise<Object>} summary
 */
async function processInvoices({ inputs, excelPath, readText, processedAt }) {
  const extract = readText || extractTextFromFile;
  const pdfPaths = collectPdfPaths(inputs);

  const ok = [];
  const skipped = [];
  const errors = [];
  const seenInBatch = new Set();

  for (const pdfPath of pdfPaths) {
    const filename = path.basename(pdfPath);
    let text;
    try {
      text = await extract(pdfPath);
    } catch (err) {
      errors.push({ file: filename, error: err.message });
      continue;
    }

    const result = parseInvoice({ text, filename });
    if (result.status !== 'ok') {
      skipped.push({ file: filename, reason: result.reason, record: result.record });
      continue;
    }

    // In-batch duplicate detection (e.g. the same PDF supplied twice, or the
    // Socrates two-page invoice + copy) before we even touch the workbook.
    const key = dedupeKey(result.record);
    if (key && seenInBatch.has(key)) {
      skipped.push({ file: filename, reason: 'duplicate_in_batch', record: result.record });
      continue;
    }
    if (key) seenInBatch.add(key);
    ok.push(result.record);
  }

  let writeResult = { added: [], duplicates: [] };
  if (excelPath && ok.length) {
    writeResult = await appendRecords({ filePath: excelPath, records: ok, processedAt });
  }

  // Records that were fine but already existed in the Excel file.
  for (const dup of writeResult.duplicates) {
    skipped.push({
      file: dup.record.sourceFile,
      reason: 'duplicate_in_excel',
      record: dup.record,
    });
  }

  return {
    excelPath: excelPath || null,
    totalFiles: pdfPaths.length,
    added: writeResult.added,
    addedCount: writeResult.added.length,
    skipped,
    skippedCount: skipped.length,
    errors,
  };
}

/**
 * Process in-memory PDF buffers (the common case inside n8n, where an email or
 * download node hands you binary data rather than a path on disk).
 *
 * @param {Object} opts
 * @param {Array<{filename: string, buffer: Buffer}>} opts.files
 * @param {string} opts.excelPath      Destination .xlsx file.
 * @param {string} [opts.processedAt]  Timestamp for new rows.
 * @returns {Promise<Object>} summary (same shape as processInvoices)
 */
async function processInvoiceBuffers({ files, excelPath, processedAt }) {
  const ok = [];
  const skipped = [];
  const errors = [];
  const seenInBatch = new Set();

  for (const { filename, buffer } of files || []) {
    let text;
    try {
      text = await extractTextFromBuffer(buffer);
    } catch (err) {
      errors.push({ file: filename, error: err.message });
      continue;
    }

    const result = parseInvoice({ text, filename });
    if (result.status !== 'ok') {
      skipped.push({ file: filename, reason: result.reason, record: result.record });
      continue;
    }

    const key = dedupeKey(result.record);
    if (key && seenInBatch.has(key)) {
      skipped.push({ file: filename, reason: 'duplicate_in_batch', record: result.record });
      continue;
    }
    if (key) seenInBatch.add(key);
    ok.push(result.record);
  }

  let writeResult = { added: [], duplicates: [] };
  if (excelPath && ok.length) {
    writeResult = await appendRecords({ filePath: excelPath, records: ok, processedAt });
  }
  for (const dup of writeResult.duplicates) {
    skipped.push({ file: dup.record.sourceFile, reason: 'duplicate_in_excel', record: dup.record });
  }

  return {
    excelPath: excelPath || null,
    totalFiles: (files || []).length,
    added: writeResult.added,
    addedCount: writeResult.added.length,
    skipped,
    skippedCount: skipped.length,
    errors,
  };
}

module.exports = { processInvoices, processInvoiceBuffers, collectPdfPaths };
