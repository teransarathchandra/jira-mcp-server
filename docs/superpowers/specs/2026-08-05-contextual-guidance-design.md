# Contextual Guidance for Jira Context Requests

Status: Superseded by `2026-10-19-v2-delivery-mcp-design.md` (guidance engine absorbed into v2 R2)  
Date: 2026-08-05  
Decision owner: jira-delivery-mcp orchestrator

## Decision

Augment the existing `jira_get_issue_context` MCP boundary with a deterministic, single-process contextual-guidance pipeline. Keep the existing internal full-brief function for callers that need it, but make the MCP tool return a compact, schema-validated guidance result with both `structuredContent` and a compatible text projection.

The runtime is an in-memory evidence graph, not a graph database and not a runtime agent swarm:

```text
classify intent
  -> retrieve Jira context
  -> build issue/dependency evidence graph
  -> assess readiness
  -> generate and rank recommendations
  -> decide whether clarification is material
  -> optionally elicit
  -> respond
```

Research and implementation use the requested bounded specialist swarm. Runtime execution remains deterministic TypeScript with no LLM, agent, or external graph service.

## Why this approach

Three options were considered:

1. Add recommendations only to the existing Markdown formatter. This is the smallest code diff, but it does not provide MCP `outputSchema`/`structuredContent`, client-aware elicitation, or reliable workflow/recent-change evidence.
2. Add a separate `jira_get_contextual_guidance` tool. This has a clean contract, but ordinary “get full context” requests would not automatically receive guidance and clients would need a second Jira retrieval.
3. Augment `jira_get_issue_context` at the MCP boundary and share a pure guidance engine with the existing context analysis. This satisfies the user flow, avoids duplicate Jira fetches, preserves internal full-brief callers, and keeps the recommendation logic independently testable. This is the selected option.

A server-wide migration from `@modelcontextprotocol/sdk` v1.30 to the newly released v2 packages is deferred. V1.30 already supports object-root `outputSchema`, `structuredContent`, client capability inspection, and form elicitation. V2 is the correct future route for 2026 `input_required`, but it also requires Node 20, Zod 4, split packages, and migration of all tools, prompts, resources, and transports. That is not the smallest reliable change for this feature.

## Existing architecture and defects to address

- `src/index.ts` manually defines tool JSON schemas and returns text-only tool results.
- `src/tools/getIssueContext.ts` retrieves `IssueContext` and flattens all analysis into Markdown.
- The formatter already extracts requirements, conflicts, readiness, quality, authority, and questions, but discards their typed forms.
- Configured acceptance-criteria, story-point, team, and custom epic field IDs are not added to the issue field request, so their values are normally unavailable.
- Sprint, available transitions, and changelog evidence are not retrieved.
- Any link label containing “block” is currently treated as blocking the main issue. This incorrectly treats “main issue blocks another issue” as an inbound blocker.
- Comment pagination is ascending and capped, which can retain old comments while omitting the newest material comments.
- `latestCommentIntroducesQuestion` is hard-coded to false.
- The current clarification helper can emit five speculative questions, including mobile/role/error-message questions derived only from silence.

The baseline is clean: 58 test files and 1,715 tests pass, and TypeScript typechecking passes before implementation.

## Evidence retrieval

The Jira client will add bounded, read-only retrieval for:

- configured custom context fields, including explicit acceptance criteria;
- Sprint, using `JIRA_SPRINT_FIELD_ID` when configured and otherwise best-effort field discovery by the documented Sprint schema;
- available transitions from `GET /rest/api/3/issue/{key}/transitions`;
- the latest bounded changelog page from `GET /rest/api/3/issue/{key}/changelog` by obtaining the total and requesting the tail page, because this endpoint is oldest-first;
- newest visible comments from the comments endpoint, then chronological sorting for analysis;
- directional link metadata and linked-issue status category.

Fetches after the main issue request will run concurrently where dependencies allow. Transitions, changelog, Sprint discovery, and related-issue access are best-effort: authorization or visibility gaps degrade to explicit evidence states and warnings instead of failing the whole context request.

Strict project authorization applies to the entire graph and fails closed. The effective allowlist is the union of `defaultProjectKey` and `allowedProjectKeys`; startup fails when strict mode yields an empty effective set. The root issue key is validated with `config.projectConfig`, and every parent, epic, linked issue, subtask, and sibling is checked against the same effective allowlist before an HTTP request or metadata projection. Disallowed nodes are represented only as an omitted/unauthorized edge count; their keys, summaries, statuses, and other metadata are not fetched or returned.

All Jira requests use constant, allowlisted REST paths appended to the single startup-validated HTTP(S) Jira origin. The server never fetches URLs found in Jira descriptions, comments, attachments, Sprint values, changelog entries, or custom fields. Base URLs containing userinfo, query, or fragment components are rejected, and authenticated requests must not follow a redirect to another origin.

Absence and unknown are distinct. Every important datum carries a state such as:

```ts
type EvidenceState =
  | 'observed'
  | 'observed_null'
  | 'not_requested'
  | 'not_configured'
  | 'denied_or_missing'
  | 'truncated'
  | 'fetch_error';
```

No recommendation may turn `denied_or_missing`, `truncated`, or `fetch_error` into a factual negative such as “there are no comments” or “there is no Sprint.”

## In-memory graph

The graph contains only retrieved Jira evidence:

- nodes: main issue, parent, epic, subtasks, linked issues, comments, acceptance criteria, Sprint, transitions, and recent changes;
- edges: `parent_of`, `child_of`, `belongs_to_epic`, `links_to`, `blocks`, `blocked_by`, `has_comment`, `has_acceptance_criterion`, `in_sprint`, `can_transition_to`, and `changed_field`;
- provenance: endpoint/field/comment/change/link ID, issue key, observed timestamp, completeness state, and visibility warning;
- confidence: `observed` or `unknown`; the runtime never creates inferred relationship edges.

Only an observed inbound blocking relationship whose linked issue is observed as non-Done forces `BLOCKED`. An inaccessible blocker status creates a readiness gap, while an outbound “blocks” edge never blocks the main issue.

The full graph is not returned by default. The response exposes compact evidence citations and graph counts so token use stays bounded.

## Intent, readiness, recommendations, and questions

`jira_get_issue_context` gains an optional intent enum:

```text
understand | plan | implement | unblock | review
```

Omission is backward-compatible and classifies as `understand`. Intent may reorder otherwise valid recommendations but may not create evidence.

Readiness reuses the existing analyzers where their inputs are complete, with these stricter rules:

- clamp the score to 0–100;
- explicit acceptance criteria and inferred prose criteria have different provenance and weight;
- permission-limited or unconfigured fields reduce confidence rather than counting as missing facts;
- only verified inbound, non-Done dependencies produce `BLOCKED`;
- assignee, priority, and Sprint are informational unless an explicit rule makes them relevant;
- a Done status category is recognized from Jira evidence, never inferred from an empty transition list.

The recommendation engine emits two to four actions from finite templates. Each candidate has a stable rule ID, semantic topic key, priority tier, and one or more resolvable Jira evidence IDs. Ranking order is:

1. verified inbound blocker;
2. high/medium source conflict;
3. explicit ambiguity or unresolved recent Jira question;
4. essential missing goal or acceptance criteria;
5. ready-state implementation, transition, and verification actions.

Candidates are deduplicated by topic key and tie-broken deterministically by evidence authority, recency, then action ID. Candidates without resolvable Jira evidence are dropped. Read-only workflow suggestions can name an observed available transition, but the feature never executes it; any future mutation requires a separate user-confirmed call.

Free-form Jira text is evidence, not instruction or authority. Comments retain immutable Jira `accountId` internally; display name and recency never establish authority. A comment from a configured high-authority account may corroborate a requirement. An uncorroborated comment can surface a conflict or clarification gap, but cannot by itself mark the ticket ready, override description/acceptance criteria, or cause a workflow/mutation suggestion. Prompt-injection detection remains a warning signal, not a trust decision.

Questions are generated only for an explicit conflict, explicit ambiguity, unknown blocker state, or essential missing requirement. A counterfactual gate emits a question only if answering it could change the top recommendation set or order. Questions use fixed templates, cite their Jira evidence, are deduplicated, and are capped at three. Silence alone never creates mobile, role, validation-message, or other speculative questions.

## MCP response and elicitation

The tool advertises an object-root `outputSchema` and read-only annotations. Its compact response contains:

```ts
interface ContextualGuidanceResult {
  schemaVersion: '1.0';
  intent: GuidanceIntent;
  issue: IssueSummary;
  summary: string;
  readiness: { status: string; score: number; confidence: string; gaps: ReadinessGap[] };
  recommendedActions: RecommendedAction[]; // 2..4
  clarifyingQuestions: ClarifyingQuestion[]; // 0..3
  evidence: EvidenceCitation[];
  contextWarnings: string[];
  clarification: { mode: 'not_needed' | 'elicited' | 'fallback'; action?: string };
}
```

Mutation-like recommendations use an explicit contract instead of a generic read-only flag:

```ts
{
  executionMode: 'advisory_only';
  wouldMutate: boolean;
  requiresConfirmation: boolean;
}
```

The response never includes an executable Jira mutation URL or request body. A future mutation must be a separate tool call with fresh confirmation plus issue and status precondition checks.

The server validates the structured object against the same Zod contract used to define the JSON schema before returning it. `structuredContent` contains the object. The single text block contains the compact serialized JSON form of the same object, as recommended by MCP for backward compatibility, so text-only clients remain useful without receiving the previous oversized brief.

Elicitation requires both explicit form capability and an `allowElicitation: true` tool argument; the argument defaults to false so capability is not mistaken for consent to interrupt a read request. The server calls `elicitInput` only after the material-question gate. The requested schema is a flat object of at most three server-authored, bounded strings, with a finite timeout. Post-validation rejects unknown fields, control characters, and oversized values.

Accepted answers are ephemeral, uncached, unlogged, non-authoritative user clarification. The clarification-sensitive ranking is rerun as a provisional view, but every resulting action must still cite at least one Jira evidence record and the answer is identified separately as non-Jira, non-persisted context. An answer cannot replace Jira evidence, establish identity, or confirm a mutation. Disabled/unsupported clients, timeout, malformed input, decline, cancel, or any elicitation error return the complete fallback response with `recommendedActions` and `clarifyingQuestions`.

The future v2 adapter will replace the synchronous elicitation call with multi-round-trip `inputRequired(...)`/`acceptedContent(...)`; no task-status runtime is needed for this short operation.

## Security and mutation boundary

- Jira descriptions, comments, acceptance criteria, and changelog strings are untrusted input.
- Recommendation and question prose comes from allowlisted templates; raw Jira instructions are never copied into action slots.
- Evidence citations identify stable issue/comment/change/link IDs, endpoint/field, timestamp, and completeness. Only bounded typed system-field values may be projected; free-form excerpts, credentials, emails, account IDs, attachment URLs, tokens, and high-entropy strings are never returned.
- Existing prompt-injection detection can create a security warning, but injection-bearing text cannot direct recommendations or tool calls. Free-form evidence can only select finite rule templates under the authority policy above.
- Elicitation never asks for credentials or other sensitive data and never includes ticket prose as instructions.
- Logs contain issue key, rule IDs, counts, completion states, and durations only. No descriptions, comments, evidence excerpts, elicited answers, or secrets are logged.
- Changelog retrieval whitelists relevant field IDs, caps entries and typed value lengths, and does not cache raw changelog responses. Transitions are explicitly user/permission-scoped evidence; empty or denied results never prove that no transition exists.
- The server currently exposes no Jira mutation endpoint. Every mutation-like suggestion is `advisory_only`, sets `wouldMutate: true` and `requiresConfirmation: true`, and cannot be executed by this feature.

## Observability

Use the existing request timer and redacting logger around each graph stage:

```text
classify_intent, retrieve_context, build_graph, assess_readiness,
generate_recommendations, decide_clarification, elicit_optional, respond
```

Emit one structured completion event with stage durations, readiness status, candidate/deduped/dropped counts, action/question counts, incomplete source count, client mode, and total duration. Do not include Jira prose or elicitation answers.

## Test and evaluation plan

Add typed fixtures plus unit and MCP-level integration tests for:

- complete ready ticket, zero questions;
- missing essential criteria, with a material question;
- inbound non-Done blocker, outbound blocker, and Done blocker;
- transition availability and empty/permission-limited transition lists;
- newest comments and latest tail-page changelog changes;
- configured custom acceptance criteria and Sprint discovery/config override;
- parent, child, epic, and inaccessible linked issue evidence;
- conflict, ambiguity, duplicate signals, and deterministic ranking;
- unsupported, accepted, declined, cancelled, and malformed elicitation responses;
- output-schema conformance and text-only client compatibility;
- prompt injection, secret-like content, evidence resolution, and no mutation;
- strict allowlist rejection of cross-project root/parent/epic/link/subtask nodes before HTTP;
- display-name/recency spoofing and uncorroborated comment authority;
- Jira-provided URL non-fetching and authenticated cross-origin redirect rejection;
- elicitation disabled, timeout, extra-field, control-character, oversized, and answer-lifecycle cases;
- an endpoint audit proving only approved read endpoints and the existing read-only search POST are called;
- typical and maximum bounded input latency.

Eval gates:

- blocker/conflict top-1 accuracy: 100% on fixtures;
- irrelevant recommendation count: 0;
- action count: always 2–4;
- unnecessary-question rate: 0; question count always 0–3;
- duplicate topic-key rate: 0;
- actions/questions with missing evidence: 0;
- raw injection instruction or secret copied to guidance/logs: 0;
- byte-stable functional output for identical input, excluding timing metadata;
- pure graph/assessment/recommendation p95: at most 20 ms at maximum fixture bounds;
- compact text projection target: at most 2,500 characters.

The implementation will be test-first and will not add a runtime agent framework, graph database, LLM call, or Jira write operation.

## Documentation references

- [MCP tool structured content and output schemas](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [MCP form elicitation and security](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)
- [MCP TypeScript SDK v1 to v2 migration](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2)
- [Jira Cloud issue, changelog, and transition APIs](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/)
- [Jira Cloud issue field APIs](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-fields/)
- [Jira Software custom fields and Sprint representation](https://developer.atlassian.com/cloud/jira/software/rest/intro/)
- [Jira Cloud issue comments API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-comments/)
