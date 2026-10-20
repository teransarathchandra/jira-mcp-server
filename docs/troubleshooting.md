# Troubleshooting

**Start with `doctor`.** With your three Jira variables exported, `npx jira-delivery-mcp doctor` checks the Jira and Confluence credentials and suggests custom field ids. It only reads.

| Symptom | Fix |
|---|---|
| The agent has no `jira_*` tools | The server isn't connected. Check your client's MCP config, then restart the client or reload its MCP servers. Node.js 22+ must be on the `PATH` the client uses. |
| `Missing required environment variable(s)` | Set `JIRA_BASE_URL`, `JIRA_EMAIL` and `JIRA_API_TOKEN` in the server's `env`. |
| `Jira authentication failed` | Wrong email or token. Create a new token at [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens); it must belong to `JIRA_EMAIL`. |
| `Permission denied` / `not found` | Your account can't see that project or issue, or the key is wrong. |
| Every brief says `NEEDS_CLARIFICATION` with no criteria | Your criteria live in a custom field. Run `doctor` and set `JIRA_ACCEPTANCE_CRITERIA_FIELD_ID`. |
| `delivery_check_changes` returns `insufficient_evidence` | No commits against the base branch yet, or the base branch doesn't exist locally — pass `baseBranch` (e.g. `main`) or `git fetch`. |
| `not_applicable` verdict | Only the `impact` check ran (planning); there's no PR verdict until code exists. |
| No related Confluence pages | Set `CONFLUENCE_SPACE_KEYS` to the spaces where your docs live; the ticket may have none. |
| Rate limited (`429`) | Wait and retry, or lower `MCP_MAX_CONCURRENT_JIRA_REQUESTS`. |
| Output looks truncated | Raise `MCP_MAX_OUTPUT_CHARS`, `MCP_MAX_DIFF_CHARS` or `JIRA_MAX_CONTEXT_CHARS`. |
| Data looks stale | The cache lasts 5 minutes for Jira (10 for Confluence); restart the server or set `MCP_CACHE_ENABLED=false`. |
| A write says the outcome is unknown | Jira timed out or answered `5xx` after the request was sent. Check the issue in Jira before confirming again. |

For more detail, set `MCP_LOG_LEVEL=debug` — logs go to stderr, which most clients show in their MCP logs.
