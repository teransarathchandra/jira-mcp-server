# jira-delivery-mcp v2 R2 — Workflows Design

Status: Accepted
Date: 2026-10-19
Parent: `2026-10-19-v2-delivery-mcp-design.md` (§6, §7 R2 row). Narrows the scope of `2026-08-05-contextual-guidance-design.md` to what R2 ships.
Decisions: the owner asked for the recommended defaults without a question round, so every choice below is the author's call unless marked as coming from the parent spec.
Plan: `docs/superpowers/plans/2026-10-19-v2-r2-workflows.md`

## 1. Intent

R1 moved the server to SDK v2 without changing what it says. R2 makes the two headline workflows from the parent spec worth using every day:

- **Start a ticket.** `jira_prepare_work_brief` tells the agent whether the ticket is ready, what to do first, what to ask, and what to name the branch, alongside the existing implementation prompt.
- **Verify before PR.** `delivery_check_changes` returns one verdict and a per-criterion breakdown that an agent can act on without parsing Markdown.

Both tools gain a typed `data` field in their envelope (parent spec §4), so agents and the R4 evals read structure instead of prose.

## 2. Goals, non-goals, anti-goals

**Goals**
- A typed, schema-validated `data` object on `jira_prepare_work_brief` and `delivery_check_changes`.
- Correct briefs: fix the four confirmed defects in §5.
- Deterministic output: identical Jira input gives byte-identical `data`.
- Tests driven by recorded Jira responses (fixtures) through the real `JiraClient`.

**Non-goals (R2)**
- Jira writes (R3), transitions, Sprint, changelog, or an `intent` parameter (deferred from the August spec).
- A full evidence graph with per-node provenance. R2 keeps evidence *states* only (§4.3).
- Remote PR diffs (parent spec Q16).
- Typed `data` on the other eight tools.

**Anti-goals: these count as failure even if everything else works**
- Turning missing or denied data into a factual negative ("there are no comments", "no blockers") when the fetch failed or was truncated.
- Speculative clarifying questions created only from silence (mobile, roles, error copy).
- Recommended actions or questions that copy instructions out of ticket text. Jira content stays untrusted (parent spec §5).
- Calling an LLM, or anything outside Jira, Confluence and local git.

## 3. Constraints

- Everything from the parent spec and the R1 plan's Global Constraints still applies: Node ≥20, SDK v2, Zod 4, object-root input schemas, no stdout writes, no telemetry, and envelope `schemaVersion: '2.0'`.
- Business logic stays in `src/utils`, `src/delivery` and `src/jira`. The new engine is pure functions there; `src/server/tools/*` only wires them up.
- Budget: one 2-week release, about 25 h. §8 lists what gets cut first.

## 4. Start a ticket — `jira_prepare_work_brief`

### 4.1 Inputs

Unchanged from R1 (`issueKey`, `depth`, `includeConfluence`), plus:
- `allowElicitation: boolean`, default `false`. When it is `true` and the client advertises form elicitation, material questions are asked in a form (§4.6). It is off by default so a read request never interrupts the user unasked (carried over from the August spec).

The guidance in `data` is always computed from the **full-depth** context: parent, epic, links, subtasks and comments. `depth` only controls how much of that goes into the Markdown prompt. The author's reasoning: readiness and blockers are wrong without links, and the extra calls are already bounded.

### 4.2 `data` shape

```ts
interface WorkBriefData {
  issue: { key: string; summary: string; type: string; status: string; statusCategory: 'new' | 'indeterminate' | 'done' | 'unknown';
           priority: string | null; assignee: string | null };
  readiness: { status: 'READY' | 'MOSTLY_READY' | 'NEEDS_CLARIFICATION' | 'BLOCKED';
               score: number;                        // 0-100, clamped
               confidence: 'high' | 'medium' | 'low';  // drops when evidence is missing (4.3)
               gaps: Array<{ id: string; text: string }> };
  acceptanceCriteria: Array<{ text: string; source: 'field' | 'description' }>;
  blockers: Array<{ key: string; status: string; direction: 'inward' }>;
  recommendedActions: Array<{ id: string; text: string; evidence: string[] }>;  // 2-4, from fixed templates
  clarifyingQuestions: Array<{ id: string; text: string; reason: string; evidence: string[] }>; // 0-3
  branchName: string;
  evidence: Record<'comments' | 'linkedIssues' | 'subtasks' | 'parent' | 'epic' | 'acceptanceCriteriaField' | 'confluence', EvidenceState>;
}
type EvidenceState = 'observed' | 'observed_empty' | 'not_requested' | 'not_configured' | 'denied_or_missing' | 'truncated' | 'fetch_error';
```

`evidence` strings are stable references such as `issue:ABC-1:description`, `comment:10023` and `link:ABC-7`. They are never excerpts of Jira text.

### 4.3 Evidence states

Each source in `data.evidence` records how the fetch went. The rules:
- Only `observed` and `observed_empty` can support a negative statement ("no subtasks").
- `denied_or_missing`, `truncated` and `fetch_error` lower `readiness.confidence` by one step each, down to a floor of `low`, and add a gap. They never count as "absent".
- `not_configured` (for example, no AC field configured) is informational. It does not lower confidence.

### 4.4 Readiness rules (author's call, adapted from the August spec)

- Start from the existing `evaluateReadiness` score, clamped to 0–100.
- `BLOCKED` only when an **inbound** blocking link ("is blocked by") points at an issue whose status category is observed and is not `done`. An outbound "blocks" link never blocks this ticket. A blocker whose status can't be read adds a gap and leaves the status alone.
- Explicit acceptance criteria (the configured field) outweigh criteria inferred from the description. No criteria at all → `NEEDS_CLARIFICATION`.
- Assignee, priority and Sprint are informational only.

### 4.5 Recommended actions and questions

- **Actions:** 2–4, chosen from a fixed template list. Each has a stable `id`, a priority tier and at least one evidence reference. Ranking, highest first:
  1. resolve the inbound blocker
  2. resolve a high- or medium-severity conflict
  3. answer an explicit ambiguity or an unresolved question in a recent comment
  4. add the missing goal or acceptance criteria
  5. create the branch and implement against the criteria, then run `delivery_check_changes`

  Ties are broken by template order, then by evidence reference. A candidate without evidence is dropped. Free-form Jira text can only *select* a template; it is never copied into the action text.
- **Questions:** 0–3, generated only from an explicit conflict, an explicit ambiguity, an unknown blocker state, or missing essential criteria. Each is kept only if answering it could change the top recommended action. The current speculative questions are removed (§5).

### 4.6 Elicitation (optional, see §8)

When `allowElicitation` is true, the client supports form elicitation and at least one question survives gating, the server asks up to three short string fields with a 60-second timeout. Answers are kept in memory only: never cached or logged, and never treated as Jira evidence. They can re-rank actions for this response only. If the user declines, cancels or times out, or the client doesn't support it, the tool returns the normal response, which already contains the questions.

### 4.7 Branch name

- Pattern from `JIRA_BRANCH_PATTERN` (default `{type}/{KEY}-{slug}`, parent spec Q23).
- `{type}`: Bug/Defect → `fix`; Story/Feature/Improvement/Epic → `feature`; anything else → `chore`.
- `{slug}`: the summary lowercased and transliterated to ASCII, with non-alphanumerics turned into `-` and repeated `-` collapsed. It keeps at most 6 words and 50 characters, never ends with `-`, and falls back to `task` if empty.
- The name is only suggested; nothing runs git.

### 4.8 Markdown

The existing implementation prompt is kept and prefixed by a short **Start here** section: readiness, blockers, actions, questions and branch name, aimed at under 1,500 characters. The prompt stays because pasting it into an agent is the main v1 use.

## 5. Defects fixed in R2 (confirmed in code on 2026-10-19)

1. **AC field never fetched.** `config.acceptanceCriteriaFieldId` (and the story points, team and epic custom fields) are never added to `ISSUE_FIELDS`, so configured acceptance criteria are invisible. Request the configured custom fields and read AC from them first.
2. **Blocker direction.** `relationship.toLowerCase().includes('block')` treats outbound "blocks" as blocking in `formatContextBrief.ts:175`, `reviewPrAlignment.ts:89` and `deliveryVerifyDefinitionOfDone.ts:196`. Replace it with one shared `isInboundBlocker(link)` helper.
3. **Newest comments dropped.** Comment pagination is ascending and capped. Request the newest page (`orderBy=-created`), then sort the comments chronologically for analysis.
4. **Speculative questions.** `clarificationQuestionGenerator` asks up to five questions inferred from silence. Gate them as in §4.5.
5. **A linked issue you can't see fails the whole brief.** `JiraClient` maps both 401 and 403 to `JiraAuthError`, and `fetchIssueContext` re-throws `JiraAuthError` for related issues. A 403 on a related issue must instead mark that evidence `denied_or_missing` and keep going. A 401 (bad credentials) still fails. *(Found while planning.)*

## 6. Verify before PR — `delivery_check_changes`

### 6.1 `data` shape

```ts
interface CheckChangesData {
  verdict: 'ready_for_pr' | 'needs_work' | 'insufficient_evidence';
  summary: string;                        // one line, from a template
  alignment?: { status: AlignmentStatus; score: number; confidence: ConfidenceLevel;
                criteria: Array<{ text: string; status: 'covered' | 'partial' | 'missing' | 'not_enough_evidence'; files: string[] }>;
                unrelatedChanges: Array<{ path: string; reason: string }>;
                testSignal: TestCoverageSignal };
  dod?: { status: DoDStatus; score: number; confidence: ConfidenceLevel;
          failed: Array<{ id: string; name: string; detail: string }>;
          warnings: Array<{ id: string; name: string; detail: string }>;
          requiredFixes: string[] };
  impact?: { likelyAffectedAreas: string[]; riskyDownstreamFlows: string[]; unknowns: string[] };
  failedChecks: Array<'alignment' | 'dod' | 'impact'>;   // checks that threw (R1 behaviour)
  diff: { baseBranch: string; compareRef: string; filesChanged: number; truncated: boolean };
}
```

These come straight from the existing typed results (`AlignmentResult` + `MatchResult`, `DoDResult`, `ImpactAnalysis`). The wrappers get a `*Data` variant that returns the typed result alongside the Markdown, so Jira and git are only read once.

### 6.2 Verdict rule (author's call; tightened after the R2 review)

- `insufficient_evidence`: no diff-based check was selected; the diff could not be read; the diff is empty; any selected diff-based check crashed; alignment reported `NOT_ENOUGH_EVIDENCE`; or, after the rules below, some criteria are `not_enough_evidence`.
- `needs_work`: any criterion is `missing` or `partial`, the DoD status is failed, or `requiredFixes` is non-empty.
- `ready_for_pr`: every criterion is `covered` and the DoD passed. The summary never claims coverage it has not observed.
- `impact` never affects the verdict; it is advisory.

### 6.3 Shared fetch

No new plumbing. Each `JiraClient` already caches `getIssue` and `getIssueMinimal` for the life of the server (`MCP_CACHE_ENABLED`, on by default), so checks after the first one in a call reuse the Jira responses, and the local git commands are cheap. Each check still runs in its own try/catch, as in R1. *(Revised while planning, after the cache was found in `src/jiraClient.ts`.)*

## 7. Testing

- **Recorded fixtures.** `tests/fixtures/jira/<scenario>/*.json` are sanitised Jira Cloud responses. A test helper replaces global `fetch` with a router keyed on method and path, so the real `JiraClient`, parsing and analyzers run. Scenarios:
  - `ready-story`: AC field set, no blockers
  - `ac-in-description`
  - `no-ac`
  - `inbound-blocker-open`
  - `inbound-blocker-done`
  - `outbound-blocks-only`
  - `blocker-status-denied` (403 on the linked issue)
  - `many-comments` (newest beyond the first page)
  - `conflicting-comment`
  - `injection-in-description`
- **Git fixtures.** The tests build a temporary git repo containing one diff that covers the criteria and one that doesn't.
- **Contract tests.** Both tools' `outputSchema` validates `data`, plus a byte-stability test (same input → same `data`).
- **Eval gates** (on fixtures, carried from the August spec):
  - blocker top-1 accuracy is 100%
  - 0 speculative questions
  - actions always number 2–4 and questions 0–3
  - 0 actions or questions without evidence
  - 0 raw Jira text in action or question text

## 8. Order and cut line

Build in this order, cutting from the bottom if the budget runs out:
1. Fixtures harness and defect fixes 1–3 and 5, which every later item depends on.
2. `WorkBriefData`: readiness, evidence states, actions, branch name, plus defect 4 and questions.
3. `CheckChangesData`.
4. The "Start here" Markdown section.
5. Elicitation (§4.6). This is the cut line: if it doesn't fit, it moves to R3 together with the write confirmations, which use the same mechanism.

**Exit criteria (parent spec):** the fixture tests above pass, the owner has used both workflows on at least 5 real tickets, then tag `2.0.0-beta.3`.

## 9. Left to the builder

File and function names inside `src/utils` and `src/delivery`, the exact template wording, the fixture capture and sanitising process, and how the `*Data` wrapper variants are factored — as long as the Markdown output for existing callers doesn't change except for the "Start here" prefix.
