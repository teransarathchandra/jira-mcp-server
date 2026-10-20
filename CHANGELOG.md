# Changelog

## 2.0.0-beta.3

### New

- **Write-back (opt-in):** `jira_add_comment` and `jira_update_issue` (transition, assign to me, link a branch/PR), registered only with `JIRA_ENABLE_WRITES=true`. Every write needs a preview + single-use confirmToken or a confirmed elicitation form, is sent without retries, and is recorded in an audit log (`JIRA_DELIVERY_AUDIT_LOG`). Markdown comments are converted to Jira's ADF. Declining the confirmation form issues no token; a timed-out or 5xx write is reported as "outcome unknown", and Jira's reason is shown when it rejects a write. A confirmToken no longer applies if the issue's workflow changed after the preview; the audit log refuses symlinks, is kept at 0600, and records account ids rather than names.
- The QA-handoff and release-note prompts offer to post the result when the write tools are available.
- **Claude Code plugin:** `/plugin marketplace add teransarathchandra/jira-mcp-server` then `/plugin install jira-delivery@jira-delivery` installs the server and a `jira-delivery` skill that tells the agent when to use each tool and never to confirm a write without the user. Credentials are prompted for and the API token is stored in secure storage.
- Contributing guide, security policy, and issue/PR templates.
- MCP Registry entry (`server.json`, `mcpName` io.github.teransarathchandra/jira-delivery-mcp) and a tag-triggered release workflow that publishes to npm with provenance, lists the version in the Registry and creates the GitHub release.
- Tool-selection evals: 34 everyday requests scored against the real tool list (`npm run eval`, needs `ANTHROPIC_API_KEY`).
- README rewritten as a short front page with a Cursor install link; the detailed reference moved to `docs/reference.md` and the workflow data to `docs/workflows.md`.
- `jira_prepare_work_brief` returns typed `data`: readiness with confidence, acceptance criteria and their source, inbound blockers, 2–4 recommended actions, 0–3 clarifying questions, a suggested branch name, and how each Jira source was read. The text now starts with a short "Start here" section.
- `delivery_check_changes` returns typed `data` with one verdict (`ready_for_pr`, `needs_work`, `insufficient_evidence`, or `not_applicable` when only the `impact` check ran), per-criterion coverage with files, Definition of Done results and impact.
- `npx jira-delivery-mcp doctor` checks the Jira (and, if configured, Confluence) credentials and suggests the acceptance-criteria, story-points, epic-link and team custom field ids for your site. Read-only; it never prints the email or token.
- `--version` / `-v` prints the server version.
- Branch name suggestion, configurable with `JIRA_BRANCH_PATTERN` (default `{type}/{KEY}-{slug}`).
- `jira_prepare_work_brief` `allowElicitation: true` asks the clarifying questions in a form when the client supports it.

### Fixes

- The configured acceptance-criteria, epic, story-points and team custom fields are now requested from Jira; before, they were never fetched.
- A link where this ticket blocks another issue no longer counts as this ticket being blocked.
- When a ticket has more comments than the cap, the newest ones are kept (before, the oldest were).
- Clarifying questions inferred only from what a ticket doesn't say (user roles, mobile views, error-message copy) are no longer generated.
- A linked issue, parent or epic you don't have permission to see no longer fails the whole request; it is reported as not visible. Bad credentials still fail.
- `delivery_check_changes` never reports `ready_for_pr` unless every criterion is covered; a crashed check, unreadable diff or unproven criteria give `insufficient_evidence`.
- A DoD-only check reports the number of changed files and treats an empty branch as `insufficient_evidence`.
- Inbound blockers are no longer missed on tickets with many links.
- Conflict evidence now points at the description and comments involved (`issue:<KEY>:description`, `comment:<id>`).
- Fewer Jira requests: comments are not re-fetched when Jira already returned all of them.

## 2.0.0-beta.2

### Fixes

- `setup <client>` and the README install snippets use `jira-delivery-mcp@beta` during the beta. A bare `jira-delivery-mcp` installs `latest`, which is still 1.x.
- Unknown CLI commands print usage to stderr and exit 1 instead of printing help and exiting 0. `setup --help` shows help.
- `delivery_generate` rejects unknown `task_report` sections instead of silently dropping them.
- The `delivery_check_changes` description says the `impact` check works before any code is written.
- The `delivery_project_patterns` description names the `DELIVERY_PATTERN_MEMORY_ENABLED=true` opt-in.
- The README now includes the v1 → v2 migration table.

## 2.0.0-beta.1

The first v2 beta: the same delivery capabilities on MCP SDK v2, consolidated from 28 tools to 10.

### Breaking changes

- **Node.js 20 or later** is required.
- **Tools consolidated from 28 to 10.** Every v1 tool name except `jira_get_issue` is gone; see the migration table below.
- `jira_review_pr_alignment`'s `github_pr` mode (an unimplemented stub) is removed. Changes are checked against the local git diff only.
- `delivery_generate` with `type: task_report` returns Markdown and no longer writes a file (`outputPath` removed). Save the output yourself if you need a file.
- `mcp_clear_cache` is removed. Caches are time-bounded; restart the server to clear them.
- The placeholder resources `jira://{issueKey}/context` and `jira://{issueKey}/traceability`, which only pointed at tools, are removed.

### Removed parameters

v2 tools ignore unknown arguments, so these v1 parameters are now silently dropped. Each fetch uses the v1 default value shown.

- `jira_get_issue`: `includeComments` (always included), `includeAttachments` (always included).
- `depth: "full"` context options: `includeParent`, `includeEpic`, `includeLinkedIssues`, `includeSubtasks` (all on), `includeEpicSiblings` (off), `maxLinkedIssues` (8), `maxSubtasks` (10), `maxCommentsPerIssue` (10), `contextDepth` (1).
- `includeConfluence: true` options: `includeJiraComments` (on), `confluenceMaxSearchResults` and `maxConfluenceChars` (server defaults), `confluenceMaxPagesToRead` (server default; 5 for `jira_prepare_work_brief`), `includeMediumRelevancePages` (on), `includeLowRelevancePages` (off).
- `delivery_check_changes` alignment: `prNumber` (the `github_pr` mode is gone).
- `delivery_generate` `task_report`: `outputPath` (no file is written).

To limit output size, use `JIRA_MAX_CONTEXT_CHARS` and the `CONFLUENCE_MAX_*` environment variables.

### New

- Every tool declares an `outputSchema` and returns `structuredContent` (`schemaVersion`, `tool`, `issueKey`, `markdown`, `warnings`) alongside the Markdown text.
- Tool annotations (`readOnlyHint`, `destructiveHint`, …) so clients can decide when to ask for approval.
- `npx jira-delivery-mcp setup <client>` prints client setup instructions without needing Jira credentials.
- Resource `jira-delivery://config/projects` describes the configured projects.
- `delivery_check_changes` runs its checks independently: one failing check is reported as a warning instead of failing the whole call.
- The server reports its real version from `package.json`.
- Generated agent packs (`.claude/`, `.codex-prompts/`, `.mcp-prompts/`) reference the v2 tool names.

### Migrating from 1.x

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

The five MCP prompts (`jira_implementation_prompt`, `jira_pr_review_prompt`, `jira_qa_handoff_prompt`, `jira_definition_of_done_prompt`, `jira_release_note_prompt`) keep their names and now point at the v2 tools.

## 1.0.1

- Fix 405 in issue search by moving to `/rest/api/3/search/jql`.

## 1.0.0

- First npm release.
