import { describe, it, expect } from 'vitest';
import {
  extractRateLimitState,
  formatRateLimitWarning,
} from '../../src/api/rateLimitHandler.js';

describe('extractRateLimitState', () => {
  it('reads X-RateLimit-Remaining header', () => {
    const headers = new Headers({ 'x-ratelimit-remaining': '42' });
    const state = extractRateLimitState(headers);
    expect(state.remainingRequests).toBe(42);
  });

  it('reads X-RateLimit-Remaining from plain object headers (case-insensitive)', () => {
    const headers: Record<string, string | undefined> = {
      'X-RateLimit-Remaining': '10',
    };
    const state = extractRateLimitState(headers);
    expect(state.remainingRequests).toBe(10);
  });

  it('reads Retry-After header and populates retryAfterMs', () => {
    const headers = new Headers({ 'retry-after': '60' });
    const state = extractRateLimitState(headers);
    expect(state.retryAfterMs).toBe(60000);
  });

  it('reads X-RateLimit-Reset header and converts to Unix ms', () => {
    const resetUnixSeconds = Math.floor(Date.now() / 1000) + 300;
    const headers = new Headers({ 'x-ratelimit-reset': String(resetUnixSeconds) });
    const state = extractRateLimitState(headers);
    expect(state.resetAt).toBe(resetUnixSeconds * 1000);
  });

  it('marks isLimited=true when remainingRequests is 0', () => {
    const headers = new Headers({ 'x-ratelimit-remaining': '0' });
    const state = extractRateLimitState(headers);
    expect(state.isLimited).toBe(true);
  });

  it('marks isLimited=true when Retry-After header is present (simulating 429)', () => {
    // When a 429 response includes a Retry-After header, isLimited should be true
    const headers = new Headers({ 'retry-after': '30' });
    const state = extractRateLimitState(headers);
    expect(state.isLimited).toBe(true);
  });

  it('marks isLimited=false when remaining requests are available and no Retry-After', () => {
    const headers = new Headers({ 'x-ratelimit-remaining': '100' });
    const state = extractRateLimitState(headers);
    expect(state.isLimited).toBe(false);
  });

  it('returns null fields when no rate limit headers are present', () => {
    const headers = new Headers({ 'content-type': 'application/json' });
    const state = extractRateLimitState(headers);
    expect(state.remainingRequests).toBeNull();
    expect(state.resetAt).toBeNull();
    expect(state.retryAfterMs).toBeNull();
    expect(state.isLimited).toBe(false);
  });

  it('handles non-numeric X-RateLimit-Remaining gracefully', () => {
    const headers: Record<string, string | undefined> = {
      'X-RateLimit-Remaining': 'not-a-number',
    };
    const state = extractRateLimitState(headers);
    expect(state.remainingRequests).toBeNull();
  });

  it('works with all headers present', () => {
    const resetUnixSeconds = Math.floor(Date.now() / 1000) + 60;
    const headers = new Headers({
      'x-ratelimit-remaining': '5',
      'x-ratelimit-reset': String(resetUnixSeconds),
      'retry-after': '30',
    });
    const state = extractRateLimitState(headers);
    expect(state.remainingRequests).toBe(5);
    expect(state.resetAt).toBe(resetUnixSeconds * 1000);
    expect(state.retryAfterMs).toBe(30000);
    // isLimited because retry-after is set
    expect(state.isLimited).toBe(true);
  });
});

describe('formatRateLimitWarning', () => {
  it('returns a string mentioning the provider name', () => {
    const state = {
      remainingRequests: 0,
      resetAt: null,
      retryAfterMs: null,
      isLimited: true,
    };
    const warning = formatRateLimitWarning('jira', state);
    expect(warning).toContain('jira');
  });

  it('mentions remaining requests when available', () => {
    const state = {
      remainingRequests: 5,
      resetAt: null,
      retryAfterMs: null,
      isLimited: false,
    };
    const warning = formatRateLimitWarning('confluence', state);
    expect(warning).toContain('5');
    expect(warning).toContain('confluence');
  });

  it('mentions retry-after seconds when retryAfterMs is set', () => {
    const state = {
      remainingRequests: null,
      resetAt: null,
      retryAfterMs: 30000,
      isLimited: true,
    };
    const warning = formatRateLimitWarning('github', state);
    expect(warning).toContain('30');
    expect(warning).toContain('github');
  });

  it('mentions reset time when resetAt is set', () => {
    const resetAt = new Date('2026-05-22T12:00:00.000Z').getTime();
    const state = {
      remainingRequests: null,
      resetAt,
      retryAfterMs: null,
      isLimited: false,
    };
    const warning = formatRateLimitWarning('jira', state);
    expect(warning).toContain('2026-05-22');
  });

  it('mentions rate limited status when isLimited is true', () => {
    const state = {
      remainingRequests: 0,
      resetAt: null,
      retryAfterMs: null,
      isLimited: true,
    };
    const warning = formatRateLimitWarning('jira', state);
    expect(warning.toLowerCase()).toContain('rate limit');
  });

  it('returns a non-empty string even with all-null state', () => {
    const state = {
      remainingRequests: null,
      resetAt: null,
      retryAfterMs: null,
      isLimited: false,
    };
    const warning = formatRateLimitWarning('test-provider', state);
    expect(warning.length).toBeGreaterThan(0);
    expect(warning).toContain('test-provider');
  });
});
