import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ISSUE_KEY_PATTERN,
  ISSUE_KEY_REGEX,
  normalizeIssueKey,
  parseIssueKey,
  isValidIssueKey,
  validateIssueKeyOrThrow,
  isAllowedProjectKey,
  validateIssueKey,
} from '../src/utils/issueKey.js';
import type { JiraProjectConfig } from '../src/config.js';

function makeConfig(overrides: Partial<JiraProjectConfig> = {}): JiraProjectConfig {
  return {
    allowedProjectKeys: [],
    issueKeyPattern: DEFAULT_ISSUE_KEY_PATTERN,
    strictProjectAllowlist: false,
    exampleIssueKey: 'PROJ-123',
    ...overrides,
  };
}

describe('DEFAULT_ISSUE_KEY_PATTERN', () => {
  it('matches CMPI-1234', () => {
    expect(DEFAULT_ISSUE_KEY_PATTERN.test('CMPI-1234')).toBe(true);
  });

  it('matches ABC-1', () => {
    expect(DEFAULT_ISSUE_KEY_PATTERN.test('ABC-1')).toBe(true);
  });

  it('matches ENG-98765', () => {
    expect(DEFAULT_ISSUE_KEY_PATTERN.test('ENG-98765')).toBe(true);
  });

  it('matches DATA-202', () => {
    expect(DEFAULT_ISSUE_KEY_PATTERN.test('DATA-202')).toBe(true);
  });

  it('matches OPS2-44', () => {
    expect(DEFAULT_ISSUE_KEY_PATTERN.test('OPS2-44')).toBe(true);
  });

  it('rejects CMPI1234 (no dash)', () => {
    expect(DEFAULT_ISSUE_KEY_PATTERN.test('CMPI1234')).toBe(false);
  });

  it('rejects CMPI_1234 (underscore not dash)', () => {
    expect(DEFAULT_ISSUE_KEY_PATTERN.test('CMPI_1234')).toBe(false);
  });

  it('rejects 123-CMPI (starts with digit)', () => {
    expect(DEFAULT_ISSUE_KEY_PATTERN.test('123-CMPI')).toBe(false);
  });

  it('rejects CMPI- (empty issue number)', () => {
    expect(DEFAULT_ISSUE_KEY_PATTERN.test('CMPI-')).toBe(false);
  });

  it('rejects CMPI-ABC (non-numeric issue number)', () => {
    expect(DEFAULT_ISSUE_KEY_PATTERN.test('CMPI-ABC')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(DEFAULT_ISSUE_KEY_PATTERN.test('')).toBe(false);
  });
});

describe('normalizeIssueKey', () => {
  it('trims whitespace', () => {
    expect(normalizeIssueKey('  CMPI-1234  ')).toBe('CMPI-1234');
  });

  it('converts to uppercase', () => {
    expect(normalizeIssueKey('cmpi-1234')).toBe('CMPI-1234');
  });

  it('trims and uppercases together', () => {
    expect(normalizeIssueKey(' cmpi-1234 ')).toBe('CMPI-1234');
  });

  it('returns already-normalized key unchanged', () => {
    expect(normalizeIssueKey('CMPI-1234')).toBe('CMPI-1234');
  });
});

describe('parseIssueKey', () => {
  it('parses CMPI-1234 into { projectKey: \'CMPI\', issueNumber: \'1234\' }', () => {
    expect(parseIssueKey('CMPI-1234')).toEqual({ projectKey: 'CMPI', issueNumber: '1234' });
  });

  it('parses ABC-1 into { projectKey: \'ABC\', issueNumber: \'1\' }', () => {
    expect(parseIssueKey('ABC-1')).toEqual({ projectKey: 'ABC', issueNumber: '1' });
  });

  it('parses ENG-98765 into { projectKey: \'ENG\', issueNumber: \'98765\' }', () => {
    expect(parseIssueKey('ENG-98765')).toEqual({ projectKey: 'ENG', issueNumber: '98765' });
  });

  it('normalizes before parsing (cmpi-1234 -> CMPI / 1234)', () => {
    expect(parseIssueKey('cmpi-1234')).toEqual({ projectKey: 'CMPI', issueNumber: '1234' });
  });

  it('throws \'Invalid issue key format\' when no dash present', () => {
    expect(() => parseIssueKey('CMPI1234')).toThrow('Invalid issue key format');
  });

  it('throws \'Invalid issue key format\' when projectKey part is empty', () => {
    expect(() => parseIssueKey('-1234')).toThrow('Invalid issue key format');
  });

  it('throws \'Invalid issue key format\' when issueNumber part is empty', () => {
    expect(() => parseIssueKey('CMPI-')).toThrow('Invalid issue key format');
  });
});

describe('isValidIssueKey', () => {
  describe('without config', () => {
    it('CMPI-1234 is valid', () => {
      expect(isValidIssueKey('CMPI-1234')).toBe(true);
    });

    it('ABC-1 is valid', () => {
      expect(isValidIssueKey('ABC-1')).toBe(true);
    });

    it('ENG-98765 is valid', () => {
      expect(isValidIssueKey('ENG-98765')).toBe(true);
    });

    it('DATA-202 is valid', () => {
      expect(isValidIssueKey('DATA-202')).toBe(true);
    });

    it('OPS2-44 is valid', () => {
      expect(isValidIssueKey('OPS2-44')).toBe(true);
    });

    it('cmpi-1234 normalizes to valid', () => {
      expect(isValidIssueKey('cmpi-1234')).toBe(true);
    });

    it('CMPI1234 is invalid', () => {
      expect(isValidIssueKey('CMPI1234')).toBe(false);
    });

    it('CMPI_1234 is invalid', () => {
      expect(isValidIssueKey('CMPI_1234')).toBe(false);
    });

    it('123-CMPI is invalid', () => {
      expect(isValidIssueKey('123-CMPI')).toBe(false);
    });

    it('CMPI- is invalid', () => {
      expect(isValidIssueKey('CMPI-')).toBe(false);
    });

    it('CMPI-ABC is invalid', () => {
      expect(isValidIssueKey('CMPI-ABC')).toBe(false);
    });

    it('empty string is invalid', () => {
      expect(isValidIssueKey('')).toBe(false);
    });
  });

  describe('with custom pattern in config (4 digits only)', () => {
    const config = makeConfig({ issueKeyPattern: /^[A-Z][A-Z0-9]+-\d{4}$/ });

    it('CMPI-1234 is valid', () => {
      expect(isValidIssueKey('CMPI-1234', config)).toBe(true);
    });

    it('CMPI-123 is invalid', () => {
      expect(isValidIssueKey('CMPI-123', config)).toBe(false);
    });

    it('CMPI-12345 is invalid', () => {
      expect(isValidIssueKey('CMPI-12345', config)).toBe(false);
    });

    it('ABC-1234 is valid (pattern doesn\'t restrict project key)', () => {
      expect(isValidIssueKey('ABC-1234', config)).toBe(true);
    });
  });
});

describe('validateIssueKeyOrThrow', () => {
  it('returns normalized key for valid input', () => {
    expect(validateIssueKeyOrThrow('CMPI-1234')).toBe('CMPI-1234');
  });

  it('normalizes before returning', () => {
    expect(validateIssueKeyOrThrow('cmpi-1234')).toBe('CMPI-1234');
  });

  it('throws for invalid pattern with message containing \'Invalid issue key\'', () => {
    expect(() => validateIssueKeyOrThrow('CMPI1234')).toThrow('Invalid issue key');
  });

  it('throws error message containing the example key from config', () => {
    const config = makeConfig({ exampleIssueKey: 'MYPROJ-9999' });
    expect(() => validateIssueKeyOrThrow('bad-key', config)).toThrow('MYPROJ-9999');
  });

  describe('allowlist enforcement', () => {
    const config = makeConfig({
      allowedProjectKeys: ['CMPI', 'ENG'],
      strictProjectAllowlist: true,
    });

    it('allows CMPI-1234', () => {
      expect(validateIssueKeyOrThrow('CMPI-1234', config)).toBe('CMPI-1234');
    });

    it('allows ENG-456', () => {
      expect(validateIssueKeyOrThrow('ENG-456', config)).toBe('ENG-456');
    });

    it('throws for DATA-100 with message \'not in the allowed list\'', () => {
      expect(() => validateIssueKeyOrThrow('DATA-100', config)).toThrow('not in the allowed list');
    });

    it('throws error message listing allowed keys', () => {
      expect(() => validateIssueKeyOrThrow('DATA-100', config)).toThrow('CMPI');
    });
  });

  describe('non-strict mode', () => {
    const config = makeConfig({
      allowedProjectKeys: ['CMPI'],
      strictProjectAllowlist: false,
    });

    it('allows DATA-100 (not in allowlist but non-strict)', () => {
      expect(validateIssueKeyOrThrow('DATA-100', config)).toBe('DATA-100');
    });
  });

  describe('empty allowlist with strict mode', () => {
    const config = makeConfig({
      allowedProjectKeys: [],
      strictProjectAllowlist: true,
    });

    it('allows any valid key (empty allowlist + strict = no restriction)', () => {
      expect(validateIssueKeyOrThrow('ANYKEY-999', config)).toBe('ANYKEY-999');
    });
  });
});

describe('isAllowedProjectKey', () => {
  function makeConfigHelper(allowedProjectKeys: string[], strict: boolean): JiraProjectConfig {
    return makeConfig({ allowedProjectKeys, strictProjectAllowlist: strict });
  }

  it('strict mode with matching key returns true', () => {
    expect(isAllowedProjectKey('CMPI', makeConfigHelper(['CMPI', 'ENG'], true))).toBe(true);
  });

  it('strict mode with non-matching key returns false', () => {
    expect(isAllowedProjectKey('DATA', makeConfigHelper(['CMPI', 'ENG'], true))).toBe(false);
  });

  it('non-strict mode with any key returns true', () => {
    expect(isAllowedProjectKey('DATA', makeConfigHelper(['CMPI'], false))).toBe(true);
  });

  it('non-strict mode with empty allowlist returns true', () => {
    expect(isAllowedProjectKey('ANYTHING', makeConfigHelper([], false))).toBe(true);
  });

  it('normalizes project key before checking (lowercase \'cmpi\' matches \'CMPI\')', () => {
    expect(isAllowedProjectKey('cmpi', makeConfigHelper(['CMPI'], true))).toBe(true);
  });
});

describe('backward compatibility', () => {
  it('ISSUE_KEY_REGEX equals DEFAULT_ISSUE_KEY_PATTERN', () => {
    expect(ISSUE_KEY_REGEX).toBe(DEFAULT_ISSUE_KEY_PATTERN);
  });

  it('ISSUE_KEY_REGEX matches CMPI-1234', () => {
    expect(ISSUE_KEY_REGEX.test('CMPI-1234')).toBe(true);
  });

  it('ISSUE_KEY_REGEX matches ABC-1', () => {
    expect(ISSUE_KEY_REGEX.test('ABC-1')).toBe(true);
  });

  it('validateIssueKey (void function) does not throw for CMPI-1234', () => {
    expect(() => validateIssueKey('CMPI-1234')).not.toThrow();
  });

  it('validateIssueKey does not throw for ENG-98765', () => {
    expect(() => validateIssueKey('ENG-98765')).not.toThrow();
  });

  it('validateIssueKey does not throw for ABC-1', () => {
    expect(() => validateIssueKey('ABC-1')).not.toThrow();
  });

  it('validateIssueKey throws for invalid key \'CMPI1234\'', () => {
    expect(() => validateIssueKey('CMPI1234')).toThrow();
  });

  it('validateIssueKey throws for empty string', () => {
    expect(() => validateIssueKey('')).toThrow();
  });
});
