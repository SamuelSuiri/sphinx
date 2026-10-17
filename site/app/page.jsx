import CopyCommand from './copy-command';

const REPO = 'https://github.com/parthh01/sphinx';
const NPM = 'https://www.npmjs.com/package/sphinx-understand';

const steps = [
  ['You push', 'You, or the coding agent working for you, push to a branch you protect, like main.'],
  ['A reviewer reads the change', 'An independent model reads the diff and the code it touches, without the conversation that wrote it.'],
  ['You answer', 'Questions are about consequences, not trivia. Miss one and you get an explanation plus a new scenario.'],
  ['The push continues', 'Pass, and the same push goes through on its own. Nothing to retry.'],
];

const principles = [
  ['Works with your agent', 'Codex, Claude Code, Cursor, OpenCode, and Pi. One install covers every repository on your machine.'],
  ['Your answers stay yours', 'You answer in a local browser page. The coding agent only learns whether the check passed.'],
  ['Sensitive files are excluded', 'Known credential files like .env, private keys, and .npmrc, plus any path in .sphinxignore, are never opened or sent to a reviewer. Matching is by path, so a secret pasted into ordinary source is not caught.'],
];

const extras = [
  ['Sized to the change', 'small changes get fewer questions; tokens and running cost are shown as the review happens.'],
  ['Skip when urgent', 'skip one check from the page, or run sphinx yolo for a repository. Every skip is logged.'],
  ['Open source', 'MIT licensed, runs locally, no account or hosted service.'],
];

const reviewSteps = ['Reading the diff', 'Opening src/ui/sizes.ts', 'Opening src/cards/actions.tsx', 'Searching for other uses of BUTTON_SM', 'Drafting a question', 'Checking the question against the source'];

function Mark() {
  return <span className="mark" aria-hidden="true">◆</span>;
}

function Chip({ kind, children }) {
  const glyph = { reviewing: '●', waiting: '◆', retry: '↺', passed: '✓' }[kind];
  return <span className={`chip ${kind}`}><span aria-hidden="true">{glyph} </span>{children}</span>;
}

function HeroPreview() {
  return (
    <figure className="hero-preview" aria-labelledby="hero-preview-label">
      <figcaption id="hero-preview-label" className="label">Example · what a checkpoint looks like</figcaption>
      <pre className="terminal small"><code>
        <span className="prompt">$ </span>git push origin main{'\n'}
        <span className="dim">Sphinx: understanding check needed for refs/heads/main (small change).{'\n'}Sphinx: Git is waiting for your answers in the local Sphinx questionnaire.</span>
      </code></pre>
      <div className="card">
        <div className="card-bar"><span>example-app / main</span><Chip kind="waiting">Question 1 of 1</Chip></div>
        <p className="who">Sphinx</p>
        <p className="q">The card actions now use BUTTON_CARD instead of BUTTON_SM. If another screen still renders a small button, does its height change?</p>
        <p className="hint">Answer in your own words. Open-book: inspect the code whenever useful.</p>
      </div>
    </figure>
  );
}

function Example() {
  return (
    <figure className="example" aria-labelledby="example-label">
      <figcaption id="example-label" className="example-head">
        <span className="label">Example · scripted walkthrough, not a live model run</span>
        <span>The real page shows the same conversation, plus tokens and running cost.</span>
      </figcaption>
      <ol className="rail">
        <li>
          <p className="stage">The change</p>
          <pre className="diff"><code>
            <span className="file">src/ui/sizes.ts</span>{'\n'}
            {'  export const BUTTON_SM = 32;\n'}
            <span className="add">{'+ export const BUTTON_CARD = 40;'}</span>{'\n\n'}
            <span className="file">src/cards/actions.tsx</span>{'\n'}
            <span className="del">{'- <Button height={BUTTON_SM}>Save</Button>'}</span>{'\n'}
            <span className="add">{'+ <Button height={BUTTON_CARD}>Save</Button>'}</span>
          </code></pre>
        </li>
        <li>
          <p className="stage">Review</p>
          <details className="activity">
            <summary><Chip kind="reviewing">Reviewed in {reviewSteps.length} steps</Chip><span className="toggle">Show steps</span></summary>
            <ol>{reviewSteps.map(step => <li key={step}>{step}</li>)}</ol>
          </details>
        </li>
        <li>
          <p className="stage">Question</p>
          <p className="who">Sphinx <span className="meta">Question 1 of 1</span></p>
          <p className="q">The card actions now use BUTTON_CARD instead of BUTTON_SM. If another screen still renders a small button, does its height change? Explain briefly.</p>
        </li>
        <li>
          <p className="stage">Your answer</p>
          <div className="you"><p className="who">You</p><p>Yes, every small button gets taller.</p></div>
          <Chip kind="retry">Needs another answer</Chip>
        </li>
        <li>
          <p className="stage">Explanation</p>
          <p className="who">Sphinx</p>
          <p>Not quite. BUTTON_CARD is a new constant used only by the card actions; BUTTON_SM is unchanged, so other small buttons keep their height.</p>
        </li>
        <li>
          <p className="stage">New scenario</p>
          <p className="who">Sphinx <span className="meta">Question 1 · Follow-up</span></p>
          <p className="q">A teammate adds a new card that imports BUTTON_SM directly. Which height does it get, and why?</p>
        </li>
        <li>
          <p className="stage">Your answer</p>
          <div className="you"><p className="who">You</p><p>The original small height. BUTTON_SM didn’t change; only the card actions moved to BUTTON_CARD.</p></div>
          <Chip kind="passed">Passed</Chip>
        </li>
        <li>
          <p className="stage">Git continues</p>
          <pre className="terminal small"><code>
            <span className="dim">Sphinx: understanding check complete. Continuing this Git operation.</span>{'\n'}
            {'To github.com:you/example-app.git\n   4f1c2a9..8be03d1  main -> main'}
          </code></pre>
        </li>
      </ol>
    </figure>
  );
}

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="bar">
        <a className="wordmark" href="#top"><Mark />sphinx</a>
        <nav aria-label="Primary">
          <a href="#how">How it works</a>
          <a href={REPO}>GitHub</a>
          <a className="nav-cta" href="#start">Get started</a>
        </nav>
      </header>

      <main id="main">
        <section className="hero" id="top">
          <div className="hero-copy">
            <p className="eyebrow"><Mark />A Git checkpoint for agent-assisted code</p>
            <h1>Outsource your thinking, not your understanding.</h1>
            <p className="lede">
              Before your agent’s code reaches main, Sphinx asks you a few questions about what the change actually
              does. Miss one and it explains, then asks again with a new scenario. Pass and the push continues.
            </p>
            <div className="actions">
              <a className="button primary" href="#start">Get started <span aria-hidden="true">→</span></a>
              <a className="button secondary" href={REPO}>Read the source</a>
            </div>
            <CopyCommand command="npm install -g sphinx-understand" label="Copy install command" />
            <p className="meta">Node.js 22.19+ and Git · macOS, Linux, or WSL · MIT licensed</p>
          </div>
          <HeroPreview />
        </section>

        <section id="how">
          <h2>How it works</h2>
          <ol className="steps">
            {steps.map(([title, body], index) => (
              <li key={title}><span className="n" aria-hidden="true">{index + 1}</span><h3>{title}</h3><p>{body}</p></li>
            ))}
          </ol>
        </section>

        <section id="example">
          <h2>One checkpoint, start to finish</h2>
          <p className="section-lede">A small change, a wrong answer, an explanation, a new scenario, and the push going through.</p>
          <Example />
        </section>

        <section>
          <h2>Built to stay out of the way</h2>
          <div className="principles">
            {principles.map(([title, body]) => (
              <div key={title}><h3>{title}</h3><p>{body}</p></div>
            ))}
          </div>
          <ul className="extras">
            {extras.map(([title, body]) => <li key={title}><strong>{title}:</strong> {body}</li>)}
          </ul>
        </section>

        <section id="start">
          <h2>Get started</h2>

          <h3 className="subhead">Before you start</h3>
          <ul className="prereqs">
            <li>Node.js 22.19 or newer, and Git.</li>
            <li>macOS, Linux, or WSL.</li>
            <li>A reviewer model. Setup asks you to pick one of these:</li>
          </ul>
          <div className="choices">
            <div>
              <h4>Codex or Claude Code</h4>
              <p>If you are already signed in to either CLI, the reviewer runs on that sign-in and its usage allowance. No API key.</p>
            </div>
            <div>
              <h4>OpenRouter</h4>
              <p>For Pi, Cursor, OpenCode, or Git-only use. Needs an API key, even for free models; setup asks for it with hidden input. Paid models are opt-in.</p>
            </div>
          </div>

          <ol className="setup">
            <li>
              <h3>Install the CLI <span className="tag">Required</span></h3>
              <CopyCommand command="npm install -g sphinx-understand" label="Copy install command" />
            </li>
            <li>
              <h3>Run guided setup <span className="tag">Required</span></h3>
              <p>Pick the coding agents you use and a reviewer, then accept the recommended checkpoint (before pushes to main or master) or customize it. Setup makes no model calls.</p>
              <CopyCommand command="sphinx install" label="Copy setup command" />
              <p className="note">Using Codex? Approve the Sphinx hooks in <code>/hooks</code> when it opens.</p>
            </li>
            <li>
              <h3>Tune a repository <span className="tag optional">Optional</span></h3>
              <p>Run inside a repository to set its protected branches, describe the project for the reviewer, and exclude paths.</p>
              <CopyCommand command="sphinx init" label="Copy repository setup command" />
            </li>
            <li>
              <h3>Push as usual</h3>
              <p>When a push matches, Git waits and Sphinx prints a local questionnaire link. On macOS it also opens that page in a background tab.</p>
              <CopyCommand command="git push" label="Copy git push" />
            </li>
          </ol>
          <p className="note">
            See the <a href={`${REPO}#readme`}>README</a> for configuration, privacy, and model options.
          </p>
        </section>
      </main>

      <footer>
        <span><Mark />sphinx · MIT licensed</span>
        <a href={REPO}>GitHub</a>
        <a href={NPM}>npm</a>
      </footer>
    </>
  );
}
