// ── Codex CLI Prompt Pack Generator ───────────────────────────────────────────
// Generates Codex CLI-friendly prompt files under a target repo's
// .codex-prompts/ directory. Pure file-generation logic — no Jira or network calls.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ── Input / Output types ───────────────────────────────────────────────────────

export interface CodexPromptPackInput {
  repoPath: string;
  overwrite: boolean;
}

export interface CodexPromptPackResult {
  generated: string[];
  skipped: string[];
  usageExamples: string[];
}

// ── File definitions ───────────────────────────────────────────────────────────

interface CodexPromptFile {
  relativePath: string;
  content: string;
}

function getCodexPromptFiles(): CodexPromptFile[] {
  return [
    {
      relativePath: '.codex-prompts/implement-jira-task.md',
      content: `# Implement Jira Task — Codex CLI Prompt

Use this prompt with Codex CLI to implement a Jira task using the Jira Delivery MCP server.

## Setup

Ensure the Jira Delivery MCP server is configured in your Codex CLI config
(~/.codex/config.toml or equivalent). See the project README for setup instructions.

## Prompt to use in Codex CLI

Replace <ISSUE-KEY> with your Jira issue key (e.g. ENG-123):

\`\`\`
Use the Jira Delivery MCP server to fetch the full implementation context for <ISSUE-KEY>
and prepare an implementation plan.

Steps:
1. Call jira_prepare_contextual_work_prompt with issueKey: <ISSUE-KEY>
2. Read the full implementation prompt it returns.
3. Inspect the repository structure relevant to the task.
4. Implement only the confirmed requirements from the Jira task.
5. Do not guess missing business rules — use existing project conventions.
6. Add or update tests for any changed behavior.
7. Summarize the changed files and your key decisions.
\`\`\`

## Notes

- The MCP server is read-only. It will not modify Jira, Confluence, or Git.
- Store JIRA_HOST, JIRA_EMAIL, and JIRA_API_TOKEN as environment variables.
- Do not include credentials in prompts or commit them to the repository.
`,
    },
    {
      relativePath: '.codex-prompts/review-pr-against-jira.md',
      content: `# Review PR Against Jira Task — Codex CLI Prompt

Use this prompt with Codex CLI to review a PR against a Jira task requirement.

## Setup

Ensure the Jira Delivery MCP server is configured in your Codex CLI config.

## Prompt to use in Codex CLI

Replace <ISSUE-KEY> with your Jira issue key:

\`\`\`
Use the Jira Delivery MCP server to review the current branch against <ISSUE-KEY>.

Steps:
1. Call jira_prepare_pr_review_prompt with issueKey: <ISSUE-KEY>
2. Read the review prompt and check the changed files listed.
3. Call jira_review_pr_alignment with issueKey: <ISSUE-KEY>
4. Report: alignment score, matched requirements, missing requirements, unrelated changes.
5. List required fixes before merge.
\`\`\`

## Notes

- The MCP server reads the local git diff — no GitHub credentials needed for local branches.
- Pass baseBranch if your default branch is not origin/main.
`,
    },
    {
      relativePath: '.codex-prompts/generate-test-strategy.md',
      content: `# Generate Test Strategy — Codex CLI Prompt

Use this prompt with Codex CLI to generate a test strategy for a Jira task.

## Setup

Ensure the Jira Delivery MCP server is configured in your Codex CLI config.

## Prompt to use in Codex CLI

Replace <ISSUE-KEY> with your Jira issue key:

\`\`\`
Use the Jira Delivery MCP server to generate a test strategy for <ISSUE-KEY>.

Steps:
1. Call delivery_generate_test_strategy with issueKey: <ISSUE-KEY>
2. Read the test strategy it returns.
3. Identify which test files already exist in the repository for the affected areas.
4. Write or update tests based on the strategy, covering acceptance criteria and edge cases.
5. Run the tests and confirm they pass.
\`\`\`

## Notes

- Derive test cases from acceptance criteria, not assumptions.
- Include negative and error path tests.
- Cover all user roles mentioned in the requirement.
`,
    },
    {
      relativePath: '.codex-prompts/verify-definition-of-done.md',
      content: `# Verify Definition of Done — Codex CLI Prompt

Use this prompt with Codex CLI to verify that a Jira task implementation meets its DoD criteria.

## Setup

Ensure the Jira Delivery MCP server is configured in your Codex CLI config.

## Prompt to use in Codex CLI

Replace <ISSUE-KEY> with your Jira issue key:

\`\`\`
Use the Jira Delivery MCP server to verify Definition of Done for <ISSUE-KEY>.

Steps:
1. Call delivery_verify_definition_of_done with issueKey: <ISSUE-KEY>
2. Call delivery_get_traceability_matrix with issueKey: <ISSUE-KEY>
3. Review the DoD checklist and traceability matrix.
4. List any failing criteria with specific evidence.
5. Recommend fixes for failing criteria before merge.
\`\`\`

## Notes

- DoD criteria include: all AC addressed, tests updated, no unrelated changes, no unresolved conflicts.
- This is a read-only verification — the MCP server will not modify any files.
`,
    },
  ];
}

// ── Generator ──────────────────────────────────────────────────────────────────

export function generateCodexPromptPack(input: CodexPromptPackInput): CodexPromptPackResult {
  const absRepo = resolve(input.repoPath);
  const files = getCodexPromptFiles();

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
    'codex "$(cat .codex-prompts/implement-jira-task.md)" — implement a Jira task',
    'codex "$(cat .codex-prompts/review-pr-against-jira.md)" — review PR against Jira',
    'codex "$(cat .codex-prompts/generate-test-strategy.md)" — generate test strategy',
    'codex "$(cat .codex-prompts/verify-definition-of-done.md)" — verify DoD criteria',
  ];

  return { generated, skipped, usageExamples };
}
