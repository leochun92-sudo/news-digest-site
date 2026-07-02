# Invoice → Excel (Ozeki shops)

Reads supplier invoice **PDFs** and appends the key fields to a local **Excel**
file on your MacBook. Built to run from an **n8n** node.

For every invoice it records:

| Supplier | Shop | Invoice No | Invoice Date | Total (AUD) | Source File | Processed At |
|----------|------|-----------|--------------|-------------|-------------|--------------|

It automatically:

- **Matches the supplier** — Always Fruit Fresh, Maru Food, JFC Australia, Socrates Distributors.
- **Matches the shop** — Yori Ozeki Sushi, Ozeki Bowl Mac, Ozeki Bowl, Yatai Ozeki.
- **Reads the correct total** for each supplier's layout — e.g. on Socrates invoices it takes
  `CURRENT INVOICE TOTAL`, never the running `TOTAL BALANCE DUE`.
- **Skips statements** (a statement of account is not an invoice).
- **Skips duplicates** — the same invoice already in the sheet, or appearing twice in one batch,
  is not written again (deduplicated by supplier + invoice number).

## Install

Install once on the machine where n8n runs (your Mac):

```bash
cd invoice-to-excel
npm install
```

## Run the tests

```bash
npm test
```

The suite includes a **real end-to-end test**: it generates genuine PDFs from the sample
invoices, runs them through actual PDF text extraction, and asserts the exact supplier / shop /
date / total for all five suppliers plus statement-skipping and de-duplication.

## Use it — three ways

### 1. n8n "Execute Command" node (simplest)

Point the command at the CLI. It prints a JSON summary to stdout:

```bash
node /Users/leo/tools/invoice-to-excel/src/cli.js \
  --pdf "/Users/leo/Downloads/invoices" \
  --excel "/Users/leo/Documents/Ozeki-Invoices.xlsx"
```

`--pdf` accepts a single file or a folder (all `*.pdf` inside are processed), and can be
repeated. Re-running is safe — invoices already in the Excel file are skipped.

### 2. n8n "Code" node (PDF binary in the workflow)

See [`n8n-code-node.js`](./n8n-code-node.js). It reads the PDF binary from each incoming item,
writes new rows to your Excel file, and returns one item per outcome (added / skipped) so you
can branch or notify. Requires `NODE_FUNCTION_ALLOW_EXTERNAL=*` in your n8n environment.

### 3. From your own Node code

```js
const { processInvoices, processInvoiceBuffers } = require('./src/processInvoices');

// From files/folders on disk:
await processInvoices({ inputs: '/path/to/pdfs', excelPath: '/path/Ozeki-Invoices.xlsx' });

// From in-memory buffers (e.g. email attachments):
await processInvoiceBuffers({
  files: [{ filename: 'Invoice 123.pdf', buffer }],
  excelPath: '/path/Ozeki-Invoices.xlsx',
});
```

## Adding a new supplier

Open [`src/parseInvoice.js`](./src/parseInvoice.js) and append an entry to `SUPPLIERS` with:

- `match` — regex(es) that identify the supplier's name in the PDF text,
- `totalLabels` — ordered regexes for the invoice total (first match wins; put the most specific
  label first so running balances are never picked up),
- `dateLabels` — ordered regexes whose capture group is the invoice date.

Add a new shop to the `SHOPS` list the same way (most-specific name first). Then add a text
fixture under `tests/fixtures/` and a case to the tests.

## How the output is deduplicated

Each row's identity is `supplier + invoice number` (lower-cased). If the invoice number can't be
found, it falls back to `supplier + shop + date + total`. Before writing, the tool loads the
existing workbook, builds the set of keys already present, and only appends rows with a new key.

## Project layout

```
src/parseInvoice.js     Pure parsing logic (supplier/shop/date/total/statement) — no I/O
src/pdfText.js          PDF → text (pdf-parse)
src/excelWriter.js      Append + dedupe into the .xlsx (exceljs)
src/processInvoices.js  Orchestration: files/buffers → parse → Excel, returns a summary
src/cli.js              Command-line entry point
n8n-code-node.js        Snippet to paste into an n8n Code node
tests/                  Unit + integration + real-PDF end-to-end tests
```
