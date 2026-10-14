import path from 'node:path';
import { mkdir, open, readdir, stat, unlink } from 'node:fs/promises';
import { getPaths, readJson, writeJson, policyHash } from './config.js';
import { selectRoute, evaluatorConfig, questionLimit } from './routing.js';
import { generateAssessment, gradeAnswer } from './evaluator.js';
import { setTimeout as delay } from 'node:timers/promises';

const now = () => new Date().toISOString();
export function sessionFile(id, env = process.env) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid assessment ID. Run sphinx pending to find it.');
  return path.join(getPaths(env).sessions, `${id}.json`);
}
async function withLock(id, env, operation, { signal, deadline = 0 } = {}) {
  signal?.throwIfAborted();
  const file = `${sessionFile(id, env)}.lock`;
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  let handle;
  try { handle = await open(file, 'wx', 0o600); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    // Another process may have created its lock but not yet written the PID.
    const lock = await readJson(file, {}).catch(() => ({}));
    // A process can die after exclusive creation but before writing its PID.
    // Leave new partial locks alone; recover old orphaned ones on explicit retry.
    let alive = await stat(file).then(info => Date.now() - info.mtimeMs < 30000).catch(error => { if (error.code === 'ENOENT') return false; throw error; });
    if (Number.isInteger(lock.pid) && lock.pid > 0) {
      try { process.kill(lock.pid, 0); alive = true; } catch (err) { alive = err.code !== 'ESRCH'; }
    }
    if (alive) {
      if (deadline > Date.now()) {
        await delay(Math.min(200, deadline - Date.now()), undefined, { signal });
        return withLock(id, env, operation, { signal, deadline });
      }
      throw new Error('This assessment is already running. Wait for preparation to finish, then resume the check.');
    }
    await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    return withLock(id, env, operation, { signal, deadline });
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: now() }));
    return await operation();
  } finally { await handle.close(); await unlink(file).catch(() => {}); }
}
function validReceipt(session, config) {
  return session?.status === 'passed' && session.policy === policyHash(config) && Date.parse(session.expiresAt) > Date.now();
}
export function publicSession(session) {
  const q = session.questions[session.index];
  return {
    id: session.id, status: session.status, event: session.snapshot.event,
    target: session.snapshot.target.ref, route: session.route,
    progress: { completed: session.index, total: session.questions.length },
    usage: { calls: session.calls, limit: session.config.maxModelCalls },
    ...(session.preparation ? { preparation: { status: session.preparation.status, ...(session.review ? { toolCalls: session.review.toolCalls, compactions: session.review.compactions } : {}) } } : {}),
    ...(q && session.status !== 'passed' ? { question: { id: q.id, concept: q.concept, prompt: q.prompt, choices: q.choices } } : {}),
    ...(session.lastFeedback ? { feedback: session.lastFeedback } : {}),
    ...(session.status === 'passed' ? { expiresAt: session.expiresAt } : {}),
  };
}

export function createSessionStore({ env = process.env, generate = generateAssessment, grade = gradeAnswer, validate = async () => {} } = {}) {
  const read = id => readJson(sessionFile(id, env));
  const save = session => writeJson(sessionFile(session.id, env), session);
  async function limitPendingQuestions(session, config) {
    if (session.status === 'passed' || !session.questions.length) return;
    // Older checkpoints used depth alone. Keep completed work and the current
    // question (including a learning follow-up), and drop only the unused tail.
    // Never award completion merely because an upgrade lowered the ceiling.
    const limit = Math.max(questionLimit(config.level, session.route.tier), session.index + 1);
    if (session.questions.length <= limit) return;
    session.questions = session.questions.slice(0, limit);
    session.updatedAt = now();
    await save(session);
  }
  async function budget(session) {
    if (session.calls >= session.config.maxModelCalls) throw new Error(`Assessment call limit (${session.config.maxModelCalls}) reached. No additional model request was made. Increase maxModelCalls in your global config if needed and start a new check.`);
    session.calls += 1;
    session.updatedAt = now();
    await save(session); // Failed requests also consume the local attempt budget.
  }
  async function ensure(snapshot, config) {
    const reusable = old => old && old.policy === policyHash(config) && (old.status !== 'passed' || validReceipt(old, config));
    // Hook reads must remain fast while the worker holds the assessment lock.
    const cached = await readJson(sessionFile(snapshot.id, env), null);
    if (reusable(cached)) return cached;
    return withLock(snapshot.id, env, async () => {
      const old = await readJson(sessionFile(snapshot.id, env), null);
      if (reusable(old)) return old;
      const session = {
        version: 2, id: snapshot.id, snapshot, config, policy: policyHash(config),
        route: selectRoute(snapshot,config), status: 'pending', questions: [], index: 0,
        calls: 0, attempts: [], createdAt: now(), updatedAt: now(), expiresAt: null,
      };
      await save(session);
      return session;
    });
  }
  async function approved(snapshot, config) {
    return validReceipt(await readJson(sessionFile(snapshot.id, env), null),config);
  }
  async function prepare(id, config, {signal, wait = false} = {}) {
    return withLock(id,env,async () => {
      signal?.throwIfAborted();
      const session = await read(id);
      if (session.policy !== policyHash(config)) throw new Error('Sphinx settings changed. Retry your push or start a fresh check.');
      await validate(session.snapshot, config);
      signal?.throwIfAborted();
      if (validReceipt(session,config)) return publicSession(session);
      await limitPendingQuestions(session, config);
      signal?.throwIfAborted();
      if (!session.questions.length) {
        const reserve = questionLimit(config.level, session.route.tier);
        const maxReviewerCalls = Math.min(config.agentMaxTurns, session.config.maxModelCalls - session.calls - reserve);
        if (maxReviewerCalls < 1) throw new Error(`Assessment call limit leaves no room for investigation and ${reserve} grading call(s). Increase maxModelCalls in your global config and start a new check.`);
        session.preparation = { status: 'running', startedAt: now() };
        await save(session);
        let requests = 0;
        const beforeCall = async () => {
          signal?.throwIfAborted();
          if (requests >= maxReviewerCalls) throw new Error('Reviewer call limit reached. The check remains pending.');
          await validate(session.snapshot, config);
          await budget(session);
          requests++;
          signal?.throwIfAborted();
        };
        try {
          const result = await generate(session.snapshot,evaluatorConfig(config,session.route),{beforeCall,signal,maxReviewerCalls,env});
          signal?.throwIfAborted();
          if (!Array.isArray(result.questions) || !result.questions.length) throw new Error('Evaluator returned no grounded questions. The check remains pending.');
          if (result.questions.length > reserve) throw new Error('Evaluator exceeded the question limit. The check remains pending.');
          await validate(session.snapshot, config);
          signal?.throwIfAborted();
          session.questions = result.questions;
          if (result.review) session.review = result.review;
          session.status = 'active';
          session.preparation = { status: 'ready', completedAt: now() };
          await save(session);
        } catch (error) {
          session.preparation = { status: 'failed', completedAt: now() };
          await save(session);
          throw error;
        }
      }
      return publicSession(session);
    }, { signal, deadline: wait ? Date.now() + (config.timeoutSeconds + 5) * 1000 : 0 });
  }
  const start = (id, config, options = {}) => prepare(id, config, { ...options, wait: true });
  async function answer(id, text, config, {dispute=false, learn=false, expectedQuestionId, signal} = {}) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('An answer is required.');
    if (text.length > 8000) throw new Error('Please keep your answer below 8,000 characters.');
    return withLock(id,env,async () => {
      signal?.throwIfAborted();
      const session = await read(id);
      if (session.policy !== policyHash(config)) throw new Error('Sphinx settings changed. Start a fresh check.');
      await validate(session.snapshot,config);
      signal?.throwIfAborted();
      if (validReceipt(session,config)) return publicSession(session);
      if (session.status !== 'active') throw new Error('Start this assessment with sphinx check first.');
      await limitPendingQuestions(session, config);
      signal?.throwIfAborted();
      const question = session.questions[session.index];
      if (expectedQuestionId !== undefined && question?.id !== expectedQuestionId) {
        const error = new Error('The question changed while you were answering. Retry the Git operation to reopen the current question.');
        error.code = 'SPHINX_STALE_QUESTION';
        throw error;
      }
      if (session.calls >= session.config.maxModelCalls) throw new Error(`Assessment call limit (${session.config.maxModelCalls}) reached. No additional model request was made.`);
      const beforeCall = async () => { signal?.throwIfAborted(); await budget(session); signal?.throwIfAborted(); };
      const result = await grade({snapshot:session.snapshot,question,answer:text.trim(),config:evaluatorConfig(config,session.route),review:session.review,dispute,beforeCall,signal,env});
      signal?.throwIfAborted();
      if (!['correct','incorrect','ambiguous'].includes(result.verdict)) throw new Error('Evaluator returned an invalid verdict. The check remains pending.');
      if ((learn || dispute) && result.verdict === 'correct') throw new Error('A learning request or dispute cannot complete a concept. The check remains pending.');
      session.attempts.push({questionId:question.id,answer:text.trim(),verdict:result.verdict,feedback:result.feedback,at:now()});
      session.lastFeedback = result.feedback;
      if (result.verdict === 'correct') {
        session.index += 1;
        if (session.index === session.questions.length) {
          await validate(session.snapshot,config);
          signal?.throwIfAborted();
          session.status = 'passed';
          session.expiresAt = new Date(Date.now()+config.receiptHours*3600000).toISOString();
        }
      } else if (result.followUp) {
        if (result.followUp.prompt.trim() === question.prompt.trim()) throw new Error('The evaluator repeated the question. Retry; no concept was marked complete.');
        session.questions[session.index] = result.followUp;
      } else if (result.verdict === 'incorrect' || learn) {
        throw new Error('The evaluator did not provide a transfer question. The concept remains pending.');
      }
      session.updatedAt = now();
      signal?.throwIfAborted();
      await save(session);
      return {...publicSession(session), verdict:result.verdict};
    });
  }
  async function pending(repoRoot) {
    const files = await readdir(getPaths(env).sessions).catch(e => {if(e.code==='ENOENT')return [];throw e;});
    const records = [];
    for (const f of files.filter(f => /^[a-f0-9]{64}\.json$/.test(f))) {
      const session = await readJson(path.join(getPaths(env).sessions,f));
      if (session.snapshot.repoRoot === repoRoot && session.status !== 'passed') records.push(session);
    }
    return records.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  }
  return {ensure,approved,prepare,start,answer,pending,read,public:publicSession};
}
