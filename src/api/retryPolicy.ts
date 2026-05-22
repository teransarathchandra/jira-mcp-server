export interface RetryPolicyOptions {
  maxRetries?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  jitter?: boolean;
  retryableMethods?: string[];
  retryableStatuses?: number[];
}

// Statuses that should NEVER be retried regardless of options
const NON_RETRYABLE_STATUSES = new Set([401, 403, 404]);

// Default retryable statuses
const DEFAULT_RETRYABLE_STATUSES = [429, 500, 502, 503, 504];

// Default retryable methods
const DEFAULT_RETRYABLE_METHODS = ['GET', 'HEAD'];

function readEnvInt(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? undefined : parsed;
}

function resolveOptions(options?: RetryPolicyOptions): Required<RetryPolicyOptions> {
  return {
    maxRetries: options?.maxRetries ?? readEnvInt('MCP_HTTP_MAX_RETRIES') ?? 3,
    initialBackoffMs: options?.initialBackoffMs ?? readEnvInt('MCP_HTTP_INITIAL_BACKOFF_MS') ?? 500,
    maxBackoffMs: options?.maxBackoffMs ?? readEnvInt('MCP_HTTP_MAX_BACKOFF_MS') ?? 10000,
    jitter: options?.jitter ?? true,
    retryableMethods: options?.retryableMethods ?? DEFAULT_RETRYABLE_METHODS,
    retryableStatuses: options?.retryableStatuses ?? DEFAULT_RETRYABLE_STATUSES,
  };
}

/**
 * Compute delay for attempt N (0-indexed). Returns ms to wait.
 * Uses exponential backoff: initialBackoffMs * 2^attempt
 * With jitter: multiply by a random factor in [0.5, 1.0]
 * Capped at maxBackoffMs.
 */
export function computeBackoff(attempt: number, options?: RetryPolicyOptions): number {
  const resolved = resolveOptions(options);
  const base = resolved.initialBackoffMs * Math.pow(2, attempt);
  const capped = Math.min(base, resolved.maxBackoffMs);

  if (resolved.jitter) {
    // Random factor in [0.5, 1.0]
    const jitterFactor = 0.5 + Math.random() * 0.5;
    return Math.round(capped * jitterFactor);
  }

  return capped;
}

/**
 * Returns true if this HTTP method should be retried.
 */
export function isRetryableMethod(method: string, options?: RetryPolicyOptions): boolean {
  const resolved = resolveOptions(options);
  return resolved.retryableMethods.includes(method.toUpperCase());
}

/**
 * Returns true if this status code should trigger a retry.
 * Non-retryable statuses (401, 403, 404) always return false regardless of options.
 */
export function isRetryableStatus(status: number, options?: RetryPolicyOptions): boolean {
  if (NON_RETRYABLE_STATUSES.has(status)) return false;
  const resolved = resolveOptions(options);
  return resolved.retryableStatuses.includes(status);
}

/**
 * Parse Retry-After header. Returns ms to wait, or null if not present/invalid.
 * Accepts both integer seconds and HTTP-date formats.
 */
export function parseRetryAfter(headers: Headers | Record<string, string | undefined>): number | null {
  let value: string | undefined | null;

  if (headers instanceof Headers) {
    value = headers.get('retry-after') ?? headers.get('Retry-After');
  } else {
    // Case-insensitive lookup for plain objects
    const key = Object.keys(headers).find(
      (k) => k.toLowerCase() === 'retry-after',
    );
    value = key !== undefined ? headers[key] : undefined;
  }

  if (value === undefined || value === null || value === '') return null;

  // Try integer seconds first
  const asInt = parseInt(value, 10);
  if (!isNaN(asInt) && String(asInt) === value.trim()) {
    return asInt * 1000;
  }

  // Try HTTP-date format
  const asDate = new Date(value);
  if (!isNaN(asDate.getTime())) {
    const msUntilReset = asDate.getTime() - Date.now();
    return msUntilReset > 0 ? msUntilReset : 0;
  }

  return null;
}
