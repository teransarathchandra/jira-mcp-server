import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installJiraFixture, fixtureClient, fixtureConfig } from '../helpers/jiraFixtures.js';
import { fetchIssueContext } from '../../src/jira/issueContextService.js';
import { isInboundBlocker } from '../../src/jira/linkUtils.js';
import { JiraAuthError, JiraForbiddenError } from '../../src/jiraClient.js';
import { CONTEXT_FETCH_DEFAULTS } from '../../src/server/tools/jiraIssueInputs.js';
import type { Config } from '../../src/config.js';

let fixture: ReturnType<typeof installJiraFixture> | undefined;

async function contextFor(name: string, config: Config = fixtureConfig()) {
  fixture = installJiraFixture(name);
  return fetchIssueContext('ABC-1', { ...CONTEXT_FETCH_DEFAULTS }, fixtureClient(config), config);
}

beforeEach(() => {
  process.env.MCP_CACHE_ENABLED = 'false';
});
afterEach(() => {
  fixture?.restore();
  fixture = undefined;
});

describe('custom fields (defect 1)', () => {
  it('requests the configured acceptance-criteria field and marks it observed', async () => {
    const context = await contextFor('ac-field', fixtureConfig({ acceptanceCriteriaFieldId: 'customfield_10050' }));
    expect(fixture!.requests[0]).toContain('customfield_10050');
    expect(context.evidence.acceptanceCriteriaField).toBe('observed');
  });

  it('marks the AC field not_configured when no field id is set', async () => {
    const context = await contextFor('ac-field');
    expect(context.evidence.acceptanceCriteriaField).toBe('not_configured');
  });
});

describe('link direction (defect 2)', () => {
  it('treats an "is blocked by" link as an inbound blocker with its status category', async () => {
    const context = await contextFor('inbound-blocker-open');
    const [link] = context.linkedIssues;
    expect(link).toMatchObject({ key: 'ABC-9', direction: 'inward', linkTypeName: 'Blocks', statusCategory: 'indeterminate', access: 'observed' });
    expect(isInboundBlocker(link)).toBe(true);
  });

  it('does not treat an outbound "blocks" link as blocking this ticket', async () => {
    const context = await contextFor('outbound-blocks-only');
    expect(context.linkedIssues[0].direction).toBe('outward');
    expect(isInboundBlocker(context.linkedIssues[0])).toBe(false);
  });
});

describe('comments (defect 3)', () => {
  it('keeps the newest comments in chronological order and marks them truncated', async () => {
    const context = await contextFor('many-comments');
    expect(context.mainIssue.fields.comment.comments.map((c) => c.id)).toEqual(
      ['16', '17', '18', '19', '20', '21', '22', '23', '24', '25'],
    );
    expect(fixture!.requests.some((r) => r.includes('/comment?') && r.includes('orderBy=-created'))).toBe(true);
    expect(context.evidence.comments).toBe('truncated');
  });

  it('marks fully fetched comments as observed', async () => {
    const context = await contextFor('ready-story');
    expect(context.evidence.comments).toBe('observed');
  });
});

describe('permissions (defect 5)', () => {
  it('keeps going when a linked issue is forbidden', async () => {
    const context = await contextFor('linked-forbidden');
    expect(context.evidence.linkedIssues).toBe('denied_or_missing');
    expect(context.linkedIssues[0]).toMatchObject({ key: 'XYZ-5', access: 'denied', statusCategory: 'indeterminate' });
  });

  it('still fails on bad credentials (401), which is not a permission error', async () => {
    const error = await contextFor('unauthorized').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JiraAuthError);
    expect(error).not.toBeInstanceOf(JiraForbiddenError);
  });
});

describe('evidence for empty sources', () => {
  it('reports observed_empty for sources that were fetched and empty', async () => {
    const context = await contextFor('ready-story');
    expect(context.evidence.linkedIssues).toBe('observed_empty');
    expect(context.evidence.subtasks).toBe('observed_empty');
    expect(context.evidence.parent).toBe('observed_empty');
    expect(context.evidence.epic).toBe('observed_empty');
  });
});
