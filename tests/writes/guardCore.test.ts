import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfirmTokenStore, argsHash } from '../../src/writes/confirmTokens.js';
import { appendAudit } from '../../src/writes/auditLog.js';
import { assertWritableIssue } from '../../src/writes/guard.js';
import { fixtureConfig } from '../helpers/jiraFixtures.js';

describe('ConfirmTokenStore', () => {
  afterEach(() => vi.useRealTimers());
  const args = { issueKey: 'ABC-1', markdown: 'hello' };

  it('confirms once and then refuses the same token', () => {
    const store = new ConfirmTokenStore();
    const token = store.issue('jira_add_comment', 'ABC-1', args);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(store.consume(token, 'jira_add_comment', 'ABC-1', args)).toBe(true);
    expect(store.consume(token, 'jira_add_comment', 'ABC-1', args)).toBe(false);
  });

  it('refuses a token used for another issue, tool or changed arguments', () => {
    const store = new ConfirmTokenStore();
    const t1 = store.issue('jira_add_comment', 'ABC-1', args);
    expect(store.consume(t1, 'jira_add_comment', 'ABC-2', args)).toBe(false);
    const t2 = store.issue('jira_add_comment', 'ABC-1', args);
    expect(store.consume(t2, 'jira_update_issue', 'ABC-1', args)).toBe(false);
    const t3 = store.issue('jira_add_comment', 'ABC-1', args);
    expect(store.consume(t3, 'jira_add_comment', 'ABC-1', { ...args, markdown: 'changed' })).toBe(false);
    expect(store.consume('not-a-token', 'jira_add_comment', 'ABC-1', args)).toBe(false);
  });

  it('expires tokens after five minutes', () => {
    vi.useFakeTimers();
    const store = new ConfirmTokenStore();
    const token = store.issue('jira_add_comment', 'ABC-1', args);
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(store.consume(token, 'jira_add_comment', 'ABC-1', args)).toBe(false);
  });

  it('hashes arguments independent of key order and of confirmToken', () => {
    expect(argsHash({ a: 1, b: { y: 2, x: 1 } })).toBe(argsHash({ b: { x: 1, y: 2 }, a: 1 }));
    expect(argsHash({ a: 1, confirmToken: 'abc' })).toBe(argsHash({ a: 1 }));
    expect(argsHash({ a: 1 })).not.toBe(argsHash({ a: 2 }));
  });
});

describe('appendAudit()', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('appends one JSON line with exactly the audit fields and private permissions', () => {
    const root = mkdtempSync(join(tmpdir(), 'audit-'));
    dirs.push(root);
    const path = join(root, 'nested', 'audit.log');
    expect(appendAudit(path, { tool: 'jira_add_comment', issueKey: 'ABC-1', action: 'comment', outcome: 'applied', detail: '30001' })).toBeNull();
    expect(appendAudit(path, { tool: 'jira_update_issue', issueKey: 'ABC-1', action: 'transition', outcome: 'failed' })).toBeNull();
    const lines = readFileSync(path, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(Object.keys(lines[0]).sort()).toEqual(['action', 'detail', 'issueKey', 'outcome', 'tool', 'ts']);
    expect(Object.keys(lines[1]).sort()).toEqual(['action', 'issueKey', 'outcome', 'tool', 'ts']);
    expect(new Date(lines[0].ts).toISOString()).toBe(lines[0].ts);
    expect(statSync(join(root, 'nested')).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('returns a warning instead of throwing when the log cannot be written', () => {
    const warning = appendAudit('/dev/null/not-a-dir/audit.log', { tool: 't', issueKey: 'ABC-1', action: 'comment', outcome: 'applied' });
    expect(warning).toMatch(/audit log/i);
  });
});

describe('assertWritableIssue()', () => {
  const strict = fixtureConfig({
    projectConfig: { defaultProjectKey: 'ABC', allowedProjectKeys: ['ABC'], issueKeyPattern: /^[A-Z][A-Z0-9]+-\d+$/, strictProjectAllowlist: true, exampleIssueKey: 'ABC-1' },
  });

  it('allows an issue in an allowed project', () => {
    expect(() => assertWritableIssue('ABC-1', strict)).not.toThrow();
  });

  it('refuses an issue outside the strict allowlist', () => {
    expect(() => assertWritableIssue('XYZ-1', strict)).toThrow(/not in the allowed list/);
  });

  it('refuses a malformed key', () => {
    expect(() => assertWritableIssue('not a key', fixtureConfig())).toThrow();
  });
});
