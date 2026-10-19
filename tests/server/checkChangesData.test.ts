import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { connect, testDeps, textOf } from './harness.js';
import { installJiraFixture, fixtureClient, fixtureConfig } from '../helpers/jiraFixtures.js';
import type { CheckChangesData } from '../../src/delivery/checkChangesTypes.js';

function git(cwd: string, ...args: string[]) {
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd, stdio: 'pipe' });
}

function makeRepo(withFeatureCommit: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'check-changes-'));
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'README.md'), '# app\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
  git(dir, 'checkout', '-q', '-b', 'feature/ABC-1-add-login-rate-limiting');
  if (withFeatureCommit) {
    mkdirSync(join(dir, 'src', 'auth'), { recursive: true });
    writeFileSync(
      join(dir, 'src', 'auth', 'rateLimit.ts'),
      [
        '// Lock the account for 15 minutes after 5 failed login attempts',
        'export const MAX_FAILED_LOGIN_ATTEMPTS = 5;',
        'export const LOCKOUT_MINUTES = 15;',
        '// Show a lockout message with the remaining lock time',
        'export function lockoutMessage(remainingMinutes: number) {',
        '  return `Account locked. Try again in ${remainingMinutes} minutes.`;',
        '}',
      ].join('\n'),
    );
    writeFileSync(
      join(dir, 'src', 'auth', 'rateLimit.test.ts'),
      "import { lockoutMessage } from './rateLimit';\ntest('lockout message', () => expect(lockoutMessage(3)).toContain('3 minutes'));\n",
    );
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'ABC-1 add login rate limiting');
  }
  return dir;
}

describe('delivery_check_changes data', () => {
  let fixture: ReturnType<typeof installJiraFixture>;
  let session: Awaited<ReturnType<typeof connect>>;
  const repos: string[] = [];

  beforeEach(async () => {
    process.env.MCP_CACHE_ENABLED = 'false';
    fixture = installJiraFixture('ready-story');
    const config = fixtureConfig();
    session = await connect(testDeps({ config, jiraClient: fixtureClient(config) }));
  });
  afterEach(async () => {
    await session.close();
    fixture.restore();
    for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const check = async (repoPath: string, baseBranch = 'main') =>
    session.client.callTool({ name: 'delivery_check_changes', arguments: { issueKey: 'ABC-1', repoPath, baseBranch } });

  it('returns a verdict and per-criterion coverage for a branch with changes', async () => {
    const repo = makeRepo(true);
    repos.push(repo);
    const result = await check(repo);
    expect(result.isError).toBeFalsy();
    const data = (result.structuredContent as { data: CheckChangesData }).data;
    expect(['ready_for_pr', 'needs_work', 'insufficient_evidence']).toContain(data.verdict);
    expect(data.alignment?.criteria).toHaveLength(2);
    expect(data.diff.filesChanged).toBeGreaterThanOrEqual(1);
    expect(data.failedChecks).toEqual([]);
  });

  it('reports insufficient evidence when the branch has no changes', async () => {
    const repo = makeRepo(false);
    repos.push(repo);
    const data = ((await check(repo)).structuredContent as { data: CheckChangesData }).data;
    expect(data.verdict).toBe('insufficient_evidence');
  });

  it('names a base branch that does not exist instead of crashing', async () => {
    const repo = makeRepo(true);
    repos.push(repo);
    const result = await check(repo, 'origin/main');
    const text = textOf(result);
    expect(text).toContain('origin/main');
    if (!result.isError) {
      expect((result.structuredContent as { data: CheckChangesData }).data.verdict).toBe('insufficient_evidence');
    }
  });
});
