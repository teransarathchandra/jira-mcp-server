# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 2.x | ✅ |
| 1.x | ❌ — please upgrade ([migration guide](docs/migrating-from-v1.md)) |

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through GitHub's
[security advisories](https://github.com/teransarathchandra/jira-mcp-server/security/advisories/new)
for this repository. Include steps to reproduce and the version you run (for example from `npx jira-delivery-mcp --version`).

You'll get an acknowledgement within a few days. Fixes are released as a new
npm version and noted in the CHANGELOG.

## Scope

In scope: anything that lets ticket or page content, a client, or another
process cause a Jira write without the user's confirmation, leak credentials,
read outside the configured Jira/Confluence site or project allowlist, or run
commands on the developer's machine.

## How the server protects you

- Credentials come only from environment variables; logs and errors are redacted.
- Jira and Confluence content is treated as untrusted data and never as instructions.
- Write tools are off unless `JIRA_ENABLE_WRITES=true`. Each write needs a
  preview plus a single-use confirmation token, or a confirmation form the user
  answers; they are never retried and are recorded in a local audit log without
  comment text or tokens. On the token path the server cannot tell who approved:
  the agent must show the user the preview first (the bundled skill requires it),
  and clients with confirmation forms let the user confirm directly.
- No telemetry: the server only talks to your Jira/Confluence site and local git.

The full model is in [docs/security.md](docs/security.md).
