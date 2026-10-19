# jira-delivery-mcp v2 — Design

Status: Accepted
Date: 2026-10-19
Supersedes: `2026-08-05-contextual-guidance-design.md` (its guidance engine is absorbed into R2 "start a ticket"; see §6)

## 1. Goal and positioning

**Goal (6 months):** adoption (stars, npm installs, registry presence) and daily personal use. Revenue is explicitly not a v2 goal.

**User:** solo developers driving AI coding agents (Claude Code, Cursor, Codex) against their own Jira Cloud tickets. Team features only where cheap. Enterprise is out of scope.

**Positioning:** a *delivery intelligence layer*, not a general Jira client. We do not compete with Atlassian's official Rovo MCP or `sooperset/mcp-atlassian` on CRUD breadth. The pitch is the loop:

> **start a ticket → build → verify before PR → hand off**, safely, from inside your coding agent.

## 2. Decisions record

| # | Decision |
|---|---|
| Q1 | Success = adoption + own daily use |
| Q2 | Solo dev first; team features only where cheap |
| Q3 | Delivery intelligence layer; CRUD only where the loop needs it |
| Q5 | v2.0.0 is breaking; Node 20+, MCP SDK v2, Zod 4 |
| Q6 | 10–15 h/week; ~2-week releases (~25 h each) |
| Q7 | Consolidate 28 tools to ~10–12 (§3) |
| Q8 | Headline workflows: start a ticket, verify before PR, hand off |
| Q9 | R1 is a foundation release; Aug 2026 spec absorbed |
| Q10 | Jira Cloud only; API token (classic + scoped) only; stdio only |
| Q11 | MCP Registry, Claude Code plugin, Cursor install link, directories, README + GIF. No `.mcpb` for now |
| Q12 | CI + provenance + release-please; MCP contract tests; tool-selection evals. Nightly live E2E only if writes prove flaky |
| Q13 | Skill built alongside v2.0, free in repo, used by evals |
| Q14 | Writes: add comment, transition, assign to me, link branch/PR. No description/AC edits |
| Q15 | All write guards (§5) |
| Q16 | Verify uses local git only; `github_pr` stub mode removed |
| Q17 | Name `jira-delivery-mcp` everywhere; repo renamed; server version read from `package.json` |
| Q18 | Release plan R1–R4 (§7) |
| Q19 | Evals: Haiku 5.5 routine, Sonnet 5.5 spot-check, on demand + pre-release, recorded Jira fixtures |
| Q20 | Old tool names removed; old→new table in CHANGELOG and README |
| Q21 | Agensi: free core skill listed after 2.0.0; paid premium skills later, only once adoption exists |
| Q22 | Zero telemetry |
| Q23 | Branch names suggested only, pattern `{type}/{KEY}-{slug}` configurable |
| Q24 | CONTRIBUTING, issue/PR templates, SECURITY.md, good-first-issues in R4 |

## 3. v2 tool surface

Ten read/local tools ship in R1; two write tools arrive in R3 (12 total).

| v2 tool | Key inputs | Replaces | Annotations |
|---|---|---|---|
| `jira_get_issue` | `issueKey`, `depth: basic\|full` (default `basic`), `includeConfluence` (default `false`) | get_issue, get_issue_context, get_issue_with_confluence_context | readOnly |
| `jira_search_issues` | `projectKey?`, `maxResults` | search_my_open_issues | readOnly |
| `jira_prepare_work_brief` | `issueKey`, `depth`, `includeConfluence` | prepare_work_prompt, prepare_contextual_work_prompt, prepare_confluence_enriched_work_prompt | readOnly |
| `confluence_search` | `issueKey`, `maxResults`, `spaceKeys`, `includeLowRelevance` | confluence_search_related_pages | readOnly |
| `confluence_get_page` | `pageId`, `maxChars` | confluence_get_page_summary | readOnly |
| `delivery_check_changes` | `issueKey`, `checks: ('alignment'\|'dod'\|'impact')[]` (default all), git refs | review_pr_alignment, prepare_pr_review_prompt, verify_definition_of_done, analyze_implementation_impact | readOnly |
| `delivery_traceability_matrix` | `issueKey`, git refs, `includeConfluence` | get_traceability_matrix | readOnly |
| `delivery_generate` | `issueKey`, `type: test_strategy\|reviewer_report\|qa_handoff\|release_notes\|task_report`, `persona?`, `audience?`, `sections?`, git refs | 5 generators + export_task_report | readOnly (task_report no longer writes a file) |
| `delivery_generate_agent_pack` | `client: claude\|codex\|generic`, `repoPath`, `overwrite` | 3 pack generators | write-local, destructive when `overwrite` |
| `delivery_project_patterns` | `action: scan\|get\|clear`, `repoPath` | scan/get/clear_project_patterns | write-local, destructive (`clear`) |
| *R3* `jira_add_comment` | `issueKey`, `markdown`, `confirmToken?` | — | write, non-destructive |
| *R3* `jira_update_issue` | `issueKey`, `transitionTo?`, `assignToMe?`, `link?`, `confirmToken?` | — | write, non-destructive |

Moved out of the tool list:
- `jira_list_configured_projects` → resource `jira-delivery://config/projects`.
- `mcp_get_client_setup_instructions` → CLI `npx jira-delivery-mcp setup <client>`.
- `mcp_clear_cache` → removed (caches are TTL-bound; restart clears).

"git refs" = `baseBranch` (default `origin/main`), `compareRef` (default `HEAD`), `repoPath` (default `.`).

MCP prompts stay as slash commands (`jira_implementation_prompt`, `jira_pr_review_prompt`, `jira_qa_handoff_prompt`, `jira_definition_of_done_prompt`, `jira_release_note_prompt`), with their text updated to v2 tool names. The two placeholder resources (`jira://{issueKey}/context|traceability`) that only redirect to tools are removed.

## 4. Output contract

Every tool declares an `outputSchema` and returns `structuredContent` plus a text block containing the Markdown.

**R1 envelope** (all tools):

```ts
{
  schemaVersion: '2.0';
  tool: string;          // v2 tool name
  issueKey?: string;
  markdown: string;      // the human/agent-readable brief, same as text content
  warnings: string[];
}
```

**R2** adds a typed `data` field to the two headline tools (`jira_prepare_work_brief`, `delivery_check_changes`); other tools gain `data` only when a workflow needs it. Errors return `isError: true` with the existing `formatError` messages. Arguments that fail the input schema are rejected by the SDK before the handler runs, with its own `Input validation error: …` text.

## 5. Write safety model (R3)

All five guards apply to every write tool:

1. **Off by default.** Write tools are not registered unless `JIRA_ENABLE_WRITES=true`.
2. **Preview then confirm.** A call without `confirmToken` performs no mutation and returns the exact payload plus a single-use token (HMAC of tool + issueKey + payload, 5-minute TTL). Applying requires a second call with that token; any payload change invalidates it.
3. **Elicitation first** when the client advertises form elicitation: the server asks the user to confirm directly and skips the token round-trip. Decline, cancel, timeout or unsupported → fall back to (2).
4. **Annotations:** `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint` per tool, `openWorldHint: true`.
5. **Audit log:** append-only JSONL at `~/.jira-delivery-mcp/audit.log` — timestamp, tool, issueKey, action, outcome. No comment bodies or secrets.

Jira content stays untrusted (`untrustedContentGuard`). The server never derives a write from ticket text; writes happen only from explicit tool arguments.

Transitions are matched by name against `GET /issue/{key}/transitions`. When nothing matches, the server returns the available names instead of guessing. Comment Markdown is converted to ADF.

## 6. Headline workflows

**Start a ticket (R2)** — `jira_prepare_work_brief` gains the August spec's guidance engine: intent, evidence-backed readiness, 2–4 recommended actions, 0–3 material clarifying questions, and the branch suggestion (`JIRA_BRANCH_PATTERN`, default `{type}/{KEY}-{slug}`). The August spec's evidence states, authority rules and question gating carry over unchanged. Its elicitation design is reused for clarifying questions, and its "advisory only" mutation contract is replaced by §5 once R3 lands.

**Verify before PR (R2)** — `delivery_check_changes` against the local diff (working tree + branch vs merge base). Output: a pass/fail per acceptance criterion and DoD item, with file references.

**Hand off (R3)** — `delivery_generate type=qa_handoff|release_notes`, then `jira_add_comment` and optionally `jira_update_issue transitionTo`.

## 7. Release plan

| Release | Scope | Tag | Exit criteria |
|---|---|---|---|
| R1 Foundation | SDK v2 (`@modelcontextprotocol/server`), Node ≥20, Zod 4, one module per tool, §3 consolidation, §4 envelope, annotations, version from package.json, `setup` CLI, CI (Node 20/22: typecheck, test, build), MCP contract tests, old→new table | `2.0.0-beta.1` | All existing tests green; contract tests cover all 10 tools; one week of personal use logged |
| R2 Workflows | Start a ticket, verify before PR, typed `data`, recorded Jira fixtures — detailed in `2026-10-19-v2-r2-workflows-design.md` | `2.0.0-beta.2` | Fixtures-based tests for both workflows; used on ≥5 real tickets |
| R3 Writes | §5 guards, `jira_add_comment`, `jira_update_issue`, Markdown→ADF, hand-off | `2.0.0-rc.1` | Write path tested preview→confirm→audit; elicitation fallback tested |
| R4 Launch | SKILL.md, Claude Code plugin, tool-selection evals (~30 prompts), README rewrite + GIF, MCP Registry `server.json`, Cursor link, directories, release-please + npm provenance, OSS hygiene files | `2.0.0` | Eval pass rate reported in README; listed in Registry |
| After | Agensi free listing; consider paid premium skills; revisit DC/OAuth/HTTP, remote PR diffs | — | — |

## 8. Non-goals (v2)

Jira Data Center/Server, OAuth 3LO, Streamable HTTP, remote PR fetching, description/AC edits, telemetry, `.mcpb` bundle, a runtime LLM or agent framework inside the server.
