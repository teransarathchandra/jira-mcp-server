import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installJiraFixture, fixtureClient } from '../helpers/jiraFixtures.js';

describe('JiraClient.listFields()', () => {
  let fixture: ReturnType<typeof installJiraFixture>;
  beforeEach(() => {
    process.env.MCP_CACHE_ENABLED = 'false';
    fixture = installJiraFixture('fields');
  });
  afterEach(() => fixture.restore());

  it('returns id, name and whether each field is custom', async () => {
    await expect(fixtureClient().listFields()).resolves.toEqual([
      { id: 'summary', name: 'Summary', custom: false },
      { id: 'customfield_10115', name: 'User Acceptance Criteria', custom: true },
    ]);
    expect(fixture.requests).toEqual(['GET /rest/api/3/field']);
  });
});
