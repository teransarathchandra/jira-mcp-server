import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { connect, testDeps, textOf, type ConnectOptions } from './harness.js';
import { installJiraFixture, fixtureClient, fixtureConfig } from '../helpers/jiraFixtures.js';
import { markdownToAdf } from '../../src/utils/markdownToAdf.js';
import type { Config } from '../../src/config.js';

type WriteData = { applied: boolean; preview: string; confirmToken?: string; results: Array<{ action: string; outcome: string }> };
const MARKDOWN = '## QA handoff\n\n- Lockout after **5** attempts';

describe('jira_add_comment', () => {
  let fixture: ReturnType<typeof installJiraFixture>;
  let session: Awaited<ReturnType<typeof connect>> | undefined;
  let auditDir: string;
  let config: Config;

  const posts = () => fixture.requests.filter((r) => r.startsWith('POST /rest/api/3/issue/ABC-1/comment'));
  const start = async (options: ConnectOptions = {}, overrides: Partial<Config> = {}) => {
    config = fixtureConfig({ enableWrites: true, auditLogPath: join(auditDir, 'audit.log'), ...overrides });
    session = await connect(testDeps({ config, jiraClient: fixtureClient(config) }), options);
  };
  const comment = (args: Record<string, unknown>) =>
    session!.client.callTool({ name: 'jira_add_comment', arguments: { issueKey: 'ABC-1', markdown: MARKDOWN, ...args } });
  const dataOf = (r: { structuredContent?: unknown }) => (r.structuredContent as { data: WriteData }).data;

  beforeEach(() => {
    process.env.MCP_CACHE_ENABLED = 'false';
    fixture = installJiraFixture('writes');
    auditDir = mkdtempSync(join(tmpdir(), 'write-audit-'));
  });
  afterEach(async () => {
    await session?.close();
    session = undefined;
    fixture.restore();
    rmSync(auditDir, { recursive: true, force: true });
  });

  it('is not listed unless writes are enabled', async () => {
    session = await connect(testDeps({ config: fixtureConfig(), jiraClient: fixtureClient() }));
    const { tools } = await session.client.listTools();
    expect(tools.map((t) => t.name)).not.toContain('jira_add_comment');
  });

  it('is listed with write annotations when enabled', async () => {
    await start();
    const tool = (await session!.client.listTools()).tools.find((t) => t.name === 'jira_add_comment');
    expect(tool?.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });
  });

  it('tells the agent to get the user\'s approval before using the token', async () => {
    await start();
    const text = textOf(await comment({}));
    expect(text).toMatch(/show this preview to the user/i);
    expect(text).toMatch(/only after they approve/i);
    expect(text).toMatch(/do not use the token on your own/i);
  });

  it('says in both write tool descriptions that only the user can approve', async () => {
    await start();
    const { tools } = await session!.client.listTools();
    for (const name of ['jira_add_comment', 'jira_update_issue']) {
      expect(tools.find((t) => t.name === name)?.description, name).toMatch(/only after the user approves the preview/i);
    }
  });

  it('previews without writing, then applies once with the token', async () => {
    await start();
    const preview = await comment({});
    expect(posts()).toHaveLength(0);
    const token = dataOf(preview).confirmToken;
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(textOf(preview)).toContain(MARKDOWN);

    const applied = await comment({ confirmToken: token });
    expect(dataOf(applied)).toMatchObject({ applied: true, results: [{ action: 'comment', outcome: 'applied' }] });
    expect(posts()).toHaveLength(1);
    expect(fixture.bodies[fixture.requests.indexOf(posts()[0])]).toEqual({ body: markdownToAdf(MARKDOWN) });
  });

  it('refuses a reused token and a token for changed text', async () => {
    await start();
    const token = dataOf(await comment({})).confirmToken;
    await comment({ confirmToken: token });
    const reused = await comment({ confirmToken: token });
    expect(reused.isError).toBe(true);
    expect(textOf(reused)).toMatch(/invalid or expired/);

    const token2 = dataOf(await comment({})).confirmToken;
    const changed = await comment({ markdown: 'something else', confirmToken: token2 });
    expect(changed.isError).toBe(true);
    expect(posts()).toHaveLength(1);
  });

  it('applies in one call when the user confirms in an elicitation form', async () => {
    const onElicit = vi.fn(async () => ({ action: 'accept', content: { confirm: true } }));
    await start({ onElicit });
    const result = await comment({});
    expect(onElicit).toHaveBeenCalledOnce();
    expect(dataOf(result).applied).toBe(true);
    expect(posts()).toHaveLength(1);
  });

  // Review fix 1: an explicit "no" must not be one call away from posting.
  it.each([
    ['decline', async () => ({ action: 'decline' })],
    ['confirm false', async () => ({ action: 'accept', content: { confirm: false } })],
  ])('changes nothing and issues no token when the user answers %s', async (_label, onElicit) => {
    await start({ onElicit });
    const result = await comment({});
    expect(dataOf(result).applied).toBe(false);
    expect(dataOf(result).confirmToken).toBeUndefined();
    expect(textOf(result)).toMatch(/declined/i);
    expect(posts()).toHaveLength(0);
  });

  it('falls back to preview and token when the form fails or times out', async () => {
    await start({ onElicit: async () => { throw new Error('client closed the form'); } });
    const result = await comment({});
    expect(dataOf(result).applied).toBe(false);
    expect(dataOf(result).confirmToken).toBeDefined();
    expect(posts()).toHaveLength(0);
  });

  it('writes to the normalized key when the key has spaces or lower case', async () => {
    await start();
    const preview = await comment({ issueKey: ' abc-1' });
    expect(textOf(preview)).toContain('ABC-1');
    const applied = await comment({ issueKey: ' abc-1', confirmToken: dataOf(preview).confirmToken });
    expect(dataOf(applied).applied).toBe(true);
    expect(posts()).toHaveLength(1);
  });

  it('shows the audit warning when a refused token cannot be audited', async () => {
    await start({}, { auditLogPath: '/dev/null/not-a-dir/audit.log' });
    const result = await comment({ confirmToken: 'f'.repeat(32) });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/invalid or expired/);
    expect(textOf(result)).toMatch(/audit log/i);
  });

  it('refuses a token used for a different issue', async () => {
    await start();
    const token = dataOf(await comment({})).confirmToken;
    const other = await comment({ issueKey: 'ABC-2', confirmToken: token });
    expect(other.isError).toBe(true);
    expect(fixture.requests.some((r) => r.startsWith('POST'))).toBe(false);
  });

  it('still writes, and warns, when the audit log cannot be written', async () => {
    await start({}, { auditLogPath: '/dev/null/not-a-dir/audit.log' });
    const token = dataOf(await comment({})).confirmToken;
    const result = await comment({ confirmToken: token });
    expect(dataOf(result).applied).toBe(true);
    expect((result.structuredContent as { warnings: string[] }).warnings.join(' ')).toMatch(/audit log/i);
    expect(textOf(result)).toMatch(/audit log/i);
  });

  // Review fix 2: a 5xx or timeout may still have been applied by Jira.
  it('says the outcome is unknown after a server error instead of inviting a retry', async () => {
    fixture.restore();
    fixture = installJiraFixture('writes-failing');
    await start();
    const token = dataOf(await comment({})).confirmToken;
    const result = await comment({ confirmToken: token });
    expect(textOf(result)).toMatch(/outcome is unknown/i);
    expect(textOf(result)).toContain('check ABC-1');
  });

  // Review fix 6: the preview shows the comment fenced, so Markdown cannot disguise it.
  it('shows the comment inside a code fence in the preview', async () => {
    await start();
    const result = await session!.client.callTool({ name: 'jira_add_comment', arguments: { issueKey: 'ABC-1', markdown: 'see ```code``` here' } });
    expect(textOf(result)).toMatch(/\n`{4,}\nsee ```code``` here\n`{4,}\n/);
  });

  it('audits the write without the comment text or the token', async () => {
    await start();
    const token = dataOf(await comment({})).confirmToken as string;
    await comment({ confirmToken: token });
    const log = readFileSync(join(auditDir, 'audit.log'), 'utf8');
    const lines = log.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toEqual([expect.objectContaining({ tool: 'jira_add_comment', issueKey: 'ABC-1', action: 'comment', outcome: 'applied', detail: '30001' })]);
    expect(log).not.toContain('Lockout');
    expect(log).not.toContain(token);
  });

  it('refuses an issue outside the strict allowlist before any request', async () => {
    await start({}, {
      projectConfig: { defaultProjectKey: 'ABC', allowedProjectKeys: ['ABC'], issueKeyPattern: /^[A-Z][A-Z0-9]+-\d+$/, strictProjectAllowlist: true, exampleIssueKey: 'ABC-1' },
    });
    const before = fixture.requests.length;
    const result = await comment({ issueKey: 'XYZ-1' });
    expect(result.isError).toBe(true);
    expect(fixture.requests.length).toBe(before);
    expect(existsSync(join(auditDir, 'audit.log'))).toBe(false);
  });
});
