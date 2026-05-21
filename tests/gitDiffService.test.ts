import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseNameStatusLine } from '../src/git/gitDiffService.js';

// ── parseNameStatusLine ────────────────────────────────────────────────────────

describe('parseNameStatusLine – added file', () => {
  it('parses "A\\tpath.ts" as added', () => {
    const result = parseNameStatusLine('A\tpath.ts');
    expect(result).toEqual({ path: 'path.ts', status: 'added' });
  });

  it('parses "A\tsrc/foo/bar.ts" as added with nested path', () => {
    const result = parseNameStatusLine('A\tsrc/foo/bar.ts');
    expect(result).toEqual({ path: 'src/foo/bar.ts', status: 'added' });
  });
});

describe('parseNameStatusLine – modified file', () => {
  it('parses "M\\tpath.ts" as modified', () => {
    const result = parseNameStatusLine('M\tpath.ts');
    expect(result).toEqual({ path: 'path.ts', status: 'modified' });
  });

  it('parses "M\tsrc/index.ts" as modified with nested path', () => {
    const result = parseNameStatusLine('M\tsrc/index.ts');
    expect(result).toEqual({ path: 'src/index.ts', status: 'modified' });
  });
});

describe('parseNameStatusLine – deleted file', () => {
  it('parses "D\\tpath.ts" as deleted', () => {
    const result = parseNameStatusLine('D\tpath.ts');
    expect(result).toEqual({ path: 'path.ts', status: 'deleted' });
  });

  it('parses "D\told/file.ts" as deleted', () => {
    const result = parseNameStatusLine('D\told/file.ts');
    expect(result).toEqual({ path: 'old/file.ts', status: 'deleted' });
  });
});

describe('parseNameStatusLine – renamed file', () => {
  it('parses "R100\\told.ts\\tnew.ts" as renamed with oldPath', () => {
    const result = parseNameStatusLine('R100\told.ts\tnew.ts');
    expect(result).toEqual({ path: 'new.ts', status: 'renamed', oldPath: 'old.ts' });
  });

  it('parses "R\\told.ts\\tnew.ts" (R without score) as renamed', () => {
    const result = parseNameStatusLine('R\told.ts\tnew.ts');
    expect(result).toEqual({ path: 'new.ts', status: 'renamed', oldPath: 'old.ts' });
  });

  it('parses "R085\\tsrc/a.ts\\tsrc/b.ts" as renamed with partial similarity score', () => {
    const result = parseNameStatusLine('R085\tsrc/a.ts\tsrc/b.ts');
    expect(result).toEqual({ path: 'src/b.ts', status: 'renamed', oldPath: 'src/a.ts' });
  });
});

describe('parseNameStatusLine – unknown/unrecognized status', () => {
  it('returns unknown status for unrecognized status code "X\\tpath.ts"', () => {
    const result = parseNameStatusLine('X\tpath.ts');
    expect(result).toEqual({ path: 'path.ts', status: 'unknown' });
  });

  it('returns unknown status with empty path when parts[1] is missing', () => {
    const result = parseNameStatusLine('X\t');
    expect(result).toEqual({ path: '', status: 'unknown' });
  });
});

describe('parseNameStatusLine – empty/unparseable input', () => {
  it('returns null for empty string', () => {
    expect(parseNameStatusLine('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(parseNameStatusLine('   ')).toBeNull();
  });

  it('returns null for a line with no tab separator', () => {
    expect(parseNameStatusLine('Mpath.ts')).toBeNull();
  });
});

// ── Truncation logic ───────────────────────────────────────────────────────────

describe('getDiff – truncation logic (via mocked execFile)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('truncates diff text when output exceeds maxDiffChars', async () => {
    vi.doMock('node:child_process', () => {
      const bigStdout = 'x'.repeat(100_000);
      return {
        execFile: (_cmd: string, _args: string[], _opts: unknown, cb: (err: null, result: { stdout: string }) => void) => {
          cb(null, { stdout: bigStdout });
        },
      };
    });

    const { getDiff } = await import('../src/git/gitDiffService.js');
    const result = await getDiff('/tmp/repo', 'main', 'HEAD', 1000);

    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(1000);
    expect(result.originalLength).toBe(100_000);
  });

  it('does not truncate diff text when output is within maxDiffChars', async () => {
    vi.doMock('node:child_process', () => {
      const smallStdout = 'x'.repeat(500);
      return {
        execFile: (_cmd: string, _args: string[], _opts: unknown, cb: (err: null, result: { stdout: string }) => void) => {
          cb(null, { stdout: smallStdout });
        },
      };
    });

    const { getDiff } = await import('../src/git/gitDiffService.js');
    const result = await getDiff('/tmp/repo', 'main', 'HEAD', 1000);

    expect(result.truncated).toBe(false);
    expect(result.text.length).toBe(500);
    expect(result.originalLength).toBe(500);
  });
});
