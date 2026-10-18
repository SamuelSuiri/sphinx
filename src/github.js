import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPaths, readJson, writeJson } from './config.js';

// After Git continues, a detached worker marks the pushed commit on GitHub with
// a `sphinx/understanding` commit status and, if the user opts in, keeps one
// summary comment on the branch's open pull request. All of it is best-effort:
// no GitHub remote, no gh CLI, no login, or any API error just means no stamp.
export const STATUS_CONTEXT = 'sphinx/understanding';
export const COMMENT_MARKER = '<!-- sphinx-understanding -->';
const RECORDS_KEPT = 20;
const WORKER = fileURLToPath(new URL('./github-worker.js', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');
const githubDirectory = env => path.join(getPaths(env).home, 'github');
const branchFile = (repoRoot, ref, env) => path.join(githubDirectory(env), 'branches', `${digest(`${repoRoot}\0${ref}`)}.json`);

/** owner/repo on a GitHub host from an https, ssh, or scp-style remote URL. */
export function githubRepository(url) {
  const match = /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[^@/\s]+@)([^/:\s]+)(?::\d+)?[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(String(url || '').trim());
  if (!match || !/(^|\.)github\.com$|^github\./.test(match[1])) return null;
  return { host: match[1], owner: match[2], repo: match[3] };
}

/** What one check means for the stamp. Never includes private answer keys. */
export function checkRecord({ session, snapshot, outcome, includeAnswers = false, at = new Date().toISOString() }) {
  const questions = [];
  const attempts = session?.attempts || [];
  // Attempts carry their question slot from 0.1.8; older records only know the final prompts.
  const tracked = attempts.length && attempts.every(item => Number.isInteger(item.index));
  for (const [index, question] of (session?.questions || []).entries()) {
    // Matches the understanding score: disputes and ambiguous grades don't count; asking for an explanation is a miss.
    const graded = tracked ? attempts.filter(item => item.index === index && item.kind !== 'dispute' && item.verdict !== 'ambiguous') : [];
    const first = attempts.find(item => tracked && item.index === index);
    questions.push({
      prompt: first?.prompt || question.prompt,
      ...(tracked ? { tries: graded.length, firstTry: graded[0]?.kind === 'answer' && graded[0]?.verdict === 'correct' } : {}),
      ...(includeAnswers && tracked ? { answers: attempts.filter(item => item.index === index).map(item => ({ kind: item.kind, prompt: item.prompt, answer: item.answer, verdict: item.verdict })) } : {}),
    });
  }
  return {
    at, outcome, head: snapshot.head, base: snapshot.base, ref: snapshot.target.ref,
    stats: snapshot.stats, level: session?.config?.level ?? null, distance: session?.config?.distance ?? null,
    model: session?.route ? [session.route.provider, session.route.model].filter(Boolean).join(' ') : null,
    noQuestionReason: session?.noQuestionReason || null, questions,
  };
}

export function statusFor(record) {
  if (record.outcome === 'skipped') return { state: 'failure', description: 'Understanding check skipped' };
  const asked = record.questions.length;
  if (!asked) return { state: 'success', description: 'Passed without questions' };
  const first = record.questions.filter(item => item.firstTry).length;
  const known = record.questions.every(item => typeof item.firstTry === 'boolean');
  return { state: 'success', description: `Understood: ${asked} question${asked === 1 ? '' : 's'}${known ? `, ${first} first try` : ''}` };
}

const quote = text => String(text).trim().split('\n').map(line => `> ${line}`).join('\n');
const short = sha => String(sha || '').slice(0, 7);

/** One PR comment covering every check recorded for the branch, newest first. */
export function commentBody(records) {
  const lines = [COMMENT_MARKER, '### Sphinx understanding checks', ''];
  for (const record of [...records].reverse()) {
    const status = statusFor(record);
    const range = record.base ? `${short(record.base)}..${short(record.head)}` : short(record.head);
    lines.push(`<details><summary>${status.state === 'success' ? '✅' : '⚠️'} <code>${range}</code> · ${status.description}${record.model ? ` · ${record.model}` : ''}</summary>`, '');
    if (record.stats) lines.push(`${record.stats.files} files, +${record.stats.additions} −${record.stats.deletions}. Depth ${record.level}, distance ${record.distance}. ${record.at.slice(0, 16).replace('T', ' ')} UTC.`, '');
    if (record.noQuestionReason) lines.push(`No questions: ${record.noQuestionReason}`, '');
    for (const [index, question] of record.questions.entries()) {
      const tries = typeof question.tries === 'number' ? ` _(${question.firstTry ? 'first try' : `${question.tries} tries`})_` : '';
      lines.push(`**Q${index + 1}.**${tries}`, quote(question.prompt), '');
      for (const item of question.answers || []) {
        if (item.prompt && item.prompt !== question.prompt) lines.push(`Follow-up:`, quote(item.prompt), '');
        lines.push(`${item.kind === 'answer' ? `Answer (${item.verdict})` : item.kind === 'dispute' ? 'Dispute' : 'Asked for an explanation'}:`, quote(item.answer || '(empty)'), '');
      }
    }
    lines.push('</details>', '');
  }
  lines.push('<sub>Recorded by <a href="https://github.com/parthh01/sphinx">Sphinx</a> on the pusher\'s machine. Self-reported, not a cryptographic attestation.</sub>');
  return lines.join('\n');
}

/**
 * Record the check and hand GitHub work to a detached worker so Git never
 * waits on the network. Never throws.
 */
export async function scheduleStamp({ snapshot, session, outcome, config, env = process.env, spawnImpl = spawn }) {
  try {
    const settings = config.github || {};
    if (snapshot.event !== 'pre-push' || (!settings.status && !settings.comment)) return false;
    const repo = githubRepository(snapshot.target.url);
    if (!repo) return false;
    const file = branchFile(snapshot.repoRoot, snapshot.target.ref, env);
    const stored = await readJson(file, null).catch(() => null);
    const record = checkRecord({ session, snapshot, outcome, includeAnswers: !!settings.answers });
    const records = [...(Array.isArray(stored?.records) ? stored.records : []).filter(item => item.head !== record.head), record].slice(-RECORDS_KEPT);
    await writeJson(file, { version: 1, repoRoot: snapshot.repoRoot, ref: snapshot.target.ref, records });
    const job = path.join(githubDirectory(env), 'jobs', `${randomUUID()}.json`);
    await writeJson(job, { version: 1, repo, sha: snapshot.head, branch: snapshot.target.ref.replace(/^refs\/heads\//, ''), branchFile: file, status: !!settings.status, comment: !!settings.comment });
    const child = spawnImpl(process.execPath, [WORKER, job], { env, detached: true, stdio: 'ignore' });
    await new Promise((resolve, reject) => { child.once('error', reject); child.once('spawn', resolve); });
    child.unref();
    return true;
  } catch { return false; }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** gh with an optional JSON body on stdin. Resolves { ok, stdout }; never rejects. */
export function ghCli(args, { env = process.env, host, input, timeoutMs = 30000 } = {}) {
  return new Promise(resolve => {
    let child, stdout = '';
    try { child = spawn('gh', args, { env: { ...env, GH_HOST: host, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'ignore'] }); }
    catch { resolve({ ok: false, stdout: '' }); return; }
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', chunk => { if (stdout.length < 4 * 1024 * 1024) stdout += chunk; });
    child.once('error', () => { clearTimeout(timer); resolve({ ok: false, stdout: '' }); });
    child.once('close', code => { clearTimeout(timer); resolve({ ok: code === 0, stdout }); });
    child.stdin.on('error', () => {});
    child.stdin.end(input === undefined ? '' : JSON.stringify(input));
  });
}

/** The worker body: wait for the push to land, stamp it, then update the PR comment. */
export async function runStampJob(job, { gh = ghCli, env = process.env, wait = sleep, landTries = 36, landEveryMs = 5000, prTries = 30, prEveryMs = 30000 } = {}) {
  const { host, owner, repo } = job.repo;
  const api = (args, input) => gh(['api', ...args, ...(input ? ['--input', '-'] : [])], { env, host, input });
  if (!(await gh(['auth', 'status', '--hostname', host], { env, host })).ok) return 'not-signed-in';
  // The hook runs before Git uploads, so the commit appears on GitHub a little later.
  let landed = false;
  for (let attempt = 0; attempt < landTries && !landed; attempt++) {
    if (attempt) await wait(landEveryMs);
    landed = (await api([`repos/${owner}/${repo}/commits/${job.sha}`, '--jq', '.sha'])).ok;
  }
  if (!landed) return 'not-pushed';
  const records = (await readJson(job.branchFile, null).catch(() => null))?.records || [];
  const record = records.find(item => item.head === job.sha);
  if (!record) return 'no-record';
  const status = statusFor(record);
  const postStatus = targetUrl => api([`repos/${owner}/${repo}/statuses/${job.sha}`, '--method', 'POST'], { state: status.state, context: STATUS_CONTEXT, description: status.description, ...(targetUrl ? { target_url: targetUrl } : {}) });
  if (job.status) await postStatus();
  if (!job.comment) return 'done';

  // A pull request is usually opened right after the first push of a branch.
  let pull = null;
  for (let attempt = 0; attempt < prTries && !pull; attempt++) {
    if (attempt) await wait(prEveryMs);
    const listed = await gh(['pr', 'list', '--repo', `${owner}/${repo}`, '--head', job.branch, '--state', 'open', '--json', 'number', '--limit', '1'], { env, host });
    try { pull = listed.ok ? JSON.parse(listed.stdout || '[]')[0] || null : null; } catch { pull = null; }
  }
  if (!pull) return 'no-pull-request';
  const body = commentBody((await readJson(job.branchFile, null).catch(() => null))?.records || records);
  const existing = await api([`repos/${owner}/${repo}/issues/${pull.number}/comments`, '--paginate', '--jq', `.[] | select(.body | startswith("${COMMENT_MARKER}")) | .id`]);
  const id = existing.ok ? existing.stdout.split('\n').find(Boolean) : null;
  const written = id
    ? await api([`repos/${owner}/${repo}/issues/comments/${id}`, '--method', 'PATCH', '--jq', '.html_url'], { body })
    : await api([`repos/${owner}/${repo}/issues/${pull.number}/comments`, '--method', 'POST', '--jq', '.html_url'], { body });
  if (written.ok && job.status) await postStatus(written.stdout.trim());
  return written.ok ? 'done' : 'comment-failed';
}

export async function runStampWorker(jobFile, { env = process.env } = {}) {
  let result = 'failed';
  try {
    const job = await readJson(jobFile, null);
    if (job) result = await runStampJob(job, { env });
  } catch { /* Best-effort only. */ }
  finally { await unlink(jobFile).catch(() => {}); }
  await writeJson(path.join(githubDirectory(env), 'last.json'), { result, at: new Date().toISOString() }).catch(() => {});
  return result;
}
