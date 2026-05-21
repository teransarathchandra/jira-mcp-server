# Jira MCP Server

A local stdio MCP (Model Context Protocol) server for Jira Cloud task retrieval and developer workflow automation.

## What this MCP server does

This server connects Claude Code (or any MCP-compatible AI agent) to your Jira Cloud instance, giving you three read-only tools:

| Tool | Description |
|------|-------------|
| `jira_get_issue` | Fetch full details of a single Jira issue (summary, description, status, priority, assignee, attachments, labels) |
| `jira_search_my_open_issues` | List your currently open issues in the configured Jira project |
| `jira_prepare_work_prompt` | Fetch a Jira issue and return a structured implementation prompt ready for a coding agent |

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
