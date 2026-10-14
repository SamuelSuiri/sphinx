#!/usr/bin/env node
import { main } from '../src/cli.js';
import { formatError } from '../src/terminal.js';

try { process.exitCode = await main(process.argv.slice(2)); }
catch (error) {
  formatError(error, { plain: process.argv.includes('--json') || ['hook', 'mcp'].includes(process.argv[2]) });
  process.exitCode = error.exitCode || 1;
}
