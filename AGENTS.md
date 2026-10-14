# Sphinx

Sphinx helps developers retain understanding of agent-assisted changes. Keep the core provider-neutral and the CLI dependency-free (Node.js 22+).

- Git decides when a checkpoint is required; an independent evaluator writes and grades questions.
- Never inherit the coding conversation into an assessment. Use committed/staged evidence and a fresh evaluator process.
- Assess consequences, failure modes, and invariants. A wrong answer leads to an explanation and a new transfer question.
- Never treat model errors or ambiguous questions as successful completion.
- Bind completion to exact Git content, destination, and policy. Agent and Git integrations share that state.
- Preserve existing hooks/settings. Install and uninstall must be idempotent and reversible.
- Do not install into a developer's real home or change global Git config during tests. Use temporary directories and explicit test environments.
- Use node:test for meaningful behavior and real temporary Git repositories for Git integration tests.
- Build a clear, polished terminal interface with explanatory options, restrained colors, and an ASCII sphinx. The user explicitly requested this visual direction. Keep JSON and hook protocol output machine-readable; honor NO_COLOR, non-TTY output, and narrow terminals.

Run `npm test` before finishing changes.
