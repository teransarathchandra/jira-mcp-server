# Configuration

Everything is set through environment variables in your MCP client's server config (or a shell `export` for the CLI). Only the first three are required.

> **Tip:** `npx jira-delivery-mcp doctor` checks your credentials and prints the custom field ids for your site. It only reads.

## Required

| Variable | Example | Notes |
|---|---|---|
| `JIRA_BASE_URL` | `https://your-domain.atlassian.net` | Jira Cloud site |
| `JIRA_EMAIL` | `you@example.com` | The Atlassian account the token belongs to |
| `JIRA_API_TOKEN` | — | Create one at [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens) |

## Projects

| Variable | Default | Notes |
|---|---|---|
| `JIRA_DEFAULT_PROJECT_KEY` | — | Project used by "my open issues" when none is given |
| `JIRA_ALLOWED_PROJECT_KEYS` | — | Comma-separated, e.g. `ENG,OPS` |
| `JIRA_STRICT_PROJECT_ALLOWLIST` | `false` | `true` refuses issues, searches and writes outside `JIRA_ALLOWED_PROJECT_KEYS` |
| `JIRA_ISSUE_KEY_PATTERN` | `^[A-Z][A-Z0-9]+-\d+$` | Custom issue-key regex |
| `JIRA_EXAMPLE_ISSUE_KEY` | derived | Example key shown in tool descriptions |

## Custom fields

Many sites keep these in custom fields; without them, acceptance criteria are read from the description only. Run `doctor` to find the ids.

| Variable | Example |
|---|---|
| `JIRA_ACCEPTANCE_CRITERIA_FIELD_ID` | `customfield_10020` |
| `JIRA_STORY_POINTS_FIELD_ID` | `customfield_10016` |
| `JIRA_EPIC_FIELD_ID` | `customfield_10014` |
| `JIRA_TEAM_FIELD_ID` | `customfield_10001` |

## Workflow

| Variable | Default | Notes |
|---|---|---|
| `JIRA_BRANCH_PATTERN` | `{type}/{KEY}-{slug}` | Suggested branch name; `type` is `fix`, `feature` or `chore` |
| `JIRA_MAX_CONTEXT_CHARS` | `30000` | Size cap for issue context |
| `JIRA_HIGH_AUTHORITY_AUTHOR_EMAILS` | — | Comma-separated: comments by these people (product owners, tech leads) carry more weight when sources conflict |
| `JIRA_HIGH_AUTHORITY_ACCOUNT_IDS` | — | Same, by Jira account id |

## Write-back (off by default)

| Variable | Default | Notes |
|---|---|---|
| `JIRA_ENABLE_WRITES` | `false` | `true` registers `jira_add_comment` and `jira_update_issue` |
| `JIRA_DELIVERY_AUDIT_LOG` | `~/.jira-delivery-mcp/audit.log` | Where each write step is recorded |

Every write is previewed and needs your confirmation — see [Tools → Writing back to Jira](tools.md#writing-back-to-jira).

## Confluence (optional)

Set the three credentials to let the tools read related Confluence pages. Jira tools work without them.

| Variable | Default | Notes |
|---|---|---|
| `CONFLUENCE_BASE_URL` | — | e.g. `https://your-domain.atlassian.net/wiki` |
| `CONFLUENCE_EMAIL` | — | |
| `CONFLUENCE_API_TOKEN` | — | |
| `CONFLUENCE_SPACE_KEYS` | all spaces | Comma-separated spaces to search (recommended) |
| `CONFLUENCE_ENABLED` | `true` | `false` turns Confluence off even with credentials |
| `CONFLUENCE_MAX_SEARCH_RESULTS` | `10` | |
| `CONFLUENCE_MAX_PAGES_TO_READ` | `5` | |
| `CONFLUENCE_MAX_PAGE_CHARS` | `12000` | |
| `CONFLUENCE_LABEL_BOOSTS` | `requirements,prd,technical-design,architecture,user-guide,release-notes` | Labels that raise relevance |
| `CONFLUENCE_EXCLUDE_LABELS` | `deprecated,archive,draft` | Labels that lower relevance |
| `CONFLUENCE_TITLE_BOOST_TERMS` | `requirement,prd,design,spec,architecture,flow` | Title words that mark authoritative pages |

Pages are found with targeted CQL (the issue key, its epic or parent, summary keywords, technical terms) and only pages scoring at least 25 for relevance are used. Jira stays the source of truth: linked pages support it, keyword matches are background, and stale pages are flagged.

## Project pattern memory (optional)

| Variable | Default | Notes |
|---|---|---|
| `DELIVERY_PATTERN_MEMORY_ENABLED` | `false` | `true` lets `delivery_project_patterns` save repository conventions |
| `DELIVERY_PATTERN_MEMORY_FILE` | `.mcp-project-patterns.json` | Relative to the repository; add it to `.gitignore` |

Only structural metadata is stored (module names, test locations, stack) — never ticket or page text.

## Performance and limits

| Variable | Default | Notes |
|---|---|---|
| `MCP_HTTP_TIMEOUT_MS` | `15000` | Per request |
| `MCP_HTTP_MAX_RETRIES` | `3` | Reads only; writes are never retried |
| `MCP_HTTP_INITIAL_BACKOFF_MS` | `500` | |
| `MCP_HTTP_MAX_BACKOFF_MS` | `10000` | |
| `MCP_MAX_CONCURRENT_JIRA_REQUESTS` | `3` | |
| `MCP_MAX_CONCURRENT_CONFLUENCE_REQUESTS` | `3` | |
| `MCP_CACHE_ENABLED` | `true` | In-memory only |
| `MCP_CACHE_TTL_JIRA_SECONDS` | `300` | |
| `MCP_CACHE_TTL_CONFLUENCE_SECONDS` | `600` | |
| `MCP_MAX_OUTPUT_CHARS` | `60000` | |
| `MCP_MAX_SECTION_CHARS` | `12000` | |
| `MCP_MAX_DIFF_CHARS` | `50000` | |
| `MCP_MAX_CONFLUENCE_CHARS` | `30000` | |

## Logging

Logs go to stderr (stdout is the MCP channel).

| Variable | Default | Notes |
|---|---|---|
| `MCP_LOG_LEVEL` | `info` | `error`, `warn`, `info` or `debug` |
| `MCP_LOG_REDACT_SECRETS` | `true` | |
| `MCP_DEBUG` | `false` | Cache and request diagnostics |
| `MCP_PERFORMANCE_LOGGING` | `false` | Adds a timing summary to tool output |
| `MCP_CLIENT_PROFILE` | `generic` | Tailors examples to `claude-code`, `cursor`, `vscode`, `codex-cli`, `windsurf` or `claude-desktop` |
