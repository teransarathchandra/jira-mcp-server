import { describe, it, expect } from 'vitest';
import {
  isValidGitRef,
  validateGitRef,
  isValidRepoPath,
  resolveRepoPath,
} from '../src/utils/gitSafety.js';

// ── isValidGitRef – valid refs ─────────────────────────────────────────────────

describe('isValidGitRef – valid refs', () => {
  it('accepts "HEAD"', () => {
    expect(isValidGitRef('HEAD')).toBe(true);
  });

  it('accepts "main"', () => {
    expect(isValidGitRef('main')).toBe(true);
  });

  it('accepts "origin/main"', () => {
    expect(isValidGitRef('origin/main')).toBe(true);
  });

  it('accepts "feature/my-branch"', () => {
    expect(isValidGitRef('feature/my-branch')).toBe(true);
  });

  it('accepts a short commit hash "abc123"', () => {
    expect(isValidGitRef('abc123')).toBe(true);
  });

  it('accepts a semver tag "v1.0.0"', () => {
    expect(isValidGitRef('v1.0.0')).toBe(true);
  });

  it('accepts "HEAD~1"', () => {
    expect(isValidGitRef('HEAD~1')).toBe(true);
  });

  it('accepts "refs/heads/main"', () => {
    expect(isValidGitRef('refs/heads/main')).toBe(true);
  });
});

// ── isValidGitRef – invalid refs ───────────────────────────────────────────────

describe('isValidGitRef – invalid refs', () => {
  it('rejects empty string', () => {
    expect(isValidGitRef('')).toBe(false);
  });

  it('rejects a string with spaces', () => {
    expect(isValidGitRef('main branch')).toBe(false);
  });

  it('rejects shell injection "; rm -rf /"', () => {
    expect(isValidGitRef('; rm -rf /')).toBe(false);
  });

  it('rejects "main..other" (double dot)', () => {
    expect(isValidGitRef('main..other')).toBe(false);
  });

  it('rejects a string with a null byte', () => {
    expect(isValidGitRef('main\x00branch')).toBe(false);
  });

  it('rejects a string with a backtick', () => {
    expect(isValidGitRef('main`whoami`')).toBe(false);
  });

  it('rejects a string with a dollar sign', () => {
    expect(isValidGitRef('$HOME')).toBe(false);
  });

  it('rejects a string over 256 characters', () => {
    const longRef = 'a'.repeat(257);
    expect(isValidGitRef(longRef)).toBe(false);
  });

  it('accepts a string of exactly 256 characters', () => {
    const maxRef = 'a'.repeat(256);
    expect(isValidGitRef(maxRef)).toBe(true);
  });
});

// ── validateGitRef ─────────────────────────────────────────────────────────────

describe('validateGitRef – throws for invalid refs', () => {
  it('throws for empty string', () => {
    expect(() => validateGitRef('')).toThrow();
  });

  it('throws for a ref with spaces', () => {
    expect(() => validateGitRef('main branch')).toThrow();
  });

  it('throws for shell injection', () => {
    expect(() => validateGitRef('; rm -rf /')).toThrow();
  });

  it('throws for double-dot ref "main..other"', () => {
    expect(() => validateGitRef('main..other')).toThrow();
  });

  it('throws for a ref with a null byte', () => {
    expect(() => validateGitRef('main\x00branch')).toThrow();
  });

  it('throws for a ref with a backtick', () => {
    expect(() => validateGitRef('main`whoami`')).toThrow();
  });

  it('throws for a ref exceeding 256 chars', () => {
    expect(() => validateGitRef('a'.repeat(257))).toThrow();
  });
});

describe('validateGitRef – does not throw for valid refs', () => {
  it('does not throw for "HEAD"', () => {
    expect(() => validateGitRef('HEAD')).not.toThrow();
  });

  it('does not throw for "main"', () => {
    expect(() => validateGitRef('main')).not.toThrow();
  });

  it('does not throw for "origin/main"', () => {
    expect(() => validateGitRef('origin/main')).not.toThrow();
  });

  it('does not throw for "feature/my-branch"', () => {
    expect(() => validateGitRef('feature/my-branch')).not.toThrow();
  });

  it('does not throw for "v1.0.0"', () => {
    expect(() => validateGitRef('v1.0.0')).not.toThrow();
  });

  it('does not throw for "HEAD~1"', () => {
    expect(() => validateGitRef('HEAD~1')).not.toThrow();
  });

  it('does not throw for "refs/heads/main"', () => {
    expect(() => validateGitRef('refs/heads/main')).not.toThrow();
  });
});

// ── isValidRepoPath ────────────────────────────────────────────────────────────

describe('isValidRepoPath – invalid paths', () => {
  it('rejects empty string', () => {
    expect(isValidRepoPath('')).toBe(false);
  });

  it('rejects path with null bytes', () => {
    expect(isValidRepoPath('/tmp/re\x00po')).toBe(false);
  });

  it('rejects path with semicolons', () => {
    expect(isValidRepoPath('/tmp/repo; rm -rf /')).toBe(false);
  });

  it('rejects path with backtick', () => {
    expect(isValidRepoPath('/tmp/`whoami`')).toBe(false);
  });

  it('rejects path with dollar sign', () => {
    expect(isValidRepoPath('/tmp/$HOME')).toBe(false);
  });
});

describe('isValidRepoPath – valid paths', () => {
  it('accepts an absolute path "/tmp/repo"', () => {
    expect(isValidRepoPath('/tmp/repo')).toBe(true);
  });

  it('accepts a relative path "./myrepo"', () => {
    expect(isValidRepoPath('./myrepo')).toBe(true);
  });

  it('accepts a path with hyphens and underscores', () => {
    expect(isValidRepoPath('/home/user/my-project_v2')).toBe(true);
  });
});

// ── resolveRepoPath ────────────────────────────────────────────────────────────

describe('resolveRepoPath', () => {
  it('throws for empty string', () => {
    expect(() => resolveRepoPath('')).toThrow();
  });

  it('throws for path with null bytes', () => {
    expect(() => resolveRepoPath('/tmp/re\x00po')).toThrow();
  });

  it('throws for path with semicolons', () => {
    expect(() => resolveRepoPath('/tmp/repo; rm -rf /')).toThrow();
  });

  it('returns an absolute path for a valid relative path', () => {
    const result = resolveRepoPath('./myrepo');
    expect(result).toMatch(/^\/.*myrepo$/);
  });

  it('returns the same absolute path for an absolute path', () => {
    const result = resolveRepoPath('/tmp/repo');
    expect(result).toBe('/tmp/repo');
  });
});
