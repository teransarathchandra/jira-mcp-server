import { describe, it, expect } from 'vitest';
import {
  escapeJqlString,
  quoteJqlString,
  safeJqlProjectKey,
  safeJqlIssueKey,
  buildProjectJql,
  buildProjectInJql,
} from '../src/utils/jql.js';

describe('escapeJqlString()', () => {
  it('returns plain strings unchanged', () => {
    expect(escapeJqlString('hello world')).toBe('hello world');
  });

  it('escapes backslashes', () => {
    expect(escapeJqlString('back\\slash')).toBe('back\\\\slash');
  });

  it('escapes double-quotes', () => {
    expect(escapeJqlString('say "hi"')).toBe('say \\"hi\\"');
  });

  it('escapes backslash before double-quote (order matters)', () => {
    expect(escapeJqlString('a\\"b')).toBe('a\\\\\\"b');
  });

  it('handles empty string', () => {
    expect(escapeJqlString('')).toBe('');
  });
});

describe('quoteJqlString()', () => {
  it('wraps value in double-quotes', () => {
    expect(quoteJqlString('PROJ-123')).toBe('"PROJ-123"');
  });

  it('escapes internal double-quotes', () => {
    expect(quoteJqlString('say "hi"')).toBe('"say \\"hi\\""');
  });

  it('injection attempt: internal double-quotes are backslash-escaped', () => {
    const malicious = '" OR project = EVIL AND "x" = "';
    const result = quoteJqlString(malicious);
    // All internal double-quotes must be preceded by a backslash
    expect(result).toContain('\\"');
    // The result must start and end with an unescaped double-quote
    expect(result.startsWith('"')).toBe(true);
    expect(result.endsWith('"')).toBe(true);
  });
});

describe('safeJqlProjectKey()', () => {
  it('accepts valid uppercase project key', () => {
    expect(safeJqlProjectKey('PROJ')).toBe('PROJ');
  });

  it('accepts key with digits', () => {
    expect(safeJqlProjectKey('ABC123')).toBe('ABC123');
  });

  it('uppercases lowercase input', () => {
    expect(safeJqlProjectKey('proj')).toBe('PROJ');
  });

  it('throws on key starting with a digit', () => {
    expect(() => safeJqlProjectKey('1ABC')).toThrow('Invalid Jira project key');
  });

  it('throws on key with spaces', () => {
    expect(() => safeJqlProjectKey('MY PROJ')).toThrow('Invalid Jira project key');
  });

  it('throws on key with special characters', () => {
    expect(() => safeJqlProjectKey('PR-OJ')).toThrow('Invalid Jira project key');
  });

  it('throws on injection attempt', () => {
    expect(() => safeJqlProjectKey('" OR 1=1 --')).toThrow('Invalid Jira project key');
  });

  it('throws on empty string', () => {
    expect(() => safeJqlProjectKey('')).toThrow('Invalid Jira project key');
  });
});

describe('safeJqlIssueKey()', () => {
  it('accepts valid issue key', () => {
    expect(safeJqlIssueKey('PROJ-123')).toBe('PROJ-123');
  });

  it('uppercases lowercase input', () => {
    expect(safeJqlIssueKey('proj-123')).toBe('PROJ-123');
  });

  it('throws on key without number suffix', () => {
    expect(() => safeJqlIssueKey('PROJ')).toThrow('Invalid Jira issue key');
  });

  it('throws on key with leading digit', () => {
    expect(() => safeJqlIssueKey('1PROJ-123')).toThrow('Invalid Jira issue key');
  });

  it('throws on injection attempt', () => {
    expect(() => safeJqlIssueKey('" AND 1=1')).toThrow('Invalid Jira issue key');
  });
});

describe('buildProjectJql()', () => {
  it('builds correct JQL clause', () => {
    expect(buildProjectJql('PROJ')).toBe('project = "PROJ"');
  });

  it('throws on invalid project key', () => {
    expect(() => buildProjectJql('bad key!')).toThrow();
  });
});

describe('buildProjectInJql()', () => {
  it('builds correct IN clause for multiple keys', () => {
    expect(buildProjectInJql(['PROJ', 'ABC'])).toBe('project in ("PROJ", "ABC")');
  });

  it('builds correct IN clause for single key', () => {
    expect(buildProjectInJql(['PROJ'])).toBe('project in ("PROJ")');
  });

  it('throws on any invalid key in the list', () => {
    expect(() => buildProjectInJql(['PROJ', 'bad key!'])).toThrow();
  });
});
