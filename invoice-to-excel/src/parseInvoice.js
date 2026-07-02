'use strict';

/**
 * parseInvoice.js
 * -----------------
 * Pure, dependency-free logic that turns the *text* extracted from an invoice
 * PDF into a structured record. Keeping this separate from PDF/Excel I/O makes
 * it fully unit-testable against text fixtures.
 *
 * Responsibilities:
 *   - Detect the supplier (from a configurable list of known suppliers).
 *   - Detect the shop the invoice is billed to (one of the Ozeki shops).
 *   - Extract the invoice number, invoice date and invoice TOTAL.
 *   - Decide whether a document is actually a *statement* (which must be
 *     disregarded) rather than an invoice.
 *
 * The tricky bits handled here:
 *   - Every supplier uses a different layout, date format and "total" label.
 *   - Some invoices (e.g. Socrates) show a running "TOTAL BALANCE DUE" that is
 *     NOT the value of this invoice. We must pick "CURRENT INVOICE TOTAL".
 */

/* ------------------------------------------------------------------ *
 *  Shop matching
 * ------------------------------------------------------------------ */

// Ordered most-specific first so "Ozeki Bowl Mac" wins over "Ozeki Bowl",
// and "Yori Ozeki Sushi" wins over a bare "Yori Ozeki".
const SHOPS = [
  {
    canonical: 'Yori Ozeki Sushi',
    patterns: [/yori\s+ozeki\s+sushi/i, /yori\s+ozeki/i],
  },
  {
    canonical: 'Ozeki Bowl Mac',
    // "Ozeki Bowl Mac", "Ozeki Bowl Macquarie", "Ozeki Bowl Mac (Macquarie)"
    patterns: [/ozeki\s+bowl\s+mac/i],
  },
  {
    canonical: 'Yatai Ozeki',
    patterns: [/yatai\s+ozeki/i],
  },
  {
    canonical: 'Ozeki Bowl',
    patterns: [/ozeki\s+bowl/i],
  },
];

// Markers for the start of the line-items table. The shop (bill-to) always
// appears BEFORE the items, whereas product descriptions after these markers
// may themselves contain shop-like words (e.g. JFC sells "YORI OZEKI" branded
// products to an "Ozeki Bowl" shop). Restricting the shop search to the header
// region avoids matching a product line as the shop.
const ITEMS_HEADER = [
  /item\s+no\s+product\s+description/i,
  /qty\s+product\s+description/i,
  /item\s+description\s+quantity/i,
  /item\s+quantity\s+unit\s+price/i,
  /\bproduct\s+description\b/i,
];

/** Return the portion of the text before the line-items table begins. */
function headerRegion(text) {
  let cut = text.length;
  for (const re of ITEMS_HEADER) {
    const m = text.match(re);
    if (m && m.index < cut) cut = m.index;
  }
  return text.slice(0, cut);
}

function detectShop(text) {
  // Only consider the billing header, never the line items.
  const region = headerRegion(text);
  for (const shop of SHOPS) {
    if (shop.patterns.some((re) => re.test(region))) {
      return shop.canonical;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 *  Supplier configuration
 * ------------------------------------------------------------------ *
 *  Each supplier declares:
 *   - name:        canonical display name written to Excel
 *   - match:       regex(es) that identify the supplier in the PDF text
 *   - totalLabels: ordered list of regexes; first that matches wins. This is
 *                  where per-supplier total quirks live.
 *   - dateLabels:  ordered list of regexes whose capture group is a date token
 *
 *  Add a new supplier by appending an entry here — no other code changes.
 */
const SUPPLIERS = [
  {
    name: 'Always Fruit Fresh',
    match: [/always\s+fruit\s+fresh/i],
    totalLabels: [
      /amount\s+due\s*\$?\s*([\d,]+\.\d{2})/i,
      /\btotal\b\s*\$?\s*([\d,]+\.\d{2})/i,
    ],
    dateLabels: [/invoice\s+date\s*:?\s*([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i],
  },
  {
    name: 'Maru Food',
    match: [/maru\s*food/i, /t\/a\s+maru\s+food/i],
    totalLabels: [
      /amount\s+due\s*aud\s*\$?\s*([\d,]+\.\d{2})/i,
      /invoice\s+total\s*aud\s*\$?\s*([\d,]+\.\d{2})/i,
    ],
    // "Invoice Date 18 Jun 2026" — label and value may be separated by newline
    dateLabels: [/invoice\s+date\s*:?\s*([0-9]{1,2}\s+[A-Za-z]{3,9}\s+[0-9]{2,4})/i],
  },
  {
    name: 'JFC Australia Co Pty Ltd',
    match: [/jfc\s+australia/i],
    totalLabels: [
      // "INVOICE TOTAL (GST,WET, INCLUDED) AU$ 759.85"
      /invoice\s+total[\s\S]{0,60}?au\$?\s*([\d,]+\.\d{2})/i,
    ],
    // "DATE OF ISSUE 22-Jun-26"
    dateLabels: [/date\s+of\s+issue\s*:?\s*([0-9]{1,2}[\-\/][A-Za-z]{3,9}[\-\/][0-9]{2,4})/i],
  },
  {
    name: 'Socrates Distributors',
    match: [/socrates\s+distributors/i],
    totalLabels: [
      // MUST use the current invoice total, never the running balance due.
      /current\s+invoice\s+total\s*\$?\s*([\d,]+\.\d{2})/i,
    ],
    dateLabels: [/invoice\s+date[\s\S]{0,20}?([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i],
  },
];

function detectSupplier(text) {
  for (const supplier of SUPPLIERS) {
    if (supplier.match.some((re) => re.test(text))) {
      return supplier;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 *  Statement detection
 * ------------------------------------------------------------------ *
 *  A statement of account summarises many invoices and must be skipped.
 *  Heuristic: it self-identifies as a "statement" and lacks the hallmarks of
 *  a single tax invoice. Note that an invoice may legitimately list
 *  "outstanding invoices" (e.g. Socrates) while still being an invoice, so we
 *  do NOT treat that as a statement.
 */
function isStatement(text) {
  const t = text || '';
  if (/statement\s+of\s+account|account\s+statement/i.test(t)) return true;

  const looksLikeInvoice =
    /tax\s+invoice/i.test(t) ||
    /invoice\s*(?:no|number|#)/i.test(t) ||
    /invoice\s+date/i.test(t) ||
    /current\s+invoice\s+total/i.test(t);

  // A bare "STATEMENT" heading with none of the invoice hallmarks.
  if (/\bstatement\b/i.test(t) && !looksLikeInvoice) return true;

  return false;
}

/* ------------------------------------------------------------------ *
 *  Field extraction helpers
 * ------------------------------------------------------------------ */

function toNumber(raw) {
  if (raw == null) return null;
  const n = parseFloat(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/**
 * Normalise a date token into ISO (yyyy-mm-dd). Supports:
 *   22/06/2026, 16-06-2026        (dd/mm/yyyy)
 *   18 Jun 2026                   (dd Mon yyyy)
 *   22-Jun-26                     (dd-Mon-yy)
 * Two-digit years are assumed to be 2000+.
 * Returns null if it cannot be parsed.
 */
function normaliseDate(token) {
  if (!token) return null;
  const s = token.trim();

  // dd <Mon> yyyy  or  dd-Mon-yy
  let m = s.match(/^([0-9]{1,2})[\s\-\/]([A-Za-z]{3,9})[\s\-\/]([0-9]{2,4})$/);
  if (m) {
    const day = m[1].padStart(2, '0');
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    let year = m[3];
    if (!mon) return null;
    if (year.length === 2) year = '20' + year;
    return `${year}-${mon}-${day}`;
  }

  // dd/mm/yyyy or dd-mm-yy
  m = s.match(/^([0-9]{1,2})[\/\-]([0-9]{1,2})[\/\-]([0-9]{2,4})$/);
  if (m) {
    const day = m[1].padStart(2, '0');
    const mon = m[2].padStart(2, '0');
    let year = m[3];
    if (year.length === 2) year = '20' + year;
    return `${year}-${mon}-${day}`;
  }

  return null;
}

function extractDate(text, supplier) {
  // Supplier-specific labels first (most reliable), then generic fallbacks.
  const labelSets = [];
  if (supplier && supplier.dateLabels) labelSets.push(...supplier.dateLabels);
  labelSets.push(
    /invoice\s+date\s*:?\s*([0-9]{1,2}[\s\/\-][A-Za-z0-9]{2,9}[\s\/\-][0-9]{2,4})/i,
    /date\s+of\s+issue\s*:?\s*([0-9]{1,2}[\s\/\-][A-Za-z0-9]{2,9}[\s\/\-][0-9]{2,4})/i
  );

  for (const re of labelSets) {
    const m = text.match(re);
    if (m) {
      const iso = normaliseDate(m[1]);
      if (iso) return { iso, raw: m[1].trim() };
    }
  }
  return { iso: null, raw: null };
}

function extractTotal(text, supplier) {
  const labelSets = [];
  if (supplier && supplier.totalLabels) labelSets.push(...supplier.totalLabels);
  // Generic fallback labels for unknown suppliers. Deliberately excludes
  // "balance due" / "outstanding" which are running totals, not this invoice.
  labelSets.push(
    /amount\s+due\s*(?:aud)?\s*\$?\s*([\d,]+\.\d{2})/i,
    /invoice\s+total\s*(?:aud)?\s*\$?\s*([\d,]+\.\d{2})/i,
    /total\s+due\s*\$?\s*([\d,]+\.\d{2})/i
  );

  for (const re of labelSets) {
    const m = text.match(re);
    if (m) {
      const n = toNumber(m[1]);
      if (n != null) return n;
    }
  }
  return null;
}

function extractInvoiceNumber(text, filename) {
  // 1) From the document body via a label.
  const labelled = text.match(
    /invoice\s*(?:no|number|num|#)\b\.?\s*:?\s*\n?\s*([A-Za-z]{0,4}[0-9][A-Za-z0-9\-\/]*)/i
  );
  if (labelled && /[0-9]/.test(labelled[1])) {
    return labelled[1].trim();
  }

  // 2) From the filename as a fallback:
  //    "Invoice (IN00121164)_1782091869.pdf" -> IN00121164
  //    "Invoice INV-8810.pdf"                -> INV-8810
  //    "001832494.pdf"                       -> 001832494
  //    "Invoice 1863874.pdf"                 -> 1863874
  if (filename) {
    const base = String(filename).replace(/\.pdf$/i, '');
    const paren = base.match(/\(([A-Za-z0-9\-\/]+)\)/);
    if (paren) return paren[1];
    const token = base.match(/([A-Za-z]{2,4}-?\d{3,}|\d{5,})/);
    if (token) return token[1];
  }
  return null;
}

/* ------------------------------------------------------------------ *
 *  Public entry point
 * ------------------------------------------------------------------ */

/**
 * Parse invoice text into a record.
 *
 * @param {Object} opts
 * @param {string} opts.text      Raw text extracted from the PDF.
 * @param {string} [opts.filename] Original file name (used as a fallback and
 *                                 recorded on the row).
 * @returns {Object} One of:
 *   { status: 'ok', record: {...} }
 *   { status: 'skipped', reason: 'statement' | 'no_total' | 'empty', record?: {...} }
 */
function parseInvoice({ text, filename } = {}) {
  const raw = typeof text === 'string' ? text : '';
  if (!raw.trim()) {
    return { status: 'skipped', reason: 'empty', record: null };
  }

  if (isStatement(raw)) {
    return {
      status: 'skipped',
      reason: 'statement',
      record: { sourceFile: filename || null },
    };
  }

  const supplier = detectSupplier(raw);
  const shop = detectShop(raw);
  const { iso: invoiceDate, raw: invoiceDateRaw } = extractDate(raw, supplier);
  const total = extractTotal(raw, supplier);
  const invoiceNumber = extractInvoiceNumber(raw, filename);

  const record = {
    supplier: supplier ? supplier.name : null,
    shop,
    invoiceNumber,
    invoiceDate, // ISO yyyy-mm-dd
    invoiceDateRaw,
    total,
    sourceFile: filename || null,
  };

  // Without a total there is nothing meaningful to record.
  if (total == null) {
    return { status: 'skipped', reason: 'no_total', record };
  }

  return { status: 'ok', record };
}

/**
 * Stable key used to detect duplicate invoices. Prefers supplier + invoice
 * number; falls back to supplier + shop + date + total when the number is
 * missing.
 */
function dedupeKey(record) {
  if (!record) return null;
  const supplier = (record.supplier || 'unknown').toLowerCase().trim();
  if (record.invoiceNumber) {
    return `${supplier}||${String(record.invoiceNumber).toLowerCase().trim()}`;
  }
  return [
    supplier,
    (record.shop || '').toLowerCase().trim(),
    record.invoiceDate || '',
    record.total != null ? record.total.toFixed(2) : '',
  ].join('||');
}

module.exports = {
  parseInvoice,
  dedupeKey,
  detectSupplier,
  detectShop,
  extractTotal,
  extractDate,
  extractInvoiceNumber,
  normaliseDate,
  isStatement,
  SUPPLIERS,
  SHOPS,
};
