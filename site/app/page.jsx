import CopyCommand from './copy-command';

const REPO = 'https://github.com/parthh01/sphinx';
const NPM = 'https://www.npmjs.com/package/sphinx-understand';
const QUOTE = 'https://x.com/yacineMTB/status/2018886083120153046?s=20';

const steps = [
  ['You push', 'You, or the coding agent working for you, run git push to a branch you protect, like main.'],
  ['A reviewer investigates', 'An independent model reads the diff and the code it touches, without the conversation that wrote it, and writes questions about consequences rather than trivia.'],
  ['You answer', 'A local page opens in a background tab while Git waits. Miss something and you get an explanation plus a fresh scenario to apply it to.'],
  ['The push continues', 'Pass, and the same push goes through on its own. Nothing to retry.'],
];

const details = [
  ['Works with your agent', 'Codex, Claude Code, Cursor, OpenCode, and Pi. One install covers every repository on your machine.'],
  ['Your answers stay yours', 'You answer in the browser. The coding agent only learns whether the check passed.'],
  ['Secrets are never read', '.env files, keys, and anything in .sphinxignore are filtered out before any file is opened.'],
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
          <figure className="quote">
            <blockquote><h1>“Outsource your thinking,<br />not your understanding.”</h1></blockquote>
            <figcaption>— <a href={QUOTE}>Sun Tzu</a></figcaption>
          </figure>
          <p className="lede">
            Sphinx is a hook for agent-assisted development. Before your agent’s code ships, it asks you a question or two checking if you understand the code being shipped.
          </p>
          <CopyCommand command="npm install -g sphinx-understand" />
          <p className="links"><a href="#start">Get started</a> · <a href={REPO}>Read the source</a></p>
        </section>

        <figure className="demo" aria-label="Example Sphinx questionnaire">
          <div className="demo-bar"><span>billing-service / main</span><span>6.8k tokens · $0.0014</span></div>
          <div className="demo-body">
            <p className="activity">✓ Checking the questions against the source <span>7 steps ▸</span></p>
            <p className="who">Sphinx</p>
            <p className="q">Your webhook handler now saves the event ID before calling charge(). Stripe times out waiting for your response and sends the same event again. What happens on the retry, and why?</p>
            <div className="you"><p className="who">You</p><p>The handler runs twice, so the customer gets charged twice.</p></div>
            <p className="who">Sphinx</p>
            <p>Not quite. The retry finds the saved event ID and returns 200 without charging, so there’s no double charge. That ordering has a cost, though: the ID is recorded before the charge succeeds.</p>
            <p className="who">Sphinx <span className="tag">Follow-up</span></p>
            <p className="q">charge() fails with a network error right after the event ID is saved. What does the next retry do, and what happens to the customer?</p>
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
