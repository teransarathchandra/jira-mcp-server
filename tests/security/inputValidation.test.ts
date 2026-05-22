import { describe, it, expect } from 'vitest';
import {
  McpInputError,
  validateIssueKey,
  validatePageId,
  validatePrNumber,
  validateGitRef,
  validateRepoPath,
  validateOutputPath,
  validateSpaceKeys,
  validateIntInRange,
  validateBoolean,
} from '../../src/security/inputValidation.js';
import os from 'node:os';

// ── McpInputError ─────────────────────────────────────────────────────────────

describe('McpInputError', () => {
  it('is an instance of Error', () => {
    const err = new McpInputError('test error');
    expect(err).toBeInstanceOf(Error);
  });

  it('has the correct name', () => {
    const err = new McpInputError('test error');
    expect(err.name).toBe('McpInputError');
  });

  it('stores the field when provided', () => {
    const err = new McpInputError('bad field', 'myField');
    expect(err.field).toBe('myField');
  });

  it('field is undefined when not provided', () => {
    const err = new McpInputError('test error');
    expect(err.field).toBeUndefined();
  });
});

// ── validateIssueKey ──────────────────────────────────────────────────────────

describe('validateIssueKey', () => {
  it('accepts a valid CMPI-XXXX key', () => {
    expect(validateIssueKey('CMPI-1234')).toBe('CMPI-1234');
  });

  it('accepts CMPI-0001', () => {
    expect(validateIssueKey('CMPI-0001')).toBe('CMPI-0001');
  });

  it('accepts CMPI-9999', () => {
    expect(validateIssueKey('CMPI-9999')).toBe('CMPI-9999');
  });

  it('trims surrounding whitespace', () => {
    expect(validateIssueKey('  CMPI-1234  ')).toBe('CMPI-1234');
  });

  it('rejects EVIL-9999 (wrong project)', () => {
    expect(() => validateIssueKey('EVIL-9999')).toThrow(McpInputError);
  });

  it('rejects a plain string "invalid"', () => {
    expect(() => validateIssueKey('invalid')).toThrow(McpInputError);
  });

  it('rejects CMPI-12345 (five digits)', () => {
    expect(() => validateIssueKey('CMPI-12345')).toThrow(McpInputError);
  });

  it('rejects CMPI-123 (three digits)', () => {
    expect(() => validateIssueKey('CMPI-123')).toThrow(McpInputError);
  });

  it('rejects a non-string value', () => {
    expect(() => validateIssueKey(1234)).toThrow(McpInputError);
  });

  it('rejects null', () => {
    expect(() => validateIssueKey(null)).toThrow(McpInputError);
  });

  it('rejects lowercase cmpi-1234', () => {
    expect(() => validateIssueKey('cmpi-1234')).toThrow(McpInputError);
  });
});

// ── validatePageId ────────────────────────────────────────────────────────────

describe('validatePageId', () => {
  it('accepts a numeric string', () => {
    expect(validatePageId('123456')).toBe('123456');
  });

  it('accepts a positive integer number', () => {
    expect(validatePageId(789)).toBe('789');
  });

  it('rejects zero string', () => {
    expect(() => validatePageId('0')).toThrow(McpInputError);
  });

  it('rejects negative number', () => {
    expect(() => validatePageId(-1)).toThrow(McpInputError);
  });

  it('rejects non-numeric string', () => {
    expect(() => validatePageId('abc')).toThrow(McpInputError);
  });

  it('rejects null', () => {
    expect(() => validatePageId(null)).toThrow(McpInputError);
  });

  it('rejects float', () => {
    expect(() => validatePageId(1.5)).toThrow(McpInputError);
  });

  it('rejects zero-padded "00"', () => {
    expect(() => validatePageId('00')).toThrow(McpInputError);
  });

  it('rejects zero-padded "007"', () => {
    expect(() => validatePageId('007')).toThrow(McpInputError);
  });
});

// ── validatePrNumber ──────────────────────────────────────────────────────────

describe('validatePrNumber', () => {
  it('accepts a positive integer', () => {
    expect(validatePrNumber(42)).toBe(42);
  });

  it('accepts a numeric string "100"', () => {
    expect(validatePrNumber('100')).toBe(100);
  });

  it('rejects zero', () => {
    expect(() => validatePrNumber(0)).toThrow(McpInputError);
  });

  it('rejects negative numbers', () => {
    expect(() => validatePrNumber(-5)).toThrow(McpInputError);
  });

  it('rejects a non-numeric string', () => {
    expect(() => validatePrNumber('abc')).toThrow(McpInputError);
  });

  it('rejects a float', () => {
    expect(() => validatePrNumber(1.5)).toThrow(McpInputError);
  });

  it('rejects null', () => {
    expect(() => validatePrNumber(null)).toThrow(McpInputError);
  });

  it('rejects hex literal string "0x5"', () => {
    expect(() => validatePrNumber('0x5')).toThrow(McpInputError);
  });

  it('rejects empty string', () => {
    expect(() => validatePrNumber('')).toThrow(McpInputError);
  });
});

// ── validateGitRef ────────────────────────────────────────────────────────────

describe('validateGitRef', () => {
  it('accepts "main"', () => {
    expect(validateGitRef('main')).toBe('main');
  });

  it('accepts "feature/foo"', () => {
    expect(validateGitRef('feature/foo')).toBe('feature/foo');
  });

  it('accepts a short commit hash "abc123"', () => {
    expect(validateGitRef('abc123')).toBe('abc123');
  });

  it('accepts "HEAD"', () => {
    expect(validateGitRef('HEAD')).toBe('HEAD');
  });

  it('accepts "v1.2.3"', () => {
    expect(validateGitRef('v1.2.3')).toBe('v1.2.3');
  });

  it('rejects a ref with semicolon (;)', () => {
    expect(() => validateGitRef('main; rm -rf /')).toThrow(McpInputError);
  });

  it('rejects a ref with double-dot (..)', () => {
    expect(() => validateGitRef('main..other')).toThrow(McpInputError);
  });

  it('rejects a ref with whitespace', () => {
    expect(() => validateGitRef('main branch')).toThrow(McpInputError);
  });

  it('rejects a ref with null byte', () => {
    expect(() => validateGitRef('main\x00branch')).toThrow(McpInputError);
  });

  it('rejects a non-string value', () => {
    expect(() => validateGitRef(123)).toThrow(McpInputError);
  });

  it('rejects backtick injection', () => {
    expect(() => validateGitRef('main`whoami`')).toThrow(McpInputError);
  });
});

// ── validateRepoPath ──────────────────────────────────────────────────────────

describe('validateRepoPath', () => {
  it('accepts a valid directory path', () => {
    const tmpDir = os.tmpdir();
    expect(() => validateRepoPath(tmpDir)).not.toThrow();
  });

  it('returns an absolute resolved path', () => {
    const tmpDir = os.tmpdir();
    const result = validateRepoPath(tmpDir);
    expect(result).toBe(require('node:path').resolve(tmpDir));
  });

  it('rejects a path with a null byte', () => {
    expect(() => validateRepoPath('/tmp/re\x00po')).toThrow(McpInputError);
  });

  it('rejects an empty string', () => {
    expect(() => validateRepoPath('')).toThrow(McpInputError);
  });

  it('rejects a non-string value', () => {
    expect(() => validateRepoPath(123)).toThrow(McpInputError);
  });

  it('rejects a path that does not exist', () => {
    expect(() => validateRepoPath('/nonexistent/path/xyz123abc')).toThrow(McpInputError);
  });
});

// ── validateOutputPath ────────────────────────────────────────────────────────

describe('validateOutputPath', () => {
  it('accepts a simple relative path', () => {
    expect(validateOutputPath('reports/output.md')).toBe('reports/output.md');
  });

  it('accepts a filename', () => {
    expect(validateOutputPath('output.txt')).toBe('output.txt');
  });

  it('rejects "../../etc/passwd" (path traversal)', () => {
    expect(() => validateOutputPath('../../etc/passwd')).toThrow(McpInputError);
  });

  it('rejects "../secret" (single traversal)', () => {
    expect(() => validateOutputPath('../secret')).toThrow(McpInputError);
  });

  it('rejects an absolute path by default', () => {
    expect(() => validateOutputPath('/absolute/path/output.txt')).toThrow(McpInputError);
  });

  it('accepts an absolute path when allowAbsolute=true', () => {
    expect(() => validateOutputPath('/absolute/path/output.txt', true)).not.toThrow();
    expect(validateOutputPath('/absolute/path/output.txt', true)).toBe('/absolute/path/output.txt');
  });

  it('rejects an empty string', () => {
    expect(() => validateOutputPath('')).toThrow(McpInputError);
  });

  it('rejects a non-string value', () => {
    expect(() => validateOutputPath(42)).toThrow(McpInputError);
  });
});

// ── validateSpaceKeys ─────────────────────────────────────────────────────────

describe('validateSpaceKeys', () => {
  it('accepts valid space keys', () => {
    expect(validateSpaceKeys(['SPACE1', 'MY-SPACE'])).toEqual(['SPACE1', 'MY-SPACE']);
  });

  it('accepts underscore in space key', () => {
    expect(validateSpaceKeys(['MY_SPACE'])).toEqual(['MY_SPACE']);
  });

  it('accepts an empty array', () => {
    expect(validateSpaceKeys([])).toEqual([]);
  });

  it('rejects a space key with "@"', () => {
    expect(() => validateSpaceKeys(['SPACE@1'])).toThrow(McpInputError);
  });

  it('rejects a space key with spaces', () => {
    expect(() => validateSpaceKeys(['MY SPACE'])).toThrow(McpInputError);
  });

  it('rejects a space key longer than 50 characters', () => {
    expect(() => validateSpaceKeys(['A'.repeat(51)])).toThrow(McpInputError);
  });

  it('accepts a space key of exactly 50 characters', () => {
    expect(() => validateSpaceKeys(['A'.repeat(50)])).not.toThrow();
  });

  it('rejects a non-array value', () => {
    expect(() => validateSpaceKeys('SPACE1')).toThrow(McpInputError);
  });

  it('rejects an array containing a non-string', () => {
    expect(() => validateSpaceKeys([123])).toThrow(McpInputError);
  });
});

// ── validateIntInRange ────────────────────────────────────────────────────────

describe('validateIntInRange', () => {
  it('accepts a value within range', () => {
    expect(validateIntInRange(3, 'contextDepth', 0, 5)).toBe(3);
  });

  it('accepts the minimum value', () => {
    expect(validateIntInRange(0, 'contextDepth', 0, 5)).toBe(0);
  });

  it('accepts the maximum value', () => {
    expect(validateIntInRange(5, 'contextDepth', 0, 5)).toBe(5);
  });

  it('accepts a numeric string within range', () => {
    expect(validateIntInRange('3', 'contextDepth', 0, 5)).toBe(3);
  });

  it('rejects a value above the maximum', () => {
    expect(() => validateIntInRange(6, 'contextDepth', 0, 5)).toThrow(McpInputError);
  });

  it('rejects a value below the minimum', () => {
    expect(() => validateIntInRange(-1, 'contextDepth', 0, 5)).toThrow(McpInputError);
  });

  it('rejects a float', () => {
    expect(() => validateIntInRange(2.5, 'contextDepth', 0, 5)).toThrow(McpInputError);
  });

  it('rejects a non-numeric string', () => {
    expect(() => validateIntInRange('abc', 'contextDepth', 0, 5)).toThrow(McpInputError);
  });

  it('rejects null', () => {
    expect(() => validateIntInRange(null, 'contextDepth', 0, 5)).toThrow(McpInputError);
  });

  it('rejects maxDiffChars over 200000', () => {
    expect(() => validateIntInRange(200001, 'maxDiffChars', 0, 200000)).toThrow(McpInputError);
  });

  it('accepts maxDiffChars at 200000', () => {
    expect(validateIntInRange(200000, 'maxDiffChars', 0, 200000)).toBe(200000);
  });

  it('rejects maxPagesToRead over 20', () => {
    expect(() => validateIntInRange(21, 'maxPagesToRead', 1, 20)).toThrow(McpInputError);
  });

  it('accepts maxPagesToRead at 20', () => {
    expect(validateIntInRange(20, 'maxPagesToRead', 1, 20)).toBe(20);
  });

  it('rejects empty string', () => {
    expect(() => validateIntInRange('', 'field', 0, 100)).toThrow(McpInputError);
  });

  it('rejects hex literal string "0x10"', () => {
    expect(() => validateIntInRange('0x10', 'field', 0, 100)).toThrow(McpInputError);
  });
});

// ── validateBoolean ───────────────────────────────────────────────────────────

describe('validateBoolean', () => {
  it('accepts true', () => {
    expect(validateBoolean(true, 'flag')).toBe(true);
  });

  it('accepts false', () => {
    expect(validateBoolean(false, 'flag')).toBe(false);
  });

  it('accepts "true" string', () => {
    expect(validateBoolean('true', 'flag')).toBe(true);
  });

  it('accepts "false" string', () => {
    expect(validateBoolean('false', 'flag')).toBe(false);
  });

  it('accepts 1', () => {
    expect(validateBoolean(1, 'flag')).toBe(true);
  });

  it('accepts 0', () => {
    expect(validateBoolean(0, 'flag')).toBe(false);
  });

  it('rejects a random string', () => {
    expect(() => validateBoolean('yes', 'flag')).toThrow(McpInputError);
  });

  it('rejects null', () => {
    expect(() => validateBoolean(null, 'flag')).toThrow(McpInputError);
  });

  it('rejects undefined', () => {
    expect(() => validateBoolean(undefined, 'flag')).toThrow(McpInputError);
  });

  it('rejects 2', () => {
    expect(() => validateBoolean(2, 'flag')).toThrow(McpInputError);
  });
});
