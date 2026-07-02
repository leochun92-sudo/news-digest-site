'use strict';

/**
 * pdfText.js — thin wrapper around pdf-parse to get plain text out of a PDF.
 * Isolated so the rest of the code (and all tests) never depend on the PDF
 * library directly.
 */

const fs = require('fs');

/**
 * Extract text from a PDF given a Buffer.
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
async function extractTextFromBuffer(buffer) {
  // Lazy require so unit tests that only touch parsing never load pdf-parse.
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(buffer);
  return data.text || '';
}

/**
 * Extract text from a PDF file path.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function extractTextFromFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  return extractTextFromBuffer(buffer);
}

module.exports = { extractTextFromBuffer, extractTextFromFile };
