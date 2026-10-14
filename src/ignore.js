import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { getPaths } from './config.js';

// Always excluded before retrieving a patch or blob. User negations cannot undo these.
export const BUILTIN_IGNORES = Object.freeze([
  '.env', '.env.*', '*.pem', '*.key', '*.p12', '*.pfx', '*.jks', '*.keystore',
  'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', '.netrc', '.npmrc', '.pypirc',
  'credentials.json', '*credentials*.json', 'service-account*.json', 'service_account*.json',
  'secrets.json', 'secrets.yml', 'secrets.yaml', '**/.aws/credentials', '.secrets/',
]);

function globSource(pattern) {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        while (pattern[i + 1] === '*') i++;
        if (pattern[i + 1] === '/') { source += '(?:.*/)?'; i++; }
        else source += '.*';
      } else source += '[^/]*';
    } else if (char === '?') source += '[^/]';
    else source += char.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }
  return source;
}

function compileRule(line) {
  let value = line.trimEnd();
  if (!value || value.startsWith('#')) return null;
  let negate = false;
  if (value.startsWith('!')) { negate = true; value = value.slice(1); }
  if (value.startsWith('\\#') || value.startsWith('\\!')) value = value.slice(1);
  if (!value) return null;
  const anchored = value.startsWith('/');
  const directory = value.endsWith('/');
  value = value.replace(/^\//, '').replace(/\/$/, '');
  const root = anchored || value.includes('/');
  const prefix = root ? '^' : '(?:^|/)';
  const suffix = directory ? '/.*$' : '(?:/.*)?$';
  return { negate, regex: new RegExp(`${prefix}${globSource(value)}${suffix}`, 'u') };
}

export function compileIgnore(patterns, builtins = BUILTIN_IGNORES) {
  const hardRules = builtins.map(compileRule).filter(Boolean);
  const rules = patterns.map(compileRule).filter(Boolean);
  return file => {
    if (hardRules.some(rule => rule.regex.test(file))) return true;
    let ignored = false;
    for (const rule of rules) if (rule.regex.test(file)) ignored = !rule.negate;
    return ignored;
  };
}

async function optionalFile(path) {
  let handle;
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Ignore policy must be a regular file, not a symlink: ${path}`);
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    if (!(await handle.stat()).isFile()) throw new Error(`Ignore policy must be a regular file: ${path}`);
    const buffer = Buffer.alloc(128 * 1024 + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length === buffer.length) throw new Error(`Ignore policy exceeds 128 KiB: ${path}`);
    return buffer.subarray(0, length).toString('utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    if (error.code === 'ELOOP') throw new Error(`Ignore policy must not be a symlink: ${path}`);
    throw error;
  } finally { await handle?.close(); }
}

/** Repository negations cannot override the user's global privacy policy or config exclusions. */
export async function loadIgnorePolicy(repoRoot, { env = process.env, exclude = [] } = {}) {
  const [global, local] = await Promise.all([
    optionalFile(join(getPaths(env).home, 'ignore')),
    optionalFile(join(repoRoot, '.sphinxignore')),
  ]);
  const globalPatterns = global.split(/\r?\n/);
  const localPatterns = local.split(/\r?\n/);
  const globalPolicy = compileIgnore(globalPatterns, []);
  const configPolicy = compileIgnore(exclude.filter(pattern => !pattern.startsWith('!')), []);
  const localPolicy = compileIgnore(localPatterns);
  const hash = createHash('sha256').update(JSON.stringify({ version: 2, builtins: BUILTIN_IGNORES, globalPatterns, exclude, localPatterns })).digest('hex');
  return { matches: file => globalPolicy(file) || configPolicy(file) || localPolicy(file), hash };
}
