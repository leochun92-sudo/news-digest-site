#!/usr/bin/env node
'use strict';

/**
 * cli.js — command line entry point.
 *
 *   node src/cli.js --pdf <file-or-dir> [--pdf <more> ...] --excel <path.xlsx>
 *
 * Prints a JSON summary to stdout (so an n8n "Execute Command" node can parse
 * it). Exit code is 0 unless a hard error occurs.
 */

const { processInvoices } = require('./processInvoices');

function parseArgs(argv) {
  const inputs = [];
  let excel = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pdf' || a === '-p') {
      inputs.push(argv[++i]);
    } else if (a === '--excel' || a === '-e') {
      excel = argv[++i];
    } else if (a === '--help' || a === '-h') {
      return { help: true };
    } else if (!a.startsWith('-')) {
      // bare positional argument -> treat as pdf input
      inputs.push(a);
    }
  }
  return { inputs, excel };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.inputs || args.inputs.length === 0 || !args.excel) {
    console.log(
      'Usage: node src/cli.js --pdf <file-or-dir> [--pdf ...] --excel <path.xlsx>'
    );
    process.exit(args.help ? 0 : 1);
    return;
  }

  const summary = await processInvoices({
    inputs: args.inputs,
    excelPath: args.excel,
  });

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
