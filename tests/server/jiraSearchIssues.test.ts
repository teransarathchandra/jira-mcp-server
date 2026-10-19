import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { connect, textOf } from './harness.js';
import { JiraAuthError } from '../../src/jiraClient.js';

vi.mock('../../src/tools/searchMyIssues.js', () => ({
  searchMyIssues: vi.fn(async () => '# My issues'),
}));

const { searchMyIssues } = await import('../../src/tools/searchMyIssues.js');
const searchMock = vi.mocked(searchMyIssues);

describe('jira_search_issues', () => {
  let session: Awaited<ReturnType<typeof connect>>;

  beforeEach(async () => {
    searchMock.mockClear();
    session = await connect();
  });
  afterEach(async () => {
    await session.close();
  });

  it('is listed as a read-only tool with an output schema', async () => {
    const { tools } = await session.client.listTools();
    const tool = tools.find((t) => t.name === 'jira_search_issues');
    expect(tool?.outputSchema).toBeDefined();
    expect(tool?.annotations?.readOnlyHint).toBe(true);
  });

  it('forwards the v1 default maxResults when arguments are omitted', async () => {
    const result = await session.client.callTool({ name: 'jira_search_issues', arguments: {} });
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock.mock.calls[0][0]).toEqual({ maxResults: 10 });
    expect((result.structuredContent as { markdown: string }).markdown).toBe('# My issues');
  });

  it('returns a friendly isError result when the wrapper throws a Jira error', async () => {
    searchMock.mockRejectedValueOnce(new JiraAuthError('x'));
    const result = await session.client.callTool({ name: 'jira_search_issues', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Authentication error:/);
  });

  it('rejects out-of-range maxResults without calling the wrapper', async () => {
    const result = await session.client.callTool({ name: 'jira_search_issues', arguments: { maxResults: 99 } });
    expect(result.isError).toBe(true);
    expect(searchMock).not.toHaveBeenCalled();
  });
});
