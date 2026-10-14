import { runCheckpointTerminal } from './terminal-launch.js';

try {
  const result = await runCheckpointTerminal({ recordFile: process.argv[2], token: process.argv[3] });
  process.exitCode = result.code;
  if (result.status === 'passed') process.stdout.write('\nSphinx check complete. You can close this window and return to your coding agent.\n');
  else if (result.status !== 'ignored') process.stdout.write('\nSphinx check remains incomplete. You can close this window; progress is saved.\n');
} catch {
  process.stderr.write('Sphinx could not open this checkpoint. Run sphinx doctor, then retry the Git operation.\n');
  process.exitCode = 1;
}
