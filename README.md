# Jira MCP Server

A local stdio MCP (Model Context Protocol) server for Jira Cloud task retrieval and developer workflow automation.

## What this MCP server does

This server connects Claude Code (or any MCP-compatible AI agent) to your Jira Cloud instance, giving you twenty-three read-only tools:

| Tool | Description |
|------|-------------|
| `jira_get_issue` | Fetch full details of a single Jira issue (summary, description, status, priority, assignee, attachments, labels) |
| `jira_search_my_open_issues` | List your currently open issues in the configured Jira project |
| `jira_prepare_work_prompt` | Fetch a Jira issue and return a structured implementation prompt ready for a coding agent |
| `jira_get_issue_context` | Fetch a Jira issue with full surrounding context (parent, epic, linked issues, subtasks, comments) |
| `jira_prepare_contextual_work_prompt` | Fetch a Jira issue with full context and return a final implementation prompt |
| `jira_review_pr_alignment` | Review a PR or local branch against a Jira requirement — produces an evidence-based alignment report with score, matched/missing requirements, and review comments |
| `jira_prepare_pr_review_prompt` | Prepare a focused Claude Code review prompt for reviewing a PR against a Jira task |
| `confluence_search_related_pages` | Search Confluence for pages related to a Jira issue, ranked by relevance |
| `confluence_get_page_summary` | Fetch and summarize a Confluence page by ID with extracted requirement signals |
| `jira_get_issue_with_confluence_context` | Jira issue + Confluence documentation enrichment in one combined context brief |
| `jira_prepare_confluence_enriched_work_prompt` | Implementation prompt enriched with relevant Confluence documentation |
| `delivery_get_traceability_matrix` | Generate a requirement-to-code traceability matrix for a Jira task |
| `delivery_verify_definition_of_done` | Verify Definition of Done (14 checks) and return merge-readiness verdict with score |
| `delivery_analyze_implementation_impact` | Analyze predicted implementation impact before coding begins |
| `delivery_generate_test_strategy` | Generate a practical test strategy with unit, integration, E2E, and manual QA scenarios |
| `delivery_generate_reviewer_report` | Generate a role-specific review report (product, frontend, backend, QA, security, release) |
| `delivery_generate_qa_handoff` | Generate a QA handoff document with test cases, regression areas, and known risks |
| `delivery_generate_release_notes` | Generate release notes with audience variants (internal, qa, product, customer_safe) |
| `delivery_generate_claude_workflow_pack` | Generate Claude Code workflow assets (.claude/skills/ and .claude/commands/) for Jira workflows |
| `delivery_scan_project_patterns` | Scan local repo for technical patterns (tech stack, module names, naming conventions) |
| `delivery_get_project_patterns` | Get saved local project patterns from pattern memory |
| `delivery_clear_project_patterns` | Clear local project pattern memory |
| `delivery_export_task_report` | Export a complete multi-section delivery report to a markdown file |

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

## Confluence Integration

The Jira MCP server can optionally enrich Jira issue context with relevant Confluence documentation. When configured, it searches Confluence for pages related to a Jira ticket, scores them by relevance, and includes the most useful content in the implementation context.

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

1. **Jira key search**: Find pages that mention the exact issue key (e.g. `CMPI-1234`)
2. **Epic/parent search**: Find pages mentioning the epic or parent issue key
3. **Summary phrase search**: Find pages whose titles contain key words from the Jira summary
4. **Technical terms search**: Find pages mentioning API names, module names, or other technical signals

Results are deduplicated by page ID and scored for relevance before any page body is read.

### Why pages are relevance-scored

Blindly including all Confluence search results would produce noisy, token-heavy context. Instead, the server scores each page:

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

### How conflicts are reported

When Jira and Confluence disagree, the conflict is reported clearly:

```
⚠️ Jira vs Confluence Conflicts:
- [high] Jira Confluence Behavior Conflict: One source says "optional"...
  - Impact: Incorrect validation logic
  - Handling: Jira latest comments and confirmed acceptance criteria take priority...
```

### Avoiding token-heavy context

- Set `CONFLUENCE_MAX_PAGES_TO_READ=3` to read fewer pages
- Set `CONFLUENCE_MAX_PAGE_CHARS=6000` to limit per-page content
- Set `CONFLUENCE_SPACE_KEYS` to restrict to relevant spaces
- Use `jira_prepare_confluence_enriched_work_prompt` instead of `jira_get_issue_with_confluence_context` when you only need the final prompt

### Example usage

**Example 1: Prepare an implementation prompt with Confluence context**
```
Use jira_prepare_confluence_enriched_work_prompt for CMPI-1234
```

**Example 2: Search for related Confluence pages**
```
Use confluence_search_related_pages for CMPI-1234 and explain which pages are most relevant
```

**Example 3: Full Jira + Confluence context brief**
```
Use jira_get_issue_with_confluence_context for CMPI-1234, then inspect this repo and implement the confirmed requirement
```

**Example 4: Summarise a specific Confluence page**
```
Use confluence_get_page_summary with pageId: "123456789"
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

The delivery intelligence layer turns the MCP server into a full engineering delivery assistant. Use these tools from Claude Code to improve requirement traceability, testing, review discipline, and delivery quality.

### 1. Requirement-to-Code Traceability Matrix

Maps each Jira acceptance criterion and business rule to implementation evidence in the PR diff.

```
Use Jira MCP to generate a traceability matrix for CMPI-1234.
```

Tool: `delivery_get_traceability_matrix`

### 2. Definition of Done Verification

Runs 14 automated checks to determine merge-readiness: test coverage, AC coverage, risky file detection, conflict detection, and more.

```
Use Jira MCP to verify Definition of Done for CMPI-1234 against the current branch.
```

Tool: `delivery_verify_definition_of_done`

### 3. Implementation Impact Analysis

Predicts affected areas (frontend, backend, API, database, auth, validation) from the Jira requirement before coding begins.

```
Use Jira MCP to analyze implementation impact for CMPI-1234.
```

Tool: `delivery_analyze_implementation_impact`

### 4. Test Strategy Generation

Generates specific test scenarios (unit, integration, E2E, manual QA, negative, permission tests) from the Jira requirement.

```
Use Jira MCP to generate a test strategy for CMPI-1234.
```

Tool: `delivery_generate_test_strategy`

### 5. Reviewer Persona Reports

Generates role-specific review reports from the same Jira/Confluence/PR context. Personas: product, frontend, backend, QA, security, release.

```
Use Jira MCP to generate a QA reviewer report for CMPI-1234.
```

Tool: `delivery_generate_reviewer_report` (with `persona` parameter)

### 6. QA Handoff

Generates a QA-readable handoff document with what to test, what not to test, test data, happy path, negative cases, and regression areas.

```
Use Jira MCP to generate a QA handoff for CMPI-1234.
```

Tool: `delivery_generate_qa_handoff`

### 7. Release Note Generation

Generates audience-aware release notes. Audiences: `internal`, `qa`, `product`, `customer_safe`.

```
Use Jira MCP to generate a release note for CMPI-1234.
```

Tool: `delivery_generate_release_notes`

### 8. Claude Code Workflow Pack

Generates `.claude/skills/` and `.claude/commands/` files that turn Jira delivery workflows into reusable slash commands.

```
Use Jira MCP to generate the Claude Code workflow pack.
```

Tool: `delivery_generate_claude_workflow_pack`

Generated slash commands (after running the workflow pack):
- `/jira-plan CMPI-1234` — Implementation plan
- `/jira-review-pr CMPI-1234` — PR alignment review
- `/jira-dod CMPI-1234` — Definition of Done check
- `/jira-qa CMPI-1234` — QA handoff

### 9. Optional Local Project Pattern Memory

Capture non-sensitive technical patterns from the local repo (module names, test locations, tech stack, naming conventions). Disabled by default.

Enable by setting `DELIVERY_PATTERN_MEMORY_ENABLED=true` in your `.env`.

Tools:
- `delivery_scan_project_patterns` — Scan and optionally persist patterns
- `delivery_get_project_patterns` — Retrieve saved patterns
- `delivery_clear_project_patterns` — Delete the pattern file

**Security note:** Pattern memory never stores Jira descriptions, Confluence content, or any client-sensitive text — only derived structural metadata.

Add `.mcp-project-patterns.json` to your `.gitignore` if you enable pattern memory.

### 10. Delivery Report Export

Combine multiple analysis sections into a single markdown document.

```
Use Jira MCP to export a complete delivery report for CMPI-1234.
```

Tool: `delivery_export_task_report`

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

## Troubleshooting

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
To clear the cache mid-session, use the `mcp_clear_cache` tool with `{ "scope": "all" }`.
You can also disable caching entirely with `MCP_CACHE_ENABLED=false`.

### Restricted Confluence pages
If a Confluence page returns 403, the server continues with available pages and adds a warning to the output. Only pages you have permission to access are included.

### Missing required config
If a required variable is missing (JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN), the server will fail with a clear error message listing the missing variables. Optional integrations (Confluence, GitHub) are silently disabled when not configured.
