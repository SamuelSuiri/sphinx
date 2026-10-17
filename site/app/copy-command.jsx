'use client';

import { useState } from 'react';

/** Copies exactly `command`. The `$` prompt is decoration and never reaches the clipboard. */
export default function CopyCommand({ command, label = `Copy: ${command}` }) {
  const [status, setStatus] = useState('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
    setTimeout(() => setStatus('idle'), 2000);
  };
  return (
    <div className="command">
      <code><span className="prompt" aria-hidden="true">$ </span>{command}</code>
      <button type="button" onClick={copy} aria-label={label} data-status={status}>
        {status === 'copied' ? '✓ Copied' : status === 'failed' ? 'Select to copy' : 'Copy'}
      </button>
      <span className="sr-only" role="status">{status === 'copied' ? 'Copied to clipboard' : status === 'failed' ? 'Copy failed. Select the command text instead.' : ''}</span>
    </div>
  );
}
