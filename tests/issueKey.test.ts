import { describe, it, expect } from 'vitest';
import { isValidIssueKey, validateIssueKey, ISSUE_KEY_REGEX } from '../src/utils/issueKey.js';

describe('isValidIssueKey', () => {
  it('accepts valid CMPI keys with exactly 4 digits', () => {
    expect(isValidIssueKey('CMPI-1234')).toBe(true);
    expect(isValidIssueKey('CMPI-0001')).toBe(true);
    expect(isValidIssueKey('CMPI-9999')).toBe(true);
    expect(isValidIssueKey('CMPI-0000')).toBe(true);
  });

  it('rejects keys with wrong digit count', () => {
    expect(isValidIssueKey('CMPI-123')).toBe(false);   // 3 digits
    expect(isValidIssueKey('CMPI-12345')).toBe(false);  // 5 digits
    expect(isValidIssueKey('CMPI-1')).toBe(false);      // 1 digit
    expect(isValidIssueKey('CMPI-')).toBe(false);       // 0 digits
  });

  it('rejects lowercase keys', () => {
    expect(isValidIssueKey('cmpi-1234')).toBe(false);
    expect(isValidIssueKey('Cmpi-1234')).toBe(false);
    expect(isValidIssueKey('CMPI-1234'.toLowerCase())).toBe(false);
  });

  it('rejects keys with missing dash', () => {
    expect(isValidIssueKey('CMPI1234')).toBe(false);
  });

  it('rejects keys with wrong project prefix', () => {
    expect(isValidIssueKey('ABC-1234')).toBe(false);
    expect(isValidIssueKey('JIRA-1234')).toBe(false);
    expect(isValidIssueKey('CMP-1234')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidIssueKey('')).toBe(false);
  });

  it('rejects keys with leading or trailing whitespace', () => {
    expect(isValidIssueKey(' CMPI-1234')).toBe(false);
    expect(isValidIssueKey('CMPI-1234 ')).toBe(false);
    expect(isValidIssueKey(' CMPI-1234 ')).toBe(false);
  });

  it('rejects keys with non-digit characters in number part', () => {
    expect(isValidIssueKey('CMPI-12X4')).toBe(false);
    expect(isValidIssueKey('CMPI-123a')).toBe(false);
  });
});

describe('validateIssueKey', () => {
  it('does not throw for valid keys', () => {
    expect(() => validateIssueKey('CMPI-1234')).not.toThrow();
    expect(() => validateIssueKey('CMPI-0001')).not.toThrow();
    expect(() => validateIssueKey('CMPI-9999')).not.toThrow();
  });

  it('throws an error for invalid keys', () => {
    expect(() => validateIssueKey('CMPI-123')).toThrow();
    expect(() => validateIssueKey('ABC-1234')).toThrow();
    expect(() => validateIssueKey('')).toThrow();
  });

  it('throws with "Invalid issue key" in the message', () => {
    expect(() => validateIssueKey('CMPI-123')).toThrow('Invalid issue key');
    expect(() => validateIssueKey('ABC-1234')).toThrow('Invalid issue key');
    expect(() => validateIssueKey('')).toThrow('Invalid issue key');
  });

  it('includes an example key (CMPI-1234) in the error message', () => {
    expect(() => validateIssueKey('CMPI-123')).toThrow('CMPI-1234');
  });

  it('throws an Error instance', () => {
    expect(() => validateIssueKey('bad')).toThrowError(Error);
  });
});

describe('ISSUE_KEY_REGEX', () => {
  it('is the expected regex', () => {
    expect(ISSUE_KEY_REGEX.source).toBe('^CMPI-\\d{4}$');
  });

  it('is a RegExp instance', () => {
    expect(ISSUE_KEY_REGEX).toBeInstanceOf(RegExp);
  });

  it('matches valid keys', () => {
    expect(ISSUE_KEY_REGEX.test('CMPI-1234')).toBe(true);
  });

  it('does not match invalid keys', () => {
    expect(ISSUE_KEY_REGEX.test('CMPI-123')).toBe(false);
    expect(ISSUE_KEY_REGEX.test('ABC-1234')).toBe(false);
  });
});
