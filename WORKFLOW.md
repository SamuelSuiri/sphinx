---
itervox_schema_version: 2
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: 385e48b25225
  active_states:
  - Todo
  - In Progress
  working_state: In Progress
  completion_state: In Review
  terminal_states:
  - Done
  - Canceled
  - Duplicate
  backlog_states:
  - Backlog
  failed_state: ''
polling:
  interval_ms: 60000
agent:
  command: /Users/parthbhagat/Downloads/sphinx/.itervox/setup/claude-opus
  max_turns: 1
  max_concurrent_agents: 3
  max_retries: 5
  turn_timeout_ms: 3600000
  read_timeout_ms: 120000
  stall_timeout_ms: 300000
  profiles:
    implementer:
      command: /Users/parthbhagat/Downloads/sphinx/.itervox/setup/claude-opus
      soul_file: .itervox/agents/implementer/SOUL.md
      instructions_file: .itervox/agents/implementer/INSTRUCTIONS.md
      allowed_actions:
      - comment
      - comment_pr
      backend: claude
      permission_mode: bypass
    reviewer:
      command: /Users/parthbhagat/Downloads/sphinx/.itervox/setup/claude-opus
      soul_file: .itervox/agents/reviewer/SOUL.md
      instructions_file: .itervox/agents/reviewer/INSTRUCTIONS.md
      allowed_actions:
      - comment
      - comment_pr
      backend: claude
      permission_mode: bypass
    input-responder:
      command: /Users/parthbhagat/Downloads/sphinx/.itervox/setup/claude-opus
      soul_file: .itervox/agents/input-responder/SOUL.md
      instructions_file: .itervox/agents/input-responder/INSTRUCTIONS.md
      allowed_actions:
      - comment
      - provide_input
      backend: claude
      permission_mode: bypass
    deps-analyzer:
      command: /Users/parthbhagat/Downloads/sphinx/.itervox/setup/claude-opus
      soul_file: .itervox/agents/deps-analyzer/SOUL.md
      instructions_file: .itervox/agents/deps-analyzer/INSTRUCTIONS.md
      backend: claude
      permission_mode: bypass
    release-reviewer:
      command: /Users/parthbhagat/Downloads/sphinx/.itervox/setup/claude-opus
      backend: claude
      enabled: true
      permission_mode: bypass
      soul_file: /Users/parthbhagat/Downloads/sphinx/.itervox/setup/reviewer/SOUL.md
      instructions_file: /Users/parthbhagat/Downloads/sphinx/.itervox/setup/reviewer/INSTRUCTIONS.md
      allowed_actions:
      - comment
      - comment_pr
  reviewer_profile: release-reviewer
  deps_analyzer_profile: deps-analyzer
  reviewer_prompt: 'You are the automatic code reviewer for {{ issue.identifier }}:
    {{ issue.title }}.

    Follow the release-reviewer profile instructions for this run. Review this issue''s

    existing PR and record a machine-readable verdict. The release controller handles

    implementation redispatch, merging, and issue completion.


    {% if issue.description %}## Issue description

    {{ issue.description }}{% endif %}

    {% if issue.comments %}## Issue comments

    {% for comment in issue.comments %}{{ comment.author_name }}: {{ comment.body
    }}

    {% endfor %}{% endif %}

    '
  available_models:
    claude:
    - id: claude-opus-5-5
      label: Opus 5.5
    codex:
    - id: gpt-6-sol
      label: GPT-6-Codex - Stable baseline
  backend: claude
  ssh_hosts: []
  pause_dispatch_when_any_in_state: []
  auto_review: false
  backend_fallback: false
  reviewer_profiles:
  - release-reviewer
  inline_input: false
workspace:
  root: /Users/parthbhagat/.itervox/workspaces/sphinx-4167faa9
  worktree: true
  clone_url: https://github.com/parthh01/sphinx.git
  base_branch: main
  auto_clear: false
hooks: {}
server:
  port: 0
  host: 127.0.0.1
dependencies:
  inferred_gating: false
  analysis_mode: manual
  stacked_prs: false
---

You are an expert engineer working on **sphinx**.

## Your issue

**{{ issue.identifier }}: {{ issue.title }}**

{% if issue.description %}
{{ issue.description }}
{% endif %}

Issue URL: {{ issue.url }}

{% if issue.comments %}
## Comments

{% for comment in issue.comments %}
**{{ comment.author_name }}**: {{ comment.body }}

{% endfor %}
{% endif %}

---

## Multi-Agent Configuration

This project has an `AGENTS.md`. Read it for multi-agent conventions and coordination rules:

```bash
cat AGENTS.md
```

---

## Step 1 — Explore before touching anything

Read the issue. Explore the relevant code before making changes.

---

## Step 2 — Inspect the prepared issue branch

```bash
git branch --show-current
git status --short
```

---

## Step 3 — Implement

Read `CLAUDE.md` to understand project conventions before writing any code:

```bash
cat CLAUDE.md
```

If `CLAUDE.md` does not exist, explore the repository structure and follow its existing conventions. Create instruction files only when the assigned issue requires them.

Detected stacks: Node.js. Follow their conventions as documented in `CLAUDE.md`.

---

## Step 4 — Run checks

Read `CLAUDE.md` for the project's test and lint commands. If `CLAUDE.md` does not exist, discover the check commands by exploring the repository (look for `Makefile`, `package.json` scripts, CI config, etc.).

```bash
# Node.js
pnpm test
pnpm check
```

---

## Step 5 — Commit and open PR

```bash
git add <specific files>
git commit -m "feat: <description> ({{ issue.identifier }})"
git push -u origin HEAD
gh pr create --title "<title> ({{ issue.identifier }})" --body "Closes {{ issue.url }}"
```

---

## Step 6 — Post PR link to tracker

After the PR is open, post its URL as a comment on the tracker issue so it is visible in Linear:

```bash
PR_URL=$(gh pr view --json url -q .url)
curl -s -X POST https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"mutation { commentCreate(input: { issueId: \\\"{{ issue.id }}\\\", body: \\\"PR: ${PR_URL}\\\" }) { success } }\"}"
```

---

## Rules

- Complete the issue fully before stopping.
- Never commit `.env` files or secrets.

---

## Asking for human input — CRITICAL

If you genuinely cannot proceed without a human decision (ambiguous spec,
destructive action, missing credentials, conflicting requirements), you **must**
emit the literal token `<!-- itervox:needs-input -->` on its own line at the
end of your final message, followed by exactly one concise question. Itervox
detects this token, pauses the issue, and surfaces the question in the
dashboard and tracker so a human can reply. The token is an HTML comment so
it stays invisible in rendered Linear/GitHub markdown.

**This is the preferred contract.** Itervox also has a deterministic fallback for
successful final messages that clearly block on a human decision or
confirmation request, but the sentinel is still better because it is
deterministic, cheaper, and less ambiguous. That fallback is heuristic and
tuned for common English phrasing. If you know you need input, emit the
sentinel instead of relying on plain-English phrasing to be inferred.

### Example — correct usage

```
I've reviewed the auth module and there are two viable approaches:
1. Refresh tokens with rotation (more secure, breaking change)
2. Extend the JWT TTL (backwards compatible, lower security)

I need your decision before proceeding because this affects all existing
API clients.

<!-- itervox:needs-input -->
Which approach should I take: rotation (1) or extended TTL (2)?
```

### When to use
- Ambiguous requirements that have multiple valid interpretations
- Destructive actions that cannot be automatically reverted
- Missing credentials, API keys, or access tokens
- Conflicting instructions in the issue description
- Decisions that affect backwards compatibility

### When NOT to use
- Status updates or progress reports
- Rhetorical questions in your reasoning
- Questions that you can answer yourself by exploring the code
- Minor style or naming decisions (make a reasonable choice and move on)

### Plain-English fallback

If you forget the sentinel but end your final message with a real blocking
question such as "Which option should I take?" or "Type discard to confirm",
Itervox will usually still pause the issue and wait for a reply. Treat this as
backup behavior, not the primary contract.

- The explicit marker is more reliable.
- The fallback is English-oriented; non-English or unusual phrasing may not be detected.

## Setup script: issue completion
<!-- itervox-setup: autonomous-release-v5-3 -->

This section defines the current autonomous delivery policy. It supersedes older
issue comments telling workers to wait for a PR number order, ask the operator
whether to merge, or stop the overall workflow at PR creation. If this run
was explicitly assigned a reviewer or automation role, follow that role's
instructions and state transitions instead of repeating the implementation.

### Independent parallel work

Read and follow this repository's AGENTS.md and CLAUDE.md when present. Work in
the issue worktree and branch that Itervox already prepared. Inspect the current
branch before doing anything; do not create the same branch again, switch to a
sibling issue's branch, or change another worker's worktree.

Read the issue's CURRENT description and acceptance criteria before continuing.
An earlier approval or completed implementation may address an older brief.
Reconcile the existing changes with the current brief; do not treat an old
approval as evidence that newly added or revised requirements are satisfied.
Keep the prepared branch even if a title edit generated a new suggested branch
name in Linear. Preserve and inspect unfinished changes from an interrupted run.

Other issues and pull requests may be active at the same time. Shared files or
a shared target branch alone are not dependencies. Implement this issue against
the configured base branch without waiting for unrelated pull requests to merge.
Do not ask the operator to choose a merge order just because work is concurrent.
Respect real, explicit issue prerequisites and repository approval requirements.
If a prerequisite is missing, first inspect the linked issue and repository to
establish what is actually unavailable; do not infer a blocker from file overlap.

Keep changes scoped to this issue. Follow existing conventions; do not create or
rewrite shared instruction files, plans, or scaffolding unless this issue needs
them. Before the final push, refresh the target branch. Resolve routine conflicts
whose intended behavior is clear from the issue, code, and tests, preserve both
changes' intended behavior, and rerun the affected checks. Do not overwrite remote
work or copy an unmerged sibling implementation to bypass a real prerequisite.

### Tests and the integration lane

Run the repository's relevant tests, build, lint, and type checks. Inspect failures
and repair those caused by the change. A failure that also occurs on the base
branch is still a failed release gate: diagnose and fix it when tractable instead
of declaring it safe to ignore. Preserve the intended test coverage; do not mute
tests or relax CI to manufacture a passing result. Ordinary CI failures and Git
conflicts return to you automatically with evidence from the release controller.
For a repair run, use the existing branch and PR, refresh the target branch,
resolve the reported problem, rerun verification, and push the new result.

The release controller owns automatic merging and issue completion. It allows
parallel implementation and processes one merge at a time per repository. Once
GitHub confirms that merge, the next eligible PR can proceed while the controller
finishes the Linear Done acknowledgement separately. Do not merge, enable GitHub
auto-merge, change Linear to Done, or wait inside a coding session for another PR
or CI. Return the worker slot once the PR and handoff are pushed; the controller
keeps working. An already merged PR ends implementation for that issue. Do not
reopen it or start another implementation run for consumed work.

### Actual prerequisites

File overlap is not a prerequisite. If code truly requires an unmerged PR in this
same repository, establish the specific missing interface from source and tests.
Write a JSON request outside the Git worktree at
$ITERVOX_RELEASE_REQUESTS_DIR/{{ issue.identifier }}.json with
{"requires": [123], "reason": "the concrete missing interface"}
(substitute actual positive PR numbers). Write it atomically. Preserve and commit
your useful scoped progress, write the handoff, push and create/update a draft PR
if useful, and finish normally. Do not ask the operator for a merge order. The
controller waits for those PRs to merge and automatically redispatches this issue.
Never invent a dependency from PR numbering. On the redispatched run, complete
the implementation and make the PR ready after verification.

### Complete the PR and release the worker

Implement, verify, and commit the relevant changes. Before the final push, write
a nonempty handoff at {{ run.handoff_path }} when provided and include it in the
commit and push. Push the issue branch and create or update its GitHub PR with
Related to {{ issue.identifier }}
in the description. Record the actual checks run and any concrete limitations.

Replace an older closing-keyword link in this PR with that related-issue link.
The implementation run is complete when its changes, handoff, and PR are pushed.
Return the PR URL and check results, without asking whether to merge and without
waiting for this or another issue's PR to merge. Itervox moves the successful
implementation to In Review. The release controller schedules the native code
reviewer when a review is needed and its persistent budget permits it. Review
findings return to implementation automatically; a passing review is tied to
the actual pushed commit. The release controller checks that review and CI,
queues repairs when needed, merges when eligible, and marks the issue Done after
GitHub confirms the merge. That confirmed merge completes the issue lifecycle.

Ask a focused question only for a genuine missing requirement, inaccessible
credential, required human approval, or conflict whose intended behavior cannot
be determined from the available evidence. Routine Git operations, ordinary
conflicts, another open PR, and a completed PR handoff are not by themselves
reasons to ask for input.

