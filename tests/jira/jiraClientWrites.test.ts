import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installJiraFixture, fixtureClient } from '../helpers/jiraFixtures.js';
import { JiraForbiddenError, JiraServerError } from '../../src/jiraClient.js';
import type { AdfDoc } from '../../src/utils/markdownToAdf.js';

const doc: AdfDoc = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'QA handoff' }] }] };

describe('JiraClient writes', () => {
  let fixture: ReturnType<typeof installJiraFixture>;
  const last = () => ({ line: fixture.requests.at(-1), body: fixture.bodies.at(-1) });

  beforeEach(() => {
    process.env.MCP_CACHE_ENABLED = 'false';
  });
  afterEach(() => fixture.restore());

  describe('against a working Jira', () => {
    beforeEach(() => {
      fixture = installJiraFixture('writes');
    });

    it('adds a comment with an ADF body', async () => {
      await expect(fixtureClient().addComment('ABC-1', doc)).resolves.toEqual({ id: '30001' });
      expect(last()).toEqual({ line: 'POST /rest/api/3/issue/ABC-1/comment', body: { body: doc } });
    });

    it('lists transitions', async () => {
      const transitions = await fixtureClient().getTransitions('ABC-1');
      expect(transitions.map((t) => [t.id, t.name, t.to.name])).toEqual([
        ['11', 'Start Progress', 'In Progress'],
        ['31', 'Ready for QA', 'QA'],
      ]);
    });

    it('transitions an issue', async () => {
      await fixtureClient().transitionIssue('ABC-1', '31');
      expect(last()).toEqual({ line: 'POST /rest/api/3/issue/ABC-1/transitions', body: { transition: { id: '31' } } });
    });

    it('reads the authenticated account', async () => {
      await expect(fixtureClient().getMyself()).resolves.toEqual({ accountId: 'acc-1', displayName: 'Dev' });
    });

    it('assigns an issue', async () => {
      await fixtureClient().assignIssue('ABC-1', 'acc-1');
      expect(last()).toEqual({ line: 'PUT /rest/api/3/issue/ABC-1/assignee', body: { accountId: 'acc-1' } });
    });

    it('adds a remote link keyed by its URL', async () => {
      await fixtureClient().addRemoteLink('ABC-1', { url: 'https://github.com/o/r/pull/7', title: 'PR #7' });
      expect(last()).toEqual({
        line: 'POST /rest/api/3/issue/ABC-1/remotelink',
        body: { globalId: 'https://github.com/o/r/pull/7', object: { url: 'https://github.com/o/r/pull/7', title: 'PR #7' } },
      });
    });
  });

  describe('against a failing Jira', () => {
    beforeEach(() => {
      fixture = installJiraFixture('writes-failing');
    });

    it('never retries a write: one request on a 503', async () => {
      await expect(fixtureClient().addComment('ABC-1', doc)).rejects.toBeInstanceOf(JiraServerError);
      expect(fixture.requests.filter((r) => r.startsWith('POST /rest/api/3/issue/ABC-1/comment'))).toHaveLength(1);
    });

    it('reports a forbidden assignment', async () => {
      await expect(fixtureClient().assignIssue('ABC-1', 'acc-1')).rejects.toBeInstanceOf(JiraForbiddenError);
    });
  });
});
