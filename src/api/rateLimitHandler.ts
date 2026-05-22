import { parseRetryAfter } from './retryPolicy.js';

export interface RateLimitState {
  remainingRequests: number | null;
  resetAt: number | null;
  retryAfterMs: number | null;
  isLimited: boolean;
}

function getHeader(
  headers: Headers | Record<string, string | undefined>,
  name: string,
): string | null {
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key !== undefined ? (headers[key] ?? null) : null;
}

/**
 * Extract rate limit info from response headers.
 * Reads X-RateLimit-Remaining, X-RateLimit-Reset, and Retry-After headers.
 */
export function extractRateLimitState(
  headers: Headers | Record<string, string | undefined>,
): RateLimitState {
  // Parse X-RateLimit-Remaining
  const remainingRaw = getHeader(headers, 'x-ratelimit-remaining');
  let remainingRequests: number | null = null;
  if (remainingRaw !== null) {
    const parsed = parseInt(remainingRaw, 10);
    if (!isNaN(parsed)) {
      remainingRequests = parsed;
    }
  }

  // Parse X-RateLimit-Reset (Unix timestamp in seconds)
  const resetRaw = getHeader(headers, 'x-ratelimit-reset');
  let resetAt: number | null = null;
  if (resetRaw !== null) {
    const parsed = parseInt(resetRaw, 10);
    if (!isNaN(parsed)) {
      // Convert from Unix seconds to Unix ms
      resetAt = parsed * 1000;
    }
  }

  // Parse Retry-After header
  const retryAfterMs = parseRetryAfter(headers);

  // isLimited: true when remaining is 0 or there is a Retry-After header present
  const isLimited =
    (remainingRequests !== null && remainingRequests === 0) ||
    retryAfterMs !== null;

  return { remainingRequests, resetAt, retryAfterMs, isLimited };
}

/**
 * Format a human-readable warning for rate-limit state.
 */
export function formatRateLimitWarning(provider: string, state: RateLimitState): string {
  const parts: string[] = [`[${provider}] Rate limit warning.`];

  if (state.remainingRequests !== null) {
    parts.push(`Remaining requests: ${state.remainingRequests}.`);
  }

  if (state.retryAfterMs !== null) {
    const seconds = Math.ceil(state.retryAfterMs / 1000);
    parts.push(`Retry after: ${seconds}s.`);
  }

  if (state.resetAt !== null) {
    const resetDate = new Date(state.resetAt).toISOString();
    parts.push(`Limit resets at: ${resetDate}.`);
  }

  if (state.isLimited) {
    parts.push('Requests are currently rate limited.');
  }

  return parts.join(' ');
}
