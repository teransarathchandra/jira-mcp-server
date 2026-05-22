// ── Generic MCP Prompt Pack Generator ─────────────────────────────────────────
// Generates client-agnostic prompt template files under a target repo's
// .mcp-prompts/ directory. Pure file-generation logic — no Jira or network calls.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ── Input / Output types ───────────────────────────────────────────────────────

export interface GenericPromptPackInput {
  repoPath: string;
  overwrite: boolean;
}

export interface GenericPromptPackResult {
  generated: string[];
  skipped: string[];
  usageExamples: string[];
}

// ── File definitions ───────────────────────────────────────────────────────────

interface PromptFile {
  relativePath: string;
  content: string;
}

function getPromptFiles(): PromptFile[] {
  return [
    {
      relativePath: '.mcp-prompts/implementation-prompt.md',
      content: `# Implementation Prompt Template

Use this template with your MCP client to generate a full implementation prompt for a Jira task.

## How to use

Ask your coding agent:

> Use the jira-delivery-mcp MCP server tool \`jira_prepare_contextual_work_prompt\`
> with issue key <ISSUE-KEY> to generate an implementation prompt.

Or for Confluence-enriched context:

> Use \`jira_prepare_confluence_enriched_work_prompt\` with issue key <ISSUE-KEY>.

## What you get

- Jira requirement summary
- Acceptance criteria
- Technical signals (files, APIs, components)
- Repo inspection hints
- Risks and ambiguities
- Coding agent instructions

## Coding agent instructions (included automatically)

- Inspect the repository before editing.
- Implement only confirmed requirements.
- Do not guess missing business rules.
- Follow existing project conventions.
- Add or update tests when behavior changes.
- Summarize changed files and reasoning after implementation.
`,
    },
    {
      relativePath: '.mcp-prompts/pr-review-prompt.md',
      content: `# PR Review Prompt Template

Use this template with your MCP client to generate a PR review prompt aligned to a Jira task.

## How to use

Ask your coding agent:

> Use the jira-delivery-mcp MCP server tool \`jira_prepare_pr_review_prompt\`
> with issue key <ISSUE-KEY> to generate a PR review prompt.

Or for alignment scoring:

> Use \`jira_review_pr_alignment\` with issue key <ISSUE-KEY>.

## What you get

- Jira requirement summary
- Acceptance criteria checklist
- Changed files context
- Alignment score and evidence
- Missing requirements
- Unrelated changes flagged
- Review comments

## Review instructions (included automatically)

- Check that all acceptance criteria are addressed.
- Verify no unconfirmed requirements were implemented.
- Flag any deviations from Jira requirement.
- Note test coverage for changed behavior.
`,
    },
    {
      relativePath: '.mcp-prompts/qa-handoff-prompt.md',
      content: `# QA Handoff Prompt Template

Use this template with your MCP client to generate a QA handoff document for a Jira task.

## How to use

Ask your coding agent:

> Use the jira-delivery-mcp MCP server tool \`delivery_generate_qa_handoff\`
> with issue key <ISSUE-KEY> to generate a QA handoff document.

## What you get

- Feature summary
- Acceptance criteria checklist
- Test scenarios (happy path + edge cases)
- Environment and data setup notes
- Risks to test
- Regression areas

## QA instructions (included automatically)

- Test all acceptance criteria before sign-off.
- Include edge cases from the risk section.
- Verify regression areas are unaffected.
`,
    },
    {
      relativePath: '.mcp-prompts/dod-verification-prompt.md',
      content: `# Definition of Done Verification Prompt Template

Use this template with your MCP client to verify Definition of Done for a Jira task.

## How to use

Ask your coding agent:

> Use the jira-delivery-mcp MCP server tool \`delivery_verify_definition_of_done\`
> with issue key <ISSUE-KEY> to check whether DoD criteria are met.

## What you get

- DoD checklist with pass/fail for each criterion
- Evidence from the implementation
- Missing items
- Recommended fixes

## DoD criteria checked (automatically)

- All acceptance criteria addressed
- Tests added or updated for changed behavior
- No unrelated changes
- No unresolved conflicts between Jira and Confluence
- Implementation aligns with Jira requirement
`,
    },
    {
      relativePath: '.mcp-prompts/test-strategy-prompt.md',
      content: `# Test Strategy Prompt Template

Use this template with your MCP client to generate a test strategy for a Jira task.

## How to use

Ask your coding agent:

> Use the jira-delivery-mcp MCP server tool \`delivery_generate_test_strategy\`
> with issue key <ISSUE-KEY> to generate a test strategy.

## What you get

- Unit test plan
- Integration test plan
- E2E test scenarios
- Edge cases derived from acceptance criteria
- Suggested test file locations
- Mocking strategy for external dependencies

## Test strategy rules (included automatically)

- Derive test cases from acceptance criteria, not assumptions.
- Prefer integration tests over mocks for external services.
- Include negative/error path tests.
- Cover all user roles mentioned in the requirement.
`,
    },
    {
      relativePath: '.mcp-prompts/release-notes-prompt.md',
      content: `# Release Notes Prompt Template

Use this template with your MCP client to generate release notes for a Jira task.

## How to use

Ask your coding agent:

> Use the jira-delivery-mcp MCP server tool \`delivery_generate_release_notes\`
> with issue key <ISSUE-KEY> to generate release notes.

## What you get

- User-facing summary of the change
- Affected areas
- Migration notes (if applicable)
- Breaking changes flagged
- Related Jira issues linked

## Release notes rules (included automatically)

- Write for a non-technical audience unless the change is purely internal.
- Highlight user-visible behavior changes.
- Flag breaking changes prominently.
- Do not include implementation details.
`,
    },
  ];
}

// ── Generator ──────────────────────────────────────────────────────────────────

export function generateGenericPromptPack(input: GenericPromptPackInput): GenericPromptPackResult {
  const absRepo = resolve(input.repoPath);
  const files = getPromptFiles();

  const generated: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const absPath = join(absRepo, file.relativePath);
    const dir = absPath.slice(0, absPath.lastIndexOf('/'));

    if (existsSync(absPath) && !input.overwrite) {
      skipped.push(absPath);
      continue;
    }

    mkdirSync(dir, { recursive: true });
    writeFileSync(absPath, file.content, 'utf8');
    generated.push(absPath);
  }

  const usageExamples = [
    'Ask your coding agent: "Use jira_prepare_contextual_work_prompt with <ISSUE-KEY>"',
    'Ask your coding agent: "Use jira_prepare_pr_review_prompt with <ISSUE-KEY>"',
    'Ask your coding agent: "Use delivery_generate_qa_handoff with <ISSUE-KEY>"',
    'Ask your coding agent: "Use delivery_verify_definition_of_done with <ISSUE-KEY>"',
    'Ask your coding agent: "Use delivery_generate_test_strategy with <ISSUE-KEY>"',
    'Ask your coding agent: "Use delivery_generate_release_notes with <ISSUE-KEY>"',
  ];

  return { generated, skipped, usageExamples };
}
