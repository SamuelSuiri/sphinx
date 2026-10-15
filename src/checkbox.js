import { StringDecoder } from 'node:string_decoder';
import { createTerminal, colorEnabled, wrapText } from './terminal.js';

const CLEAR = '\r\x1b[J';
const NAVIGATION = new Map([
  ['\x1b[A', 'up'], ['\x1bOA', 'up'], ['\x1b[B', 'down'], ['\x1bOB', 'down'],
  ['\x1b[H', 'home'], ['\x1bOH', 'home'], ['\x1b[1~', 'home'], ['\x1b[7~', 'home'],
  ['\x1b[F', 'end'], ['\x1bOF', 'end'], ['\x1b[4~', 'end'], ['\x1b[8~', 'end'],
]);

function cancelled() {
  const error = new Error('Selection cancelled.');
  error.code = 'SPHINX_CANCELLED'; error.exitCode = 130;
  return error;
}

/** A small inline checkbox prompt. The caller must close its readline first. */
export async function checkbox({ choices, current = [], title = 'Connect your coding agents', description, ui, input = process.stdin, output = process.stdout, env = process.env, escapeTimeoutMs = 50, signalSource = process } = {}) {
  if (!Array.isArray(choices) || choices.some(choice => !choice || typeof choice.value !== 'string' || !choice.value || typeof choice.label !== 'string' || !choice.label) || new Set(choices.map(choice => choice.value)).size !== choices.length || !Array.isArray(current)) throw new Error('Checkbox choices need unique values, labels, and an array of selected values.');
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function' || env.TERM === 'dumb') {
    const error = new Error('Checkbox selection requires an interactive terminal.'); error.code = 'SPHINX_TTY_REQUIRED'; throw error;
  }
  if (input.destroyed || input.readableEnded) throw cancelled();
  const terminal = ui || createTerminal({ stream: output, env });
  const style = colorEnabled({ stream: output, env }) ? terminal.style : { strong: String, amber: String, green: String, muted: String };
  const selected = new Set(current.filter(value => choices.some(choice => choice.value === value)));
  const rows = [{ label: 'All supported agents', description: 'Select or clear every supported agent. Leave everything unchecked for Git and terminal only.' }, ...choices];
  // Untouched stdin has readableFlowing=null while isPaused() is false. Resume
  // only a stream that was actually flowing; otherwise the prompt keeps Node
  // alive after installation when it was the first interactive question.
  const wasRaw = !!input.isRaw, wasPaused = input.readableFlowing !== true;
  let focus = 0, renderedLines = 0, escapeTimer, pending = '', finished = false, rawChanged = false, cursorHidden = false;
  const decoder = new StringDecoder('utf8');
  const width = () => Math.max(10, Math.min(Number(output.columns) || terminal.width || 80, terminal.width || 100) - 1);
  const clearFrame = () => {
    if (renderedLines) output.write(`\x1b[${renderedLines}A${CLEAR}`);
    renderedLines = 0;
  };
  const render = () => {
    clearFrame();
    const columns = width(), height = Math.max(5, (Number(output.rows) || 24) - 1);
    const fullHint = 'Arrows move · Space toggles · A all · Enter confirms · Esc cancels';
    let hint = wrapText(fullHint, columns).split('\n');
    if (hint.length + rows.length + 3 > height) hint = wrapText('↑↓ move  Space toggle  Enter done  Esc cancel', columns).split('\n');
    const renderedRows = rows.map((row, index) => {
      const check = index === 0 ? selected.size === 0 ? ' ' : selected.size === choices.length ? 'x' : '-' : selected.has(choices[index - 1].value) ? 'x' : ' ';
      const prefix = `${index === focus ? '>' : ' '} [${check}] `;
      return wrapText(row.label, Math.max(1, columns - prefix.length)).split('\n').map((line, part) => {
        const text = (part ? ' '.repeat(prefix.length) : prefix) + line;
        return index === focus ? style.amber(text) : text;
      });
    });
    const rowRoom = Math.max(1, height - hint.length - 2);
    let first = 0;
    while (first < focus && renderedRows.slice(first, focus + 1).reduce((count, row) => count + row.length, 0) > rowRoom) first++;
    const lines = [];
    for (let index = first; index < renderedRows.length; index++) {
      if (lines.length && lines.length + renderedRows[index].length > rowRoom) break;
      lines.push(...renderedRows[index].slice(0, rowRoom - lines.length));
    }
    const detailRoom = Math.max(0, height - lines.length - hint.length - 1);
    const detail = wrapText(rows[focus].description || '', columns).split('\n').slice(0, Math.min(3, detailRoom));
    if (detail.length && detail.some(Boolean)) lines.push('', ...detail.map(style.muted));
    lines.push(...hint.map(style.muted));
    renderedLines = lines.length;
    output.write(`${lines.join('\n')}\n`);
  };
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(escapeTimer);
      input.removeListener('data', onData); input.removeListener('end', onEnd); input.removeListener('close', onEnd); input.removeListener('error', onError);
      output.removeListener('resize', onResize); signalSource.removeListener('SIGINT', onInterrupt);
      try { if (rawChanged) input.setRawMode(wasRaw); } catch {}
      try { if (wasPaused) input.pause(); else input.resume(); } catch {}
      try { if (cursorHidden) output.write('\x1b[?25h'); } catch {}
    };
    const finish = error => {
      if (finished) return;
      finished = true;
      let failure = error;
      const values = choices.filter(choice => selected.has(choice.value)).map(choice => choice.value);
      try {
        clearFrame();
        if (!failure) {
          const summary = values.length ? `Selected: ${choices.filter(choice => selected.has(choice.value)).map(choice => choice.label).join(', ')}` : 'Git and terminal only.';
          output.write(`${wrapText(summary, width())}\n`);
        }
      } catch (error) { failure ||= error; }
      cleanup();
      if (failure) reject(failure); else resolve(values);
    };
    const toggleAll = () => {
      if (selected.size === choices.length) selected.clear();
      else for (const choice of choices) selected.add(choice.value);
    };
    const key = name => {
      if (finished) return;
      if (name === 'cancel') { finish(cancelled()); return; }
      if (name === 'enter') { finish(); return; }
      if (name === 'up') focus = (focus - 1 + rows.length) % rows.length;
      else if (name === 'down') focus = (focus + 1) % rows.length;
      else if (name === 'home') focus = 0;
      else if (name === 'end') focus = rows.length - 1;
      else if (name === 'all' || (name === 'space' && focus === 0)) toggleAll();
      else if (name === 'space') {
        const value = choices[focus - 1].value;
        if (selected.has(value)) selected.delete(value); else selected.add(value);
      } else return;
      render();
    };
    const parse = () => {
      clearTimeout(escapeTimer);
      while (pending && !finished) {
        if (pending[0] === '\x1b') {
          const complete = [...NAVIGATION].find(([sequence]) => pending.startsWith(sequence));
          if (complete) { pending = pending.slice(complete[0].length); key(complete[1]); continue; }
          if ([...NAVIGATION.keys()].some(sequence => sequence.startsWith(pending))) {
            escapeTimer = setTimeout(() => { pending = ''; key('cancel'); }, escapeTimeoutMs);
            return;
          }
          // Ignore complete unrecognized CSI keys, such as Delete or PageDown.
          const other = /^\x1b\[[0-?]*[ -/]*[@-~]/.exec(pending);
          if (other) { pending = pending.slice(other[0].length); continue; }
          key('cancel'); return;
        }
        const character = pending[0]; pending = pending.slice(1);
        if (character === '\x03' || character === '\x04') key('cancel');
        else if (character === '\r' || character === '\n') key('enter');
        else if (character === ' ') key('space');
        else if (character === 'a' || character === 'A') key('all');
      }
    };
    const onData = chunk => { try { pending += typeof chunk === 'string' ? chunk : decoder.write(chunk); parse(); } catch (error) { finish(error); } };
    const onEnd = () => finish(cancelled());
    const onError = error => finish(error);
    const onInterrupt = () => finish(cancelled());
    const onResize = () => { try { render(); } catch (error) { finish(error); } };
    try {
      if (title) output.write(`${wrapText(style.strong(title), width())}\n`);
      if (description) output.write(`${wrapText(description, width())}\n`);
      output.write('\n\x1b[?25l'); cursorHidden = true;
      input.setRawMode(true); rawChanged = true;
      input.on('data', onData); input.on('end', onEnd); input.on('close', onEnd); input.on('error', onError);
      output.on('resize', onResize); signalSource.on('SIGINT', onInterrupt);
      render(); input.resume();
    } catch (error) { finish(error); }
  });
}
