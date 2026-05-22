import { describe, it, expect } from 'vitest';
import {
  hashForCacheKey,
  jiraIssueKey,
  jiraSearchKey,
  confluencePageKey,
  confluenceSearchKey,
  gitDiffKey,
} from '../../src/cache/cacheKeys.js';

describe('hashForCacheKey', () => {
  it('returns a string', () => {
    expect(typeof hashForCacheKey('hello')).toBe('string');
  });

  it('returns exactly 16 hex characters', () => {
    const hash = hashForCacheKey('test-value');
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is consistent for the same input', () => {
    const a = hashForCacheKey('same-input');
    const b = hashForCacheKey('same-input');
    expect(a).toBe(b);
  });

  it('produces different hashes for different inputs', () => {
    expect(hashForCacheKey('input-a')).not.toBe(hashForCacheKey('input-b'));
  });

  it('does not contain raw token-like strings in output', () => {
    const rawToken = 'ghp_supersecrettoken1234567890abcdef';
    const hash = hashForCacheKey(rawToken);
    expect(hash).not.toContain('ghp_');
    expect(hash).not.toContain('supersecret');
    expect(hash.length).toBe(16);
  });

  it('handles empty string', () => {
    const hash = hashForCacheKey('');
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('jiraIssueKey', () => {
  it('starts with "jira:issue:"', () => {
    expect(jiraIssueKey('PROJ-123')).toMatch(/^jira:issue:/);
  });

  it('returns expected format', () => {
    expect(jiraIssueKey('PROJ-123')).toBe('jira:issue:PROJ-123');
  });

  it('same input produces same key', () => {
    expect(jiraIssueKey('PROJ-456')).toBe(jiraIssueKey('PROJ-456'));
  });

  it('different inputs produce different keys', () => {
    expect(jiraIssueKey('PROJ-1')).not.toBe(jiraIssueKey('PROJ-2'));
  });
});

describe('jiraSearchKey', () => {
  it('starts with "jira:search:"', () => {
    expect(jiraSearchKey('project = PROJ', 10)).toMatch(/^jira:search:/);
  });

  it('same inputs produce same key', () => {
    const k1 = jiraSearchKey('project = FOO ORDER BY created', 20);
    const k2 = jiraSearchKey('project = FOO ORDER BY created', 20);
    expect(k1).toBe(k2);
  });

  it('different JQL produces different key', () => {
    const k1 = jiraSearchKey('project = FOO', 10);
    const k2 = jiraSearchKey('project = BAR', 10);
    expect(k1).not.toBe(k2);
  });

  it('different maxResults produces different key', () => {
    const k1 = jiraSearchKey('project = FOO', 10);
    const k2 = jiraSearchKey('project = FOO', 20);
    expect(k1).not.toBe(k2);
  });

  it('JQL is hashed (not raw) in output', () => {
    const jql = 'project = SECRET_PROJECT AND assignee = me';
    const key = jiraSearchKey(jql, 10);
    expect(key).not.toContain('SECRET_PROJECT');
    expect(key).not.toContain('assignee');
  });
});

describe('confluencePageKey', () => {
  it('starts with "confluence:page:"', () => {
    expect(confluencePageKey('12345')).toMatch(/^confluence:page:/);
  });

  it('returns expected format', () => {
    expect(confluencePageKey('98765')).toBe('confluence:page:98765');
  });

  it('same input produces same key', () => {
    expect(confluencePageKey('111')).toBe(confluencePageKey('111'));
  });

  it('different inputs produce different keys', () => {
    expect(confluencePageKey('111')).not.toBe(confluencePageKey('222'));
  });
});

describe('confluenceSearchKey', () => {
  it('starts with "confluence:search:"', () => {
    expect(confluenceSearchKey('deployment process', ['ENG'], 10)).toMatch(
      /^confluence:search:/,
    );
  });

  it('same inputs produce same key', () => {
    const k1 = confluenceSearchKey('deployment', ['ENG', 'OPS'], 5);
    const k2 = confluenceSearchKey('deployment', ['ENG', 'OPS'], 5);
    expect(k1).toBe(k2);
  });

  it('different query produces different key', () => {
    const k1 = confluenceSearchKey('deployment', ['ENG'], 5);
    const k2 = confluenceSearchKey('release', ['ENG'], 5);
    expect(k1).not.toBe(k2);
  });

  it('different spaceKeys produces different key', () => {
    const k1 = confluenceSearchKey('query', ['ENG'], 5);
    const k2 = confluenceSearchKey('query', ['OPS'], 5);
    expect(k1).not.toBe(k2);
  });

  it('different maxResults produces different key', () => {
    const k1 = confluenceSearchKey('query', ['ENG'], 5);
    const k2 = confluenceSearchKey('query', ['ENG'], 10);
    expect(k1).not.toBe(k2);
  });

  it('query is hashed in output', () => {
    const query = 'internal secret document classification';
    const key = confluenceSearchKey(query, [], 5);
    expect(key).not.toContain('internal secret');
    expect(key).not.toContain('classification');
  });
});

describe('gitDiffKey', () => {
  it('starts with "git:diff:"', () => {
    expect(gitDiffKey('/repos/myapp', 'main', 'feature/my-branch')).toMatch(/^git:diff:/);
  });

  it('same inputs produce same key', () => {
    const k1 = gitDiffKey('/path/to/repo', 'main', 'HEAD');
    const k2 = gitDiffKey('/path/to/repo', 'main', 'HEAD');
    expect(k1).toBe(k2);
  });

  it('different repoPath produces different key', () => {
    const k1 = gitDiffKey('/repo/a', 'main', 'HEAD');
    const k2 = gitDiffKey('/repo/b', 'main', 'HEAD');
    expect(k1).not.toBe(k2);
  });

  it('different baseBranch produces different key', () => {
    const k1 = gitDiffKey('/repo', 'main', 'HEAD');
    const k2 = gitDiffKey('/repo', 'develop', 'HEAD');
    expect(k1).not.toBe(k2);
  });

  it('different compareRef produces different key', () => {
    const k1 = gitDiffKey('/repo', 'main', 'abc123');
    const k2 = gitDiffKey('/repo', 'main', 'def456');
    expect(k1).not.toBe(k2);
  });

  it('repo path is hashed (not raw) in output', () => {
    const repoPath = '/home/user/super-secret-project';
    const key = gitDiffKey(repoPath, 'main', 'HEAD');
    expect(key).not.toContain('super-secret-project');
    expect(key).not.toContain('/home/user');
  });
});
