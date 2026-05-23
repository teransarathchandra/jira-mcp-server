import { logger } from '../logging/logger.js';
import { redactString } from '../security/secretRedactor.js';
import {
  type RetryPolicyOptions,
  computeBackoff,
  isRetryableStatus,
  parseRetryAfter,
} from './retryPolicy.js';
import { extractRateLimitState, formatRateLimitWarning } from './rateLimitHandler.js';

export interface HttpClientOptions {
  timeoutMs?: number;
  maxRetries?: number;
  retryPolicy?: RetryPolicyOptions;
  provider?: string;
}

export interface HttpResponse {
  status: number;
  headers: Headers;
  json<T>(): Promise<T>;
  text(): Promise<string>;
}

function resolveTimeout(options?: HttpClientOptions): number {
  if (options?.timeoutMs !== undefined) return options.timeoutMs;
  const envVal = process.env['MCP_HTTP_TIMEOUT_MS'];
  if (envVal !== undefined && envVal !== '') {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed)) return parsed;
  }
  return 15000;
}

function resolveMaxRetries(options?: HttpClientOptions): number {
  if (options?.maxRetries !== undefined) return options.maxRetries;
  if (options?.retryPolicy?.maxRetries !== undefined) return options.retryPolicy.maxRetries;
  const envVal = process.env['MCP_HTTP_MAX_RETRIES'];
  if (envVal !== undefined && envVal !== '') {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed)) return parsed;
  }
  return 3;
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = redactString(v);
  }
  return out;
}

async function httpRequest(
  method: 'GET' | 'POST',
  url: string,
  headers: Record<string, string>,
  body: unknown | undefined,
  options?: HttpClientOptions,
): Promise<HttpResponse> {
  const timeoutMs = resolveTimeout(options);
  const maxRetries = resolveMaxRetries(options);
  const provider = options?.provider ?? 'unknown';
  const retryPolicyOptions = options?.retryPolicy;

  const redactedUrl = redactString(url);
  const redactedHeaders = redactHeaders(headers);

  let attempt = 0;

  while (true) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(
          `[${provider}] Request timed out after ${timeoutMs}ms (attempt ${attempt + 1}): ${redactedUrl}`,
        );
      }

      const rawMessage = err instanceof Error ? err.message : String(err);
      const safeMessage = redactString(rawMessage);
      throw new Error(
        `[${provider}] Network error on attempt ${attempt + 1}: ${safeMessage}. URL: ${redactedUrl}`,
      );
    }

    const status = response.status;

    // Non-retryable errors: throw immediately
    if (status === 401 || status === 403 || status === 404) {
      throw new Error(
        `[${provider}] HTTP ${status} — not retrying. URL: ${redactedUrl}. Headers: ${JSON.stringify(redactedHeaders)}`,
      );
    }

    // Success
    if (status >= 200 && status < 300) {
      return {
        status,
        headers: response.headers,
        json: <T>() => response.json() as Promise<T>,
        text: () => response.text(),
      };
    }

    // Rate limit (429) or 5xx — check if we should retry
    if (isRetryableStatus(status, retryPolicyOptions)) {
      // Extract and log rate limit info
      const rateLimitState = extractRateLimitState(response.headers);
      if (rateLimitState.isLimited || status === 429) {
        const warning = formatRateLimitWarning(provider, rateLimitState);
        logger.warn(warning, { url: redactedUrl, attempt: attempt + 1, status });
      }

      if (attempt < maxRetries) {
        // Determine wait time: prefer Retry-After header, fall back to backoff
        let waitMs: number;
        if (status === 429) {
          const retryAfterMs = parseRetryAfter(response.headers);
          waitMs = retryAfterMs !== null ? retryAfterMs : computeBackoff(attempt, retryPolicyOptions);
        } else {
          waitMs = computeBackoff(attempt, retryPolicyOptions);
        }

        logger.info(`[${provider}] Retrying after ${waitMs}ms (attempt ${attempt + 1}/${maxRetries}, status ${status})`, {
          url: redactedUrl,
        });

        await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
        attempt++;
        continue;
      }
    }

    // All retries exhausted or non-retryable non-success status
    throw new Error(
      `[${provider}] HTTP ${status} after ${attempt + 1} attempt(s). URL: ${redactedUrl}`,
    );
  }
}

/**
 * GET request with timeout + retry + rate-limit handling.
 */
export function httpGet(
  url: string,
  headers: Record<string, string>,
  options?: HttpClientOptions,
): Promise<HttpResponse> {
  return httpRequest('GET', url, headers, undefined, options);
}

/**
 * POST request with timeout + retry + rate-limit handling.
 */
export function httpPost(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  options?: HttpClientOptions,
): Promise<HttpResponse> {
  return httpRequest('POST', url, headers, body, options);
}
