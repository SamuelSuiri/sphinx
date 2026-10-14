# Contributing to Sphinx

Use Node.js 22+ and run `npm test`. There are no runtime dependencies to install. Tests must not call real models, change real agent settings, or modify a developer's global Git configuration.

Keep trigger policy deterministic and separate from model judgment. Preserve existing hooks. Filter paths before reading code. New integrations need isolated install/uninstall tests and clear coverage limitations.

The most useful assessment contributions are small, reproducible change fixtures with:

1. A baseline and patch with no private data.
2. The observable behavior or invariant a developer should understand.
3. A bounded question with stated assumptions.
4. Accepted answers and causal reasoning, including valid alternative explanations.
5. Common misconceptions and a new scenario that tests transfer after teaching.

Question-quality evaluation should include ambiguous questions and cases where an answer correctly identifies a bug. Do not grade on naming trivia, prose style, or similarity to a single model-written answer.

Before proposing a stronger model or additional model calls, measure whether the change improves the assessment enough to justify its usage. Keep the free default and avoid silent paid fallback.
