# CRI-46 evidence

Before/after captures for the landing page and the real local questionnaire.

- `before/`, `after/`: landing page at 360, 390, 768, and 1173 px (plus dark mode), and questionnaire states.
- Questionnaire captures render the real `src/browser-page.js` with scripted states. No model was called; they are not live-model evidence.
- `after/installer-transcript.txt`: a real `sphinx install --no-launch` run in a temporary home and Git config.
- `shoot.mjs`, `sections.mjs`, `questionnaire.mjs`: capture scripts. They need `playwright-core` and a local Chrome.
