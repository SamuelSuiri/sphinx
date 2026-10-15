# Contributing to Sphinx

Use Node.js 22.19+, install the pinned dependencies with `npm ci`, and run `npm test`. Tests must not call real models, change real agent settings, or modify a developer's global Git configuration. The test runner blocks outbound Node requests while permitting local fixtures.

Keep trigger policy deterministic and separate from model judgment. Preserve existing hooks. Filter paths before reading code. New integrations need isolated install/uninstall tests and clear coverage limitations.

The most useful assessment contributions are small, reproducible change fixtures with:

1. A baseline and patch with no private data.
2. The observable behavior or invariant a developer should understand.
3. A bounded question with stated assumptions.
4. Accepted answers and causal reasoning, including valid alternative explanations.
5. Common misconceptions and a new scenario that tests transfer after teaching.

Question-quality evaluation should include ambiguous questions and cases where an answer correctly identifies a bug. Do not grade on naming trivia, prose style, or similarity to a single model-written answer.

Run `npm run eval -- --out /tmp/sphinx-eval.json` for the deterministic fixture baseline. Use the separately authorized, bounded live workflow in [eval/README.md](eval/README.md) to measure model quality. Retain generated questions, source evidence, grading probes, and request/cost totals when comparing changes. Never answer a real human checkpoint as part of testing.

Before proposing a stronger model or additional model calls, measure whether the change improves the assessment enough to justify its usage. Keep model selection explicit and avoid silent paid fallback.
