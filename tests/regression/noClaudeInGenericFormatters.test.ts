/**
 * Regression: generic formatters must not produce Claude-specific strings
 * in their output. Client-specific wording belongs only in clientProfileConfig.ts
 * and Claude-specific tools (e.g. delivery_generate_claude_workflow_pack).
 */
import { describe, it, expect } from 'vitest';
import { formatRepoInspectionSection, generateRepoInspectionHints } from '../../src/utils/repoInspectionHintGenerator.js';
import { formatContextBrief } from '../../src/utils/formatContextBrief.js';
import type { IssueContext } from '../../src/jira/issueContextService.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeMinimalIssueContext(): IssueContext {
  return {
    mainIssue: {
      id: '10001',
      key: 'ENG-1',
      fields: {
        summary: 'Test feature',
        description: null,
        status: { name: 'In Progress' },
        priority: { name: 'Medium' },
        assignee: null,
        reporter: { displayName: 'Dev' },
        labels: [],
        components: [],
        fixVersions: [],
        issuetype: { name: 'Story' },
        parent: undefined,
        subtasks: [],
        attachment: [],
        comment: { comments: [], total: 0 },
        created: '2024-01-01T00:00:00.000Z',
        updated: '2024-01-01T00:00:00.000Z',
      },
    },
    mainIssueDescription: 'Implement a test feature with validation and a UserProfile component.',
    parentIssue: null,
    parentDescription: null,
    epicIssue: null,
    epicDescription: null,
    linkedIssues: [],
    subtasks: [],
    truncationWarnings: [],
  };
}

// ── repoInspectionHintGenerator ────────────────────────────────────────────────

describe('formatRepoInspectionSection — no Claude-specific strings', () => {
  it('does not contain "Claude Code should" in output', () => {
    const result = generateRepoInspectionHints({
      technicalSignals: ['auth.ts', '/api/users', 'UserProfile'],
      components: ['Auth'],
      labels: [],
      userRoles: ['admin'],
      linkedIssueSummaries: [],
      mainDescription: 'Add validation to the user profile form',
      summary: 'Test summary',
    });
    const formatted = formatRepoInspectionSection(result);
    expect(formatted).not.toContain('Claude Code should');
    expect(formatted).not.toContain('Ask Claude');
  });

  it('uses generic agent wording', () => {
    const result = generateRepoInspectionHints({
      technicalSignals: ['auth.ts'],
      components: [],
      labels: [],
      userRoles: [],
      linkedIssueSummaries: [],
      mainDescription: 'Implement auth',
      summary: 'Auth feature',
    });
    const formatted = formatRepoInspectionSection(result);
    expect(formatted).toContain('coding agent');
  });
});

// ── formatContextBrief ─────────────────────────────────────────────────────────

describe('formatContextBrief — no Claude-specific section headings', () => {
  it('does not output "Final Implementation Prompt for Claude Code"', () => {
    const context = makeMinimalIssueContext();
    const brief = formatContextBrief(context);
    expect(brief).not.toContain('Final Implementation Prompt for Claude Code');
  });

  it('outputs "Final Implementation Prompt" section', () => {
    const context = makeMinimalIssueContext();
    const brief = formatContextBrief(context);
    expect(brief).toContain('## Final Implementation Prompt');
  });

  it('does not output "Implementation Prompt for Claude Code" heading', () => {
    const context = makeMinimalIssueContext();
    const brief = formatContextBrief(context);
    expect(brief).not.toContain('Implementation Prompt for Claude Code');
  });
});
