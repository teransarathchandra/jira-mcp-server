# Jira Delivery MCP

**From Jira ticket to merged PR without leaving your coding agent.** A local MCP server for Jira Cloud that turns a ticket into a ready-to-build brief, checks your branch against the acceptance criteria before you open the PR, and hands the work off: QA notes, release notes and, if you allow it, the Jira update itself.

[![npm](https://img.shields.io/npm/v/jira-delivery-mcp/beta?label=npm%20beta)](https://www.npmjs.com/package/jira-delivery-mcp) [![CI](https://github.com/teransarathchandra/jira-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/teransarathchandra/jira-mcp-server/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Works with Claude Code, Claude Desktop, Cursor, Codex CLI, Windsurf, VS Code and any stdio MCP client. Jira Cloud with an API token; Node.js 20 or newer. No telemetry, and read-only unless you turn writes on.

## Install

> **v2 is in beta.** These instructions use the `@beta` tag. Plain `jira-delivery-mcp` still installs 1.x until 2.0.0 is released.

You need your Jira site URL, your Atlassian email and an [API token](https://id.atlassian.com/manage-profile/security/api-tokens).

**Claude Code plugin** — the server plus a skill that tells the agent when to use each tool. It asks for your site, email and token (the token goes to secure storage):

```
/plugin marketplace add teransarathchandra/jira-mcp-server
/plugin install jira-delivery@jira-delivery
```

**Cursor** — [![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=jira-delivery&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImppcmEtZGVsaXZlcnktbWNwQGJldGEiXSwiZW52Ijp7IkpJUkFfQkFTRV9VUkwiOiJodHRwczovL3lvdXItZG9tYWluLmF0bGFzc2lhbi5uZXQiLCJKSVJBX0VNQUlMIjoieW91QGV4YW1wbGUuY29tIiwiSklSQV9BUElfVE9LRU4iOiJ5b3VyLWFwaS10b2tlbiJ9fQ%3D%3D), then replace the three placeholder values.

**Claude Code, without the plugin:**

```bash
claude mcp add jira-delivery \
  --env JIRA_BASE_URL=https://your-domain.atlassian.net \
  --env JIRA_EMAIL=you@example.com \
  --env JIRA_API_TOKEN=your-api-token \
  -- npx -y jira-delivery-mcp@beta
```

**Any other MCP client** — add this to its MCP config:

```json
{
  "mcpServers": {
    "jira-delivery": {
      "command": "npx",
      "args": ["-y", "jira-delivery-mcp@beta"],
      "env": {
        "JIRA_BASE_URL": "https://your-domain.atlassian.net",
        "JIRA_EMAIL": "you@example.com",
        "JIRA_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

`npx jira-delivery-mcp@beta setup <client>` prints the exact steps for `claude-code`, `claude-desktop`, `codex-cli`, `cursor`, `windsurf`, `vscode` or `generic`. The three variables above are the only required ones; everything else is in [`.env.example`](.env.example) and the [reference](docs/reference.md#installation-and-configuration).

## What you can ask

| Moment | Ask your agent | Tool |
|---|---|---|
| Pick up a ticket | "I'm starting ABC-101, get me ready to implement it." | `jira_prepare_work_brief` |
| Before writing code | "Which parts of the codebase will ABC-22 touch?" | `delivery_check_changes` (`impact`) |
| Before the PR | "Check my branch against ABC-20 before I open the PR." | `delivery_check_changes` |
| Hand off | "Write a QA handoff for ABC-30 and post it as a comment." | `delivery_generate`, `jira_add_comment` |
| Wrap up | "Move ABC-30 to In Review and link the PR." | `jira_update_issue` |

**Start a ticket.** `jira_prepare_work_brief` returns a short *Start here* (readiness, inbound blockers, 2–4 next steps, up to 3 clarifying questions, a suggested branch name) followed by an implementation prompt. Missing or unreadable data lowers the confidence instead of being reported as "none", and ticket text is never copied into the actions or questions.

**Verify before the PR.** `delivery_check_changes` compares your local diff with the acceptance criteria and the Definition of Done and gives one verdict: `ready_for_pr` only when every criterion is covered, otherwise `needs_work` or `insufficient_evidence`, with the files behind each criterion.

Both return typed `structuredContent` so an agent can act on the result without parsing text — see [docs/workflows.md](docs/workflows.md) for the data and the rules behind each decision.

## Tools

| Tool | What it does |
|------|-------------|
| `jira_get_issue` | A Jira issue as a developer brief; `depth: "full"` adds parent, epic, links and subtasks; `includeConfluence` adds related docs |
| `jira_search_issues` | Your open issues, optionally in one project |
| `jira_prepare_work_brief` | A ready-to-implement brief with readiness, blockers, next steps, questions and a branch name |
| `confluence_search` | Confluence pages related to an issue, ranked by relevance |
| `confluence_get_page` | A Confluence page, cleaned and size-bounded |
| `delivery_check_changes` | The local diff against the issue: `alignment`, `dod` (Definition of Done), `impact` |
| `delivery_traceability_matrix` | Each requirement mapped to the changed files that implement it |
| `delivery_generate` | Test strategy, reviewer report, QA handoff, release notes or task report |
| `delivery_generate_agent_pack` | Reusable delivery prompts/commands for Claude Code, Codex or any agent, written into the repo |
| `delivery_project_patterns` | Scan, read or clear stored repository conventions |
| `jira_add_comment` | *Writes, opt-in.* Post a Markdown comment |
| `jira_update_issue` | *Writes, opt-in.* Transition, assign to me, link a branch or PR |

Git-based tools take `baseBranch` (default `origin/main`), `compareRef` (default `HEAD`) and `repoPath` (default `.`). Every tool declares an `outputSchema` and annotations, so clients know which calls change anything. Also included: the resource `jira-delivery://config/projects` and five prompts (`jira_implementation_prompt`, `jira_pr_review_prompt`, `jira_qa_handoff_prompt`, `jira_definition_of_done_prompt`, `jira_release_note_prompt`).

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
| `mcp_get_client_setup_instructions` | CLI `npx jira-delivery-mcp@beta setup <client>` |
| `mcp_clear_cache` | removed (restart the server) |

Parameters that v2 no longer accepts are listed in the [CHANGELOG](CHANGELOG.md#removed-parameters).

## Security and privacy

- **Local and read-only by default.** The server runs on your machine over stdio and only reads from Jira and Confluence until you set `JIRA_ENABLE_WRITES=true`.
- **No telemetry.** Nothing is sent anywhere except your own Jira and Confluence site.
- **Jira content is untrusted.** Ticket and page text is fenced as untrusted in prompts, checked for prompt-injection patterns, and never turned into instructions or writes.
- **Credentials stay in your environment.** Tokens are never logged; authorization headers are redacted from all output.
- **Git is read-only.** Commands run with argument arrays (no shell), validated refs and a timeout.

More in the [security model](docs/reference.md#security-model). To report a vulnerability, see [SECURITY.md](SECURITY.md).

## More

- [docs/workflows.md](docs/workflows.md) — the data the workflow tools return and how they decide
- [docs/reference.md](docs/reference.md) — configuration, client setup, Confluence, delivery features, performance, troubleshooting
- [USAGE_GUIDE.md](USAGE_GUIDE.md) — longer walk-throughs
- [evals/](evals/README.md) — tool-selection evals
- [CHANGELOG.md](CHANGELOG.md) · [CONTRIBUTING.md](CONTRIBUTING.md) · [MIT license](LICENSE)
