// ── Claude Code Workflow Pack Generator ───────────────────────────────────────
// Generates optional Claude Code workflow asset files under a target repo's
// .claude/ directory. Pure file-generation logic — no Jira or network calls.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ── Input / Output types ───────────────────────────────────────────────────────

export interface WorkflowPackInput {
  repoPath: string;
  overwrite: boolean;
}

export interface WorkflowPackResult {
  generated: string[];   // file paths generated
  skipped: string[];     // file paths skipped (already existed + overwrite=false)
  usageExamples: string[];
}

// ── File definitions ───────────────────────────────────────────────────────────

interface WorkflowFile {
  relativePath: string;
  content: string;
}

function getWorkflowFiles(): WorkflowFile[] {
  return [
    {
      relativePath: '.claude/skills/jira-delivery-review/SKILL.md',
      content: `---
name: jira-delivery-review
description: Review a Jira task implementation using the Jira MCP server. Checks PR alignment, Definition of Done, and traceability.
---

# Jira Delivery Review Skill

Use this skill to review whether the current branch implementation aligns with a Jira task.

## Steps
1. Run \`delivery_verify_definition_of_done\` with the issue key
2. Run \`delivery_get_traceability_matrix\` with the issue key
3. Run \`jira_review_pr_alignment\` with the issue key
4. Summarize findings and list required fixes

## When to Use
Use before merging any feature branch to verify Jira requirement coverage.
`,
    },
    {
      relativePath: '.claude/skills/jira-implementation-plan/SKILL.md',
      content: `---
name: jira-implementation-plan
description: Generate an implementation plan from a Jira task using the Jira MCP server.
---

# Jira Implementation Plan Skill

Use this skill to plan implementation before writing code.

## Steps
1. Run \`jira_get_issue_with_confluence_context\` to get full context
2. Run \`delivery_analyze_implementation_impact\` to predict affected areas
3. Run \`delivery_generate_test_strategy\` to plan testing
4. Produce an ordered implementation plan

## When to Use
Use before starting any new Jira task implementation.
`,
    },
    {
      relativePath: '.claude/skills/jira-qa-handoff/SKILL.md',
      content: `---
name: jira-qa-handoff
description: Generate a QA handoff document from a Jira task and current branch.
---

# Jira QA Handoff Skill

Use this skill to prepare a QA handoff after implementation.

## Steps
1. Run \`delivery_generate_qa_handoff\` with the issue key
2. Review and summarize the handoff document
3. Highlight known risks and open questions

## When to Use
Use after implementation is complete and before QA hand-off.
`,
    },
    {
      relativePath: '.claude/commands/jira-plan.md',
      content: `# /jira-plan

Generate an implementation plan for a Jira task.

## Usage
/jira-plan CMPI-1234

## What This Does
1. Fetches the Jira issue with Confluence context
2. Analyzes implementation impact
3. Generates a test strategy
4. Returns a structured implementation plan
`,
    },
    {
      relativePath: '.claude/commands/jira-review-pr.md',
      content: `# /jira-review-pr

Review PR alignment against a Jira task.

## Usage
/jira-review-pr CMPI-1234

## What This Does
1. Fetches the Jira requirement
2. Reviews the current branch diff
3. Checks Definition of Done
4. Returns alignment score and required fixes
`,
    },
    {
      relativePath: '.claude/commands/jira-qa.md',
      content: `# /jira-qa

Generate a QA handoff document for a Jira task.

## Usage
/jira-qa CMPI-1234

## What This Does
1. Fetches the Jira issue
2. Analyzes the current branch changes
3. Generates a QA handoff with test cases and regression areas
`,
    },
    {
      relativePath: '.claude/commands/jira-dod.md',
      content: `# /jira-dod

Verify Definition of Done for a Jira task.

## Usage
/jira-dod CMPI-1234

## What This Does
1. Fetches the Jira issue and current diff
2. Runs 14 Definition of Done checks
3. Returns verdict, score, and required fixes
`,
    },
  ];
}

// ── Main export ────────────────────────────────────────────────────────────────

export function generateWorkflowPack(input: WorkflowPackInput): WorkflowPackResult {
  const absoluteRepoPath = resolve(input.repoPath);
  const files = getWorkflowFiles();

  const generated: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const absolutePath = join(absoluteRepoPath, file.relativePath);

    if (existsSync(absolutePath) && !input.overwrite) {
      skipped.push(absolutePath);
      continue;
    }

    // Ensure parent directory exists
    const parentDir = join(absolutePath, '..');
    mkdirSync(parentDir, { recursive: true });

    writeFileSync(absolutePath, file.content, 'utf8');
    generated.push(absolutePath);
  }

  const usageExamples = [
    '/jira-plan CMPI-1234 — Generate implementation plan',
    '/jira-review-pr CMPI-1234 — Review PR alignment',
    '/jira-dod CMPI-1234 — Verify Definition of Done',
    '/jira-qa CMPI-1234 — Generate QA handoff',
    '/jira-release-note CMPI-1234 — Generate release notes (via delivery_generate_release_notes tool)',
  ];

  return { generated, skipped, usageExamples };
}
