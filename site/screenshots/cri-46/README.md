# CRI-46 evidence

Captures of the landing page and the real local questionnaire. All are headless Chrome (browser emulation), not real devices.

- `before/`: the earlier live landing page and questionnaire states.
- `after/`: the redesigned landing page.
  - `light-{360,390,768,1173,1440}-viewport.png`, `dark-{390,1440}-viewport.png`, `light-{390,1440}-full.png`: layout at each width.
  - `step-1.png` … `step-7-finished.png`: the scripted checkpoint walkthrough, one state at a time. `step-3-all-files-excerpt.png` shows switching to all 35 files mid-walkthrough without losing the step.
  - `evidence-client.png`: an evidence reference opening its file and highlighting the matching hunk lines.
  - `mobile-390-*.png`: question first, then the Files/Diff views.
  - `focus-visible.png`, `start-copied.png`: keyboard focus and copy feedback.
  - `workspace-run.log`: output of `workspace.mjs`: horizontal-scroll and 44px target checks per width, the walkthrough labels, and the copied clipboard text.
  - `qafter-*.png`: the real `src/browser-page.js` rendered with **scripted** states. No model was called.
  - `installer-transcript.txt`: a real `sphinx install --no-launch` run in a temporary home and Git config.
- The checkpoint example is synthetic and labeled a product preview. The real questionnaire's change-scope and linked-diff view landed separately in CRI-49 (#9) and is not captured here.
- Scripts: `workspace.mjs` (landing captures and interaction checks), `shoot.mjs`, `questionnaire.mjs`, and `contrast.mjs` (WCAG ratios for the color tokens). The capture scripts need `playwright-core` and a local Chrome.
