import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_CONFIG, writeJson } from '../src/config.js';
import { createSessionStore, sessionFile } from '../src/sessions.js';

const q={id:'retry',concept:'idempotency',prompt:'Can a repeated request duplicate the operation? Give the cause.',choices:['Yes','No'],expectedAnswer:'Yes: no deduplication.',rationale:'The insert happens on every call.',evidence:[{path:'src/order.js',reason:'An unconditional insert.'}]};
const snapshot={id:'a'.repeat(64),repoRoot:'/test/repo',repoId:'r',event:'pre-push',target:{ref:'refs/heads/main'},files:['src/order.js'],evidence:'insert()',stats:{additions:10,deletions:1,files:1}};
async function fixture(t, extra={}) {
  const home=await mkdtemp(path.join(tmpdir(),'sphinx-sessions-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const env={SPHINX_HOME:home};
  const config=structuredClone(DEFAULT_CONFIG);
  const store=createSessionStore({env,generate:async()=>({questions:[structuredClone(q)]}),grade:async()=>({verdict:'correct',feedback:'Correct: the repeated insert can duplicate it.',followUp:null}),...extra});
  return {store,env,config};
}

test('pending is free, approval is reusable and public output never contains the answer key',async t=>{
  let calls=0;
  const {store,env,config}=await fixture(t,{generate:async()=>{calls++;return{questions:[q]};}});
  await store.ensure(snapshot,config);
  assert.equal(calls,0);
  assert.equal(await store.approved(snapshot,config),false);
  const state=await store.start(snapshot.id,config);
  assert.equal(calls,1);
  assert.equal(JSON.stringify(state).includes('expectedAnswer'),false);
  assert.equal(JSON.stringify(state).includes(q.rationale),false);
  await store.start(snapshot.id,config);
  assert.equal(calls,1);
  assert.equal((await store.answer(snapshot.id,'Yes: it inserts every time.',config)).status,'passed');
  assert.equal(await store.approved(snapshot,config),true);
  assert.equal((await store.start(snapshot.id,config)).status,'passed');
  assert.equal(calls,1);
  assert.equal((await stat(sessionFile(snapshot.id,env))).mode & 0o777,0o600);
  assert.equal(await store.approved({...snapshot,id:'b'.repeat(64)},config),false);
});

test('a misconception produces a new scenario and only a later correct answer completes the concept',async t=>{
  let attempt=0;
  const followUp={...q,id:'timeout',prompt:'The connection drops after insertion. Can retry insert again? Why?'};
  const {store,config}=await fixture(t,{grade:async()=>++attempt===1?{verdict:'incorrect',feedback:'There is no key to deduplicate.',followUp}:{verdict:'correct',feedback:'That accounts for the retry.',followUp:null}});
  await store.ensure(snapshot,config);await store.start(snapshot.id,config);
  const missed=await store.answer(snapshot.id,'No.',config);
  assert.equal(missed.status,'active');assert.equal(missed.progress.completed,0);assert.equal(missed.question.id,'timeout');
  assert.equal((await store.answer(snapshot.id,'Yes, both attempts insert.',config)).status,'passed');
});

test('ambiguous grading does not produce a receipt',async t=>{
  const {store,config}=await fixture(t,{grade:async()=>({verdict:'ambiguous',feedback:'The schema is missing.',followUp:null})});
  await store.ensure(snapshot,config);await store.start(snapshot.id,config);
  assert.equal((await store.answer(snapshot.id,'There may be a unique index.',config)).status,'active');
  assert.equal(await store.approved(snapshot,config),false);
});

test('learning and dispute requests cannot award a pass',async t=>{
  const {store,config}=await fixture(t);
  await store.ensure(snapshot,config);await store.start(snapshot.id,config);
  await assert.rejects(store.answer(snapshot.id,'Teach me.',config,{learn:true}),/cannot complete/);
  await assert.rejects(store.answer(snapshot.id,'The premise is wrong.',config,{dispute:true}),/cannot complete/);
  assert.equal(await store.approved(snapshot,config),false);
});

test('failed generation consumes a call and a budget limit prevents further calls',async t=>{
  let calls=0;
  const {store,config}=await fixture(t,{generate:async()=>{calls++;throw new Error('Unavailable');}});
  config.maxModelCalls=1;
  await store.ensure(snapshot,config);
  await assert.rejects(store.start(snapshot.id,config),/Unavailable/);
  await assert.rejects(store.start(snapshot.id,config),/call limit/);
  assert.equal(calls,1);assert.equal(await store.approved(snapshot,config),false);
});

test('policy changes and expired receipts require a new assessment',async t=>{
  const {store,env,config}=await fixture(t);
  await store.ensure(snapshot,config);await store.start(snapshot.id,config);await store.answer(snapshot.id,'Yes.',config);
  assert.equal(await store.approved(snapshot,{...config,level:'thorough'}),false);
  const record=await store.read(snapshot.id);record.expiresAt='2000-01-01T00:00:00.000Z';
  await writeJson(sessionFile(snapshot.id,env),record);
  assert.equal(await store.approved(snapshot,config),false);
  assert.equal((await store.ensure(snapshot,config)).status,'pending');
});

test('stale snapshots fail before generation and again before recording completion',async t=>{
  let checks=0;
  const {store,config}=await fixture(t,{validate:async()=>{checks++;if(checks===3)throw new Error('Changed');}});
  await store.ensure(snapshot,config);await store.start(snapshot.id,config);
  await assert.rejects(store.answer(snapshot.id,'Yes.',config),/Changed/);
  assert.equal(await store.approved(snapshot,config),false);
});

test('parallel operations share an exclusive session lock',async t=>{
  let unblock, entered;
  const ready=new Promise(r=>{entered=r;});
  const held=new Promise(r=>{unblock=r;});
  const {store,config}=await fixture(t,{generate:async()=>{entered();await held;return{questions:[q]};}});
  await store.ensure(snapshot,config);
  const first=store.start(snapshot.id,config);await ready;
  await assert.rejects(store.start(snapshot.id,config),/already running/);
  unblock();await first;
});

test('session IDs cannot escape the state directory',()=>{
  assert.throws(()=>sessionFile('../../credentials'),/Invalid assessment/);
});

test('question identity is checked under the lock before a stale answer consumes a call',async t=>{
  let grades=0;
  const {store,config}=await fixture(t,{grade:async()=>{grades++;return{verdict:'incorrect',feedback:'Retry.',followUp:{...q,id:'new-scenario',prompt:'Can retrying the job repeat the insert?'}};}});
  await store.ensure(snapshot,config);await store.start(snapshot.id,config);
  await store.answer(snapshot.id,'No.',config,{expectedQuestionId:q.id});
  await assert.rejects(store.answer(snapshot.id,'Stale answer.',config,{expectedQuestionId:q.id}),error=>error.code==='SPHINX_STALE_QUESTION');
  assert.equal(grades,1);assert.equal((await store.read(snapshot.id)).calls,2);
});

test('cancellation during generation or grading never stores completion',async t=>{
  const generation=new AbortController();
  const {store,config}=await fixture(t,{generate:async()=>{generation.abort();return{questions:[q]};}});
  await store.ensure(snapshot,config);
  await assert.rejects(store.start(snapshot.id,config,{signal:generation.signal}),/abort/i);
  assert.equal((await store.read(snapshot.id)).questions.length,0);
  const grading=new AbortController();
  const next=await fixture(t,{grade:async()=>{grading.abort();return{verdict:'correct',feedback:'Correct.',followUp:null};}});
  await next.store.ensure(snapshot,next.config);await next.store.start(snapshot.id,next.config);
  await assert.rejects(next.store.answer(snapshot.id,'Yes.',next.config,{signal:grading.signal}),/abort/i);
  assert.equal(await next.store.approved(snapshot,next.config),false);
});

async function legacyQuestions(store, env, config, { index = 0, current = q } = {}) {
  const session = await store.ensure(snapshot, config);
  session.status = 'active';
  session.questions = [0, 1, 2].map(n => ({ ...q, id: `legacy-${n}`, prompt: `Stored scenario ${n}?` }));
  session.questions[index] = current;
  session.index = index;
  session.calls = 2; // The generation and a failed grading request already cost calls.
  await writeJson(sessionFile(snapshot.id, env), session);
}

test('legacy small checkpoints keep the current question and trim extras without regenerating or passing', async t => {
  const {store,env,config}=await fixture(t, {generate:async()=>{throw new Error('Must not regenerate');}});
  await legacyQuestions(store,env,config);
  const state=await store.start(snapshot.id,config);
  assert.deepEqual(state.progress,{completed:0,total:1});
  assert.deepEqual(state.question,{id:q.id,concept:q.concept,prompt:q.prompt,choices:q.choices});
  assert.equal(state.usage.calls,2);
  assert.equal(state.status,'active');
  assert.equal(await store.approved(snapshot,config),false);
  assert.equal((await store.read(snapshot.id)).questions.length,1);
  const completed=await store.answer(snapshot.id,'Yes, each request inserts.',config);
  assert.equal(completed.status,'passed');
  assert.equal(completed.usage.calls,3);
});

test('legacy migration retains completed work and a current transfer question, even beyond the new ceiling', async t => {
  const current={...q,id:'transfer',prompt:'After a timeout can a new attempt insert again? Explain why.'};
  const {store,env,config}=await fixture(t);
  await legacyQuestions(store,env,config,{index:1,current});
  const state=await store.start(snapshot.id,config);
  assert.deepEqual(state.progress,{completed:1,total:2});
  assert.equal(state.question.id,current.id);
  assert.equal(state.status,'active');
  assert.equal(await store.approved(snapshot,config),false);
  assert.equal((await store.answer(snapshot.id,'Yes, no key prevents a repeated insert.',config)).status,'passed');
});

test('an answer to an already-open legacy check uses the new ceiling and still requires correct grading', async t => {
  let grades=0;
  const current={...q,id:'transfer',prompt:'Does retrying after a lost response repeat the insert? Why?'};
  const {store,env,config}=await fixture(t,{grade:async()=>++grades===1
    ? {verdict:'incorrect',feedback:'Every attempt inserts.',followUp:current}
    : {verdict:'correct',feedback:'Yes, it inserts again.',followUp:null}});
  await legacyQuestions(store,env,config);
  const missed=await store.answer(snapshot.id,'No.',config);
  assert.equal(missed.status,'active');
  assert.deepEqual(missed.progress,{completed:0,total:1});
  assert.equal(missed.question.id,current.id);
  assert.equal((await store.answer(snapshot.id,'Yes, inserts are unconditional.',config)).status,'passed');
});

test('oversized new question sets fail without saving questions or approving the checkpoint', async t => {
  const {store,config}=await fixture(t,{generate:async()=>({questions:[q,{...q,id:'extra'}]})});
  await store.ensure(snapshot,config);
  await assert.rejects(store.start(snapshot.id,config),/exceeded the question limit/);
  const record=await store.read(snapshot.id);
  assert.equal(record.status,'pending');
  assert.equal(record.questions.length,0);
  assert.equal(record.calls,1);
  assert.equal(await store.approved(snapshot,config),false);
});
