import { describe, it, expect } from 'vitest';
import { redactSecrets, redactUrl, isLikelySecret } from '../../src/security/secretRedactor.js';

describe('redactSecrets — strings', () => {
  it('redacts Authorization: Basic header', () => {
    expect(redactSecrets('Authorization: Basic abc123')).toBe('Authorization: [REDACTED]');
  });

  it('redacts Authorization: Bearer header', () => {
    expect(redactSecrets('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig')).toBe('Authorization: [REDACTED]');
  });

  it('redacts Bearer token standalone', () => {
    expect(redactSecrets('Bearer ghp_xxxxxxxxxxx')).toBe('Bearer [REDACTED]');
  });

  it('redacts Basic token standalone', () => {
    expect(redactSecrets('Basic dXNlcjpwYXNz')).toBe('Basic [REDACTED]');
  });

  it('redacts JIRA_API_TOKEN env var', () => {
    expect(redactSecrets('JIRA_API_TOKEN=my-secret-token')).toBe('JIRA_API_TOKEN=[REDACTED]');
  });

  it('redacts CONFLUENCE_API_TOKEN env var', () => {
    expect(redactSecrets('CONFLUENCE_API_TOKEN=super-secret')).toBe('CONFLUENCE_API_TOKEN=[REDACTED]');
  });

  it('redacts GITHUB_TOKEN env var', () => {
    expect(redactSecrets('GITHUB_TOKEN=ghp_abc123xyz')).toBe('GITHUB_TOKEN=[REDACTED]');
  });

  it('redacts generic *_TOKEN env var pattern', () => {
    expect(redactSecrets('MY_SERVICE_TOKEN=abc123')).toBe('MY_SERVICE_TOKEN=[REDACTED]');
  });

  it('redacts generic *_SECRET env var pattern', () => {
    expect(redactSecrets('OAUTH_SECRET=mysecretvalue')).toBe('OAUTH_SECRET=[REDACTED]');
  });

  it('does NOT redact a Jira issue key', () => {
    expect(redactSecrets('CMPI-1234')).toBe('CMPI-1234');
  });

  it('does NOT redact normal sentences', () => {
    const sentence = 'The quick brown fox jumps over the lazy dog';
    expect(redactSecrets(sentence)).toBe(sentence);
  });

  it('does NOT redact normal URLs without sensitive params', () => {
    const url = 'https://jira.example.com/browse/CMPI-1234';
    expect(redactSecrets(url)).toBe(url);
  });
});

describe('redactSecrets — objects', () => {
  it('redacts values inside a plain object', () => {
    const input = { auth: 'Authorization: Bearer secret-token-here', normal: 'hello' };
    const result = redactSecrets(input) as typeof input;
    expect(result.auth).toBe('Authorization: [REDACTED]');
    expect(result.normal).toBe('hello');
  });

  it('redacts nested object values recursively', () => {
    const input = { headers: { authorization: 'Authorization: Bearer tok' }, id: 'CMPI-1234' };
    const result = redactSecrets(input) as typeof input;
    expect((result.headers as Record<string, string>).authorization).toBe('Authorization: [REDACTED]');
    expect(result.id).toBe('CMPI-1234');
  });

  it('passes through non-object primitives unchanged', () => {
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(true)).toBe(true);
    expect(redactSecrets(null)).toBe(null);
    expect(redactSecrets(undefined)).toBe(undefined);
  });
});

describe('redactSecrets — arrays', () => {
  it('redacts values inside an array', () => {
    const input = ['JIRA_API_TOKEN=secret', 'CMPI-1234', 'normal text'];
    const result = redactSecrets(input) as string[];
    expect(result[0]).toBe('JIRA_API_TOKEN=[REDACTED]');
    expect(result[1]).toBe('CMPI-1234');
    expect(result[2]).toBe('normal text');
  });

  it('handles nested arrays', () => {
    const input = [['Authorization: Bearer tok']];
    const result = redactSecrets(input) as string[][];
    expect(result[0][0]).toBe('Authorization: [REDACTED]');
  });
});

describe('redactSecrets — Error objects', () => {
  it('redacts Error message', () => {
    const err = new Error('Request failed with Authorization: Bearer secret-token');
    const result = redactSecrets(err) as Error;
    expect(result.message).toBe('Request failed with Authorization: [REDACTED]');
  });

  it('returns an Error instance', () => {
    const err = new Error('JIRA_API_TOKEN=tok');
    const result = redactSecrets(err);
    expect(result).toBeInstanceOf(Error);
  });
});

describe('redactUrl', () => {
  it('removes token query param', () => {
    const url = 'https://api.example.com/data?foo=bar&token=mysecret';
    expect(redactUrl(url)).toBe('https://api.example.com/data?foo=bar');
  });

  it('removes api_key query param', () => {
    const url = 'https://api.example.com/data?api_key=abc123&page=1';
    expect(redactUrl(url)).toBe('https://api.example.com/data?page=1');
  });

  it('removes secret query param', () => {
    const url = 'https://api.example.com/data?secret=xyz';
    expect(redactUrl(url)).toBe('https://api.example.com/data');
  });

  it('removes key query param', () => {
    const url = 'https://api.example.com/data?key=abc&q=search';
    expect(redactUrl(url)).toBe('https://api.example.com/data?q=search');
  });

  it('preserves non-sensitive query params', () => {
    const url = 'https://api.example.com/data?page=2&limit=10';
    expect(redactUrl(url)).toBe(url);
  });

  it('returns the original string if not a valid URL', () => {
    const notAUrl = 'not-a-url';
    expect(redactUrl(notAUrl)).toBe(notAUrl);
  });
});

describe('isLikelySecret', () => {
  it('returns true for a long random-looking token', () => {
    expect(isLikelySecret('ghp_ABCDEF123456789abcdefXYZ')).toBe(true);
  });

  it('returns true for a base64-like token of 20+ chars', () => {
    expect(isLikelySecret('dXNlcjpwYXNzd29yZHRva2Vu')).toBe(true);
  });

  it('returns false for a short string', () => {
    expect(isLikelySecret('short')).toBe(false);
  });

  it('returns false for a string with spaces', () => {
    expect(isLikelySecret('this is a normal sentence with words')).toBe(false);
  });

  it('returns false for a Jira issue key', () => {
    expect(isLikelySecret('CMPI-1234')).toBe(false);
  });

  it('returns false for a normal URL path segment', () => {
    expect(isLikelySecret('/rest/api/2/issue')).toBe(false);
  });
});

describe('redactSecrets — circular references', () => {
  it('does not crash on a circular object and returns [Circular] placeholder', () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj['self'] = obj;
    expect(() => redactSecrets(obj)).not.toThrow();
    const result = redactSecrets(obj) as Record<string, unknown>;
    expect(result['self']).toBe('[Circular]');
  });

  it('does not crash on a circular array and returns [Circular] placeholder', () => {
    const arr: unknown[] = [1, 2];
    arr.push(arr);
    expect(() => redactSecrets(arr)).not.toThrow();
    const result = redactSecrets(arr) as unknown[];
    expect(result[2]).toBe('[Circular]');
  });

  it('still redacts non-circular parts of a circular object', () => {
    const obj: Record<string, unknown> = { token: 'JIRA_API_TOKEN=supersecret' };
    obj['self'] = obj;
    const result = redactSecrets(obj) as Record<string, unknown>;
    expect(result['token']).toBe('JIRA_API_TOKEN=[REDACTED]');
  });
});

describe('redactUrl — password query param', () => {
  it('removes password query param', () => {
    const url = 'https://api.example.com/data?user=alice&password=s3cr3t';
    expect(redactUrl(url)).toBe('https://api.example.com/data?user=alice');
  });
});

describe('redactSecrets — URL embedded credentials', () => {
  it('redacts user:password credentials embedded in a URL string', () => {
    const input = 'https://user:mysecretpassword@host.example.com/path';
    const result = redactSecrets(input) as string;
    expect(result).toContain('[REDACTED]@');
    expect(result).not.toContain('mysecretpassword');
  });

  it('redacts credentials in HTTP URLs as well', () => {
    const input = 'http://admin:topsecret@internal.company.com/api';
    const result = redactSecrets(input) as string;
    expect(result).toContain('[REDACTED]@');
    expect(result).not.toContain('topsecret');
  });
});
