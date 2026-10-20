import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installJiraFixture, fixtureClient, fixtureConfig } from './helpers/jiraFixtures.js';
import { searchMyIssues } from '../src/tools/searchMyIssues.js';

describe('jira search paging', () => {
  let fixture: ReturnType<typeof installJiraFixture>;
  beforeEach(() => {
    process.env.MCP_CACHE_ENABLED = 'false';
    fixture = installJiraFixture('search-paged');
  });
  afterEach(() => {
    fixture.restore();
    delete process.env.MCP_CACHE_ENABLED;
  });

  it('sends no nextPageToken on the first page', async () => {
    await fixtureClient().searchIssues('assignee = currentUser()', ['summary'], 10);
    expect(fixture.bodies[0]).toEqual({ jql: 'assignee = currentUser()', fields: ['summary'], maxResults: 10 });
  });

  it('forwards a page token to Jira', async () => {
    await fixtureClient().searchIssues('assignee = currentUser()', ['summary'], 10, 'tok-page-2');
    expect(fixture.bodies[0]).toEqual({ jql: 'assignee = currentUser()', fields: ['summary'], maxResults: 10, nextPageToken: 'tok-page-2' });
  });

  it('caches each page separately', async () => {
    process.env.MCP_CACHE_ENABLED = 'true';
    const client = fixtureClient();
    await client.searchIssues('jql', ['summary'], 10);
    await client.searchIssues('jql', ['summary'], 10, 'tok-page-2');
    await client.searchIssues('jql', ['summary'], 10, 'tok-page-2');
    expect(fixture.requests).toHaveLength(2);
  });

  it('returns the issue keys and the next page token', async () => {
    const r = await searchMyIssues({ maxResults: 2, pageToken: 'tok-1' }, fixtureClient(), fixtureConfig());
    expect(fixture.bodies[0]).toMatchObject({ maxResults: 2, nextPageToken: 'tok-1' });
    expect(r.issueKeys).toEqual(['ABC-2', 'ABC-1']);
    expect(r.nextPageToken).toBe('tok-page-2');
    expect(r.markdown).toContain('pageToken: "tok-page-2"');
  });

  it('keeps a summary containing | inside its table cell', async () => {
    const r = await searchMyIssues({}, fixtureClient(), fixtureConfig());
    expect(r.markdown).toContain('| ABC-2 | Export A \\| B report | To Do | High |');
  });

  it('reports no next page on the last page', async () => {
    fixture.routes['POST /rest/api/3/search/jql'].body = { issues: [], isLast: true };
    const r = await searchMyIssues({ pageToken: 'tok-9' }, fixtureClient(), fixtureConfig());
    expect(r.nextPageToken).toBeUndefined();
    expect(r.issueKeys).toEqual([]);
  });
});
