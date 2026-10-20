# Security model

jira-delivery-mcp runs on your machine over stdio and talks only to your own Atlassian site. To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## What it does and doesn't do

- **Reads by default.** Writes exist only with `JIRA_ENABLE_WRITES=true`, and are limited to comments, transitions, assign-to-me and remote links. It never creates or deletes issues, or edits their summary, description or fields.
- **Every write needs you.** A write is previewed first and applied only with a single-use token the agent may use after you approve, or through a confirmation form your client shows you. Writes are sent once (never retried) and recorded in an owner-only audit log.
- **No Confluence writes, no PR comments, no approvals.**
- **No telemetry, no LLM inside.** All analysis is deterministic; nothing is sent anywhere except your Jira and Confluence.

## Credentials

- Read from environment variables only; never logged or included in error messages.
- Authorization headers and token-like values are redacted from logs and output.
- The `doctor` command never prints the email or the token.

## Untrusted content

Jira descriptions, comments, Confluence pages and diffs are treated as untrusted data:

- They are fenced in `<UNTRUSTED_CONTENT>` blocks in prompts, and never turned into instructions or writes.
- Prompt-injection patterns are detected and flagged.
- Recommended actions and clarifying questions come from fixed templates; ticket text decides which apply but is never copied into them.

## Git and local files

- Git runs read-only through `execFile` with argument arrays (never a shell), validated refs and a timeout.
- Large diffs are truncated; binary, generated and lock files are skipped.
- `JIRA_DELIVERY_AUDIT_LOG` is created owner-only (directory `0700`, file `0600`) and refuses symlinks.
- Pattern memory (opt-in) stores structural metadata only, never ticket or page text.

## Network

- Reads retry with exponential backoff and jitter; `401`, `403` and `404` are never retried; writes are never retried.
- The cache is in memory only, with short TTLs, and its keys never contain tokens.
- `JIRA_STRICT_PROJECT_ALLOWLIST=true` confines issue access, searches (including `jql` filters) and writes to `JIRA_ALLOWED_PROJECT_KEYS`.
