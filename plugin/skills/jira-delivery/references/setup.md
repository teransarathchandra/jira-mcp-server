# Setting up the jira-delivery MCP server

The skill needs the `jira-delivery-mcp` MCP server. It runs locally over stdio with `npx` (Node.js 22 or newer) and needs three values from the user:

| Variable | Value |
|---|---|
| `JIRA_BASE_URL` | Their Jira Cloud site, e.g. `https://your-domain.atlassian.net` |
| `JIRA_EMAIL` | The email of their Atlassian account |
| `JIRA_API_TOKEN` | An API token from https://id.atlassian.com/manage-profile/security/api-tokens |

Ask the user to put the token into the config themselves. Never ask them to paste it into the chat, and never write it into a file that is committed to git.

After changing the config, the client usually needs a restart (or a reload of its MCP servers) before the tools appear.

## Claude Code

The plugin installs the server and this skill, and asks for the three values (the token goes to secure storage):

```
/plugin marketplace add teransarathchandra/jira-mcp-server
/plugin install jira-delivery@jira-delivery
```

Without the plugin:

```bash
claude mcp add jira-delivery \
  --env JIRA_BASE_URL=https://your-domain.atlassian.net \
  --env JIRA_EMAIL=you@example.com \
  --env JIRA_API_TOKEN=your-api-token \
  -- npx -y jira-delivery-mcp
```

## Cursor, Windsurf, Claude Desktop and other clients

Add an `mcpServers` entry to the client's MCP config: `~/.cursor/mcp.json` for Cursor, Windsurf Settings → MCP Servers for Windsurf, `claude_desktop_config.json` for Claude Desktop.

```json
{
  "mcpServers": {
    "jira-delivery": {
      "command": "npx",
      "args": ["-y", "jira-delivery-mcp"],
      "env": {
        "JIRA_BASE_URL": "https://your-domain.atlassian.net",
        "JIRA_EMAIL": "you@example.com",
        "JIRA_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

## VS Code (GitHub Copilot agent mode)

VS Code uses its own format: a `servers` entry with `"type": "stdio"` in `.vscode/mcp.json` (or **MCP: Add Server** from the Command Palette). Keep that file out of git if it holds the token, or use VS Code's `inputs` to prompt for it.

```json
{
  "servers": {
    "jira-delivery": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "jira-delivery-mcp"],
      "env": {
        "JIRA_BASE_URL": "https://your-domain.atlassian.net",
        "JIRA_EMAIL": "you@example.com",
        "JIRA_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

## Codex CLI

In `~/.codex/config.toml`:

```toml
[mcp_servers.jira-delivery]
command = "npx"
args = ["-y", "jira-delivery-mcp"]
env = { JIRA_BASE_URL = "https://your-domain.atlassian.net", JIRA_EMAIL = "you@example.com", JIRA_API_TOKEN = "your-api-token" }
```

`npx jira-delivery-mcp setup <client>` prints the snippet for `claude-code`, `cursor`, `windsurf`, `vscode`, `codex-cli`, `claude-desktop` or `generic`.

## Optional settings

- **Custom fields.** Many sites keep acceptance criteria, story points or epic links in custom fields. With the three variables exported in a terminal, `npx jira-delivery-mcp doctor` checks the credentials and prints the lines to add, such as `JIRA_ACCEPTANCE_CRITERIA_FIELD_ID=customfield_10020`. It only reads.
- **Write-back.** `JIRA_ENABLE_WRITES=true` adds `jira_add_comment` and `jira_update_issue`. Each write is previewed and needs the user's confirmation, and is recorded in `~/.jira-delivery-mcp/audit.log`.
- **Confluence.** `CONFLUENCE_BASE_URL`, `CONFLUENCE_EMAIL` and `CONFLUENCE_API_TOKEN` let the tools read related Confluence pages.
- **Projects.** `JIRA_DEFAULT_PROJECT_KEY` limits "my open issues" to one project; `JIRA_ALLOWED_PROJECT_KEYS` with `JIRA_STRICT_PROJECT_ALLOWLIST=true` refuses issues outside the listed projects.

Every setting is described in https://github.com/teransarathchandra/jira-mcp-server/blob/main/docs/configuration.md
