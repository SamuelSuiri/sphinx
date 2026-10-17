# Sphinx

Outsource your thinking, not your understanding.

Sphinx adds an understanding checkpoint to agent-assisted development. Before a configured Git operation, it asks you to predict the consequences of your changes. If you miss a concept, it explains the relevant execution path and gives you a new scenario to apply it to.

Install once for your machine. Git provides a local browser questionnaire and waits. On macOS, the page opens in the background, leaving your coding-agent window in place. Once you pass, the same push or commit continues automatically, whether you started it yourself or through a coding agent. An independent reviewer investigates committed changes using read-only diff, file, and search tools. It receives your project's context without the conversation that produced the code. Background preparation gets questions ready before a push when the destination is known.

## Install

Requires Node.js 22.19 or newer, Git, and macOS, Linux, or WSL. Native Windows installation is not supported yet.

```sh
npm install -g sphinx-understand
sphinx install
```

There is no account or hosted Sphinx service. To work from a checkout instead, run `npm install -g .` in the repository.

Onboarding starts by asking which coding agents you use, then offers economical reviewer presets for those clients. Codex uses GPT-6 Luna; Claude Code uses Haiku. You can instead choose paid OpenRouter coding models or enter your own routes for small, medium, and large changes. Git defaults are pushes to `main` or `master` at standard depth. Existing installations keep their saved models unless you choose a replacement.

**Every OpenRouter route requires an API key, including free models.** The installer accepts an existing `OPENROUTER_API_KEY` or prompts for a key with hidden input. Create one at [OpenRouter's key settings](https://openrouter.ai/settings/keys). Paid routes also need OpenRouter credits. Sphinx stores a supplied key in a user-only `credentials.json` file outside your repositories (mode `0600`); this is a local file, not an OS keychain. `sphinx auth` replaces it later. Keys are never stored in project configuration.

Using OpenRouter sends filtered evidence to OpenRouter and its selected model provider, billed separately from your coding-agent plan. Codex and Claude reviewer routes use that CLI's existing authentication and consume its allowance. For unattended installation, choose a preset explicitly:

```sh
sphinx install --yes --preset codex-economy
# or
sphinx install --yes --preset claude-economy
# or, using paid OpenRouter credits
sphinx install --yes --preset openrouter-value --allow-paid
```

Fresh `install --yes` requires a preset or an explicit reviewer route; it does not silently choose a free model. Reinstalling an existing configuration preserves its routes. The free OpenRouter router remains an explicit best-effort option (`--preset openrouter-free`); its model selection, rate limits, and tool support can interrupt a check. Sphinx does not automatically switch providers or upgrade models after a failure.

You need a recent, signed-in CLI with access to the selected model for Codex or Claude review. Pi, Cursor, and OpenCode integrations present checkpoints, but do not supply reviewer authentication or models. Their users choose an installed Codex/Claude CLI transport or OpenRouter separately.

The independent reviewer runs in an embedded [Pi SDK](https://pi.dev/docs/latest/sdk) session. OpenRouter supplies model responses directly. The Codex and Claude routes use fresh, isolated CLI calls as model transports underneath Pi; their CLI sign-in and usage allowance are reused, while Pi runs the reviewer's tool loop and context management.

The installer configures user-level Git hooks and adapters for detected coding clients, then opens the selected installed clients. Codex, Claude Code, Pi, and OpenCode start fresh CLI sessions; Cursor opens a new editor window. Activation supplies no prompt and makes no Sphinx model request. It does not restart existing client processes.

Complete any trust or connection prompts in the opened client. **In Codex, open `/hooks` to review and trust the installed hooks.** Opening the client does not verify MCP connectivity or complete hook trust, and Sphinx does not bypass those reviews. The normal blocking flow uses a local browser questionnaire, opened in the background on macOS. Codex/Claude native forms and Pi extension dialogs handle fallback checkpoints; each client controls those dialogs' appearance.

In Cursor, start a new Agent conversation in the opened window. Activation flags known versions older than 1.7 for an update; newer versions still need the hook events used by Sphinx.

| Development client | Checkpoint experience | Installed integration |
| --- | --- | --- |
| Codex | Local browser questionnaire; native MCP form for fallback checks | MCP server and lifecycle hooks |
| Claude Code | Local browser questionnaire; native MCP form for fallback checks | MCP server and lifecycle hooks |
| Pi 1.2+ | Local browser questionnaire; native dialogs for fallback checks | Local Pi extension |
| Cursor | Local browser questionnaire | Local user hooks |
| OpenCode 1.x | Local browser questionnaire | Local OpenCode plugin |

`--agents auto` detects clients by their executable, configuration directory, or existing Sphinx installation. Select a subset explicitly with `--agents codex,claude,pi,cursor,opencode`, or use `--agents none` for Git-only setup. These integrations are separate from the evaluator model routes.

Guided setup presents checkboxes with **All supported agents** first and detected agents preselected. Use the arrow keys to move, Space to toggle, and Enter to confirm. Clear every checkbox to skip agent setup. Previously connected integrations remain installed.

Interactive installation opens clients by default. Use `--no-launch` to defer this step. `install --yes` configures Sphinx without opening clients unless you also pass `--launch`. To open configured clients later, use `activate`; it does not reinstall or change their settings:

```sh
sphinx install --no-launch
sphinx install --yes --preset codex-economy --launch
sphinx activate
sphinx activate --agents codex,claude
```

`activate --agents` selects a subset of configured integrations; `--json` returns launch results without terminal styling. If a client is missing or the environment cannot open a terminal or editor, Sphinx reports a focused command to run yourself. Existing sessions stay open; Pi can also load its extension with `/reload`.

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

The Git hook serves a local browser questionnaire for the exact checkpoint and waits for its result. You answer directly on that page; the development model receives only the Git result and status. It does not launch the interview or relay questions and answers. Native fallback dialogs in Pi require an interactive session or a dialog-capable RPC client.

On macOS, Sphinx opens the questionnaire in a background browser tab without activating Terminal or minimizing your coding window. Other environments print the loopback URL for you to open; a remote session needs access to that machine's loopback listener. CI does not start a questionnaire. One page handles all checkpoints in a Git operation, and unrelated tool calls do not reopen paused checks. Closing the tab leaves Git waiting until its deadline; Pause stops it and saves progress. `sphinx check` remains an explicit terminal alternative. A new Git attempt can queue another presentation. Cursor's installed user hooks cover local sessions, not cloud agents.

### Bring your own endpoint, or use your plan

**Any OpenAI-compatible endpoint** (OpenAI, Groq, Together, vLLM, Ollama, LM Studio, and others) can run reviews. It must support tool calls and JSON-schema structured output.

```sh
sphinx auth --provider openai --base-url https://api.openai.com/v1   # prompts for the key (hidden)
sphinx config --provider openai --model gpt-5-mini                    # or per size: --large openai:<model>
```

The key is stored next to its URL and only ever sent there. Plain `http://` is allowed only for localhost, where a key is optional. For scripts, set `SPHINX_OPENAI_BASE_URL` and `SPHINX_OPENAI_API_KEY` together. Sphinx never reads `OPENAI_API_KEY`.

**Codex and Claude routes bill your signed-in plan by default.** Sphinx removes `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CODEX_API_KEY`, and similar variables from the reviewer CLI's environment, so a key in your shell cannot silently switch reviews to API credits. If the CLI is not signed in with a Claude or ChatGPT plan, the check stops with instructions. To let the CLIs use API keys instead, run `sphinx config --cli-billing api`.

## Set up a repository

After installing Sphinx once, run this in a repository:

```sh
sphinx init
```

The guided setup explains the available Git events and question depths, then asks which destination branches and remotes to cover. It creates `.sphinxconfig`, `.sphinxignore`, and `.sphinxcontext.md`, preserving existing files. Model selection and credentials remain in your machine-wide settings.

Use `.sphinxcontext.md` to describe what the project does, who uses it, important workflows, and architecture boundaries. Its text is included in every reviewer, compaction, and grading request. The reviewer checks its claims against code; it cannot override Sphinx policy or authorize reading ignored files. Keep it under 16,000 bytes, without secrets. Changing context invalidates prepared questions and prior completion records. The context file itself also respects `.sphinxignore`.

```sh
sphinx init --yes --context 'A booking service for shared equipment. Reservations must never overlap.'
```

Without a supplied description, setup creates an editable template. In a repository without context, the reviewer must establish purpose from available documentation and source rather than invent requirements.

Branch defaults come from your effective configuration, initially `main` and `master`. They do not change because you happen to be working on a feature branch. To set up checks only when pushing to `main`, without prompts:

```sh
sphinx init --yes --branches main --events pre-push --level standard
```

Commit `.sphinxconfig`, `.sphinxignore`, and `.sphinxcontext.md` to share repository settings and background with collaborators. Rerunning `init` preserves them; edit the files directly to update existing settings. If a legacy `.sphinx.json` exists, `init` creates `.sphinxconfig` from that policy and leaves the old file intact. When both exist, `.sphinxconfig` takes precedence; their policies are not merged.

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
| `install` | Set up machine-wide Git hooks and coding-agent integrations, then open selected clients |
| `activate` | Open configured coding clients without reinstalling |
| `init` | Choose and save this repository's checkpoint policy |
| `check` | Start or resume an understanding check |
| `prepare` | Schedule background investigation; use `--retry` after a failure |
| `pending` | List unfinished checks |
| `answer`, `explain`, `dispute` | Respond, learn a concept, or challenge a question |
| `status` | Inspect this repository's policy and pending work |
| `config` | Inspect settings or change machine-wide reviewer presets, model routes, and call ceiling |
| `doctor` | Check hook and agent integration coverage |
| `auth` | Save or replace your OpenRouter key |
| `uninstall` | Remove integrations while preserving unrelated settings |

`help`, `status`, `pending`, and `config` do not invoke an evaluator. JSON commands work without an interactive terminal; `sphinx init --json` accepts defaults and returns its setup result.

## What happens when you push

1. Git supplies the exact source and destination commits. Sphinx applies branch/event policy and filters paths before reading contents.
2. If the exact change already passed, the operation continues. Otherwise the hook saves a pending checkpoint and keeps the original Git process waiting.
3. The hook serves a private questionnaire on loopback and prints its local URL. On macOS it opens the page in the background, without activating Terminal or minimizing the coding agent. On Linux, WSL, and over SSH, open the printed URL yourself; from a remote session, forward the same port number (for example, `ssh -L <port>:127.0.0.1:<port> host`) and open the printed URL unchanged in your local browser, or run `sphinx check` in a terminal instead. You answer in the page; Git's stdin and the coding agent's shell are never used for questionnaire input.
4. Sphinx reuses matching prepared questions, waits for an existing review, or starts a fresh reviewer. The reviewer reads relevant diffs and follows related source and tests before committing questions, private answer keys, and supporting evidence. A separate model request checks the questions against that evidence before displaying them. Small changes get one question; larger changes have higher ceilings based on your chosen depth. You answer directly in the form.
5. Correct answers clear concepts. An incorrect answer gets an explanation and replaces that concept's question with a different transfer scenario. Every proposed replacement gets a fresh source audit before display, without the human answer or grading conversation. Grading costs one request; a proposed replacement adds one audit within any explicitly configured call limit. Ambiguity or evaluator failure never creates a completion record.
6. Sphinx revalidates every original snapshot and completion record, then returns control to the same Git process. The push or commit continues automatically, without replaying its command. Completion is bound to the exact repository, commits/index, destination, ignore policy, project context, assessment policy, and expiry.

Pausing, cancellation, stale code/policy, or the 25-minute interview deadline stops the operation and saves progress. Closing or refreshing a browser tab does not submit an answer; the same local URL remains available while Git is waiting. The coding client or remote connection may impose a shorter timeout. An operation that already exited cannot be resumed. CI and unavailable presentation leave the check pending and stop Git. Native/manual fallback can complete the check, followed by a new Git invocation. Advisory operations already proceeded and must not be repeated.

## When it's urgent

- **Skip this time:** the questionnaire has a *Skip this time* button, available even while the review is still running. Git continues immediately.
- **Yolo mode:** `sphinx yolo` toggles skipping checks. Inside a Git repository it applies to that repository; outside one it applies globally (repositories with their own setting win, including an explicit off inside a repository while global yolo is on). Run it again to turn it off. `--reason "prod hotfix"` is optional.

Skips never count as understanding: no receipt is written and nothing resurfaces later. Every skip or toggle is appended with its optional reason to `~/.config/sphinx/overrides.jsonl`. `sphinx status` shows whether yolo is on and lists recent overrides.

The questionnaire streams the reviewer's progress live (files read, searches, drafting and auditing questions) while you wait.

## Background preparation and investigation

Installed `post-commit`, `post-merge`, `post-rewrite`, and `post-checkout` hooks schedule a detached worker after the original hook completes. A short debounce coalesces rapid updates. The worker investigates the expected protected destination using local remote-tracking refs, and saves questions without opening a form or awarding completion. `sphinx status` reports preparation; `sphinx prepare` schedules it explicitly.

Preparation and the push check share the exact assessment ID, lock, questions, and counted model usage. Source, destination/base, policy, ignore rules, or context changes cause a cache miss. Superseded work is discarded. Failed jobs are not automatically retried; `sphinx prepare --retry` makes that choice explicit. Set `backgroundPreparation: false` globally or in `.sphinxconfig` to opt out. A repository cannot re-enable preparation disabled globally.

The first push of a new repository or a branch without local remote-tracking history may need a cold review. Sphinx does not fetch or guess missing remote history during preparation. Explicit pushes to a different destination can also miss the prepared cache. Pre-commit checks review the exact staged snapshot on demand.

Before the first model request, Sphinx supplies bounded diff pages and a filtered file inventory using local reads. The reviewer then requests missing diff pages, source ranges, file listings, and literal searches. It can inspect unchanged callers, dependencies, and tests at the same pinned revision. File names are navigation hints; only inspected source can support a question. Sphinx enforces ignores and tool access locally; it never grants the reviewer an unrestricted shell or the developer's working files. Large patches are inspected incrementally rather than bundled into one prompt.

Pi owns the reviewer session, tool loop, and [native context compaction](https://pi.dev/docs/latest/compaction). Sphinx supplies the restricted Git tools, project context, and model transports. It also keeps a separate bounded archive of exact tool observations and their provenance. Pi session entries, evidence, and an assessment awaiting its independent audit are saved privately under the checkpoint lock. Interrupted reviews resume from that state without repeating the investigation. The reviewer can recover archived observations after compaction with `read_evidence`. Pi can summarize older conversation history without replacing that evidence archive. Final questions must cite inspected evidence, and grading receives the relevant original observations, private rubric, and project context.

The agent integration shares state with Git, so there is one assessment per change. The local questionnaire and native fallback forms send your responses directly to Sphinx; the development model receives only completion status and the original Git result. It does not relay questions or answers. There is no extra development-model turn for each answer.

Each form lets you answer, learn the concept, dispute the premise, or pause. Pausing or dismissing keeps the assessment incomplete. It does not reopen on unrelated shell commands; retrying a blocked Git operation queues it again. The integration associates queued checks with the agent session, including when the shell uses `cd` or `git -C`.

The local questionnaire also works for shell/GUI pushes outside supported coding agents. Platforms without a reliable background browser opener print the local URL instead of taking focus. SSH users can forward the same loopback port or use `sphinx check` explicitly; see [What happens when you push](#what-happens-when-you-push). If presentation is unavailable, Sphinx leaves the checkpoint pending and stops Git. Native after-tool callbacks or `sphinx check` can then complete the fallback check, but cannot revive a Git process that already exited.

Example question for a change introducing background jobs:

> The worker commits the operation but crashes before acknowledging the job. After redelivery, can the operation happen twice? Give a short reason.

The examiner assesses actual behavior. Explaining a bug in the implementation can demonstrate understanding. An invalid question or answer key must be corrected before the concept can pass; disputes never award completion. It should not ask which file contains a class or whether you remember a function name.

Interactive commands during a terminal check:

```text
/learn              Explain this concept and give me a new scenario
/dispute <reason>   Recheck an ambiguous or incorrect premise
/quit               Save progress and leave the operation pending
```

The CLI also exposes a manual JSON protocol for integrations and debugging. These commands return questions and feedback, but never private answer keys. Codex/Claude use `sphinx mcp` internally; Pi calls the same questionnaire controller from its extension. Neither asks the coding model to run these commands or supply answers:

```sh
sphinx pending --json
sphinx check --json
sphinx answer <assessment-id> --text 'Your answer and reason' --json
sphinx explain <assessment-id> --json
sphinx dispute <assessment-id> --text 'Why the premise is wrong' --json
```

## Keep model usage small

Routing is deterministic and makes no model request of its own. The default heuristics use **added plus deleted lines**, file count, and configurable consequential path terms:

| Tier | Default rule |
| --- | --- |
| Small | At most 80 changed lines and 3 files |
| Medium | Between the small and large thresholds |
| Large | At least 400 changed lines, 12 files, or a consequential path |

Consequential paths include names containing `auth`, `permission`, `migration`, `billing`, `payment`, `crypto`, `security`, or `terraform`. A matching path promotes a change to large even when the patch is tiny. A one-file change is not necessarily small: line count and consequential paths count too. These are configurable heuristics, not a semantic risk classification. Ignored files do not contribute to routing counts.

The same deterministic tier sets the question ceiling together with your chosen depth:

| Change tier | Relaxed | Standard | Thorough |
| --- | --- | --- | --- |
| Small | 1 | 1 | 1 |
| Medium | Up to 2 | Up to 2 | Up to 3 |
| Large | Up to 2 | Up to 3 | Up to 5 |

These are ceilings, not quotas. The evaluator asks fewer questions when the evidence supports fewer distinct behaviors, with at least one question for an assessed change. It does not add filler to reach the ceiling. A wrong answer still leads to teaching and a replacement question about the same concept, so retries can exceed the initial question count subject to any explicitly configured model-call cap.

Sphinx chooses the tier and uses its saved model route. Depth sets how many concepts it can assess; changing models does not change the question ceiling. Presets are starting points you can change without reinstalling:

| Preset | Small and medium | Large | Usage source |
| --- | --- | --- | --- |
| `codex-economy` | `codex:gpt-6-luna` | `codex:gpt-6-luna` | Your Codex CLI account |
| `claude-economy` | `claude:haiku` | `claude:haiku` | Your Claude CLI account |
| `openrouter-value` (experimental) | `openrouter:anthropic/claude-haiku-5.5` | `openrouter:anthropic/claude-haiku-5.5` | Paid OpenRouter credits |
| `openrouter-deepseek` (experimental) | `openrouter:deepseek/deepseek-v3.2` | `openrouter:deepseek/deepseek-v3.2` | Paid OpenRouter credits |
| `openrouter-free` | `openrouter:openrouter/free` | `openrouter:openrouter/free` | OpenRouter free availability and limits |

Codex and Claude presets keep the economical model for all tiers; investigation effort and question count still scale with change size. The Claude `haiku` alias follows the available Haiku model. Neither preset automatically upgrades to a more expensive model. Model access and plan limits depend on your account; see [Codex models](https://learn.chatgpt.com/docs/models) and [Claude model configuration](https://code.claude.com/docs/en/model-config).

```sh
# Change the saved reviewer routes without reinstalling.
sphinx config --preset openrouter-value --allow-paid

# Or choose each tier yourself.
sphinx config --small claude:haiku --medium claude:haiku --large claude:sonnet
```

The paid value preset uses Haiku 5.5 with an 8,192-token output ceiling, including reasoning. Reference prices checked **October 15, 2026** start at $0.10 input / $0.50 output per million tokens below 100,000 input tokens; the listed higher context tier is $0.50/$2.50. Rates vary by endpoint and over time; see [Haiku endpoints](https://openrouter.ai/api/v1/models/anthropic/claude-haiku-5.5/endpoints). At the lower rates, 30,000 input plus 2,000 output tokens costs about $0.004; a whole check includes multiple requests and repeated context. Existing saved routes do not change automatically: apply the preset to opt in, and use `--max-output-tokens` to override its output ceiling. The assessment's call limit stays unchanged.

The [evaluation results](eval/RESULTS.md) retain measured question quality, grading failures and corrections across Haiku, Qwen, DeepSeek and GLM. These synthetic cases are a limited development benchmark, not a reliability guarantee. Haiku's low-cost preset is experimental because it still rejected a sufficient qualitative answer in a focused test. DeepSeek remains an experimental open-weight preset; other OpenRouter models can be selected with explicit tier routes. Price and tool support alone do not establish question quality.

Interactive setup labels paid choices before selection. Noninteractive commands require `--allow-paid` or an existing `allowPaid: true` setting to choose paid OpenRouter routes. Free routes send zero-price provider limits even when another route permits paid models. There are no automatic paid fallbacks or uncounted model requests. Automatic retries and cache warming are disabled. Free availability and account limits still apply; see [OpenRouter limits](https://openrouter.ai/docs/api_reference/limits).

OpenRouter requests require endpoint support for their tool and output parameters. Capability metadata is a compatibility check, not a guarantee that every response is valid; unusable output leaves the check pending. OpenRouter's [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection) and [structured-output documentation](https://openrouter.ai/docs/guides/features/structured-outputs) explain these requirements.

Other controls:

- Investigation counts every model request, including any compaction. The first request already includes filtered, bounded diff pages read from the immutable checkpoint. These local reads consume no model calls; a self-contained change can propose questions on the first request. One independent audit request checks the whole proposed assessment before it is shown, subject to any configured call cap. Each submitted answer, learning request, or dispute uses one further request, plus another independent audit whenever it proposes a replacement question.
- Resume reuses the saved investigation, evidence, questions, and progress; approved changes reuse completion records. Listing status and pushing an already approved change consume no inference. A waiting Git operation can launch a review when no matching questions are prepared.
- Model calls have no default cap (`maxModelCalls: null`, `agentMaxTurns: null`); the reviewer still stops after three consecutive invalid responses and at the timeout. This covers background investigation, compaction, auditing, grading, corrections, and failed requests. Set an optional machine-wide cap with `sphinx config --max-model-calls 30` (1–100), or clear it with `sphinx config --max-model-calls unlimited` (`none` is an alias). These commands change no model routes and make no model request. Existing saved numeric caps remain in effect until changed. Existing checks adopt an edited cap when resumed and before their next request, preserving questions, progress, and all used calls. Lowering a cap below usage blocks further calls; clearing it preserves the count without a limit. If a review fails, the questionnaire offers explicit continuation of saved work; with a configured cap, it can offer a one-attempt extension when too few calls remain. Pause is the default. Provider failures never retry automatically. Setup, credential, stale-code, and deterministic evidence failures need to be resolved first. `sphinx check --id <id>` resumes saved work, and `--retry-review` can extend a configured allowance for a failed, questionless review. Active questionnaires cannot be reset this way.
- Small/medium/large reviews aim for 5/7/8 calls including the independent audit. These are planning targets, not hard stops. The advanced `agentMaxTurns` setting defaults to `null`; a numeric value explicitly caps investigation, compaction, question generation, and auditing for one review attempt. There is no hidden request cap when both settings are `null`. An explicitly configured total cap reserves calls for grading and limits all review and learning requests. Correctable tool or question-validation errors return feedback to Pi; they never increase an explicit cap or switch providers. `timeoutSeconds` still bounds the whole investigation, so unlimited calls do not mean unlimited execution time. `maxContextBytes` caps serialized review context—prompts, tools, and schemas—at 100,000 bytes by default. Pi compacts earlier using an estimated context threshold; review context that still exceeds the cap is rejected before a model call. Transport metadata is outside this count. The cap does not apply to the whole Git diff. `toolResultBytes` is an upper bound for each page (16,000 by default); pages are reduced to reserve context room for bounded batches of reads.
- Your configured `maxOutputTokens` applies to every tier, without an additional hidden size-based cap. Set it with `sphinx config --max-output-tokens 8192` (allowed range: 512–16,384). OpenRouter counts hidden model reasoning within this output limit; a larger ceiling can avoid truncation and permits more billed output, without increasing the assessment's call limit. Codex/Claude receive concise-output instructions and local timeout/output-byte limits; their CLI interfaces do not provide an equivalent hard Sphinx token cap.
- Small/medium changes request low reasoning effort; large changes request medium effort on supporting coding-agent CLIs.

Explicit call caps bound requests; context and page limits bound evidence. These controls they are not a guaranteed dollar or subscription-token ceiling. Set provider-side spending limits for paid accounts.

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

**Filtering happens before patch, line-count, and blob-content retrieval, including searches of unchanged files.** Ignored paths' contents are not read, persisted as evidence, or sent to an evaluator. Git may enumerate their names/object IDs to identify changes. Snapshot identity still binds the full commit/index, so a later ignored-file edit alongside an already assessed change can invalidate the previous record. Uncommitted working files are not used as code evidence; pre-commit pins indexed object IDs, and pre-push reads Git objects. The separately supplied `.sphinxcontext.md` is read from the current project directory and its hash binds the assessment.

Ignore rules match paths. They do not detect a secret embedded in an otherwise included source file. Add sensitive project-specific paths before running an assessment. Ignore policy symlinks are rejected rather than followed. Sphinx does not automatically apply `.gitignore` to already tracked files.

## Configuration

Global settings are stored at `~/.config/sphinx/config.json`. `SPHINX_HOME` relocates all Sphinx settings, credentials, and assessment state. `sphinx config` shows effective settings and configuration paths; `--preset`, `--small`, `--medium`, and `--large` change your machine-wide reviewer routes. Route changes invalidate prepared questions and completion records under the previous assessment policy. For a complete global example using the explicitly paid Haiku preset, see [examples/config.json](examples/config.json).

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

Supported repository overrides are `enabled`, `level`, `events`, `branches`, `remotes`, `exclude`, and `backgroundPreparation`, with `version: 1`. A repository cannot redirect source to another provider, supply credentials, or raise your usage budget. Repository excludes add to global excludes. `enabled: false` disables Sphinx for that repository. Existing `.sphinx.json` files remain supported when `.sphinxconfig` is absent.

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

This first version handles local Git commit/push checkpoints. Web merges, CI-required checks, deployment gates, signed remote attestations, automatic new-agent discovery after installation, and native Windows support are future work. Run `sphinx install` again to upgrade an existing installation with preparation hooks, or after adding a supported agent. Binary contents are not available as textual evidence. Missing remote history needs a `git fetch` before assessment. A first push compares against an empty tree; the reviewer investigates relevant parts through its tools, subject to its budgets. A comprehension assessment is not an exhaustive code audit.

The [live evaluation results](eval/RESULTS.md) record question quality, grading, costs, and observed failures on synthetic changes. They do not certify arbitrary repositories or every supported client version. See [CONTRIBUTING.md](CONTRIBUTING.md). The automated suite uses fixture evaluators and mock MCP clients, including an end-to-end Git-to-questionnaire workflow; it makes no paid or live inference requests.

## Development

```sh
npm ci
npm test
npm run eval -- --out /tmp/sphinx-eval.json
node bin/sphinx.js --help
```

The reviewer uses `@earendil-works/pi-coding-agent` 1.2.0. Install the locked dependencies with `npm ci` before development. Tests use Node's test runner, real temporary Git repositories, isolated integration homes, and fixture model backends. Never run installer tests against a real home directory or Git configuration.

The [evaluation runner](eval/README.md) includes committed Git fixtures, executable behavior oracles, question-quality checks, and known correct, incorrect, and invalid-question grading probes. Its default mode makes no model requests. Explicit live runs accept request/cost limits and save synthetic questions, evidence, grading results, and failure traces for inspection.

See [docs/architecture.md](docs/architecture.md) for module boundaries and assessment state. MIT licensed.
