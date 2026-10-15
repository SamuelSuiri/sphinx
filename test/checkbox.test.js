import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { checkbox } from '../src/checkbox.js';
import { stripAnsi } from '../src/terminal.js';

const choices = [
  { value: 'codex', label: 'Codex', description: 'Review hooks in the coding client.' },
  { value: 'claude', label: 'Claude Code', description: 'Answer directly in native forms.' },
  { value: 'pi', label: 'Pi', description: 'Answer directly in dialogs.' },
  { value: 'cursor', label: 'Cursor', description: 'Open a dedicated Sphinx terminal.' },
  { value: 'opencode', label: 'OpenCode', description: 'Open a dedicated Sphinx terminal.' },
];

function fixture({ paused = true, raw = false, columns = 80, rows = 24, env = { NO_COLOR: '1' } } = {}) {
  const input = new EventEmitter(), output = new EventEmitter(), signalSource = new EventEmitter();
  let text = '', isPaused = paused;
  input.isTTY = true; input.isRaw = raw; input.rawChanges = []; input.readableFlowing = !paused;
  input.isPaused = () => isPaused;
  input.pause = () => { isPaused = true; input.readableFlowing = false; };
  input.resume = () => { isPaused = false; input.readableFlowing = true; };
  input.setRawMode = value => { input.isRaw = value; input.rawChanges.push(value); };
  output.isTTY = true; output.columns = columns; output.rows = rows;
  output.write = value => { text += value; };
  return { input, output, signalSource, get text() { return text; }, options: { input, output, signalSource, env, choices, escapeTimeoutMs: 5 } };
}

test('All is first, shows a partial state, and space selects every supported client in stable order', async () => {
  const f = fixture(), result = checkbox({ ...f.options, current: ['pi'] });
  assert.match(stripAnsi(f.text), /> \[-\] All supported agents/);
  assert.ok(f.text.indexOf('All supported agents') < f.text.indexOf('Codex'));
  f.input.emit('data', Buffer.from(' \r'));
  assert.deepEqual(await result, choices.map(choice => choice.value));
  assert.match(stripAnsi(f.text), /\[x\] All supported agents/);
  assert.match(stripAnsi(f.text), /Selected: Codex, Claude Code, Pi, Cursor, OpenCode/);
});

test('individual arrows and space toggle choices; Enter preserves defaults and returns none as Git only', async () => {
  const f = fixture(), result = checkbox({ ...f.options, current: ['claude', 'obsolete'] });
  f.input.emit('data', '\x1b[B \x1b[B \r');
  assert.deepEqual(await result, ['codex']);
  const keep = fixture(), same = checkbox({ ...keep.options, current: ['pi'] }); keep.input.emit('data', '\r');
  assert.deepEqual(await same, ['pi']);
  const empty = fixture(), none = checkbox({ ...empty.options, current: choices.map(choice => choice.value) }); empty.input.emit('data', 'a\r');
  assert.deepEqual(await none, []); assert.match(stripAnsi(empty.text), /Git and terminal only/);
});

test('split arrow sequences do not cancel, and Home/End move predictably', async () => {
  const f = fixture(), result = checkbox(f.options);
  f.input.emit('data', '\x1b'); f.input.emit('data', '['); f.input.emit('data', 'B'); f.input.emit('data', ' ');
  f.input.emit('data', '\x1b[F '); f.input.emit('data', '\x1b[H'); f.input.emit('data', '\r');
  assert.deepEqual(await result, ['codex', 'opencode']);
});

test('Ctrl+C, Escape, Ctrl+D, EOF, and external SIGINT cancel and restore the terminal', async () => {
  for (const action of [f => f.input.emit('data', '\x03'), f => f.input.emit('data', '\x1b'), f => f.input.emit('data', '\x04'), f => f.input.emit('end'), f => f.signalSource.emit('SIGINT')]) {
    const f = fixture(), result = checkbox(f.options);
    action(f);
    await assert.rejects(result, error => error.code === 'SPHINX_CANCELLED' && error.exitCode === 130);
    assert.equal(f.input.isRaw, false); assert.equal(f.input.isPaused(), true);
    assert.equal(f.input.listenerCount('data'), 0); assert.equal(f.input.listenerCount('end'), 0); assert.equal(f.output.listenerCount('resize'), 0); assert.equal(f.signalSource.listenerCount('SIGINT'), 0);
    assert.ok(f.text.endsWith('\x1b[?25h'));
  }
});

test('completion restores existing raw/flowing states and removes only prompt-owned listeners', async () => {
  const f = fixture({ raw: true, paused: false }); let seen = 0;
  const existing = () => { seen++; };
  f.input.on('data', existing); f.output.on('resize', existing); f.signalSource.on('SIGINT', existing);
  const result = checkbox(f.options); f.input.emit('data', '\r'); await result;
  assert.equal(f.input.isRaw, true); assert.equal(f.input.isPaused(), false);
  assert.deepEqual(f.input.listeners('data'), [existing]); assert.deepEqual(f.output.listeners('resize'), [existing]); assert.deepEqual(f.signalSource.listeners('SIGINT'), [existing]);
  assert.equal(seen, 1); assert.deepEqual(f.input.rawChanges, [true, true]);
});

test('untouched stdin returns to non-flowing state so a first-question picker does not keep installation alive', async () => {
  const f = fixture({ paused: false }); f.input.readableFlowing = null;
  assert.equal(f.input.isPaused(), false);
  const result = checkbox(f.options); f.input.emit('data', '\r'); await result;
  assert.equal(f.input.readableFlowing, false);
  assert.equal(f.input.isPaused(), true);
  assert.equal(f.input.listenerCount('data'), 0);
});

test('narrow output wraps prose, keeps navigation visible, and honors NO_COLOR even with FORCE_COLOR', async () => {
  const f = fixture({ columns: 24, rows: 12, env: { NO_COLOR: '1', FORCE_COLOR: '1' } });
  const result = checkbox({ ...f.options, description: 'Select every coding agent that should connect to Sphinx.' });
  const initial = stripAnsi(f.text);
  assert.ok(initial.split('\n').every(line => line.length <= 23));
  assert.match(initial, /Space toggle/); assert.doesNotMatch(f.text, /\x1b\[[\d;]*m/);
  f.input.emit('data', '\x1b[F \r'); assert.deepEqual(await result, ['opencode']);
});

test('color uses existing amber only when enabled, and output errors restore raw mode', async () => {
  const f = fixture({ env: { FORCE_COLOR: '1' } }), result = checkbox(f.options);
  assert.match(f.text, /\x1b\[38;5;179m/); f.input.emit('data', '\r'); await result;
  const broken = fixture(); let writes = 0;
  broken.output.write = () => { if (++writes >= 3) throw new Error('terminal closed'); };
  await assert.rejects(checkbox(broken.options), /terminal closed/);
  assert.equal(broken.input.isRaw, false); assert.equal(broken.input.isPaused(), true); assert.equal(broken.input.listenerCount('data'), 0);
});

test('noninteractive, dumb, ended, or invalid input is rejected without installing listeners', async () => {
  const f = fixture(); f.input.isTTY = false;
  await assert.rejects(checkbox(f.options), error => error.code === 'SPHINX_TTY_REQUIRED'); assert.equal(f.input.listenerCount('data'), 0);
  const dumb = fixture({ env: { TERM: 'dumb' } }); await assert.rejects(checkbox(dumb.options), error => error.code === 'SPHINX_TTY_REQUIRED');
  const ended = fixture(); ended.input.readableEnded = true; await assert.rejects(checkbox(ended.options), error => error.code === 'SPHINX_CANCELLED');
  await assert.rejects(checkbox({ ...ended.options, choices: [choices[0], choices[0]] }), /unique/);
});
