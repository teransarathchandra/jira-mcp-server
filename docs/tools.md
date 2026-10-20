# Workflows: start a ticket, verify before PR

Two tools return typed `data` in `structuredContent` alongside their Markdown, so an agent can act on the result without parsing text.

## Start a ticket: `jira_prepare_work_brief`

The text starts with a short **Start here** section (readiness, blockers, next steps, questions, branch) followed by the implementation prompt. `data` looks like this:

```json
{
  "issue": { "key": "ABC-1", "summary": "Add login rate limiting", "type": "Story", "status": "To Do", "statusCategory": "new", "priority": "Medium", "assignee": null },
  "readiness": { "status": "MOSTLY_READY", "score": 60, "confidence": "high", "gaps": [] },
  "acceptanceCriteria": [
    { "text": "Lock the account for 15 minutes after 5 failed login attempts", "source": "description" },
    { "text": "Show a lockout message with the remaining lock time", "source": "description" }
  ],
  "blockers": [],
  "recommendedActions": [
    { "id": "create-branch", "text": "Create the suggested branch (see branchName).", "evidence": ["issue:ABC-1:summary"] },
    { "id": "implement-and-verify", "text": "Implement against the 2 acceptance criteria, then run delivery_check_changes.", "evidence": ["issue:ABC-1:description"] }
  ],
  "clarifyingQuestions": [],
  "branchName": "feature/ABC-1-add-login-rate-limiting",
  "evidence": { "comments": "observed", "linkedIssues": "observed_empty", "subtasks": "observed_empty", "parent": "observed_empty", "epic": "observed_empty", "acceptanceCriteriaField": "not_configured", "confluence": "not_requested" }
}
```

How it decides:
- **Readiness** is `BLOCKED` only when an issue that blocks this one ("is blocked by") is still open. A link where this ticket blocks another one never blocks it.
- **Acceptance criteria** come from your configured `JIRA_ACCEPTANCE_CRITERIA_FIELD_ID` first, then from the description. No criteria at all means `NEEDS_CLARIFICATION`.
- **Confidence** drops when something couldn't be read (a linked issue you can't see, truncated comments). Missing data is never reported as "none".
- **Actions** (2–4) and **questions** (0–3) come from fixed templates. Ticket text decides which ones apply but is never copied into them. A question is asked only when its answer could change the first step.
- **Branch name** follows `JIRA_BRANCH_PATTERN` (default `{type}/{KEY}-{slug}`): Bug/Defect → `fix`, Story/Feature/Improvement/Epic → `feature`, anything else → `chore`. It's a suggestion; nothing runs git.
- **`allowElicitation: true`** asks the questions in a form when your client supports it. Answers come back in `clarifyingQuestions[].answer` for that response only and are never stored. The form waits up to 60 seconds; some clients cancel a tool call after 60 seconds in total, so answer promptly or leave it off.

## Verify before PR: `delivery_check_changes`

`data` holds a single verdict plus the detail behind it:

```json
{
  "verdict": "needs_work",
  "summary": "Needs work: 1 missing, 0 partial criteria, 0 required fixes.",
  "alignment": {
    "status": "PARTIALLY_ALIGNED", "score": 55, "confidence": "Medium",
    "criteria": [
      { "text": "Lock the account for 15 minutes after 5 failed login attempts", "status": "covered", "files": ["src/auth/rateLimit.ts"] },
      { "text": "Show a lockout message with the remaining lock time", "status": "missing", "files": [] }
    ],
    "unrelatedChanges": [], "testSignal": "tests_added"
  },
  "dod": { "status": "NEEDS_SMALL_FIXES", "score": 72, "confidence": "Medium", "failed": [], "warnings": [], "requiredFixes": [] },
  "impact": { "likelyAffectedAreas": ["auth"], "riskyDownstreamFlows": [], "unknowns": [] },
  "failedChecks": [],
  "diff": { "baseBranch": "origin/main", "compareRef": "HEAD", "filesChanged": 2, "truncated": false }
}
```

The verdict comes only from the diff-based checks (`alignment`, `dod`); `impact` is advisory.
- `not_applicable`: only `impact` was run (planning before any code exists), so there is no PR verdict.
- `insufficient_evidence`: no changes against the base branch, the diff couldn't be read, a selected diff-based check crashed, alignment found no evidence, or some criteria have no evidence.
- `needs_work`: a criterion is `missing` or only `partial`, the Definition of Done failed, or there are required fixes.
- `ready_for_pr`: every criterion is `covered` and the Definition of Done passed.

For writing results back to Jira, see [Hand off](../README.md#hand-off-write-back-to-jira).
