import CopyCommand from './copy-command';
import CheckpointDemo, { FocusLink } from './checkpoint-demo';

const REPO = 'https://github.com/parthh01/sphinx';
const NPM = 'https://www.npmjs.com/package/sphinx-understand';

const stages = [
  ['A configured Git operation starts', 'You, or the coding agent working for you, commit or push in a way your policy covers, like a push to main. Git waits.'],
  ['An independent reviewer reads the change', 'A separate model investigates the diff and the code it touches with read-only tools, without the conversation that wrote it.'],
  ['You answer and apply feedback', <>
    Answer in a local browser page. On macOS it opens in a background tab; on Linux, WSL, or over SSH, Sphinx prints
    a link for you to open (<a href={`${REPO}#what-happens-when-you-push`}>remote setup</a>). Miss a concept and you
    get an explanation and a new scenario.
  </>],
  ['The same Git operation continues', 'Once you pass, Git verifies the exact change and the original commit or push continues. Nothing to retry.'],
];

const fits = [
  {
    title: 'Works with your agent',
    items: [
      'Codex, Claude Code, Cursor, OpenCode, and Pi, or plain Git with no agent.',
      'One install covers every repository on your machine.',
    ],
  },
  {
    title: 'Your answers stay private',
    items: [
      'You answer in a local browser page. The coding agent only learns whether the check passed.',
      'Skip one check from the page when it is urgent, or run sphinx yolo for a repository. Every skip is logged.',
    ],
  },
  {
    title: 'Local and open source',
    items: [
      'MIT licensed. No account or hosted Sphinx service.',
      'The reviewer receives filtered evidence from the change through the route you pick: your Codex or Claude sign-in, or OpenRouter and its model provider.',
      'Known credential files like .env, private keys, and .npmrc, plus any path in .sphinxignore, are never opened or sent to a reviewer. Matching is by path, so a secret pasted into ordinary source is not caught.',
    ],
  },
];

function Mark() {
  return <span className="mark" aria-hidden="true">◆</span>;
}

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="bar">
        <div className="wrap bar-inner">
          <a className="wordmark" href="#top"><Mark />Sphinx</a>
          <nav aria-label="Primary">
            <a href="#how">How it works</a>
            <a href="#start">Get started</a>
            <a href={REPO}>GitHub</a>
          </nav>
        </div>
      </header>

      <main id="main">
        <section className="hero wrap" id="top">
          <div className="hero-title">
            <p className="eyebrow">A comprehension checkpoint for AI-assisted code</p>
            <h1>Your agent wrote it. Can you explain it?</h1>
          </div>
          <div className="hero-copy">
            <p className="lede">
              Sphinx asks you to reason about your code changes before a commit or push continues. Understand the
              decisions, work through what you missed, and keep going.
            </p>
            <div className="actions">
              <FocusLink target="checkpoint" className="button primary">Explore a checkpoint</FocusLink>
              <a className="button secondary" href="#how">How it works</a>
            </div>
          </div>
        </section>

        <section className="demo wrap" id="checkpoint" tabIndex={-1} aria-label="Example checkpoint">
          <CheckpointDemo />
          <p className="demo-note">
            Synthetic example with scripted answers. The real questionnaire shows the checkpoint's changed files and the
            diff lines the reviewer read for each question; that view is in the GitHub source and not yet in the
            published npm package (0.1.0). The example says nothing about reviewer coverage, speed, or accuracy.
          </p>
        </section>

        <section className="wrap section" id="how">
          <h2>How it works</h2>
          <ol className="stages">
            {stages.map(([title, body], index) => (
              <li key={title}><span className="n" aria-hidden="true">{index + 1}</span><h3>{title}</h3><p>{body}</p></li>
            ))}
          </ol>
        </section>

        <section className="wrap section why">
          <h2>Why the question matters</h2>
          <div className="prose">
            <p>
              A large change can be correct line by line and still carry a decision you never made, like letting a
              queue retry a payment. Sphinx asks about consequences: what happens on a retry, a timeout, or a crash.
              Questions come from a reviewer that never saw the conversation that wrote the code, so they test what
              the change does rather than what you asked for.
            </p>
            <p>
              It does not review every line or promise to catch defects. It checks that you can explain the parts that
              matter before the change moves on.
            </p>
          </div>
        </section>

        <section className="wrap section">
          <h2>Fits your workflow</h2>
          <div className="fits">
            {fits.map(group => (
              <div key={group.title}>
                <h3>{group.title}</h3>
                <ul>{group.items.map(item => <li key={item}>{item}</li>)}</ul>
              </div>
            ))}
          </div>
        </section>

        <section className="wrap section" id="start">
          <h2>Get started</h2>

          <div className="start-grid">
            <div>
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
          </div>
        </section>
      </main>

      <footer className="wrap">
        <span><Mark />Sphinx · MIT licensed</span>
        <a href={REPO}>GitHub</a>
        <a href={NPM}>npm</a>
        <a href={`${REPO}#readme`}>Documentation</a>
        <a href={`${REPO}/blob/main/LICENSE`}>License</a>
      </footer>
    </>
  );
}
