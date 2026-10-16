import path from 'node:path';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { getPaths, readJson, writeJson } from './config.js';

// Urgent overrides are a deliberate human escape hatch. They never create a
// completion receipt: the skipped check stays pending so it can be revisited.
const files = env => {
  const { home } = getPaths(env);
  return { state: path.join(home, 'yolo.json'), log: path.join(home, 'overrides.jsonl') };
};
const reasonText = reason => typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : undefined;

async function readState(env) {
  const state = await readJson(files(env).state, null);
  return state && typeof state === 'object' && !Array.isArray(state)
    ? { global: state.global ?? null, repos: state.repos && typeof state.repos === 'object' ? state.repos : {} }
    : { global: null, repos: {} };
}

/** The active yolo entry for a repository: its own toggle first, then the global one. */
export async function yoloStatus(repoRoot, env = process.env) {
  const state = await readState(env);
  if (repoRoot && state.repos[repoRoot]) return { scope: 'repo', repoRoot, ...state.repos[repoRoot] };
  if (state.global) return { scope: 'global', ...state.global };
  return null;
}

/** Toggle yolo for one repository, or globally when repoRoot is null. */
export async function toggleYolo({ repoRoot = null, reason, env = process.env, now = () => new Date() } = {}) {
  const state = await readState(env);
  const current = repoRoot ? state.repos[repoRoot] : state.global;
  const entry = current ? null : { since: now().toISOString(), ...(reasonText(reason) ? { reason: reasonText(reason) } : {}) };
  if (repoRoot) {
    if (entry) state.repos[repoRoot] = entry; else delete state.repos[repoRoot];
  } else state.global = entry;
  await writeJson(files(env).state, state);
  await recordOverride({ kind: entry ? 'yolo-on' : 'yolo-off', repoRoot, reason }, env, now);
  return { scope: repoRoot ? 'repo' : 'global', repoRoot, enabled: Boolean(entry), ...(entry || {}) };
}

export async function recordOverride({ kind, repoRoot = null, target, id, head, reason }, env = process.env, now = () => new Date()) {
  const { log } = files(env);
  await mkdir(path.dirname(log), { recursive: true, mode: 0o700 });
  const entry = { at: now().toISOString(), kind, ...(repoRoot ? { repoRoot } : {}), ...(target ? { target } : {}), ...(id ? { id } : {}), ...(head ? { head } : {}), ...(reasonText(reason) ? { reason: reasonText(reason) } : {}) };
  await appendFile(log, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  return entry;
}

/** Most recent override records first; malformed lines are ignored. */
export async function recentOverrides({ repoRoot, limit = 5, env = process.env } = {}) {
  const text = await readFile(files(env).log, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
  const rows = [];
  for (const line of text.split('\n')) {
    try { const row = JSON.parse(line); if (row && typeof row.kind === 'string' && (!repoRoot || !row.repoRoot || row.repoRoot === repoRoot)) rows.push(row); } catch {}
  }
  return rows.reverse().slice(0, limit);
}
