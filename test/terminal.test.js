import test from 'node:test';
import assert from 'node:assert/strict';
import { colorEnabled, createTerminal, stripAnsi, wrapText, withProgress, formatError, SPHINX } from '../src/terminal.js';
import { printHelp, HELP } from '../src/help.js';
import { askInstall, askPolicy, createPrompts } from '../src/prompts.js';
import { applyInstallOptions } from '../src/cli.js';
import { DEFAULT_CONFIG } from '../src/config.js';

function capture({ width = 80, env = {}, tty = false } = {}) {
  let text = '';
  const stream = { isTTY: tty, columns: width, write(value) { text += value; } };
  return { stream, ui: createTerminal({ stream, env }), text: () => text };
}

test('color follows terminal, NO_COLOR, TERM=dumb, and explicit FORCE_COLOR policy', () => {
  assert.equal(colorEnabled({ stream: { isTTY: true }, env: {} }), true);
  assert.equal(colorEnabled({ stream: { isTTY: false }, env: {} }), false);
  assert.equal(colorEnabled({ stream: { isTTY: true }, env: { TERM: 'dumb' } }), false);
  assert.equal(colorEnabled({ stream: { isTTY: false }, env: { FORCE_COLOR: '1' } }), true);
  assert.equal(colorEnabled({ stream: { isTTY: true }, env: { FORCE_COLOR: '0' } }), false);
  assert.equal(colorEnabled({ stream: { isTTY: true }, env: { FORCE_COLOR: '1', NO_COLOR: '1' } }), false);
  assert.equal(colorEnabled({ stream: { isTTY: true }, env: { NO_COLOR: '' } }), false);
});

test('wrapping respects visible width, long tokens, indentation, and blank paragraphs', () => {
  const text = wrapText('\x1b[1mA rather long sentence\x1b[0m\n\n' + 'x'.repeat(100), 24, '  ');
  assert.ok(text.split('\n').every(line => stripAnsi(line).length <= 24));
  assert.ok(text.includes('\n\n'));
  assert.equal(stripAnsi(text).replace(/\s/g, ''), 'Aratherlongsentence' + 'x'.repeat(100));
});

test('main help has the sphinx mark and command help stays scoped at narrow widths', () => {
  const main = capture(); printHelp(main.ui);
  assert.ok(main.text().includes(SPHINX[0]));
  assert.match(main.text(), /Get started/);
  for (const width of [24, 40, 60, 80]) {
    for (const command of Object.keys(HELP)) {
      const output = capture({ width, env: { FORCE_COLOR: '1' } });
      printHelp(output.ui, command);
      assert.ok(stripAnsi(output.text()).includes(`sphinx ${command}`));
      assert.equal(output.text().includes(SPHINX[0]), false);
      assert.ok(output.text().split('\n').every(line => stripAnsi(line).length <= width), `${command} overflowed ${width} columns`);
    }
  }
});

test('status rows and narrow banners fit without decorative boxes or blue colors', () => {
  for (const width of [20, 24, 30, 40, 65, 80]) {
    const output = capture({ width, env: { FORCE_COLOR: '1' } });
    output.ui.banner();
    output.ui.rows([['Repository policy', '/long/path/'.repeat(15)], ['Current local branch', 'release/next-version']]);
    assert.ok(output.text().split('\n').every(line => stripAnsi(line).length <= width), `overflowed ${width} columns`);
    assert.equal(output.text().includes('\x1b[34m'), false);
  }
});

test('model progress uses only a live terminal and is suppressed for machine output', async () => {
  const pipe = capture(); await withProgress('Preparing questions', async () => 42, { stream: pipe.stream, env: {} });
  assert.equal(pipe.text(), '');
  const terminal = capture({ tty: true });
  assert.equal(await withProgress('Preparing questions', async () => 42, { stream: terminal.stream, env: {} }), 42);
  assert.match(stripAnsi(terminal.text()), /Preparing questions/);
  const machine = capture({ tty: true });
  await withProgress('Must not print', async () => 42, { stream: machine.stream, env: { FORCE_COLOR: '1' }, enabled: false });
  assert.equal(machine.text(), '');
});

test('plain protocol errors never contain ANSI despite forced color', () => {
  const output = capture({ tty: true });
  formatError(new Error('Unknown option --wat'), { stream: output.stream, env: { FORCE_COLOR: '1' }, plain: true });
  assert.equal(output.text().includes('\x1b'), false);
  assert.match(output.text(), /Sphinx: Unknown option --wat/);
});

test('numbered prompts validate choices and retry without accepting invalid input', async () => {
  const output = capture(), answers = ['99', 'nonsense', '2'];
  const prompts = createPrompts({ ui: output.ui, ask: async () => answers.shift() });
  const result = await prompts.choose({ title: 'Depth', current: 'standard', choices: [
    { value: 'relaxed', label: 'Relaxed', description: 'Up to 2 questions.' },
    { value: 'standard', label: 'Standard', description: 'Up to 3 questions.' },
  ] });
  assert.equal(result, 'standard');
  assert.equal((output.text().match(/Enter a number/g) || []).length, 2);
  assert.match(output.text(), /Standard \(default\)/);
});

test('text prompts reject bad routes before returning a valid option', async () => {
  const output = capture(), answers = ['invalid', 'claude:sonnet'];
  const prompts = createPrompts({ ui: output.ui, ask: async () => answers.shift() });
  const value = await prompts.text({ title: 'Route', current: 'codex', validate: input => { if (!input.includes(':')) throw new Error('Use provider:model.'); } });
  assert.equal(value, 'claude:sonnet'); assert.match(output.text(), /Use provider:model/);
});

test('accepting onboarding defaults preserves existing per-tier models and reversed event order', async () => {
  const current = structuredClone(DEFAULT_CONFIG);
  current.events = ['pre-commit', 'pre-push'];
  current.models = { small: { provider: 'openrouter', model: 'openrouter/free' }, medium: { provider: 'claude', model: 'sonnet' }, large: { provider: 'codex', model: 'custom-model' } };
  const output = capture();
  const values = await askInstall(current, {}, createPrompts({ ui: output.ui, ask: async () => '' }));
  const updated = applyInstallOptions(current, values);
  assert.deepEqual(updated.models, current.models);
  assert.deepEqual(updated.events, current.events);
  assert.deepEqual(current.models.large, { provider: 'codex', model: 'custom-model' });
});

test('onboarding keeps intentionally empty branches and remotes on Enter', async () => {
  const current = { ...structuredClone(DEFAULT_CONFIG), branches: [], remotes: [], events: [] };
  const output = capture();
  const values = await askPolicy(current, {}, createPrompts({ ui: output.ui, ask: async () => '' }));
  const updated = applyInstallOptions(current, values);
  assert.deepEqual(updated.events, []); assert.deepEqual(updated.branches, []); assert.deepEqual(updated.remotes, []);
});

test('explicit model flags alter only their requested routes and reject invalid settings before setup', () => {
  const config = structuredClone(DEFAULT_CONFIG);
  const updated = applyInstallOptions(config, { large: 'claude:opus' });
  assert.deepEqual(updated.models.small, config.models.small);
  assert.deepEqual(updated.models.large, { provider: 'claude', model: 'opus' });
  const all = applyInstallOptions(config, { provider: 'codex' });
  for (const route of Object.values(all.models)) assert.deepEqual(route, { provider: 'codex', model: null });
  assert.throws(() => applyInstallOptions(config, { agents: 'unknown' }), /--agents/);
  assert.throws(() => applyInstallOptions(config, { large: 'openrouter:paid-model' }), /allow-paid/);
  assert.throws(() => applyInstallOptions(config, { level: 'anything' }), /level/);
});
