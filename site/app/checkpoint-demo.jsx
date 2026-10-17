'use client';

import { useRef, useState } from 'react';
import { change, evidence, files } from './example-change';

const STRIPE = 'https://docs.stripe.com/api/idempotent_requests';
const OUTBOX = 'https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html';

const questions = [
  {
    label: 'Question 1 of 2 · Retries and external side effects',
    text: 'The queue can redeliver a job after a worker crashes. What must this design guarantee so retries do not charge a customer twice, without silently dropping the payment?',
    evidence: ['worker', 'client', 'webhook'],
  },
  {
    label: 'Question 2 of 2 · A lost response',
    text: 'The billing API succeeded, but its response was lost. Should the retry create a new idempotency key?',
    evidence: ['client', 'worker'],
  },
];

// One scripted state at a time. Nothing here grades what a visitor types.
const steps = [
  { question: 0, action: 'Show sample answer' },
  { question: 0, action: 'See the explanation' },
  { question: 0, action: 'Show a stronger answer' },
  { question: 0, action: 'Try the follow-up' },
  { question: 1, action: 'Show sample answer' },
  { question: 1, action: 'Finish the checkpoint' },
  { question: 1 },
];

const fmt = n => n.toLocaleString('en-US');
const name = path => path.split('/').pop();

function Status({ kind, children }) {
  const glyph = { open: '◆', retry: '↺', passed: '✓' }[kind];
  return <span className={`status ${kind}`}><span aria-hidden="true">{glyph} </span>{children}</span>;
}

function SampleAnswer({ children }) {
  return (
    <div className="answer">
      <p className="who">Sample answer <span className="meta">(scripted)</span></p>
      <p>{children}</p>
    </div>
  );
}

function StepBody({ step }) {
  switch (step) {
    case 0:
      return <p className="note">In Sphinx you answer in your own words and an independent reviewer judges it. This preview shows scripted sample answers instead of grading anything you type.</p>;
    case 1:
      return (
        <>
          <SampleAnswer>Record the job as done before calling the billing API, so retries are skipped.</SampleAnswer>
          <Status kind="retry">Needs another answer</Status>
        </>
      );
    case 2:
      return (
        <>
          <Status kind="retry">Needs another answer</Status>
          <div className="explain">
            <p className="who">Explanation</p>
            <p>That prevents a repeated attempt, but a crash before the API call can lose the payment. Recording completion afterward leaves the opposite gap: the API may succeed before the worker records it, so a retry can repeat the charge. A local flag alone cannot make the external side effect atomic.</p>
          </div>
        </>
      );
    case 3:
      return (
        <>
          <SampleAnswer>Persist the payment intent and use the same operation ID as an idempotency key on every retry, with a billing API that honors it. Record the confirmed outcome durably. The queue may redeliver; the external payment must not be applied again.</SampleAnswer>
          <Status kind="passed">Passed</Status>
          <details className="deeper">
            <summary>Deeper note: where a transactional outbox fits</summary>
            <p>At-least-once delivery does not give exactly-once external effects. If enqueueing a job must happen together with a database write, a <a href={OUTBOX}>transactional outbox</a> closes that dual-write gap. It does not deduplicate the billing call; the provider’s <a href={STRIPE}>idempotency key</a> does that.</p>
          </details>
        </>
      );
    case 4:
      return <p className="note">A new scenario that applies the same idea. Sphinx asks follow-ups like this to check understanding transfers, not just recall.</p>;
    case 5:
      return (
        <>
          <SampleAnswer>No. Reuse the key for that same payment and recover its result. A new key represents a new operation and can charge again.</SampleAnswer>
          <Status kind="passed">Passed</Status>
          <div className="explain">
            <p className="who">Explanation</p>
            <p>A timeout or lost response does not mean the provider failed; the outcome is unknown until you look it up. Retries must stay within the provider’s idempotency contract, which can expire keys; older or ambiguous attempts need reconciliation against the provider’s records.</p>
          </div>
        </>
      );
    default:
      return (
        <div className="finish">
          <p className="finish-title"><Status kind="passed">Checkpoint passed</Status></p>
          <pre className="terminal"><code>
            <span className="dim">Sphinx: understanding check complete. Continuing this Git operation.</span>{'\n'}
            {'To github.com:example/billing-service.git\n   4f1c2a9..8be03d1  main -> main'}
          </code></pre>
          <p className="note">Git operation continued. Both states are scripted for this example. Passing shows you could explain these consequences; it does not prove the design is safe or that every changed line was understood.</p>
        </div>
      );
  }
}

const excerptCount = files.filter(f => f.hunks.length).length;

function DiffView({ file, highlight }) {
  if (!file.hunks.length) {
    return (
      <div className="diff-empty">
        <p>This file is part of the {change.files}-file change, but its diff is not included in this excerpt. The excerpt bundles only the {excerptCount} files this example’s questions refer to.</p>
      </div>
    );
  }
  return (
    <div className="diff">
      {file.hunks.map(h => (
        <div key={h.id} id={`hunk-${h.id}`} className="hunk">
          <p className="hunk-head">{h.header}</p>
          <table>
            <tbody>
              {h.rows.map((row, i) => {
                const lit = highlight && highlight.hunk === h.id && row.new !== null && row.new >= highlight.from && row.new <= highlight.to;
                const kind = row.kind === '+' ? 'add' : row.kind === '-' ? 'del' : 'ctx';
                return (
                  <tr key={i} className={`${kind}${lit ? ' lit' : ''}`}>
                    <td className="ln">{row.old ?? ''}</td>
                    <td className="ln">{row.new ?? ''}</td>
                    <td className="sign" aria-label={kind === 'add' ? 'added' : kind === 'del' ? 'removed' : undefined}>{row.kind === ' ' ? '' : row.kind === '-' ? '−' : '+'}</td>
                    <td className="code">{row.text}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export function FocusLink({ target, className, children }) {
  return (
    <a
      className={className}
      href={`#${target}`}
      onClick={event => {
        const el = document.getElementById(target);
        if (!el) return;
        event.preventDefault();
        el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
        el.focus({ preventScroll: true });
        history.replaceState(null, '', `#${target}`);
      }}
    >
      {children}
    </a>
  );
}

export default function CheckpointDemo() {
  const [step, setStep] = useState(0);
  const [scope, setScope] = useState('relevant');
  const [selected, setSelected] = useState(evidence.worker.path);
  const [highlight, setHighlight] = useState(evidence.worker);
  const [view, setView] = useState('diff');
  const diffRef = useRef(null);

  const q = questions[steps[step].question];
  const file = files.find(f => f.path === selected);
  // "Relevant" follows the current question's evidence, not the whole excerpt.
  const relevantPaths = new Set(q.evidence.map(key => evidence[key].path));
  const relevantCount = relevantPaths.size;
  const shown = scope === 'relevant' ? files.filter(f => relevantPaths.has(f.path)) : files;
  const outside = !relevantPaths.has(file.path);

  const goTo = next => {
    const nextQ = questions[steps[next].question];
    // Entering a new question re-anchors the diff on its evidence if the open file is not part of it.
    if (nextQ !== q && !nextQ.evidence.some(key => evidence[key].path === selected)) {
      const ref = evidence[nextQ.evidence[0]];
      setSelected(ref.path);
      setHighlight(ref);
    } else if (nextQ !== q && highlight && !nextQ.evidence.some(key => evidence[key] === highlight)) {
      setHighlight(null);
    }
    setStep(next);
  };

  const openFile = path => {
    setSelected(path);
    setHighlight(Object.values(evidence).find(e => e.path === path) ?? null);
    setView('diff');
  };
  const openEvidence = key => {
    const ref = evidence[key];
    setSelected(ref.path);
    setHighlight(ref);
    setView('diff');
    requestAnimationFrame(() => {
      document.getElementById(`hunk-${ref.hunk}`)?.scrollIntoView({ block: 'nearest' });
      diffRef.current?.focus({ preventScroll: true });
    });
  };

  return (
    <div className="workspace" data-view={view}>
      <div className="ws-bar">
        <p className="ws-scope">
          <span className="ws-kicker">Example change</span>
          <span><strong>{change.files}</strong> files changed</span>
          <span className="add">+{fmt(change.additions)}</span>
          <span className="del">−{fmt(change.deletions)}</span>
        </p>
        <p className="ws-title">{change.title}</p>
        <p className="ws-badge">Product preview · synthetic data · excerpt shown</p>
      </div>

      <div className="ws-tabs" role="group" aria-label="Show">
        <button type="button" aria-pressed={view === 'files'} onClick={() => setView('files')}>Files</button>
        <button type="button" aria-pressed={view === 'diff'} onClick={() => setView('diff')}>Diff</button>
      </div>

      <nav className="ws-files" aria-label="Changed files">
        <div className="scope-toggle" role="group" aria-label="File scope">
          <button type="button" aria-pressed={scope === 'relevant'} onClick={() => setScope('relevant')}>Relevant to this question <span className="count">{relevantCount}</span></button>
          <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>All changed files <span className="count">{change.files}</span></button>
        </div>
        <ul>
          {shown.map(f => (
            <li key={f.path}>
              <button type="button" className="file-row" aria-current={f.path === selected ? 'true' : undefined} onClick={() => openFile(f.path)}>
                <span className="path" title={f.path}>{relevantPaths.has(f.path) && <span className="rel" aria-label="relevant to this question">◆ </span>}{f.path}</span>
                <span className="stat"><span className="add">+{fmt(f.additions)}</span> <span className="del">−{fmt(f.deletions)}</span></span>
              </button>
            </li>
          ))}
        </ul>
        <p className="files-note">◆ marks files this question’s evidence cites. Diffs for {excerptCount} files are in this excerpt; other files list their size only.</p>
      </nav>

      <section className="ws-diff" aria-label={`Diff: ${file.path}`} tabIndex={-1} ref={diffRef}>
        <div className="diff-title">
          <span className="path" title={file.path}>{file.path}{file.added && <span className="new-tag"> new file</span>}</span>
          <span className="stat"><span className="add">+{fmt(file.additions)}</span> <span className="del">−{fmt(file.deletions)}</span></span>
        </div>
        {file.role && <p className="diff-role">{file.role}</p>}
        {outside && <p className="diff-outside">Browsing a file outside this question’s evidence.</p>}
        <DiffView file={file} highlight={highlight} />
      </section>

      <section className="ws-question" aria-labelledby="demo-question-label">
        <p id="demo-question-label" className="q-label">{q.label}</p>
        <p className="q-scope">{relevantCount} relevant files · out of {change.files} changed</p>
        <p className="q-text">{q.text}</p>
        <div className="evidence">
          <p className="who">Evidence in this change</p>
          <ul>
            {q.evidence.map(key => {
              const ref = evidence[key];
              const active = highlight === ref;
              return (
                <li key={key}>
                  <button type="button" className="ref" aria-pressed={active} onClick={() => openEvidence(key)}>
                    <span className="ref-path">{name(ref.path)} · L{ref.from}–{ref.to}</span>
                    <span className="ref-note">{ref.note}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="step-body" aria-live="polite">
          <StepBody step={step} />
        </div>
        <div className="step-actions">
          {steps[step].action
            ? <button type="button" className="button primary" onClick={() => goTo(step + 1)}>{steps[step].action}</button>
            : <button type="button" className="button primary" onClick={() => goTo(0)}>Restart</button>}
          <button type="button" className="button quiet" disabled={step === 0} onClick={() => goTo(step - 1)}>Back</button>
          {steps[step].action && step > 0 && <button type="button" className="button quiet" onClick={() => goTo(0)}>Restart</button>}
          <span className="step-count">Step {step + 1} of {steps.length}</span>
        </div>
      </section>
    </div>
  );
}
