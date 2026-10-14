# Sphinx

Outsource your thinking, not your understanding.

Sphinx adds an understanding checkpoint to agent-assisted development. Before a configured Git operation, it asks you to predict the consequences of your changes. If you miss a concept, it explains the relevant execution path and gives you a new scenario to apply it to.

Install once for your machine. Git handles the checkpoint; supported Codex and Claude Code clients show the questionnaire through their native MCP forms. Your responses go directly to a separate evaluator, which receives a filtered Git snapshot without the conversation that produced the code.

## Install

Requires Node.js 22+, Git, and macOS, Linux, or WSL. Native Windows installation is not supported yet.

From this checkout:

```sh
npm install -g .
sphinx install
```

The package is not published to a registry yet. There is no account or hosted Sphinx service.

Onboarding selects destination branches, Git events, question depth, and models for small, medium, and large changes. Defaults are pushes to `main` or `master`, standard depth, and `openrouter/free` for every tier.

**OpenRouter's free models require an API key.** The installer accepts an existing `OPENROUTER_API_KEY` or prompts for a key with hidden input. Create one at [OpenRouter's key settings](https://openrouter.ai/settings/keys). Sphinx stores a supplied key in a user-only `credentials.json` file outside your repositories (mode `0600`); this is a local file, not an OS keychain. `sphinx auth` replaces it later. Keys are never stored in project configuration.

Using OpenRouter sends the filtered evidence to OpenRouter and its selected model provider. Choosing an installed coding agent instead uses that CLI's existing authentication and consumes its usage allowance:

```sh
sphinx install --yes --provider codex
# or
sphinx install --yes --provider claude
```

You need a recent, signed-in CLI for the selected backend. Sphinx does not automatically switch providers if authentication, availability, or output validation fails.

The installer configures user-level Git hooks, detects installed Codex/Claude CLIs, and registers the local Sphinx MCP server and native lifecycle hooks. Restart existing agent sessions after installation. **Codex also requires you to review and trust the installed hook with `/hooks`.** Follow the client's MCP approval prompts too; Sphinx does not bypass those reviews. Native questionnaires require a client that supports MCP form elicitation and MCP tool hooks. The exact form appearance is controlled by the client.

Client policies can disable forms even when the integration is installed. In Codex 0.162.1, approval policy `never` cancels native elicitation unless the host enables full-access form input for the user thread. A cancelled form leaves the checkpoint pending; use `sphinx check` in a terminal. Sphinx does not change your approval policy.

```sh
sphinx doctor
```

Global defaults apply to existing and future repositories using that Git configuration. Repositories that override `core.hooksPath` need an explicit compatibility step; Sphinx diagnoses the override:

```sh
cd your-repo
sphinx install --repo
```

Existing hooks run first, and their rejection is preserved. Sphinx chains all existing hook types, including those with streaming protocols. Reinstallation is idempotent. Agent settings are merged, not replaced. Remote machines, containers, and hosted coding agents need their own setup; this installation covers your local machine.

## Set up a repository

After installing Sphinx once, run this in a repository:

```sh
sphinx init
```

The guided setup explains the available Git events, question depths, and blocking/advisory modes, then asks which destination branches and remotes to cover. It saves `.sphinxconfig`, creates an optional `.sphinxignore`, and shows the resulting policy. Model selection and credentials remain in your machine-wide settings.

Branch defaults come from your effective configuration, initially `main` and `master`. They do not change because you happen to be working on a feature branch. To set up checks only when pushing to `main`, without prompts:

```sh
sphinx init --yes --branches main --events pre-push --level standard --mode block
```

Commit `.sphinxconfig` to share the repository policy with collaborators. Rerunning `init` preserves existing configuration and ignore files; edit `.sphinxconfig` directly to change an existing policy. If a legacy `.sphinx.json` exists, `init` creates `.sphinxconfig` from that policy and leaves the old file intact. When both exist, `.sphinxconfig` takes precedence; their policies are not merged.

`init` configures the repository. It does not reinstall hooks, contact a model, or change your global settings. The machine-wide hooks already cover ordinary repositories. Use `sphinx install --repo` only when that repository has its own hooks directory; use `sphinx doctor` to inspect coverage.

## Find your way around

Human-facing terminal output uses an ASCII sphinx, restrained colors, clear option descriptions, and a visible assessment progress summary. Color is off by default when output is redirected, `NO_COLOR=1` disables it, and `--json` returns machine-readable data without banners or ANSI styling.

Each command has its own help:

```sh
sphinx --help
sphinx init --help
sphinx help check
```

| Command | Use it to |
| --- | --- |
| `install` | Set up machine-wide Git hooks and native coding-agent integration |
| `init` | Choose and save this repository's checkpoint policy |
| `check` | Start or resume an understanding check |
| `pending` | List unfinished checks |
| `answer`, `explain`, `dispute` | Respond, learn a concept, or challenge a question |
| `status` | Inspect this repository's policy and pending work |
| `config` | Inspect effective settings and configuration paths |
| `doctor` | Check hook and agent integration coverage |
| `auth` | Save or replace your OpenRouter key |
| `uninstall` | Remove integrations while preserving unrelated settings |

`help`, `status`, `pending`, and `config` do not invoke an evaluator. JSON commands work without an interactive terminal; `sphinx init --json` accepts defaults and returns its setup result.

## What happens when you push

1. Git supplies the exact source and destination commits. Sphinx applies branch/event policy and filters paths before reading contents.
2. If the exact change already passed, the operation continues. Otherwise the hook saves a pending checkpoint and stops the operation. The hook makes **no model calls**.
3. Inside a supported coding-agent session, a lifecycle hook opens the native questionnaire. In a terminal, run `sphinx check`.
4. A fresh evaluator generates questions with private answer keys and code evidence. Small changes get one question; larger changes have higher ceilings based on your chosen depth. You supply a bounded prediction and a brief explanation directly in the form.
5. Correct answers clear concepts. An incorrect answer gets an explanation and replaces that concept's question with a different transfer scenario. Ambiguity or evaluator failure never creates a completion record.
6. Retry the blocked Git operation. Advisory operations already proceeded and should not be repeated. A completion record is bound to the exact repository, commits/index, destination, ignore policy, assessment policy, and expiry.

The agent integration shares state with Git, so there is one assessment per change. Native forms send your responses directly to Sphinx; the development model receives only completion status and retry guidance. It does not relay questions or answers. There is no extra development-model turn for each answer.

Each form lets you answer, learn the concept, dispute the premise, or pause. Pausing or dismissing keeps the assessment incomplete. It does not reopen on unrelated shell commands; retrying a blocked Git operation queues it again. For a paused advisory check, use `sphinx check` in your terminal instead of repeating an operation that already succeeded. The integration associates queued checks with the agent session, including when the shell uses `cd` or `git -C`.

If the client cannot show native forms, Sphinx leaves the checkpoint pending without calling the evaluator. A shell/GUI push outside a supported agent session also stops with a command to finish the check. Run `sphinx check` in an interactive terminal to continue.

Example question for a change introducing background jobs:

> The worker commits the operation but crashes before acknowledging the job. After redelivery, can the operation happen twice? Give a short reason.

The examiner assesses actual behavior. Finding a bug or correcting an unsupported premise can demonstrate understanding. It should not ask which file contains a class or whether you remember a function name.

Interactive commands during a terminal check:

```text
/learn              Explain this concept and give me a new scenario
/dispute <reason>   Recheck an ambiguous or incorrect premise
/quit               Save progress and leave the operation pending
```

The CLI also exposes a manual JSON protocol for integrations and debugging. These commands return questions and feedback, but never private answer keys. The native integration uses `sphinx mcp` internally instead; it does not ask the coding model to run these commands or supply answers:

```sh
sphinx pending --json
sphinx check --json
sphinx answer <assessment-id> --text 'Your answer and reason' --json
sphinx explain <assessment-id> --json
sphinx dispute <assessment-id> --text 'Why the premise is wrong' --json
```

## Keep model usage small

Routing is deterministic and makes no model request of its own. The default heuristics use **added plus deleted lines**, file count, and configurable consequential path terms:

| Tier | Default rule | Default evaluator |
| --- | --- | --- |
| Small | At most 80 changed lines and 3 files | `openrouter/free` |
| Medium | Between the small and large thresholds | `openrouter/free` |
| Large | At least 400 changed lines, 12 files, or a consequential path | `openrouter/free` |

Consequential paths include names containing `auth`, `permission`, `migration`, `billing`, `payment`, `crypto`, `security`, or `terraform`. A matching path promotes a change to large even when the patch is tiny. A one-file change is not necessarily small: line count and consequential paths count too. These are configurable heuristics, not a semantic risk classification. Ignored files do not contribute to routing counts.

The same deterministic tier sets the question ceiling together with your chosen depth:

| Change tier | Relaxed | Standard | Thorough |
| --- | --- | --- | --- |
| Small | 1 | 1 | 1 |
| Medium | Up to 2 | Up to 2 | Up to 3 |
| Large | Up to 2 | Up to 3 | Up to 5 |

These are ceilings, not quotas. The evaluator asks fewer questions when the evidence supports fewer distinct behaviors, with at least one question for an assessed change. It does not add filler to reach the ceiling. A wrong answer still leads to teaching and a replacement question about the same concept, so retries can exceed the initial question count while remaining within the model-call budget.

`openrouter/free` selects among available free models; it is not itself a complexity router. Sphinx chooses the tier. Model routes choose who evaluates a tier; depth sets how many concepts it can assess. Changing models does not change the question ceiling. Until you choose separate routes, all tiers stay free:

```sh
# Route larger work to your existing coding-agent plan.
sphinx install --yes \
  --small openrouter:openrouter/free \
  --medium claude:sonnet \
  --large claude:opus
```

Model names and access depend on the provider. Any paid OpenRouter route requires explicit `--allow-paid` or `allowPaid: true` in your global settings. Free routes send zero-price provider limits even when another route permits paid models. There are no automatic paid fallbacks or hidden model retries. Free availability and account limits still apply; see [OpenRouter limits](https://openrouter.ai/docs/api_reference/limits).

Other controls:

- A full question set is generated in one request. Each submitted answer, learning request, or dispute uses one further request.
- Resume reuses questions and progress; approved changes reuse completion records. Merely pushing or listing status consumes no inference.
- The default limit is 10 model calls per assessment, including failed requests. Exhaustion leaves the operation pending.
- Evidence is capped at 100,000 bytes. Oversized patches are rejected with an explanation rather than silently truncated.
- Your configured `maxOutputTokens` applies to every tier, without an additional hidden size-based cap. OpenRouter enforces the requested output-token cap. Codex/Claude receive concise-output instructions and local timeout/output-byte limits; their CLI interfaces do not provide an equivalent hard Sphinx token cap.
- Small/medium changes request low reasoning effort; large changes request medium effort on supporting coding-agent CLIs.

These controls bound requests and evidence; they are not a guaranteed dollar or subscription-token ceiling. Set provider-side spending limits for paid accounts.

## Files Sphinx never reads

Built-in exclusions apply recursively and cannot be undone by project negations:

- `.env` and `.env.*`, including `.env.example`.
- Common private key and keystore names (`*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `id_rsa`, `id_ed25519`, and related SSH names).
- Common credential files such as `.netrc`, `.npmrc`, `.pypirc`, `*credentials*.json`, `service-account*.json`, and `secrets.json` / `secrets.yaml` / `secrets.yml`.

Repository setup creates `.sphinxignore` without overwriting an existing one. Edit it to add project exclusions, for example:

```gitignore
# Project-specific private or generated files
internal/customer-exports/
/config/production.json
*.generated.ts
dist/
```

The supported syntax is `*`, `**`, `?`, root `/`, directory suffix `/`, comments beginning with `#`, and local `!` negations. Escape a leading `#` or `!` with `\`. This is a small gitignore-like parser, not the full Git pattern language.

Machine-wide patterns live in `~/.config/sphinx/ignore`. Project rules cannot undo global exclusions or the built-in sensitive-file rules. `.sphinxconfig` can add `exclude` patterns too. An ignored-only change requires no assessment.

**Filtering happens before patch, line-count, and blob-content retrieval.** Ignored paths' contents are not read, persisted as evidence, or sent to an evaluator. Git may enumerate their names/object IDs to identify changes. Snapshot identity still binds the full commit/index, so a later ignored-file edit alongside an already assessed change can invalidate the previous record. Uncommitted working files are not used as code evidence; pre-commit reads the index, and pre-push reads Git objects.

Ignore rules match paths. They do not detect a secret embedded in an otherwise included source file. Add sensitive project-specific paths before running an assessment. Ignore policy symlinks are rejected rather than followed. Sphinx does not automatically apply `.gitignore` to already tracked files.

## Configuration

Global settings are stored at `~/.config/sphinx/config.json`. `SPHINX_HOME` relocates all Sphinx settings, credentials, and assessment state. `sphinx config` shows effective settings and configuration paths. For a complete global example, see [examples/config.json](examples/config.json).

Question depth controls coverage within the change-tier ceilings above:

- `relaxed`: observable behavior and the most consequential edge case.
- `standard`: behavior, failure modes, and relevant system interactions.
- `thorough`: also consider supported rollout, rollback, and compatibility assumptions.

All depths ask one question for a small change. Model routes remain separate: choosing a stronger evaluator does not increase the question count.

Repository policy uses JSON in `.sphinxconfig`. Start with `sphinx init` or [.sphinxconfig.example](.sphinxconfig.example):

```json
{
  "version": 1,
  "events": ["pre-push"],
  "branches": ["main", "release/*"],
  "level": "standard",
  "mode": "block",
  "exclude": ["vendor/**"]
}
```

Supported repository overrides are `enabled`, `level`, `mode`, `events`, `branches`, `remotes`, and `exclude`, with `version: 1`. A repository cannot redirect source to another provider, supply credentials, or raise your usage budget. Repository excludes add to global excludes. `mode: "advisory"` queues a check but allows the operation; `enabled: false` disables Sphinx for that repository. Existing `.sphinx.json` files remain supported when `.sphinxconfig` is absent.

For commit checkpoints, enable `pre-commit` and run `sphinx check --staged`. Push policies match the **destination** branch, not the name of the local branch. For a manual push check, `--remote` and `--branch` select the destination; otherwise Sphinx uses the upstream. Actual pending push snapshots take precedence when resuming. Multiple destination refs are assessed separately. Tag-only pushes and deletions do not trigger v0.1 checks.

## Uninstall

```sh
sphinx uninstall --repo   # Remove an explicit repository integration, if present
sphinx uninstall         # Remove user-level Git/agent integrations
npm uninstall -g sphinx-understand
```

Uninstall restores the previous hook configuration when Sphinx still owns it and removes only its own unchanged agent handlers and MCP registration. Later user edits are preserved and reported. Global uninstall leaves explicit repository installations in place, with a warning; remove those before removing the executable. Configuration, credentials, and assessment state remain in `SPHINX_HOME` for you to keep or delete.

## Scope and limitations

Sphinx is a voluntary practice for retaining understanding. A local user or agent can bypass hooks, change state, or answer with outside help. Completion is not proof of human authorship or unaided understanding, and an LLM examiner can be wrong.

This first version handles local Git commit/push checkpoints. Web merges, CI-required checks, deployment gates, signed remote attestations, automatic new-agent discovery after installation, and native Windows support are future work. Run `sphinx install` again after adding a supported agent. Binaries must be explicitly excluded or checked outside Sphinx. Missing remote history needs a `git fetch` before assessment. The first push of a new branch currently assesses its full tree against an empty tree, which can exceed the context limit in an established repository.

Question quality and native-form behavior need evaluation on real changes and supported client versions. See [CONTRIBUTING.md](CONTRIBUTING.md). The automated suite uses fixture evaluators and mock MCP clients, including an end-to-end Git-to-questionnaire workflow; it makes no paid or live inference requests.

## Development

```sh
npm test
node bin/sphinx.js --help
```

The runtime has no third-party dependencies. Tests use Node's test runner, real temporary Git repositories, isolated integration homes, and mocked model backends. Never run installer tests against a real home directory or Git configuration.

See [docs/architecture.md](docs/architecture.md) for module boundaries and assessment state. MIT licensed.
