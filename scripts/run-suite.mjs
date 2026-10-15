import { spawn } from 'node:child_process';

const guard = new URL('./outbound-guard.mjs', import.meta.url).href;
const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import ${JSON.stringify(guard)}`.trim() };
const child = spawn(process.execPath, ['--test', ...process.argv.slice(2)], { env, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => {
  if (signal) { process.kill(process.pid, signal); return; }
  process.exitCode = code ?? 1;
});
