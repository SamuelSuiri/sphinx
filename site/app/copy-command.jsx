'use client';

import { useState } from 'react';

export default function CopyCommand({ command }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <div className="command">
      <code><span className="prompt">$</span> {command}</code>
      <button type="button" onClick={copy} aria-label="Copy install command">{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}
