import CopyCommand from './copy-command';

const REPO = 'https://github.com/parthh01/sphinx';
const NPM = 'https://www.npmjs.com/package/sphinx-understand';

const steps = [
  ['You push', 'You, or the coding agent working for you, run git push to a branch you protect, like main.'],
  ['A reviewer investigates', 'An independent model reads the diff and the code it touches, without the conversation that wrote it, and writes questions about consequences rather than trivia.'],
  ['You answer', 'A local page opens in a background tab while Git waits. Miss something and you get an explanation plus a fresh scenario to apply it to.'],
  ['The push continues', 'Pass, and the same push goes through on its own. Nothing to retry.'],
];

const details = [
  ['Works with your agent', 'Codex, Claude Code, Cursor, OpenCode, and Pi. One install covers every repository on your machine.'],
  ['Your answers stay yours', 'You answer in the browser. The coding agent only learns whether the check passed.'],
  ['Sensitive files are excluded', 'Known credential files like .env, private keys, and .npmrc, plus any path in .sphinxignore, are never opened or sent to a reviewer. Matching is by path, so a secret pasted into ordinary source is not caught.'],
  ['Cheap by default', 'Small changes go to small models. Tokens and running cost are shown as the review happens.'],
  ['Urgent? Skip it', 'Skip a single check from the page, or run sphinx yolo to bypass checks for a repo. Every skip is logged.'],
  ['Open source', 'MIT licensed, runs locally, no account or hosted service.'],
];

export default function Home() {
  return (
    <>
      <header className="bar">
        <a className="wordmark" href="#top">sphinx</a>
        <nav>
          <a href="#how">How it works</a>
          <a href="#start">Get started</a>
          <a href={REPO}>GitHub</a>
        </nav>
      </header>

      <main id="top">
        <section className="intro">
          <h1>Outsource your thinking,<br />not your understanding.</h1>
          <p className="lede">
            Sphinx is a Git checkpoint for agent-assisted development. Before your agent’s code reaches
            main, it asks you a few questions about what the change actually does.
          </p>
          <CopyCommand command="npm install -g sphinx-understand" />
          <p className="links"><a href="#start">Get started</a> · <a href={REPO}>Read the source</a></p>
        </section>

        <figure className="demo" aria-label="Example Sphinx questionnaire">
          <div className="demo-bar"><span>checkride-ai / main</span><span>4.1k tokens · $0.0009</span></div>
          <div className="demo-body">
            <p className="activity">✓ Checking the questions against the source <span>6 steps ▸</span></p>
            <p className="who">Sphinx</p>
            <p className="q">The card actions now use BUTTON_CARD instead of BUTTON_SM. If another screen still renders a small button, does its height change? Explain briefly.</p>
            <div className="you"><p className="who">You</p><p>Yes, every small button gets taller.</p></div>
            <p className="who">Sphinx</p>
            <p>Not quite. BUTTON_CARD is a new constant used only by the card actions; BUTTON_SM is unchanged, so other small buttons keep their height.</p>
            <p className="who">Sphinx <span className="tag">Follow-up</span></p>
            <p className="q">A teammate adds a new card that imports BUTTON_SM directly. Which height does it get, and why?</p>
          </div>
          <figcaption>Git is waiting. Pass, and the push continues automatically.</figcaption>
        </figure>

        <section id="how">
          <h2>How it works</h2>
          <ol className="steps">
            {steps.map(([title, body], index) => (
              <li key={title}><span className="n">{index + 1}</span><div><h3>{title}</h3><p>{body}</p></div></li>
            ))}
          </ol>
        </section>

        <section>
          <h2>Built to stay out of the way</h2>
          <dl className="details">
            {details.map(([title, body]) => (
              <div key={title}><dt>{title}</dt><dd>{body}</dd></div>
            ))}
          </dl>
        </section>

        <section id="start">
          <h2>Get started</h2>
          <p>Requires Node.js 22.19+ and Git on macOS, Linux, or WSL.</p>
          <pre className="terminal"><code>
<span className="c"># 1. Install the CLI</span>{'\n'}
npm install -g sphinx-understand{'\n\n'}
<span className="c"># 2. Connect Git and your coding agents, pick reviewer models</span>{'\n'}
sphinx install{'\n\n'}
<span className="c"># 3. Optional: describe the project and choose protected branches</span>{'\n'}
cd your-repo && sphinx init{'\n\n'}
<span className="c"># 4. Push as usual</span>{'\n'}
git push
          </code></pre>
          <p>
            Reviewers can run on your existing Codex or Claude Code sign-in, or on OpenRouter with an API key.
            See the <a href={`${REPO}#readme`}>README</a> for configuration, privacy, and model options.
          </p>
        </section>
      </main>

      <footer>
        <span>MIT licensed</span>
        <a href={REPO}>GitHub</a>
        <a href={NPM}>npm</a>
      </footer>
    </>
  );
}
