# Jira Delivery MCP

A local stdio MCP (Model Context Protocol) server for Jira Cloud task retrieval and developer workflow automation. Works with any MCP-compatible AI coding agent or client.

**Supported clients:** Claude Code, Claude Desktop, Codex CLI, Cursor, Windsurf, VS Code MCP extensions, and any stdio-based MCP client.

## Install

> **v2 is in beta.** These instructions install it with the `@beta` tag. Plain `jira-delivery-mcp` still installs 1.x until 2.0.0 is released.

**Claude Code plugin (server + skill in one step).** The plugin asks for your Jira site, email and API token, and adds a skill that tells the agent when to use each tool:

```
/plugin install jira-delivery --marketplace teransarathchandra/jira-mcp-server
```

**Any MCP client.** No cloning required. Add the server to your MCP client config and it will be fetched from npm on first run:

```json
{
  "mcpServers": {
    "jira-delivery": {
      "command": "npx",
      "args": ["-y", "jira-delivery-mcp@beta"],
      "env": {
        "JIRA_BASE_URL": "https://your-domain.atlassian.net",
        "JIRA_EMAIL": "your-email@example.com",
        "JIRA_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

For Claude Code, one command does the same thing:

```bash
claude mcp add jira-delivery \
  --env JIRA_BASE_URL=https://your-domain.atlassian.net \
  --env JIRA_EMAIL=your-email@example.com \
  --env JIRA_API_TOKEN=your-api-token \
  -- npx -y jira-delivery-mcp@beta
```

Prefer a pinned global install instead of on-demand fetching:

```bash
npm install -g jira-delivery-mcp@beta
```

Then use `"command": "jira-delivery-mcp"` with no `args` in the config above.

Get your Jira API token at
[id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).

`JIRA_BASE_URL`, `JIRA_EMAIL`, and `JIRA_API_TOKEN` are the only required
variables. Everything else — project scoping, Confluence integration, custom
field IDs, context budgets — is optional and documented in
[`.env.example`](.env.example) and the [Configuration](#configuration) section.

**Requires Node.js 20 or newer.**

## What this MCP server does

This server connects your AI coding agent to your Jira Cloud instance. It supports any Jira project key and provides ten tools.

> **Upgrading from 1.x?** v2 consolidated 28 tools into the 10 below. See [Migrating from 1.x](#migrating-from-1x).

## Tools (v2)

| Tool | What it does | Key inputs |
|------|-------------|------------|
| `jira_get_issue` | Fetch a Jira issue as a developer brief | `issueKey`, `depth: basic\|full`, `includeConfluence` |
| `jira_search_issues` | List your open issues | `projectKey?`, `maxResults` |
| `jira_prepare_work_brief` | Turn an issue into a ready-to-implement brief for a coding agent | `issueKey`, `depth`, `includeConfluence` |
| `confluence_search` | Find Confluence pages related to an issue, ranked by relevance | `issueKey`, `maxResults`, `spaceKeys` |
| `confluence_get_page` | Read and summarise a Confluence page | `pageId`, `maxChars` |
| `delivery_check_changes` | Check the local diff against the issue: alignment, Definition of Done, impact | `issueKey`, `checks`, git refs |
| `delivery_traceability_matrix` | Map requirements to the changed files that implement them | `issueKey`, git refs |
| `delivery_generate` | Generate a test strategy, reviewer report, QA handoff, release notes or task report | `issueKey`, `type`, `persona?`, `audience?` |
| `delivery_generate_agent_pack` | Write reusable delivery prompts/commands for Claude Code, Codex or any agent into the repo | `client: claude\|codex\|generic` |
| `delivery_project_patterns` | Scan, read or clear stored repository conventions | `action: scan\|get\|clear` |

Git refs are `baseBranch` (default `origin/main`), `compareRef` (default `HEAD`) and `repoPath` (default `.`).

Every tool returns Markdown text plus `structuredContent` (`schemaVersion`, `tool`, `issueKey`, `markdown`, `warnings`) and carries annotations (`readOnlyHint`, `destructiveHint`) so clients know which calls change anything. Only `delivery_generate_agent_pack` and `delivery_project_patterns` write, and only to the local repository.

Also available:
- Resource `jira-delivery://config/projects`: which Jira projects this server is configured for.
- Prompts (slash commands): `jira_implementation_prompt`, `jira_pr_review_prompt`, `jira_qa_handoff_prompt`, `jira_definition_of_done_prompt`, `jira_release_note_prompt`.
- CLI: `npx jira-delivery-mcp setup <client>` prints setup instructions for `generic`, `claude-code`, `claude-desktop`, `codex-cli`, `cursor`, `windsurf` or `vscode`.

Additional capabilities:
- Converts Atlassian Document Format (ADF) to clean Markdown so descriptions are readable
- Generates structured implementation prompts for coding agents based on issue content
- Surfaces attachment filenames and URLs so you know what files are attached (without downloading them)

## Workflows: start a ticket, verify before PR

Two tools return typed `data` in `structuredContent` alongside their Markdown, so an agent can act on the result without parsing text.

### Start a ticket: `jira_prepare_work_brief`

The text starts with a short **Start here** section (readiness, blockers, next steps, questions, branch) followed by the implementation prompt. `data` looks like this:

```json
{
  "issue": { "key": "ABC-1", "summary": "Add login rate limiting", "type": "Story", "status": "To Do", "statusCategory": "new", "priority": "Medium", "assignee": null },
  "readiness": { "status": "MOSTLY_READY", "score": 60, "confidence": "high", "gaps": [] },
  "acceptanceCriteria": [
    { "text": "Lock the account for 15 minutes after 5 failed login attempts", "source": "description" },
    { "text": "Show a lockout message with the remaining lock time", "source": "description" }
  ],
  "blockers": [],
  "recommendedActions": [
    { "id": "create-branch", "text": "Create the suggested branch (see branchName).", "evidence": ["issue:ABC-1:summary"] },
    { "id": "implement-and-verify", "text": "Implement against the 2 acceptance criteria, then run delivery_check_changes.", "evidence": ["issue:ABC-1:description"] }
  ],
  "clarifyingQuestions": [],
  "branchName": "feature/ABC-1-add-login-rate-limiting",
  "evidence": { "comments": "observed", "linkedIssues": "observed_empty", "subtasks": "observed_empty", "parent": "observed_empty", "epic": "observed_empty", "acceptanceCriteriaField": "not_configured", "confluence": "not_requested" }
}
```

How it decides:
- **Readiness** is `BLOCKED` only when an issue that blocks this one ("is blocked by") is still open. A link where this ticket blocks another one never blocks it.
- **Acceptance criteria** come from your configured `JIRA_ACCEPTANCE_CRITERIA_FIELD_ID` first, then from the description. No criteria at all means `NEEDS_CLARIFICATION`.
- **Confidence** drops when something couldn't be read (a linked issue you can't see, truncated comments). Missing data is never reported as "none".
- **Actions** (2–4) and **questions** (0–3) come from fixed templates. Ticket text decides which ones apply but is never copied into them. A question is asked only when its answer could change the first step.
- **Branch name** follows `JIRA_BRANCH_PATTERN` (default `{type}/{KEY}-{slug}`): Bug/Defect → `fix`, Story/Feature/Improvement/Epic → `feature`, anything else → `chore`. It's a suggestion; nothing runs git.
- **`allowElicitation: true`** asks the questions in a form when your client supports it. Answers come back in `clarifyingQuestions[].answer` for that response only and are never stored. The form waits up to 60 seconds; some clients cancel a tool call after 60 seconds in total, so answer promptly or leave it off.

### Verify before PR: `delivery_check_changes`

`data` holds a single verdict plus the detail behind it:

```json
{
  "verdict": "needs_work",
  "summary": "Needs work: 1 missing, 0 partial criteria, 0 required fixes.",
  "alignment": {
    "status": "PARTIALLY_ALIGNED", "score": 55, "confidence": "Medium",
    "criteria": [
      { "text": "Lock the account for 15 minutes after 5 failed login attempts", "status": "covered", "files": ["src/auth/rateLimit.ts"] },
      { "text": "Show a lockout message with the remaining lock time", "status": "missing", "files": [] }
    ],
    "unrelatedChanges": [], "testSignal": "tests_added"
  },
  "dod": { "status": "NEEDS_SMALL_FIXES", "score": 72, "confidence": "Medium", "failed": [], "warnings": [], "requiredFixes": [] },
  "impact": { "likelyAffectedAreas": ["auth"], "riskyDownstreamFlows": [], "unknowns": [] },
  "failedChecks": [],
  "diff": { "baseBranch": "origin/main", "compareRef": "HEAD", "filesChanged": 2, "truncated": false }
}
```

The verdict comes only from the diff-based checks (`alignment`, `dod`); `impact` is advisory.
- `insufficient_evidence`: no changes against the base branch, the diff couldn't be read, a selected diff-based check crashed, alignment found no evidence, or some criteria have no evidence.
- `needs_work`: a criterion is `missing` or only `partial`, the Definition of Done failed, or there are required fixes.
- `ready_for_pr`: every criterion is `covered` and the Definition of Done passed.

## Hand off: write back to Jira

Two write tools finish the loop without leaving your editor. They are **off by default**: set `JIRA_ENABLE_WRITES=true` in the server's environment to register them.

| Tool | What it does |
|------|-------------|
| `jira_add_comment` | Post a Markdown comment (e.g. the QA handoff or release notes from `delivery_generate`), converted to Jira's rich text |
| `jira_update_issue` | `transitionTo` a status or transition name, `assignToMe`, and/or `link` a branch or PR URL |

Every write is guarded:
- **Preview first.** The first call changes nothing. It returns exactly what will be sent and a single-use `confirmToken` (valid 5 minutes). Calling again with the same arguments plus the token applies it; a changed argument or a reused token is refused.
- **Or confirm in a form.** If your client supports form elicitation, you're asked "Apply these changes to ABC-1?" directly and the write happens in one call. Answering no changes nothing and issues no token; a new attempt needs a fresh preview.
- **Never retried.** A write request is sent once. If it times out or Jira answers 5xx, the outcome is unknown — the result says so; check the issue before confirming again. If Jira rejects a write (e.g. a status needs a resolution), its reason is shown.
- **Audited.** Each step is appended to `~/.jira-delivery-mcp/audit.log` (override with `JIRA_DELIVERY_AUDIT_LOG`): time, tool, issue, action, outcome. No comment text, tokens or credentials.
- **Allowlist.** With `JIRA_STRICT_PROJECT_ALLOWLIST=true`, writes outside `JIRA_ALLOWED_PROJECT_KEYS` are refused before any preview.

Transitions are matched by name, then by target status, case-insensitively. If nothing matches, the available transitions are listed and nothing changes.

## Migrating from 1.x

| v1 tool | v2 equivalent |
|---|---|
| `jira_get_issue` | `jira_get_issue` |
| `jira_get_issue_context` | `jira_get_issue` with `depth: "full"` |
| `jira_get_issue_with_confluence_context` | `jira_get_issue` with `includeConfluence: true` |
| `jira_search_my_open_issues` | `jira_search_issues` |
| `jira_prepare_work_prompt` | `jira_prepare_work_brief` |
| `jira_prepare_contextual_work_prompt` | `jira_prepare_work_brief` with `depth: "full"` |
| `jira_prepare_confluence_enriched_work_prompt` | `jira_prepare_work_brief` with `includeConfluence: true` |
| `confluence_search_related_pages` | `confluence_search` |
| `confluence_get_page_summary` | `confluence_get_page` |
| `jira_review_pr_alignment` | `delivery_check_changes` with `checks: ["alignment"]` |
| `jira_prepare_pr_review_prompt` | `delivery_check_changes` (or the `jira_pr_review_prompt` prompt) |
| `delivery_verify_definition_of_done` | `delivery_check_changes` with `checks: ["dod"]` |
| `delivery_analyze_implementation_impact` | `delivery_check_changes` with `checks: ["impact"]` |
| `delivery_get_traceability_matrix` | `delivery_traceability_matrix` |
| `delivery_generate_test_strategy` | `delivery_generate` with `type: "test_strategy"` |
| `delivery_generate_reviewer_report` | `delivery_generate` with `type: "reviewer_report"` and `persona` |
| `delivery_generate_qa_handoff` | `delivery_generate` with `type: "qa_handoff"` |
| `delivery_generate_release_notes` | `delivery_generate` with `type: "release_notes"` and `audience` |
| `delivery_export_task_report` | `delivery_generate` with `type: "task_report"` (returns Markdown, writes no file) |
| `delivery_generate_claude_workflow_pack` | `delivery_generate_agent_pack` with `client: "claude"` |
| `delivery_generate_codex_prompt_pack` | `delivery_generate_agent_pack` with `client: "codex"` |
| `delivery_generate_generic_prompt_pack` | `delivery_generate_agent_pack` with `client: "generic"` |
| `delivery_scan_project_patterns` | `delivery_project_patterns` with `action: "scan"` |
| `delivery_get_project_patterns` | `delivery_project_patterns` with `action: "get"` |
| `delivery_clear_project_patterns` | `delivery_project_patterns` with `action: "clear"` |
| `jira_list_configured_projects` | resource `jira-delivery://config/projects` |
| `mcp_get_client_setup_instructions` | CLI `npx jira-delivery-mcp setup <client>` |
| `mcp_clear_cache` | removed (restart the server) |

Parameters that v2 no longer accepts are listed in the [CHANGELOG](CHANGELOG.md#removed-parameters).

## What this server does NOT do

- Does not create, edit, or delete Jira issues
- Does not add comments to Jira
- Does not transition issue statuses
- Does not download attachments — it lists filenames and URLs only
- Does not support pagination beyond the first page (max 50 results for search)
- Does not write to Confluence
- Does not use an LLM internally — all logic is deterministic and rule-based

## Prerequisites

- Node.js 20+
- A Jira Cloud account with API token access

## Creating an Atlassian API token

1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Click **Create API token**
3. Give it a descriptive name (e.g. `jira-delivery-mcp`) and click **Create**
4. Copy the token immediately — it is only shown once

## Installation and configuration

```bash
git clone <repo>
cd jira-mcp-server
npm install
cp .env.example .env
# Edit .env with your credentials
npm run build
```

Create or edit `.env` with your Jira credentials:

```
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_EMAIL=your-email@example.com
JIRA_API_TOKEN=your-api-token

# Optional: configure your Jira project(s)
JIRA_DEFAULT_PROJECT_KEY=ENG
JIRA_ALLOWED_PROJECT_KEYS=ENG,DATA,OPS
JIRA_STRICT_PROJECT_ALLOWLIST=true

# Optional: MCP client profile (affects setup instructions and generated examples)
# Supported: generic, claude-code, claude-desktop, codex-cli, cursor, windsurf, vscode
MCP_CLIENT_PROFILE=generic
```

| Variable | Required | Description |
|----------|----------|-------------|
| `JIRA_BASE_URL` | Yes | Your Jira Cloud base URL (no trailing slash) |
| `JIRA_EMAIL` | Yes | The email address of your Atlassian account |
| `JIRA_API_TOKEN` | Yes | The API token you created above |
| `JIRA_DEFAULT_PROJECT_KEY` | No | Default project key for searches (e.g. `ENG`, `CMPI`) |
| `JIRA_ALLOWED_PROJECT_KEYS` | No | Comma-separated allowed project keys (e.g. `ENG,DATA,OPS`) |
| `JIRA_STRICT_PROJECT_ALLOWLIST` | No | If `true`, only allow project keys in `JIRA_ALLOWED_PROJECT_KEYS` |
| `JIRA_ISSUE_KEY_PATTERN` | No | Custom regex for issue key validation (default: `^[A-Z][A-Z0-9]+-\d+$`) |
| `JIRA_EXAMPLE_ISSUE_KEY` | No | Example issue key shown in tool hints (auto-derived if not set) |
| `JIRA_PROJECT_KEY` | No | **Deprecated** — use `JIRA_DEFAULT_PROJECT_KEY` instead |
| `MCP_CLIENT_PROFILE` | No | Client profile for setup instructions (default: `generic`) |

### Multi-team Configuration Examples

**Single team (e.g. engineering):**
```env
JIRA_DEFAULT_PROJECT_KEY=ENG
JIRA_ALLOWED_PROJECT_KEYS=ENG
JIRA_STRICT_PROJECT_ALLOWLIST=true
```

**Multiple teams sharing one server:**
```env
JIRA_DEFAULT_PROJECT_KEY=ENG
JIRA_ALLOWED_PROJECT_KEYS=ENG,DATA,OPS
JIRA_STRICT_PROJECT_ALLOWLIST=true
```

**Open access — all Jira projects:**
```env
JIRA_STRICT_PROJECT_ALLOWLIST=false
```

## Running locally

```bash
# Build first (required after any source change)
npm run build

# Test the server starts (it waits for MCP input — Ctrl+C to stop)
node dist/index.js
```

The server communicates over stdio and produces no output until an MCP client connects.

## Client Setup

---

### Using with Claude Code

Register the server using the `claude mcp add` command. Replace the path with the absolute path to your local clone:

```bash
claude mcp add --transport stdio jira-delivery-mcp -- node /absolute/path/to/dist/index.js
```

#### Passing environment variables

```bash
claude mcp add --transport stdio jira-delivery-mcp \
  --env JIRA_BASE_URL=https://your-domain.atlassian.net \
  --env JIRA_EMAIL=your-email@example.com \
  --env JIRA_API_TOKEN=your-api-token \
  --env JIRA_DEFAULT_PROJECT_KEY=ENG \
  --env MCP_CLIENT_PROFILE=claude-code \
  -- node /absolute/path/to/dist/index.js
```

#### Verify registration

```bash
claude mcp list
```

You should see `jira-delivery-mcp` in the output.

#### Example Claude Code prompts

After registering, use these prompts in Claude Code:

```
Use the Jira MCP server to fetch ENG-123 and prepare an implementation plan.
Fetch ENG-123 from Jira, inspect this repo, and implement the task carefully.
Show my open Jira issues.
Use delivery_check_changes for ENG-123 and review my current branch.
Use Jira MCP to verify Definition of Done for ENG-123.
Use Jira MCP to generate the Claude Code workflow pack.
```

#### Claude Code workflow pack (Claude-specific)

The `delivery_generate_agent_pack` (client: claude) tool generates `.claude/skills/` and `.claude/commands/` files that turn Jira delivery workflows into reusable slash commands in Claude Code:

```
Use Jira MCP to generate the Claude Code workflow pack.
```

Generated slash commands (after running the workflow pack):
- `/jira-plan ENG-123` — Implementation plan
- `/jira-review-pr ENG-123` — PR alignment review
- `/jira-dod ENG-123` — Definition of Done check
- `/jira-qa ENG-123` — QA handoff

---

### Using with Codex CLI

#### Prerequisites

- Codex CLI installed and authenticated
- MCP server built: `npm run build`

#### Configuration

Add the server to your Codex CLI MCP configuration. Codex CLI supports MCP servers configured via `~/.codex/config.toml` (or the equivalent Codex CLI config path for your installation):

```toml
# ~/.codex/config.toml

[mcp_servers.jira-delivery-mcp]
command = "node"
args = ["/absolute/path/to/dist/index.js"]
env = { JIRA_BASE_URL = "https://your-domain.atlassian.net", JIRA_EMAIL = "your-email@example.com", JIRA_API_TOKEN = "your-api-token", MCP_CLIENT_PROFILE = "codex-cli" }
```

> **Note:** Codex CLI MCP configuration paths and syntax may vary by version. Check `codex --help` or the Codex CLI documentation for the exact format supported by your installation.

#### Generate a Codex CLI prompt pack

The `delivery_generate_agent_pack` (client: codex) tool creates `.codex-prompts/` files with ready-to-use Codex prompts:

```
Use Jira MCP to generate the Codex CLI prompt pack.
```

Generated files:
- `.codex-prompts/implement-jira-task.md`
- `.codex-prompts/review-pr-against-jira.md`
- `.codex-prompts/generate-test-strategy.md`
- `.codex-prompts/verify-definition-of-done.md`

Use them in Codex CLI:

```bash
codex "$(cat .codex-prompts/implement-jira-task.md)"
```

#### Example Codex CLI prompts

```
Use the Jira Delivery MCP server to fetch ENG-123 and prepare an implementation plan.
Use the Jira Delivery MCP server to review my current branch against ENG-123.
Use the Jira Delivery MCP server to generate a test strategy for ENG-123.
```

#### Security note (Codex CLI)

- Keep the server local and read-only.
- Do not expose Jira or Confluence credentials in prompts.
- Store credentials in environment variables or the Codex CLI config file, not in plain text prompts.

---

### Using with Cursor, Windsurf, or VS Code

Most MCP-compatible editors support stdio-based servers. The general configuration pattern is:

**Server name:** `jira-delivery-mcp`
**Command:** `node`
**Args:** `["/absolute/path/to/dist/index.js"]`
**Environment:** `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`

For Cursor:
1. Open Cursor Settings → Features → MCP → Add Server
2. Enter the command and args
3. Pass credentials via the environment section

For Windsurf:
1. Open Windsurf Settings → MCP Servers → Add
2. Enter the server command and args

For VS Code:
1. Configure the server in your VS Code MCP extension settings
2. Pass credentials via environment variables

For tailored instructions for your client, run:

```
npx jira-delivery-mcp setup cursor
```

---

### Generic stdio MCP client

Any MCP client that supports stdio transport can connect to this server. The standard configuration pattern is:

```json
{
  "mcpServers": {
    "jira-delivery-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"],
      "env": {
        "JIRA_BASE_URL": "https://your-domain.atlassian.net",
        "JIRA_EMAIL": "your-email@example.com",
        "JIRA_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

Refer to your client's documentation for where to place this configuration.

#### Getting client-specific setup instructions

The `setup` command prints setup instructions for any supported client, and needs no Jira credentials:

```bash
npx jira-delivery-mcp setup codex-cli
```

Supported client values: `generic`, `claude-code`, `claude-desktop`, `codex-cli`, `cursor`, `windsurf`, `vscode`

---

## Example usage

These prompts work with any MCP-compatible AI coding agent:

```
Fetch ENG-123 from Jira and prepare an implementation plan.
Show my open Jira issues.
Review my current branch against ENG-123.
Verify Definition of Done for ENG-123.
Generate a QA handoff for ENG-123.
Generate a test strategy for ENG-123.
Generate release notes for ENG-123.
```

Direct tool usage:
```
jira_get_issue({"issueKey": "ENG-123"})
jira_prepare_work_brief({"issueKey": "ENG-123"})
jira_search_issues({"maxResults": 10})
delivery_check_changes({"issueKey": "ENG-123", "checks": ["dod"]})
```

## Context-aware Jira task fetching

The server includes two advanced tools that gather surrounding context from Jira — parent issues, epics, linked issues, subtasks, and analyzed comments — to produce a richer brief for implementing complex requirements.

### `jira_get_issue` (depth: full)

Fetches an issue and its surrounding Jira context, producing a comprehensive developer brief.

```json
{
  "issueKey": "ENG-123",
  "depth": "full"
}
```

It fetches the parent, epic, up to 8 linked issues, up to 10 subtasks and up to 10 comments per issue (epic siblings are not included). Add `"includeConfluence": true` to fold in related Confluence pages.

Output includes: Main Task metadata, Core Requirement, Acceptance Criteria, Requirement Clarifications from Comments, Parent/Epic Context, Related Issues, Subtasks, Possible Dependencies/Blockers, Technical Signals, Risk/Ambiguity, and a Final Implementation Prompt.

### `jira_prepare_work_brief` (depth: full)

Same as `jira_get_issue` (depth: full) but returns only the final implementation prompt — ready to paste directly into any AI coding agent.

```json
{
  "issueKey": "ENG-123",
  "depth": "full"
}
```

### Optional: Epic field configuration

Some Jira Cloud projects store the epic link in a custom field (e.g., `customfield_10014`). Add it to `.env` if automatic epic detection does not work:

```
JIRA_EPIC_FIELD_ID=customfield_10014
```

Standard Jira Cloud projects do not need this setting — the server tries the standard `epic` field first.

### Context budget controls

- `depth: "basic"` (the default) fetches only the issue itself; use `"full"` only when the surrounding context matters.
- The full-depth limits (8 linked issues, 10 subtasks, 10 comments per issue, no epic siblings) are fixed in v2.
- If the brief is too large, lower `JIRA_MAX_CONTEXT_CHARS` (default `30000`).

### Why these tools are still read-only

Both tools only read from Jira. They do not create, update, delete, comment on, or transition any Jira issues.

## Requirement Intelligence Layer

The context-aware tools include a built-in intelligence layer that evaluates Jira context quality before generating the implementation brief. No LLM is used — all logic is deterministic and rule-based.

### What the intelligence layer does

| Component | Purpose |
|---|---|
| Authority Ranker | Classifies each information source (description, AC, comments, parent, epic) by authority level |
| Relevance Scorer | Scores linked issues as High / Medium / Low relevance and filters noise |
| Readiness Evaluator | Checks if the ticket has enough information to implement (READY / MOSTLY_READY / NEEDS_CLARIFICATION / BLOCKED) |
| Conflict Detector | Detects contradictions between description, comments, parent, and epic |
| Clarification Generator | Generates up to 5 specific, implementation-focused questions when the ticket is unclear |
| Repo Inspection Hint Generator | Produces targeted instructions for the coding agent to inspect the right files before editing |
| Context Quality Scorer | Produces a 0-100 quality score for the assembled Jira context |

### Updated context brief sections

When using `jira_get_issue` (depth: full), the brief includes:
- **Context Quality** — Score and interpretation (0-100)
- **Requirement Authority** — Which sources are most authoritative
- **Implementation Readiness** — READY / MOSTLY_READY / NEEDS_CLARIFICATION / BLOCKED with reasons
- **Relevant Jira Context** — Linked issues ranked by relevance (High / Medium / Omitted)
- **Conflicts** — Detected contradictions with impact and recommended handling
- **Suggested Repo Inspection Targets** — Specific instructions for the coding agent
- **Clarification Needed** — Practical questions (only shown when ticket is unclear or blocked)

### Optional environment variables

```
# Identify the custom field used for Epic Links (if standard epic field doesn't work)
JIRA_EPIC_FIELD_ID=customfield_10014

# Custom field IDs for additional context (optional)
JIRA_STORY_POINTS_FIELD_ID=customfield_10016
JIRA_ACCEPTANCE_CRITERIA_FIELD_ID=customfield_10020
JIRA_TEAM_FIELD_ID=customfield_10018

# Comma-separated emails of high-authority authors (e.g., product owners, tech leads)
JIRA_HIGH_AUTHORITY_AUTHOR_EMAILS=product-owner@example.com,tech-lead@example.com

# Comma-separated Jira account IDs of high-authority authors (alternative to email)
JIRA_HIGH_AUTHORITY_ACCOUNT_IDS=account-id-1,account-id-2

# Maximum characters for the full context output (default: 30000)
JIRA_MAX_CONTEXT_CHARS=30000
```

### Readiness statuses

| Status | Meaning |
|---|---|
| READY | Proceed with implementation |
| MOSTLY_READY | Proceed, but flag any unclear specifics |
| NEEDS_CLARIFICATION | Seek answers to open questions before or during implementation |
| BLOCKED | Resolve blocker issues before starting |

## Reviewing a PR against a Jira task

### Overview

The `delivery_check_changes` (checks: alignment) tool compares a PR's changes against the Jira requirement to produce an evidence-based alignment report. It reports a score, confidence level, matched requirements, missing requirements, unrelated changes, risky changes, and practical review comments.

### How changes are read

Compares a local branch against a base branch using git. No GitHub API required.

### `delivery_check_changes` (checks: alignment)

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `issueKey` | yes | — | Jira issue key, e.g. `ENG-123` |
| `baseBranch` | no | `origin/main` | Base branch to compare against |
| `compareRef` | no | `HEAD` | Branch, commit SHA, or ref to compare |
| `repoPath` | no | `.` | Path to the git repository |
| `maxDiffChars` | no | `50000` | Max characters of diff to analyze |

### Choosing checks

`delivery_check_changes` also accepts `checks` (default: all three) and `includeConfluence` (default `true`):

| `checks` value | What it runs |
|-----------|-------------|
| `alignment` | The alignment report above |
| `dod` | The 14-point Definition of Done verdict |
| `impact` | Predicted implementation impact |

Each check runs independently. If one fails (for example, Confluence returns 401), the others still report and the failure appears in `warnings`.

### Usage examples

```
# Review local changes against ENG-123
Use delivery_check_changes (checks: alignment) with issueKey: "ENG-123"

# Review a specific branch
Use delivery_check_changes (checks: alignment) with issueKey: "ENG-123", baseBranch: "main", compareRef: "feature/my-branch"

# Prepare a review prompt
Use delivery_check_changes with issueKey: "ENG-123"
```

### Understanding the alignment score

The score is 0–100, broken down as:

| Points | Component |
|--------|-----------|
| 40 | Acceptance criteria coverage (key term matching in diff and file paths) |
| 20 | Technical signal match (file names, API paths from Jira description) |
| 15 | Relevant files changed (low unrelated change ratio) |
| 15 | Tests added or updated |
| 10 | Low noise (no truncation, no risky files, no ambiguities) |

Possible statuses:

| Status | Score range |
|--------|-------------|
| `STRONGLY_ALIGNED` | 80+ |
| `MOSTLY_ALIGNED` | 65+ |
| `PARTIALLY_ALIGNED` | 45+ |
| `WEAKLY_ALIGNED` | 25+ |
| `NOT_ENOUGH_EVIDENCE` | <25 or no files changed |

### Important limitations

- The score is heuristic — it uses keyword and pattern matching, not semantic understanding.
- A high score does not guarantee the PR is correct or complete.
- A low score may result from poor Jira description quality, not poor implementation.
- **This is not a replacement for human code review.** Use it as a pre-review checklist.
- The tool never posts PR comments, approves/rejects PRs, or modifies Jira issues.
- Git access is read-only. Jira access is read-only.

## Confluence Integration

The server can optionally enrich Jira issue context with relevant Confluence documentation. When configured, it searches Confluence for pages related to a Jira ticket, scores them by relevance, and includes the most useful content in the implementation context.

### What it does

- Searches Confluence for pages related to a Jira ticket using targeted CQL queries
- Scores pages by relevance to the Jira task (issue key mentions, label matches, technical term matches)
- Ranks pages by documentation authority (PRD, technical design, architecture docs score higher)
- Converts Confluence HTML to readable Markdown
- Extracts requirement signals: business rules, API endpoints, UI screens, validation rules, permissions
- Detects conflicts between Jira requirements and Confluence documentation
- Produces a combined implementation brief with Jira + Confluence context

### What it does NOT do

- **Does not write to Confluence**: Read-only access only. No pages are created, edited, or deleted.
- **Does not update Jira**: Jira data is also read-only.
- **Does not use an LLM**: All analysis is deterministic and rule-based.
- **Does not blindly include all Confluence content**: Only relevant pages (relevance score ≥ 25) are included by default.

### Required environment variables

| Variable | Description |
|----------|-------------|
| `CONFLUENCE_BASE_URL` | Your Confluence base URL (e.g. `https://your-domain.atlassian.net/wiki`) |
| `CONFLUENCE_EMAIL` | Your Atlassian account email |
| `CONFLUENCE_API_TOKEN` | Your Atlassian API token |

The server starts and Jira tools work normally even when these are not set. Confluence-specific tools return a clear error when Confluence is not configured.

### Optional environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CONFLUENCE_SPACE_KEYS` | (all spaces) | Comma-separated space keys to restrict search |
| `CONFLUENCE_MAX_SEARCH_RESULTS` | `10` | Max pages to return from Confluence search |
| `CONFLUENCE_MAX_PAGES_TO_READ` | `5` | Max pages to read full body content for |
| `CONFLUENCE_MAX_PAGE_CHARS` | `12000` | Max characters per page body |
| `CONFLUENCE_ENABLED` | `true` | Set to `false` to disable even if credentials are set |
| `CONFLUENCE_LABEL_BOOSTS` | `requirements,prd,technical-design,...` | Labels that boost relevance score |
| `CONFLUENCE_EXCLUDE_LABELS` | `deprecated,archive,draft` | Labels that penalize relevance score |
| `CONFLUENCE_TITLE_BOOST_TERMS` | `requirement,prd,design,spec,...` | Title keywords for authority detection |

### How Confluence search works

The server builds multiple targeted CQL queries from the Jira ticket context:

1. **Jira key search**: Find pages that mention the exact issue key (e.g. `ENG-123`)
2. **Epic/parent search**: Find pages mentioning the epic or parent issue key
3. **Summary phrase search**: Find pages whose titles contain key words from the Jira summary
4. **Technical terms search**: Find pages mentioning API names, module names, or other technical signals

Results are deduplicated by page ID and scored for relevance before any page body is read.

### Relevance scoring

- +40: Page body mentions the exact Jira issue key
- +30: Page is directly linked from the Jira description or comments
- +25: Page mentions the epic or parent issue key
- +20: Page title contains keywords from the Jira summary
- -30: Page is stale, deprecated, or archived

Only pages scoring ≥ 25 are included by default.

### Jira and Confluence authority model

Jira is always the primary source of truth:

- **Jira acceptance criteria and latest comments**: Primary authority. Always followed.
- **Directly-linked Confluence pages**: Supporting/authoritative. Followed unless they conflict with Jira.
- **Keyword-matched Confluence pages**: Background context only. Used for additional understanding, not as requirements.
- **Stale/deprecated Confluence pages**: Marked with warnings. Never treated as authoritative.

### Example usage

```
Use jira_prepare_work_brief (includeConfluence: true) for ENG-123
Use confluence_search for ENG-123 and explain which pages are most relevant
Use jira_get_issue (includeConfluence: true) for ENG-123, then inspect this repo and implement the confirmed requirement
Use confluence_get_page with pageId: "123456789"
```

### Troubleshooting Confluence

| Problem | Fix |
|---------|-----|
| `401 Unauthorized` | Check `CONFLUENCE_EMAIL` and `CONFLUENCE_API_TOKEN`. Generate a new token at https://id.atlassian.com/manage-profile/security/api-tokens |
| `403 Restricted page` | The page exists but your account lacks permission. Grant your Atlassian account viewer access to the Confluence space |
| `404 Page not found` | The page ID is invalid or the page was deleted. Verify the page ID from the Confluence URL |
| `429 Rate limited` | Wait a few seconds and retry. Reduce `CONFLUENCE_MAX_SEARCH_RESULTS` to make fewer API calls |
| No relevant pages found | Set `CONFLUENCE_SPACE_KEYS` to the spaces where your docs live. The ticket may genuinely have no related Confluence documentation |
| Broad/noisy results | Set `CONFLUENCE_SPACE_KEYS` to restrict search. Reduce `CONFLUENCE_MAX_SEARCH_RESULTS` |
| Confluence not configured | Set `CONFLUENCE_BASE_URL`, `CONFLUENCE_EMAIL`, and `CONFLUENCE_API_TOKEN`. Jira-only tools continue to work without these |

## Delivery Intelligence Workflows

The delivery intelligence layer turns the MCP server into a full engineering delivery assistant.

### 1. Requirement-to-Code Traceability Matrix

Maps each Jira acceptance criterion and business rule to implementation evidence in the PR diff.

```
Use Jira MCP to generate a traceability matrix for ENG-123.
```

Tool: `delivery_traceability_matrix`

### 2. Definition of Done Verification

Runs 14 automated checks to determine merge-readiness: test coverage, AC coverage, risky file detection, conflict detection, and more.

```
Use Jira MCP to verify Definition of Done for ENG-123 against the current branch.
```

Tool: `delivery_check_changes` (checks: dod)

### 3. Implementation Impact Analysis

Predicts affected areas (frontend, backend, API, database, auth, validation) from the Jira requirement before coding begins.

```
Use Jira MCP to analyze implementation impact for ENG-123.
```

Tool: `delivery_check_changes` (checks: impact)

### 4. Test Strategy Generation

Generates specific test scenarios (unit, integration, E2E, manual QA, negative, permission tests) from the Jira requirement.

```
Use Jira MCP to generate a test strategy for ENG-123.
```

Tool: `delivery_generate` (type: test_strategy)

### 5. Reviewer Persona Reports

Generates role-specific review reports from the same Jira/Confluence/PR context. Personas: product, frontend, backend, QA, security, release.

```
Use Jira MCP to generate a QA reviewer report for ENG-123.
```

Tool: `delivery_generate` (type: reviewer_report) (with `persona` parameter)

### 6. QA Handoff

Generates a QA-readable handoff document with what to test, what not to test, test data, happy path, negative cases, and regression areas.

```
Use Jira MCP to generate a QA handoff for ENG-123.
```

Tool: `delivery_generate` (type: qa_handoff)

### 7. Release Note Generation

Generates audience-aware release notes. Audiences: `internal`, `qa`, `product`, `customer_safe`.

```
Use Jira MCP to generate a release note for ENG-123.
```

Tool: `delivery_generate` (type: release_notes)

### 8. Prompt Packs

**Generic MCP prompt pack** — works with any AI coding agent:
```
Use Jira MCP to generate the generic prompt pack.
```
Tool: `delivery_generate_agent_pack` (client: generic)

Generates `.mcp-prompts/` with 6 ready-to-use template files covering all major workflows.

**Codex CLI prompt pack** — optimized for Codex CLI:
```
Use Jira MCP to generate the Codex CLI prompt pack.
```
Tool: `delivery_generate_agent_pack` (client: codex)

Generates `.codex-prompts/` with 4 Codex-ready prompt files.

**Claude Code workflow pack** — Claude Code-specific:
```
Use Jira MCP to generate the Claude Code workflow pack.
```
Tool: `delivery_generate_agent_pack` (client: claude)

Generates `.claude/skills/` and `.claude/commands/` for Claude Code slash command workflows.

### 9. Optional Local Project Pattern Memory

Capture non-sensitive technical patterns from the local repo (module names, test locations, tech stack, naming conventions). Disabled by default.

Enable by setting `DELIVERY_PATTERN_MEMORY_ENABLED=true` in your `.env`.

Tools:
- `delivery_project_patterns` (action: scan) — Scan and optionally persist patterns
- `delivery_project_patterns` (action: get) — Retrieve saved patterns
- `delivery_project_patterns` (action: clear) — Delete the pattern file

**Security note:** Pattern memory never stores Jira descriptions, Confluence content, or any client-sensitive text — only derived structural metadata.

Add `.mcp-project-patterns.json` to your `.gitignore` if you enable pattern memory.

### 10. Delivery Report Export

Combine multiple analysis sections into a single markdown document.

```
Use Jira MCP to export a complete delivery report for ENG-123.
```

Tool: `delivery_generate` (type: task_report)

Sections: `context`, `impact`, `traceability`, `pr_alignment`, `definition_of_done`, `test_strategy`, `qa_handoff`, `release_notes`

## MCP Prompts

The server exposes five named prompts for direct use in MCP-compatible clients:

| Prompt | Description |
|--------|-------------|
| `jira_implementation_prompt` | Generate an implementation prompt for a Jira task |
| `jira_pr_review_prompt` | Generate a PR review prompt for a Jira task |
| `jira_qa_handoff_prompt` | Generate a QA handoff prompt for a Jira task |
| `jira_definition_of_done_prompt` | Generate a Definition of Done verification prompt |
| `jira_release_note_prompt` | Generate a release note prompt for a Jira task |

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `Jira authentication failed` | Wrong email or API token | Verify `JIRA_EMAIL` and `JIRA_API_TOKEN` in `.env` |
| `Jira access denied (403)` | Insufficient Jira permissions | Ask your Jira admin to grant you read access |
| `Issue ENG-XXX not found` | Issue doesn't exist or you lack permission | Check the issue key in Jira, verify project access |
| `Invalid issue key` | Key doesn't match expected format | Use a valid Jira key format like `ENG-123` |
| `Missing env variable` | `.env` not loaded or misconfigured | Check `.env` file exists; ensure it's sourced or passed via environment |
| `Cannot find module` | `dist/` not built | Run `npm run build` first |
| `Network error` | Jira unreachable | Check VPN, network, and the Jira Cloud URL in `JIRA_BASE_URL` |
| Rate limited (429) | Too many requests | Wait a few minutes and retry |

## Development

```bash
npm test          # Run all tests
npm run lint      # TypeScript type check (tsc --noEmit)
npm run build     # Compile TypeScript to dist/
```

Tests live in `tests/` and are run with [Vitest](https://vitest.dev).

## Security notes

- Never commit `.env` — it is listed in `.gitignore`
- API tokens are stored only in environment variables, never hardcoded
- The server never writes to Jira (read-only)
- No Jira data is persisted to disk

## Security Model

This MCP server is designed as a **read-only** intelligence layer.

### What it will never do
- Write to Jira (no issue creation, updates, transitions, or comments)
- Write to Confluence (no page creation or edits)
- Post PR comments automatically
- Approve or reject pull requests
- Execute arbitrary shell commands
- Use an LLM internally

### How secrets are handled
- All credentials are read from environment variables only
- API tokens are never logged or included in error messages
- Authorization headers are redacted from all logs and error output
- The `redactSecrets()` function sanitizes all logged data

### External content is untrusted
Jira descriptions, Confluence pages, PR descriptions, comments, and code diffs are treated as **untrusted content**:
- Content is wrapped in `<UNTRUSTED_CONTENT>` blocks in prompts
- Prompt-injection patterns are detected and flagged with warnings
- Instructions found inside Jira/Confluence content are never executed

### Safe Git execution
- Git commands use `execFile` with argument arrays (never shell strings)
- Git refs are validated before use (no shell metacharacters allowed)
- All git commands have a 15-second timeout
- Huge diffs are truncated; binary, generated, and lockfiles are skipped

### Rate-limit and retry safety
- HTTP calls use exponential backoff with jitter
- 401/403/404 responses are never retried
- `Retry-After` headers are respected on 429 responses
- Maximum 3 retries by default

### Cache behavior
- In-memory only — nothing persisted to disk by default
- Cache keys never include raw API tokens
- Short TTLs (5 min for Jira, 10 min for Confluence)
- Disabled via `MCP_CACHE_ENABLED=false`

## Performance Settings

All settings can be configured via environment variables:

### HTTP Timeouts and Retries
| Variable | Default | Description |
|---|---|---|
| `MCP_HTTP_TIMEOUT_MS` | `15000` | HTTP request timeout in milliseconds |
| `MCP_HTTP_MAX_RETRIES` | `3` | Maximum retry attempts for GET requests |
| `MCP_HTTP_INITIAL_BACKOFF_MS` | `500` | Initial backoff delay in milliseconds |
| `MCP_HTTP_MAX_BACKOFF_MS` | `10000` | Maximum backoff delay in milliseconds |
| `MCP_RATE_LIMIT_RESPECT_RETRY_AFTER` | `true` | Respect `Retry-After` header on 429 |

### Caching
| Variable | Default | Description |
|---|---|---|
| `MCP_CACHE_ENABLED` | `true` | Enable/disable in-memory cache |
| `MCP_CACHE_TTL_JIRA_SECONDS` | `300` | Jira issue cache TTL (5 minutes) |
| `MCP_CACHE_TTL_CONFLUENCE_SECONDS` | `600` | Confluence cache TTL (10 minutes) |
| `MCP_CACHE_MAX_ITEMS` | `500` | Maximum cached items before eviction |

### Concurrency
| Variable | Default | Description |
|---|---|---|
| `MCP_MAX_CONCURRENT_JIRA_REQUESTS` | `3` | Max parallel Jira API calls |
| `MCP_MAX_CONCURRENT_CONFLUENCE_REQUESTS` | `3` | Max parallel Confluence API calls |
| `MCP_MAX_CONCURRENT_GITHUB_REQUESTS` | `2` | Max parallel GitHub API calls |

### Output Budgets
| Variable | Default | Description |
|---|---|---|
| `MCP_MAX_OUTPUT_CHARS` | `60000` | Maximum total output characters |
| `MCP_MAX_SECTION_CHARS` | `12000` | Maximum characters per section |
| `MCP_MAX_DIFF_CHARS` | `50000` | Maximum diff characters |
| `MCP_MAX_CONFLUENCE_CHARS` | `30000` | Maximum Confluence content characters |

### Debug and Profiling
| Variable | Default | Description |
|---|---|---|
| `MCP_DEBUG` | `false` | Enable debug-level logging |
| `MCP_LOG_LEVEL` | `info` | Log level: error, warn, info, debug |
| `MCP_LOG_REDACT_SECRETS` | `true` | Redact secrets from log output |
| `MCP_PERFORMANCE_LOGGING` | `false` | Include performance summary in output |

## Additional Troubleshooting

### Slow Confluence search
Confluence CQL search can be slow on large instances. Options:
- Set `CONFLUENCE_SPACE_KEYS` to restrict search to specific spaces
- Reduce `CONFLUENCE_MAX_SEARCH_RESULTS` (default 10)
- Enable caching: `MCP_CACHE_ENABLED=true`

### Jira or Confluence 429 (rate limit)
The server automatically retries with exponential backoff. If you hit limits frequently:
- Reduce `MCP_MAX_CONCURRENT_JIRA_REQUESTS` or `MCP_MAX_CONCURRENT_CONFLUENCE_REQUESTS`
- Increase `MCP_HTTP_INITIAL_BACKOFF_MS`

### Git diff too large
If the diff output is truncated:
- Increase `MCP_MAX_DIFF_CHARS` (default 50000)
- Generated files, lockfiles, and binary files are automatically skipped

### Output truncated
If context output is cut off:
- Increase `MCP_MAX_OUTPUT_CHARS` (default 60000)
- Security warnings are always preserved even when truncating

### Cache stale
Cache entries expire on their own; to clear them immediately, restart the MCP server.
You can also disable caching entirely with `MCP_CACHE_ENABLED=false`.

### Restricted Confluence pages
If a Confluence page returns 403, the server continues with available pages and adds a warning to the output. Only pages you have permission to access are included.
