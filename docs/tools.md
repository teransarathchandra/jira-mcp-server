# Tools

Every tool returns Markdown plus `structuredContent` — `{ schemaVersion: "2.0", tool, issueKey?, markdown, warnings, data? }` — and declares an `outputSchema` and annotations (`readOnlyHint`, `destructiveHint`, …) so clients know which calls change anything.

| Tool | What it does | Key inputs |
|---|---|---|
| `jira_search_issues` | Your open issues, or any JQL filter | `projectKey`, `jql`, `maxResults` (≤ 50), `pageToken` |
| `jira_get_issue` | An issue as a developer brief | `issueKey`, `depth: "full"` (parent, epic, links, subtasks), `includeConfluence` |
| `jira_prepare_work_brief` | A ready-to-build brief: readiness, blockers, next steps, questions, branch name | `issueKey`, `depth`, `includeConfluence`, `allowElicitation` |
| `delivery_check_changes` | The local diff against the acceptance criteria and Definition of Done, with one verdict | `issueKey`, `checks` (`alignment`, `dod`, `impact`) |
| `delivery_traceability_matrix` | Each requirement mapped to the files and tests that implement it | `issueKey` |
| `delivery_generate` | Test strategy, reviewer report, QA handoff, release notes or task report | `issueKey`, `type`, `persona`, `audience`, `sections` |
| `delivery_generate_agent_pack` | Reusable delivery prompts/commands written into the repo | `client` (`claude`, `codex`, `generic`) |
| `delivery_project_patterns` | Learn, show or forget the repository's conventions | `action` (`scan`, `get`, `clear`) |
| `confluence_search` | Confluence pages related to an issue, ranked by relevance | `issueKey` |
| `confluence_get_page` | One Confluence page, cleaned and size-bounded | `pageId` |
| `jira_add_comment` | *Write, opt-in.* Post a Markdown comment (tables included) | `issueKey`, `markdown`, `confirmToken` |
| `jira_update_issue` | *Write, opt-in.* Transition, assign to me, link a branch or PR | `issueKey`, `transitionTo`, `assignToMe`, `link`, `confirmToken` |

Git-based tools also take `baseBranch` (default `origin/main`), `compareRef` (default `HEAD`) and `repoPath` (default `.`). Git runs read-only, with argument arrays, validated refs and a timeout.

**Search filters.** `jql` replaces the default "my open issues" query. It is limited to `projectKey` when given and, under `JIRA_STRICT_PROJECT_ALLOWLIST=true`, to the allowed projects; a filter whose parentheses or quotes don't balance is refused.

## Start a ticket: `jira_prepare_work_brief`

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

## Verify before PR: `delivery_check_changes`

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
- `not_applicable`: only `impact` was run (planning before any code exists), so there is no PR verdict.
- `insufficient_evidence`: no changes against the base branch, the diff couldn't be read, a selected diff-based check crashed, alignment found no evidence, or some criteria have no evidence.
- `needs_work`: a criterion is `missing` or only `partial`, the Definition of Done failed, or there are required fixes.
- `ready_for_pr`: every criterion is `covered` and the Definition of Done passed.


## Generate documents: `delivery_generate`

| `type` | Output | Options |
|---|---|---|
| `test_strategy` | Unit, integration, E2E, manual, negative and permission test cases | `includePrDiff` |
| `reviewer_report` | A review from one point of view | `persona`: `product_reviewer`, `frontend_reviewer`, `backend_reviewer`, `qa_reviewer`, `security_reviewer`, `release_reviewer` |
| `qa_handoff` | What to test and not, test data, happy path, negative cases, regression areas | |
| `release_notes` | Release notes for an audience | `audience`: `internal`, `qa`, `product`, `customer_safe` |
| `task_report` | Several sections in one document | `sections`: `context`, `impact`, `traceability`, `pr_alignment`, `definition_of_done`, `test_strategy`, `qa_handoff`, `release_notes` |

Nothing is written to disk; save the Markdown yourself if you need a file.

## Writing back to Jira

`jira_add_comment` and `jira_update_issue` exist only when `JIRA_ENABLE_WRITES=true`. Every write is guarded:

- **Preview first.** The first call changes nothing. It returns exactly what will be sent and a single-use `confirmToken` (valid 5 minutes, bound to the tool, the issue and the arguments). The agent must show you the preview and use the token only after you approve.
- **Or confirm in a form.** If your client supports form elicitation, you're asked "Apply these changes to ABC-1?" directly. Answering no changes nothing.
- **Never retried.** A write request is sent once. If it times out or Jira answers 5xx, the result says the outcome is unknown; check the issue before confirming again.
- **Audited.** Each step is appended to `~/.jira-delivery-mcp/audit.log` (owner-only permissions): time, tool, issue, action, outcome — no comment text, tokens or credentials.
- **Scoped.** With the strict allowlist on, writes outside the allowed projects are refused before any preview.

Transitions are matched by name, then by target status, case-insensitively; if nothing matches, the available transitions are listed and nothing changes.

## Prompts and resources

Five MCP prompts: `jira_implementation_prompt`, `jira_pr_review_prompt`, `jira_qa_handoff_prompt`, `jira_definition_of_done_prompt`, `jira_release_note_prompt`. The resource `jira-delivery://config/projects` describes the configured projects.

## Command line

| Command | What it does |
|---|---|
| `npx jira-delivery-mcp` | Start the MCP server on stdio |
| `npx jira-delivery-mcp setup <client>` | Print setup steps for `claude-code`, `cursor`, `vscode`, `windsurf`, `codex-cli`, `claude-desktop` or `generic` |
| `npx jira-delivery-mcp doctor` | Check credentials and suggest custom field ids (read-only) |
| `npx jira-delivery-mcp --version` | Print the version |
