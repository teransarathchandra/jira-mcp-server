import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { connect, textOf } from './harness.js';
import { ConfluenceNotConfiguredError } from '../../src/confluence/confluenceConfig.js';

vi.mock('../../src/tools/confluenceSearchRelatedPages.js', () => ({
  confluenceSearchRelatedPages: vi.fn(async () => 'related pages'),
}));
vi.mock('../../src/tools/confluenceGetPageSummary.js', () => ({
  confluenceGetPageSummary: vi.fn(async () => 'page summary'),
}));

const search = vi.mocked((await import('../../src/tools/confluenceSearchRelatedPages.js')).confluenceSearchRelatedPages);
const getPage = vi.mocked((await import('../../src/tools/confluenceGetPageSummary.js')).confluenceGetPageSummary);

describe('confluence tools', () => {
  let session: Awaited<ReturnType<typeof connect>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    session = await connect();
  });
  afterEach(async () => {
    await session.close();
  });

  it('confluence_search forwards the v1 defaults', async () => {
    const r = await session.client.callTool({ name: 'confluence_search', arguments: { issueKey: 'ABC-1' } });
    expect(search.mock.calls[0][0]).toEqual({
      issueKey: 'ABC-1',
      maxResults: 10,
      spaceKeys: [],
      includeLowRelevance: false,
    });
    expect((r.structuredContent as { issueKey?: string }).issueKey).toBe('ABC-1');
  });

  it('confluence_get_page forwards the v1 default maxChars', async () => {
    const r = await session.client.callTool({ name: 'confluence_get_page', arguments: { pageId: '42' } });
    expect(getPage.mock.calls[0][0]).toEqual({ pageId: '42', maxChars: 12000 });
    expect(r.structuredContent).not.toHaveProperty('issueKey');
  });

  it('reports a missing Confluence configuration clearly', async () => {
    search.mockRejectedValueOnce(new ConfluenceNotConfiguredError('set CONFLUENCE_BASE_URL'));
    const r = await session.client.callTool({ name: 'confluence_search', arguments: { issueKey: 'ABC-1' } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/^Confluence not configured:/);
  });
});
