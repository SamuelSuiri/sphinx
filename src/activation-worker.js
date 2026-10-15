import { runActivationTerminal } from './activation.js';

try {
  const result = await runActivationTerminal({ recordFile: process.argv[2], token: process.argv[3] });
  process.exitCode = result.code;
  if (result.status === 'failed') process.stderr.write('Sphinx could not start this coding client. Open it manually in this repository.\n');
} catch {
  process.stderr.write('Sphinx could not start this coding client. Run sphinx activate to try again.\n');
  process.exitCode = 1;
}
