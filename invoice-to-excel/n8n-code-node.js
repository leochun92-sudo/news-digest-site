/**
 * n8n "Code" node snippet (Run Once for All Items).
 * -------------------------------------------------
 * Paste this into a Code node. It reads the PDF binary attached to each
 * incoming item, extracts the invoice fields, and appends new rows to a local
 * Excel file on your MacBook — skipping statements and duplicates.
 *
 * Requirements:
 *   1. This project must be installed where n8n runs, e.g.
 *        /Users/leo/tools/invoice-to-excel  (run `npm install` there once)
 *   2. n8n must allow requiring external modules. In your n8n environment set:
 *        NODE_FUNCTION_ALLOW_EXTERNAL=*        (or list the specific paths)
 *        NODE_FUNCTION_ALLOW_BUILTIN=*
 *   3. Each incoming item should carry the PDF in binary property "data"
 *      (the default for Read/Download/Email-attachment nodes).
 *
 * Adjust the two CONFIG paths below.
 */

// ---- CONFIG ---------------------------------------------------------------
const MODULE_PATH = '/Users/leo/tools/invoice-to-excel/src/processInvoices';
const EXCEL_PATH = '/Users/leo/Documents/Ozeki-Invoices.xlsx';
// ---------------------------------------------------------------------------

const { processInvoiceBuffers } = require(MODULE_PATH);

// Collect every incoming PDF as { filename, buffer }.
const files = [];
for (const item of items) {
  const binary = item.binary || {};
  for (const key of Object.keys(binary)) {
    const meta = binary[key];
    if (meta.mimeType && !/pdf/i.test(meta.mimeType)) continue;
    const buffer = await this.helpers.getBinaryDataBuffer(items.indexOf(item), key);
    files.push({ filename: meta.fileName || `${key}.pdf`, buffer });
  }
}

const summary = await processInvoiceBuffers({ files, excelPath: EXCEL_PATH });

// Return one item per outcome so you can branch/notify downstream.
const out = [];
for (const rec of summary.added) out.push({ json: { status: 'added', ...rec } });
for (const sk of summary.skipped) {
  out.push({ json: { status: 'skipped', reason: sk.reason, file: sk.file } });
}
out.push({ json: { status: 'summary', ...summary, added: undefined, skipped: undefined } });
return out;
