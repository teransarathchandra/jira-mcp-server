# Jira MCP Server

A local stdio MCP (Model Context Protocol) server for Jira Cloud task retrieval and developer workflow automation.

## What this MCP server does

This server connects Claude Code (or any MCP-compatible AI agent) to your Jira Cloud instance, giving you seven read-only tools:

| Tool | Description |
|------|-------------|
| `jira_get_issue` | Fetch full details of a single Jira issue (summary, description, status, priority, assignee, attachments, labels) |
| `jira_search_my_open_issues` | List your currently open issues in the configured Jira project |
| `jira_prepare_work_prompt` | Fetch a Jira issue and return a structured implementation prompt ready for a coding agent |
| `jira_get_issue_context` | Fetch a Jira issue with full surrounding context (parent, epic, linked issues, subtasks, comments) |
| `jira_prepare_contextual_work_prompt` | Fetch a Jira issue with full context and return a final implementation prompt |
| `jira_review_pr_alignment` | Review a PR or local branch against a Jira requirement — produces an evidence-based alignment report with score, matched/missing requirements, and review comments |
| `jira_prepare_pr_review_prompt` | Prepare a focused Claude Code review prompt for reviewing a PR against a Jira task |

Additional capabilities:
- Converts Atlassian Document Format (ADF) to clean Markdown so descriptions are readable
- Generates structured implementation prompts for coding agents based on issue content
- Surfaces attachment filenames and URLs so you know what files are attached (without downloading them)

## What v1 does NOT do

- Does not create, edit, or delete Jira issues
- Does not add comments to Jira
- Does not transition issue statuses
- Does not download attachments — it lists filenames and URLs only
- Does not support pagination beyond the first page (max 50 results for search)

## Prerequisites

- Node.js 18+ (this project uses Node 22)
- A Jira Cloud account with API token access

## Creating an Atlassian API token

1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Click **Create API token**
3. Give it a descriptive name (e.g. `jira-mcp-server`) and click **Create**
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
JIRA_PROJECT_KEY=CMPI
```

| Variable | Description |
|----------|-------------|
| `JIRA_BASE_URL` | Your Jira Cloud base URL (no trailing slash) |
| `JIRA_EMAIL` | The email address of your Atlassian account |
| `JIRA_API_TOKEN` | The API token you created above |
| `JIRA_PROJECT_KEY` | The Jira project key (e.g. `CMPI`) |

## Running locally

```bash
# Build first (required after any source change)
npm run build

# Test the server starts (it waits for MCP input — Ctrl+C to stop)
node dist/index.js
```

The server communicates over stdio and produces no output until an MCP client connects.

## Registering with Claude Code

Use `claude mcp add` to register the server. Replace the path with the absolute path to your local clone:

```bash
claude mcp add --transport stdio jira-cmpi -- node /absolute/path/to/dist/index.js
```

For this project at its default location:

```bash
claude mcp add --transport stdio jira-cmpi -- node /Users/teransarathchandra/Development/MCP_Servers/jira-mcp-server/dist/index.js
```

### Passing environment variables

The server reads credentials from the environment. If they are not already set in your shell, pass them explicitly with `--env`:

```bash
claude mcp add --transport stdio jira-cmpi \
  --env JIRA_BASE_URL=https://your-domain.atlassian.net \
  --env JIRA_EMAIL=your-email@example.com \
  --env JIRA_API_TOKEN=your-api-token \
  --env JIRA_PROJECT_KEY=CMPI \
  -- node /Users/teransarathchandra/Development/MCP_Servers/jira-mcp-server/dist/index.js
```

### Verify registration

```bash
claude mcp list
```

You should see `jira-cmpi` in the output.

## Example Claude Code usage

After registering the server, you can use these prompts inside Claude Code:

- "Use the Jira MCP server to fetch CMPI-1234 and prepare an implementation plan."
- "Fetch CMPI-1234 from Jira, inspect this repo, and implement the task carefully."
- "Show my open CMPI Jira issues."
- "Get the work prompt for CMPI-5678 and use it to implement the feature."
- "What are my current open Jira tasks?"

### Direct tool usage

```
# Get full issue brief
jira_get_issue({"issueKey": "CMPI-1234"})

# Get just the implementation prompt
jira_prepare_work_prompt({"issueKey": "CMPI-1234"})

# List your open issues
jira_search_my_open_issues({"maxResults": 10})
```

## Context-aware Jira task fetching

The server includes two advanced tools that gather surrounding context from Jira — parent issues, epics, linked issues, subtasks, and analyzed comments — to produce a richer brief for implementing complex requirements.

### New tools

#### `jira_get_issue_context`

Fetches an issue and its surrounding Jira context, producing a comprehensive developer brief.

```json
{
  "issueKey": "CMPI-1234",
  "includeComments": true,
  "includeParent": true,
  "includeEpic": true,
  "includeLinkedIssues": true,
  "includeSubtasks": true,
  "includeEpicSiblings": false,
  "maxLinkedIssues": 8,
  "maxSubtasks": 10,
  "maxCommentsPerIssue": 10,
  "contextDepth": 1
}
```

Output includes: Main Task metadata, Core Requirement, Acceptance Criteria, Requirement Clarifications from Comments, Parent/Epic Context, Related Issues, Subtasks, Possible Dependencies/Blockers, Technical Signals, Risk/Ambiguity, and a Final Implementation Prompt.

#### `jira_prepare_contextual_work_prompt`

Same as `jira_get_issue_context` but returns only the final implementation prompt — ready to paste directly into Claude Code or Codex.

```json
{
  "issueKey": "CMPI-1234",
  "includeComments": true,
  "includeParent": true,
  "includeEpic": true,
  "includeLinkedIssues": true,
  "includeSubtasks": true,
  "includeEpicSiblings": false
}
```

### Example Claude Code prompts

**Example 1 — Full context brief:**
> Use Jira MCP to fetch full context for CMPI-1234 including comments, parent, epic, linked issues, and subtasks.

**Example 2 — Contextual work prompt:**
> Use Jira MCP to prepare a contextual implementation prompt for CMPI-1234. Then inspect this repository and implement only the confirmed requirements.

**Example 3 — Without epic siblings:**
> Use Jira MCP to fetch CMPI-1234 but do not include epic sibling issues.

### Optional: Epic field configuration

Some Jira Cloud projects store the epic link in a custom field (e.g., `customfield_10014`). Add it to `.env` if automatic epic detection does not work:

```
JIRA_EPIC_FIELD_ID=customfield_10014
```

Standard Jira Cloud projects do not need this setting — the server tries the standard `epic` field first.

### Context budget controls

- `includeEpicSiblings` defaults to `false` — sibling issues can add a lot of noise.
- `contextDepth` maximum is `2` — keep it at `1` for most tasks.
- `maxLinkedIssues` maximum is `15` — default is `8`.
- If the brief is too large, lower `maxLinkedIssues`, `maxCommentsPerIssue`, or set `includeEpicSiblings: false`.

### Why these tools are still read-only

Both new tools only read from Jira. They do not create, update, delete, comment on, or transition any Jira issues.

## Requirement Intelligence Layer

The context-aware tools now include a built-in intelligence layer that evaluates Jira context quality before generating the implementation brief. No LLM is used — all logic is deterministic and rule-based.

### What the intelligence layer does

| Component | Purpose |
|---|---|
| Authority Ranker | Classifies each information source (description, AC, comments, parent, epic) by authority level |
| Relevance Scorer | Scores linked issues as High / Medium / Low relevance and filters noise |
| Readiness Evaluator | Checks if the ticket has enough information to implement (READY / MOSTLY_READY / NEEDS_CLARIFICATION / BLOCKED) |
| Conflict Detector | Detects contradictions between description, comments, parent, and epic |
| Clarification Generator | Generates up to 5 specific, implementation-focused questions when the ticket is unclear |
| Repo Inspection Hint Generator | Produces targeted instructions for Claude Code to inspect the right files before editing |
| Context Quality Scorer | Produces a 0-100 quality score for the assembled Jira context |

### Updated context brief sections

When using `jira_get_issue_context`, the brief now includes:
- **Context Quality** — Score and interpretation (0-100)
- **Requirement Authority** — Which sources are most authoritative
- **Implementation Readiness** — READY / MOSTLY_READY / NEEDS_CLARIFICATION / BLOCKED with reasons
- **Relevant Jira Context** — Linked issues ranked by relevance (High / Medium / Omitted)
- **Conflicts** — Detected contradictions with impact and recommended handling
- **Suggested Repo Inspection Targets** — Specific instructions for Claude Code
- **Clarification Needed** — Practical questions (only shown when ticket is unclear or blocked)

### Optional environment variables

Add any of these to `.env` to improve intelligence for your project:

```
# Identify the custom field used for Epic Links (if standard epic field doesn't work)
JIRA_EPIC_FIELD_ID=customfield_10014

# Custom field IDs for additional context (optional)
JIRA_STORY_POINTS_FIELD_ID=customfield_10016
JIRA_ACCEPTANCE_CRITERIA_FIELD_ID=customfield_10020
JIRA_TEAM_FIELD_ID=customfield_10018

# Comma-separated emails of high-authority authors (e.g., product owners, tech leads)
# Comments from these authors are weighted higher in authority ranking
JIRA_HIGH_AUTHORITY_AUTHOR_EMAILS=product-owner@example.com,tech-lead@example.com

# Comma-separated Jira account IDs of high-authority authors (alternative to email)
JIRA_HIGH_AUTHORITY_ACCOUNT_IDS=account-id-1,account-id-2

# Maximum characters for the full context output (default: 30000)
JIRA_MAX_CONTEXT_CHARS=30000
```

None of these are required. The server works without them.

### Readiness statuses

| Status | Meaning |
|---|---|
| READY | Proceed with implementation |
| MOSTLY_READY | Proceed, but flag any unclear specifics |
| NEEDS_CLARIFICATION | Seek answers to open questions before or during implementation |
| BLOCKED | Resolve blocker issues before starting |

### Example Claude Code prompts

```
# Get the full intelligence-enhanced context brief
"Fetch full Jira context for CMPI-1234 with authority ranking and readiness evaluation."

# Get the final implementation prompt (intelligence-processed)
"Use jira_prepare_contextual_work_prompt for CMPI-1234 and implement the confirmed requirements."

# Check if a ticket is ready before starting
"Use jira_get_issue_context for CMPI-1234. If it is not READY, explain what is unclear."

# Skip epic siblings for a cleaner brief
"Fetch context for CMPI-1234, disable epic sibling issues."
```

## Reviewing a PR against a Jira task

### Overview

The `jira_review_pr_alignment` tool compares a PR's changes against the Jira requirement to produce an evidence-based alignment report. It does not claim "perfect alignment" — it reports a score, confidence level, matched requirements, missing requirements, unrelated changes, risky changes, and practical review comments.

### Supported modes

**local_diff (default):**
Compares a local branch against a base branch using git. No GitHub API required.

**github_pr (v2, not yet supported):**
Will fetch PR data from GitHub using GITHUB_TOKEN. Not available in v1 — use local_diff.

### Tools

#### `jira_review_pr_alignment`

Runs an alignment analysis between a Jira issue and the diff of a local branch.

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `issueKey` | yes | — | Jira issue key, e.g. `CMPI-1234` |
| `baseBranch` | no | `origin/main` | Base branch to compare against |
| `compareRef` | no | `HEAD` | Branch, commit SHA, or ref to compare |
| `repoPath` | no | `.` | Path to the git repository |
| `maxDiffChars` | no | `50000` | Max characters of diff to analyze |

#### `jira_prepare_pr_review_prompt`

Returns a ready-to-use review prompt that instructs Claude Code to review the PR against the Jira requirement. Useful when you want Claude to do a focused review without calling the full alignment tool.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `issueKey` | yes | Jira issue key, e.g. `CMPI-1234` |

### Usage examples

**Example 1: Review local changes against CMPI-1234**
```
Use jira_review_pr_alignment with issueKey: "CMPI-1234"
```
This uses the current branch (HEAD) compared against origin/main.

**Example 2: Review a specific branch**
```
Use jira_review_pr_alignment with issueKey: "CMPI-1234", baseBranch: "main", compareRef: "feature/my-branch", repoPath: "/path/to/repo"
```

**Example 3: Prepare a review prompt**
```
Use jira_prepare_pr_review_prompt with issueKey: "CMPI-1234"
```
Returns a focused review prompt. Pass it to Claude Code to perform the review.

**Example 4: GitHub PR mode (v2 — not yet available)**
```
Use jira_review_pr_alignment with issueKey: "CMPI-1234", mode: "github_pr", prNumber: 123
Requires: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO environment variables.
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

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `Jira authentication failed` | Wrong email or API token | Verify `JIRA_EMAIL` and `JIRA_API_TOKEN` in `.env` |
| `Jira access denied (403)` | Insufficient Jira permissions | Ask your Jira admin to grant you read access |
| `Issue CMPI-XXXX not found` | Issue doesn't exist or you lack permission | Check the issue key in Jira, verify project access |
| `Invalid issue key` | Key doesn't match `CMPI-XXXX` format | Use exactly 4 digits: `CMPI-1234` not `CMPI-12` |
| `Missing env variable` | `.env` not loaded or misconfigured | Check `.env` file exists; ensure it's sourced or passed via `--env` |
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
- The server never writes to Jira (read-only v1)
- No Jira data is persisted to disk
