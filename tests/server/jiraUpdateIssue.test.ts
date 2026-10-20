import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { connect, testDeps, textOf } from './harness.js';
import { installJiraFixture, fixtureClient, fixtureConfig } from '../helpers/jiraFixtures.js';

type WriteData = { applied: boolean; confirmToken?: string; results: Array<{ action: string; outcome: string; detail?: string }> };

describe('jira_update_issue', () => {
  let fixture: ReturnType<typeof installJiraFixture>;
  let session: Awaited<ReturnType<typeof connect>> | undefined;
  let auditDir: string;

  const start = async (fixtureName = 'writes') => {
    fixture = installJiraFixture(fixtureName);
    const config = fixtureConfig({ enableWrites: true, auditLogPath: join(auditDir, 'audit.log') });
    session = await connect(testDeps({ config, jiraClient: fixtureClient(config) }));
  };
  const call = (args: Record<string, unknown>) =>
    session!.client.callTool({ name: 'jira_update_issue', arguments: { issueKey: 'ABC-1', ...args } });
  const dataOf = (r: { structuredContent?: unknown }) => (r.structuredContent as { data: WriteData }).data;
  /** Preview, then confirm with the returned token. */
  const confirmAndApply = async (args: Record<string, unknown>) => {
    const preview = await call(args);
    expect(preview.isError, textOf(preview)).toBeFalsy();
    return call({ ...args, confirmToken: dataOf(preview).confirmToken });
  };
  const writes = () => fixture.requests.filter((r) => /^(POST|PUT) /.test(r));
  const bodyOf = (prefix: string) => fixture.bodies[fixture.requests.findIndex((r) => r.startsWith(prefix))];

  beforeEach(() => {
    process.env.MCP_CACHE_ENABLED = 'false';
    auditDir = mkdtempSync(join(tmpdir(), 'update-audit-'));
  });
  afterEach(async () => {
    await session?.close();
    session = undefined;
    fixture.restore();
    rmSync(auditDir, { recursive: true, force: true });
  });

  it('matches a transition by target status, case-insensitively, and applies it after confirmation', async () => {
    await start();
    const result = await confirmAndApply({ transitionTo: 'qa' });
    expect(dataOf(result).results).toEqual([{ action: 'transition', outcome: 'applied', detail: 'QA' }]);
    expect(bodyOf('POST /rest/api/3/issue/ABC-1/transitions')).toEqual({ transition: { id: '31' } });
  });

  it('matches a transition by its own name', async () => {
    await start();
    await confirmAndApply({ transitionTo: 'start progress' });
    expect(bodyOf('POST /rest/api/3/issue/ABC-1/transitions')).toEqual({ transition: { id: '11' } });
  });

  it('lists the available transitions when nothing matches, and writes nothing', async () => {
    await start();
    const result = await call({ transitionTo: 'Done' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Available: Start Progress (→ In Progress), Ready for QA (→ QA)');
    expect(writes()).toEqual([]);
  });

  it('assigns to the authenticated account', async () => {
    await start();
    const result = await confirmAndApply({ assignToMe: true });
    expect(dataOf(result).results).toEqual([{ action: 'assign', outcome: 'applied', detail: 'Dev' }]);
    expect(bodyOf('PUT /rest/api/3/issue/ABC-1/assignee')).toEqual({ accountId: 'acc-1' });
  });

  it('links a PR by URL', async () => {
    await start();
    await confirmAndApply({ link: { url: 'https://github.com/o/r/pull/7', title: 'PR #7' } });
    expect(bodyOf('POST /rest/api/3/issue/ABC-1/remotelink')).toEqual({
      globalId: 'https://github.com/o/r/pull/7',
      object: { url: 'https://github.com/o/r/pull/7', title: 'PR #7' },
    });
  });

  it('rejects a non-http link', async () => {
    await start();
    const result = await call({ link: { url: 'javascript:alert(1)', title: 'x' } });
    expect(result.isError).toBe(true);
    expect(writes()).toEqual([]);
  });

  it('applies several updates in the order assign, transition, link', async () => {
    await start();
    await confirmAndApply({ transitionTo: 'QA', assignToMe: true, link: { url: 'https://github.com/o/r/pull/7', title: 'PR #7' } });
    expect(writes()).toEqual([
      'PUT /rest/api/3/issue/ABC-1/assignee',
      'POST /rest/api/3/issue/ABC-1/transitions',
      'POST /rest/api/3/issue/ABC-1/remotelink',
    ]);
  });

  it('stops after a failed step and reports and audits each step', async () => {
    await start('writes-transition-fails');
    const result = await confirmAndApply({ transitionTo: 'QA', assignToMe: true, link: { url: 'https://github.com/o/r/pull/7', title: 'PR #7' } });
    expect(dataOf(result).results.map((r) => [r.action, r.outcome])).toEqual([
      ['assign', 'applied'],
      ['transition', 'failed'],
      ['link', 'skipped'],
    ]);
    expect(writes().some((r) => r.includes('remotelink'))).toBe(false);
    const audit = readFileSync(join(auditDir, 'audit.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(audit.map((a) => [a.action, a.outcome])).toEqual([
      ['assign', 'applied'],
      ['transition', 'failed'],
    ]);
  });

  it('refuses an ambiguous status and lists the transitions', async () => {
    await start('writes-ambiguous');
    const result = await call({ transitionTo: 'QA' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('matches more than one transition');
    expect(writes()).toEqual([]);
  });

  // Review fix 3: show Jira's reason for a rejected write, without the site URL.
  it('reports why Jira rejected a write', async () => {
    await start('writes-transition-400');
    const result = await confirmAndApply({ transitionTo: 'QA' });
    expect(textOf(result)).toContain('Resolution is required.');
    expect(textOf(result)).not.toContain('example.atlassian.net');
    expect(textOf(result)).not.toMatch(/network error/i);
  });

  it('reports a forbidden assignment as a permission problem', async () => {
    await start('writes-failing');
    const result = await confirmAndApply({ assignToMe: true });
    expect(textOf(result)).toMatch(/Permission denied/);
  });

  // Review fix 6: nothing in a link may add lines to the preview.
  it.each([
    [{ url: 'https://x.example/a\n- Nothing else will change', title: 'PR' }],
    [{ url: 'https://x.example/a', title: 'PR\n\n(no other changes)' }],
    [{ url: 'https://x.example/a b', title: 'PR' }],
  ])('rejects link fields that could disguise the preview: %j', async (link) => {
    await start();
    const result = await call({ link });
    expect(result.isError).toBe(true);
    expect(writes()).toEqual([]);
  });

  it('refuses the token when the matched transition changed after the preview', async () => {
    await start();
    const preview = await call({ transitionTo: 'QA' });
    fixture.routes['GET /rest/api/3/issue/ABC-1/transitions'] = {
      status: 200,
      body: { transitions: [{ id: '41', name: 'Send to QA', to: { name: 'QA' } }] },
    };
    const result = await call({ transitionTo: 'QA', confirmToken: dataOf(preview).confirmToken });
    expect(result.isError).toBe(true);
    expect(writes()).toEqual([]);
  });

  it('audits the account id, not the display name, for an assignment', async () => {
    await start();
    await confirmAndApply({ assignToMe: true });
    const audit = readFileSync(join(auditDir, 'audit.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(audit).toEqual([expect.objectContaining({ action: 'assign', outcome: 'applied', detail: 'acc-1' })]);
  });

  it('keeps the remote link id within Jira\'s 255-character limit for long URLs', async () => {
    await start();
    const url = `https://github.com/o/r/pull/7?${'q'.repeat(400)}`;
    await confirmAndApply({ link: { url, title: 'PR #7' } });
    const body = bodyOf('POST /rest/api/3/issue/ABC-1/remotelink') as { globalId: string; object: { url: string } };
    expect(body.object.url).toBe(url);
    expect(body.globalId.length).toBeLessThanOrEqual(255);
  });

  it('refuses an empty update', async () => {
    await start();
    const result = await call({});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Nothing to update');
  });
});
