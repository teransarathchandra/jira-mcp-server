import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { connect, textOf } from './harness.js';

vi.mock('../../src/tools/getIssue.js', () => ({ getIssue: vi.fn(async () => 'basic issue') }));
vi.mock('../../src/tools/getIssueContext.js', () => ({ getIssueContext: vi.fn(async () => 'full issue') }));
vi.mock('../../src/tools/jiraGetIssueWithConfluenceContext.js', () => ({
  jiraGetIssueWithConfluenceContext: vi.fn(async () => 'issue + confluence'),
}));
vi.mock('../../src/tools/prepareWorkPrompt.js', () => ({ prepareWorkPrompt: vi.fn(async () => 'basic brief') }));
vi.mock('../../src/tools/prepareContextualWorkPrompt.js', () => ({
  prepareContextualWorkPrompt: vi.fn(async () => 'full brief'),
}));
vi.mock('../../src/tools/jiraPrepareConfluenceEnrichedWorkPrompt.js', () => ({
  jiraPrepareConfluenceEnrichedWorkPrompt: vi.fn(async () => 'brief + confluence'),
}));

const getIssue = vi.mocked((await import('../../src/tools/getIssue.js')).getIssue);
const getIssueContext = vi.mocked((await import('../../src/tools/getIssueContext.js')).getIssueContext);
const getWithConfluence = vi.mocked(
  (await import('../../src/tools/jiraGetIssueWithConfluenceContext.js')).jiraGetIssueWithConfluenceContext,
);
const prepareWorkPrompt = vi.mocked((await import('../../src/tools/prepareWorkPrompt.js')).prepareWorkPrompt);
const prepareContextual = vi.mocked(
  (await import('../../src/tools/prepareContextualWorkPrompt.js')).prepareContextualWorkPrompt,
);
const prepareWithConfluence = vi.mocked(
  (await import('../../src/tools/jiraPrepareConfluenceEnrichedWorkPrompt.js')).jiraPrepareConfluenceEnrichedWorkPrompt,
);

type Envelope = { issueKey?: string; markdown: string };

describe('jira_get_issue and jira_prepare_work_brief', () => {
  let session: Awaited<ReturnType<typeof connect>>;
  const call = (name: string, args: Record<string, unknown>) =>
    session.client.callTool({ name, arguments: args });

  beforeEach(async () => {
    vi.clearAllMocks();
    session = await connect();
  });
  afterEach(async () => {
    await session.close();
  });

  describe('jira_get_issue', () => {
    it('uses the basic fetch with v1 defaults when only issueKey is given', async () => {
      const r = await call('jira_get_issue', { issueKey: 'ABC-1' });
      expect(getIssue.mock.calls[0][0]).toEqual({ issueKey: 'ABC-1', includeComments: true, includeAttachments: true });
      expect((r.structuredContent as Envelope).markdown).toBe('basic issue');
    });

    it('uses the context fetch with v1 defaults for depth full', async () => {
      await call('jira_get_issue', { issueKey: 'ABC-1', depth: 'full' });
      expect(getIssueContext).toHaveBeenCalledTimes(1);
      expect(getIssueContext.mock.calls[0][0]).toEqual({
        issueKey: 'ABC-1',
        includeComments: true,
        includeParent: true,
        includeEpic: true,
        includeLinkedIssues: true,
        includeSubtasks: true,
        includeEpicSiblings: false,
        maxLinkedIssues: 8,
        maxSubtasks: 10,
        maxCommentsPerIssue: 10,
        contextDepth: 1,
      });
    });

    it('uses the Confluence-enriched fetch when includeConfluence is true', async () => {
      await call('jira_get_issue', { issueKey: 'ABC-1', includeConfluence: true });
      expect(getWithConfluence).toHaveBeenCalledTimes(1);
      expect(getWithConfluence.mock.calls[0][0]).toEqual({
        issueKey: 'ABC-1',
        includeJiraComments: true,
        includeParent: true,
        includeEpic: true,
        includeLinkedIssues: true,
        includeSubtasks: true,
        includeConfluence: true,
        includeMediumRelevancePages: true,
        includeLowRelevancePages: false,
      });
      expect(getIssue).not.toHaveBeenCalled();
      expect(getIssueContext).not.toHaveBeenCalled();
    });

    it('puts the issue key in the envelope', async () => {
      const r = await call('jira_get_issue', { issueKey: 'ABC-1' });
      expect((r.structuredContent as Envelope).issueKey).toBe('ABC-1');
    });

    it('surfaces wrapper errors as isError results', async () => {
      getIssue.mockRejectedValueOnce(new Error('Issue key ZZZ-1 is not in the allowed project list'));
      const r = await call('jira_get_issue', { issueKey: 'ZZZ-1' });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toContain('ZZZ-1');
    });
  });

  describe('jira_prepare_work_brief', () => {
    it('uses the basic brief by default', async () => {
      const r = await call('jira_prepare_work_brief', { issueKey: 'ABC-1' });
      expect(prepareWorkPrompt.mock.calls[0][0]).toEqual({ issueKey: 'ABC-1' });
      expect((r.structuredContent as Envelope).markdown).toBe('basic brief');
    });

    it('uses the contextual brief for depth full', async () => {
      await call('jira_prepare_work_brief', { issueKey: 'ABC-1', depth: 'full' });
      expect(prepareContextual.mock.calls[0][0]).toEqual({
        issueKey: 'ABC-1',
        includeComments: true,
        includeParent: true,
        includeEpic: true,
        includeLinkedIssues: true,
        includeSubtasks: true,
        includeEpicSiblings: false,
      });
    });

    it('uses the Confluence-enriched brief when includeConfluence is true', async () => {
      await call('jira_prepare_work_brief', { issueKey: 'ABC-1', includeConfluence: true });
      expect(prepareWithConfluence.mock.calls[0][0]).toEqual({
        issueKey: 'ABC-1',
        includeConfluence: true,
        confluenceMaxPagesToRead: 5,
      });
    });
  });
});
