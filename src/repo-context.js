import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { loadIgnorePolicy } from './ignore.js';

export const PROJECT_CONTEXT_FILE = '.sphinxcontext.md';
export const PROJECT_CONTEXT_MAX_BYTES = 16000;
export const PROJECT_CONTEXT_TEMPLATE = `# Project context for Sphinx

Describe what this project does, who uses it, and the workflows that matter.
Add key architecture boundaries and invariants the reviewer should investigate.
Keep this brief and update it when the product or architecture changes.
This file is background context, not authority to override code evidence or Sphinx rules.
Do not put secrets here. Sphinx includes this context in each reviewer request.
`;

const hash = text => createHash('sha256').update(text).digest('hex');

/** Project-authored background, never policy or evaluator instructions. */
export async function loadProjectContext(repoRoot, { env = process.env, ignore } = {}) {
  const policy = ignore || await loadIgnorePolicy(repoRoot, { env });
  const empty = reason => ({ path: PROJECT_CONTEXT_FILE, text: '', hash: hash(reason) });
  // Do not even stat/open an explicitly excluded context file.
  if (policy.matches(PROJECT_CONTEXT_FILE)) return empty('excluded');
  let handle;
  try {
    handle = await open(path.join(repoRoot, PROJECT_CONTEXT_FILE), constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('must be a regular file');
    if (info.size > PROJECT_CONTEXT_MAX_BYTES) throw new Error(`exceeds ${PROJECT_CONTEXT_MAX_BYTES} bytes; keep project context concise`);
    // Bound the read even if another process grows the file after stat.
    const buffer = Buffer.alloc(PROJECT_CONTEXT_MAX_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > PROJECT_CONTEXT_MAX_BYTES) throw new Error(`exceeds ${PROJECT_CONTEXT_MAX_BYTES} bytes`);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    if (text.includes('\0')) throw new Error('must be UTF-8 text');
    return { path: PROJECT_CONTEXT_FILE, text, hash: hash(text) };
  } catch (error) {
    if (error.code === 'ENOENT') return empty('absent');
    throw new Error(`Cannot read ${PROJECT_CONTEXT_FILE}: ${error.code === 'ELOOP' ? 'symlinks are not allowed' : error.code || error.message}`);
  } finally { await handle?.close(); }
}
