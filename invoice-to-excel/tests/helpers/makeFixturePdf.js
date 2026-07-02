'use strict';

/**
 * Generate a valid PDF from plain text using pdfkit (dev dependency only).
 * Used by the real end-to-end test to exercise the actual pdf-parse extractor.
 */

const fs = require('fs');
const PDFDocument = require('pdfkit');

/**
 * @param {string} text     Text content, one logical line per '\n'.
 * @param {string} outPath  Destination .pdf path.
 * @returns {Promise<void>}
 */
function writeTextPdf(text, outPath) {
  return new Promise((resolve, reject) => {
    // compress:false keeps a plain xref table that pdf-parse's (old) bundled
    // pdf.js reads reliably; compressed xref streams intermittently fail there.
    const doc = new PDFDocument({ margin: 40, size: 'A4', compress: false });
    const stream = fs.createWriteStream(outPath);
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.pipe(stream);
    doc.font('Helvetica').fontSize(9);
    for (const line of text.split('\n')) {
      // Empty lines still advance the cursor.
      doc.text(line.length ? line : ' ');
    }
    doc.end();
  });
}

module.exports = { writeTextPdf };
