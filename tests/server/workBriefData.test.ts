import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { connect, testDeps, textOf } from './harness.js';
import { installJiraFixture, fixtureClient, fixtureConfig } from '../helpers/jiraFixtures.js';
import { formatStartHere } from '../../src/delivery/formatStartHere.js';
import type { WorkBriefData } from '../../src/delivery/workBriefTypes.js';

describe('jira_prepare_work_brief data', () => {
  let fixture: ReturnType<typeof installJiraFixture> | undefined;
  let session: Awaited<ReturnType<typeof connect>> | undefined;

  async function callFor(name: string) {
    fixture = installJiraFixture(name);
    const config = fixtureConfig();
    session = await connect(testDeps({ config, jiraClient: fixtureClient(config) }));
    return session.client.callTool({ name: 'jira_prepare_work_brief', arguments: { issueKey: 'ABC-1' } });
  }

  beforeEach(() => {
    process.env.MCP_CACHE_ENABLED = 'false';
  });
  afterEach(async () => {
    await session?.close();
    fixture?.restore();
    session = undefined;
    fixture = undefined;
  });

  it('returns typed data and a Start here section ahead of the prompt', async () => {
    const result = await callFor('ready-story');
    expect(result.isError).toBeFalsy();
    const data = (result.structuredContent as { data: WorkBriefData }).data;
    expect(data.branchName).toBe('feature/ABC-1-add-login-rate-limiting');
    expect(textOf(result).startsWith('## Start here')).toBe(true);
    expect(textOf(result)).toContain('Branch: `feature/ABC-1-add-login-rate-limiting`');
  });

  it('reports a blocked ticket', async () => {
    const result = await callFor('inbound-blocker-open');
    expect((result.structuredContent as { data: WorkBriefData }).data.readiness.status).toBe('BLOCKED');
  });
});

describe('formatStartHere()', () => {
  const longText = 'x'.repeat(220);
  const crowded: WorkBriefData = {
    issue: { key: 'ABC-1', summary: 's', type: 'Story', status: 'To Do', statusCategory: 'new', priority: null, assignee: null },
    readiness: {
      status: 'BLOCKED',
      score: 30,
      confidence: 'low',
      gaps: Array.from({ length: 6 }, (_, i) => ({ id: `gap-${i}`, text: longText })),
    },
    acceptanceCriteria: [],
    blockers: [{ key: 'ABC-9', status: 'In Progress', direction: 'inward' }],
    recommendedActions: Array.from({ length: 4 }, (_, i) => ({ id: `a-${i}`, text: `${i} ${longText}`, evidence: ['link:ABC-9'] })),
    clarifyingQuestions: Array.from({ length: 3 }, (_, i) => ({ id: `q-${i}`, text: `${i} ${longText}`, reason: 'r', evidence: ['link:ABC-9'] })),
    branchName: 'feature/ABC-1-s',
    evidence: {
      comments: 'observed', linkedIssues: 'observed', subtasks: 'observed_empty', parent: 'observed_empty',
      epic: 'observed_empty', acceptanceCriteriaField: 'not_configured', confluence: 'not_requested',
    },
  };

  it('stays within 1500 characters and keeps the most important lines', () => {
    const text = formatStartHere(crowded);
    expect(text.length).toBeLessThanOrEqual(1500);
    expect(text.startsWith('## Start here')).toBe(true);
    expect(text).toContain('BLOCKED');
    expect(text).toContain('ABC-9');
    expect(text).toContain('Branch: `feature/ABC-1-s`');
    expect(text).toContain('0 xxx');
  });
});
