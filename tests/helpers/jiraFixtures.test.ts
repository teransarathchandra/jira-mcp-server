import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installJiraFixture, fixtureClient, fixtureConfig } from './jiraFixtures.js';
import { fetchIssueContext } from '../../src/jira/issueContextService.js';
import { CONTEXT_FETCH_DEFAULTS } from '../../src/server/tools/jiraIssueInputs.js';

describe('recorded-Jira fixture harness', () => {
  let fixture: ReturnType<typeof installJiraFixture>;
  beforeEach(() => {
    process.env.MCP_CACHE_ENABLED = 'false';
    fixture = installJiraFixture('ready-story');
  });
  afterEach(() => fixture.restore());

  it('drives the real JiraClient from recorded responses', async () => {
    const config = fixtureConfig();
    const context = await fetchIssueContext('ABC-1', { ...CONTEXT_FETCH_DEFAULTS }, fixtureClient(config), config);
    expect(context.mainIssue.fields.summary).toBe('Add login rate limiting');
    expect(fixture.requests[0]).toMatch(/^GET \/rest\/api\/3\/issue\/ABC-1\?fields=/);
  });

  it('answers unknown routes with 404', async () => {
    const res = await fetch('https://example.atlassian.net/rest/api/3/issue/NOPE-1');
    expect(res.status).toBe(404);
  });
});
