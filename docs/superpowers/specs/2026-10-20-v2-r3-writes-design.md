# jira-delivery-mcp v2 R3 — Safe Writes Design

Status: Accepted pending owner review (written overnight without a question round, at the owner's request; every choice is the author's call unless marked as coming from the parent spec)
Date: 2026-10-20
Parent: `2026-10-19-v2-delivery-mcp-design.md` (§3 tools, §5 write safety model, §6 hand-off, §7 R3 row)
Plan: `docs/superpowers/plans/2026-10-20-v2-r3-writes.md`

## 1. Intent

R1 and R2 made the server read Jira well. R3 lets the agent finish the loop **start → build → verify → hand off** without the developer switching to the Jira UI: post the QA handoff or release notes as a comment, move the ticket to the next status, assign it to yourself when starting, and link the branch or PR.

Every write is guarded so that a prompt-injected ticket, an over-eager agent or a network retry cannot change Jira without the person seeing exactly what will happen first.

## 2. Goals, non-goals, anti-goals

**Goals**
- Two write tools (parent spec §3): `jira_add_comment` and `jira_update_issue`.
- All five guards from parent spec §5, tested.
- Markdown → ADF conversion good enough for the server's own Markdown (headings, paragraphs, lists, code, bold/italic, links).
- Write tests that never touch a real Jira: recorded fixtures with POST/PUT routes, and request-body assertions.

**Non-goals (R3)**
- Editing descriptions or acceptance criteria (parent spec Q14).
- Creating issues, worklogs, attachments, sprints, watchers.
- Writing to Confluence.
- Bulk writes across issues.

**Anti-goals — failure even if everything else works**
- Any Jira change without a preview the user could have seen (token round-trip or an accepted elicitation form).
- A write derived from ticket text rather than explicit tool arguments.
- A duplicated comment caused by an automatic retry.
- Comment bodies, tokens or credentials in the audit log or server logs.
- Write tools visible when `JIRA_ENABLE_WRITES` is not `true`.

## 3. Constraints

- Everything in the parent spec and the R1/R2 Global Constraints still holds (Node ≥20, SDK v2, Zod 4, object-root input schemas, no stdout writes outside `src/cli.ts`, no telemetry, envelope `schemaVersion: '2.0'`).
- **No automatic retries on writes.** `httpClient` retries POST on 5xx today (`isRetryableMethod` exists but is never consulted); write calls pass `retryPolicy: { maxRetries: 0 }`. A failed write reports the error; the user re-confirms if they want to try again.
- The project allowlist applies to writes: when `JIRA_STRICT_PROJECT_ALLOWLIST` is on, a write to an issue outside the allowed projects is refused before preview.

## 4. Tools

Both are registered only when `JIRA_ENABLE_WRITES=true`. Annotations: `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`, `openWorldHint: true`.

### 4.1 `jira_add_comment`

Input: `issueKey`, `markdown` (1–32 000 chars), `confirmToken?`.

Typical use: post `delivery_generate type=qa_handoff` or `release_notes` output.

### 4.2 `jira_update_issue`

Input: `issueKey`, at least one of:
- `transitionTo?: string` — target transition or status name, matched case-insensitively against `GET /rest/api/3/issue/{key}/transitions` (transition `name` first, then destination status `to.name`). No match → error listing the available names; nothing is changed.
- `assignToMe?: true` — assigns to the authenticated account (`GET /rest/api/3/myself` → `accountId`, then `PUT /rest/api/3/issue/{key}/assignee`).
- `link?: { url: string; title: string }` — remote link (`POST /rest/api/3/issue/{key}/remotelink`) with `globalId` = the URL, so re-linking the same URL updates instead of duplicating. URL must be `https://` or `http://`.

plus `confirmToken?`.

Apply order: assign → transition → link. Each step's outcome is reported and audited separately; a failed step stops the later ones.

## 5. Guards (parent spec §5, made concrete)

1. **Off by default** — tools not registered unless `JIRA_ENABLE_WRITES` is `true` (trimmed, case-insensitive).
2. **Preview then confirm.**
   - A call without `confirmToken` changes nothing and returns `data.preview` (what will be sent, in human terms, plus the planned API calls) and `data.confirmToken`.
   - Tokens are random 128-bit values held in server memory with: tool name, issue key, a SHA-256 of the canonical JSON of the arguments (excluding the token), expiry 5 minutes, used flag. *(Author's call: a server-held random token is equivalent to the spec's HMAC and simpler — nothing to verify cryptographically and it dies with the process.)*
   - A call with a token applies only if the token exists, is unused, unexpired, and matches tool + key + argument hash. Otherwise → error "Confirmation token is invalid or expired — call again without confirmToken to get a fresh preview." Nothing is written.
   - Tokens are single-use: marked used before the Jira request is sent.
3. **Elicitation first.** When the client supports form elicitation, the first call shows the preview in a form with one boolean field "Apply these changes to <KEY>?". Accept with `true` → apply immediately in the same call. An explicit refusal (decline, or `false`) → nothing changes and **no token is issued**. Cancel, timeout (60 s) or error → fall back to (2): return the preview and a token. *(Amended after the security review: a token after an explicit "no" was one call away from posting what the user refused.)*
4. **Annotations** as in §4.
5. **Audit log.** Append-only JSONL at `JIRA_DELIVERY_AUDIT_LOG` (default `~/.jira-delivery-mcp/audit.log`; directory created with mode 0700, file 0600). One line per attempted step: `{ ts, tool, issueKey, action, outcome, detail? }` where `action` ∈ `comment|assign|transition|link`, `outcome` ∈ `applied|failed|refused`, `detail` is a status name, transition id, link URL or error class — never a comment body, token or credential. A failure to write the audit line does not block the Jira write but adds a warning.

## 6. Markdown → ADF

`markdownToAdf(markdown): AdfDoc` in `src/utils/markdownToAdf.ts`, the inverse of the existing `adfToMarkdown` for the subset the server produces:
- Blocks: paragraphs, ATX headings `#`–`######`, bullet lists (`-`, `*`), ordered lists (`1.`), fenced code blocks (with language), horizontal rules `---`, block quotes `>`.
- Inline: `**bold**`, `*italic*`/`_italic_`, `` `code` ``, `[text](url)` (http/https only; other schemes stay plain text).
- Anything else stays as plain text. Never throws; an empty input yields an empty paragraph.
- Round-trip property for the supported subset: `adfToMarkdown(markdownToAdf(md))` ≈ `md` (normalised whitespace).

## 7. Hand-off workflow

- The `jira_qa_handoff_prompt` and `jira_release_note_prompt` prompts gain one sentence: "If the jira_add_comment tool is available, offer to post it." (harmless when writes are off).
- README section "Hand off: write back to Jira" with the enable flag, the preview/confirm flow and the audit log location.

## 8. Testing

- Fixture harness: route lookup matches `POST`/`PUT`; request bodies recorded.
- Fixtures: `transitions` (ABC-1 with "Start Progress"→In Progress, "Ready for QA"→QA), `myself`, write routes returning 201/204, a 403 on comment.
- Tests:
  - tools absent unless `JIRA_ENABLE_WRITES=true`; present with exact annotations when set
  - preview call sends no POST/PUT
  - token round-trip applies once; second use refused; changed arguments refused; expired (fake timers) refused
  - elicitation accept applies in one call; decline/false/timeout fall back to preview+token; no-capability → preview+token
  - transition matching by transition name and by status name, case-insensitive; no match lists names and writes nothing
  - assign uses `/myself` accountId; link sends `globalId` = URL; non-http URL rejected
  - partial failure: transition fails → link not attempted, both outcomes reported and audited
  - strict allowlist refuses an outside project before preview
  - audit log lines have the fixed fields and never contain the comment body or token
  - write requests are sent with retries disabled (a 503 produces one request, not four)
  - `markdownToAdf` unit tests per construct plus the round-trip property

## 9. Release

R3 ships as `2.0.0-rc.1` (parent spec §7) after the owner reviews the PR and tries one write on a test ticket. The PR is not merged without that review.

## 10. Left to the builder

File layout, token store implementation, exact preview wording, and ADF node details — as long as the guards and tests above hold.
