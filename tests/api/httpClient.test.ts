import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import { httpGet } from '../../src/api/httpClient.js';

// Helper to build a mock Response
function mockResponse(
  status: number,
  body: unknown = {},
  headersInit: Record<string, string> = {},
): Response {
  const headers = new Headers(headersInit);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

describe('httpGet', () => {
  let mockFetch: Mock;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    // Suppress logger output during tests
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns response on 200', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, { id: 'CMPI-1' }));

    const res = await httpGet('https://jira.example.com/rest/api/3/issue/CMPI-1', {
      Authorization: 'Basic dXNlcjpwYXNz',
    });

    expect(res.status).toBe(200);
    const data = await res.json<{ id: string }>();
    expect(data.id).toBe('CMPI-1');
  });

  it('throws immediately on 401 without retrying', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(401));

    await expect(
      httpGet('https://jira.example.com/rest/api/3/issue/CMPI-1', {}, { maxRetries: 3 }),
    ).rejects.toThrow(/401/);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws immediately on 403 without retrying', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(403));

    await expect(
      httpGet('https://jira.example.com/rest/api/3/issue/CMPI-1', {}, { maxRetries: 3 }),
    ).rejects.toThrow(/403/);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws immediately on 404 without retrying', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(404));

    await expect(
      httpGet('https://jira.example.com/rest/api/3/issue/CMPI-1', {}, { maxRetries: 3 }),
    ).rejects.toThrow(/404/);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 503 and succeeds on second attempt', async () => {
    vi.useFakeTimers();

    mockFetch
      .mockResolvedValueOnce(mockResponse(503))
      .mockResolvedValueOnce(mockResponse(200, { ok: true }));

    const promise = httpGet(
      'https://jira.example.com/api',
      {},
      {
        maxRetries: 3,
        retryPolicy: { jitter: false, initialBackoffMs: 100 },
      },
    );

    // Advance timers to trigger the retry delay
    await vi.runAllTimersAsync();

    const res = await promise;
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries on 429 with Retry-After header', async () => {
    vi.useFakeTimers();

    mockFetch
      .mockResolvedValueOnce(mockResponse(429, {}, { 'retry-after': '2' }))
      .mockResolvedValueOnce(mockResponse(200, { ok: true }));

    const promise = httpGet(
      'https://jira.example.com/api',
      {},
      {
        maxRetries: 3,
        retryPolicy: { jitter: false, initialBackoffMs: 100 },
        provider: 'jira',
      },
    );

    await vi.runAllTimersAsync();

    const res = await promise;
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws after max retries exhausted and includes attempt count in message', async () => {
    vi.useFakeTimers();

    // Always return 503
    mockFetch.mockResolvedValue(mockResponse(503));

    const promise = httpGet(
      'https://jira.example.com/api',
      {},
      {
        maxRetries: 2,
        retryPolicy: { jitter: false, initialBackoffMs: 10 },
      },
    );

    // Run timers and settle together to avoid unhandled rejection
    const [result] = await Promise.allSettled([
      promise,
      vi.runAllTimersAsync(),
    ]);

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(String(result.reason)).toMatch(/attempt/i);
    }
    // Should have tried 1 initial + 2 retries = 3 total calls
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('throws with timeout message when request times out', async () => {
    vi.useFakeTimers();

    // Never resolves — simulates a hanging request
    mockFetch.mockImplementation((_url: string, opts: RequestInit) => {
      return new Promise((_resolve, reject) => {
        // Listen for abort signal
        const signal = opts.signal as AbortSignal;
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted.');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    });

    const promise = httpGet(
      'https://jira.example.com/api',
      {},
      { timeoutMs: 5000, maxRetries: 0 },
    );

    // Advance time past the timeout and settle together to avoid unhandled rejection
    const [result] = await Promise.allSettled([
      promise,
      vi.advanceTimersByTimeAsync(6000),
    ]);

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(String(result.reason)).toMatch(/timed out/i);
    }
  });

  it('redacts secrets from error messages on auth failure', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(401));

    let errorMessage = '';
    try {
      await httpGet(
        'https://jira.example.com/api',
        { Authorization: 'Basic dXNlcjpzZWNyZXRwYXNzd29yZA==' },
        { maxRetries: 0 },
      );
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    // The raw base64 credential should be redacted in the error message
    expect(errorMessage).not.toContain('dXNlcjpzZWNyZXRwYXNzd29yZA==');
    expect(errorMessage).toContain('[REDACTED]');
  });

  it('redacts secrets from network error messages', async () => {
    mockFetch.mockRejectedValueOnce(
      new Error('Network error with Authorization: Bearer supersecrettoken123'),
    );

    let errorMessage = '';
    try {
      await httpGet('https://jira.example.com/api', {}, { maxRetries: 0 });
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    expect(errorMessage).not.toContain('supersecrettoken123');
  });

  it('does not retry on non-retryable 400 status', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(400));

    await expect(
      httpGet('https://jira.example.com/api', {}, { maxRetries: 3 }),
    ).rejects.toThrow(/400/);

    // 400 is not in retryable list, so only 1 call
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns text() from response', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, 'plain text'));

    const res = await httpGet('https://jira.example.com/api', {});
    const text = await res.text();
    expect(text).toBe('"plain text"');
  });

  it('uses provider name in error messages', async () => {
    mockFetch.mockResolvedValue(mockResponse(503));

    await expect(
      httpGet('https://jira.example.com/api', {}, { provider: 'jira', maxRetries: 0 }),
    ).rejects.toThrow(/jira/i);
  });

  it('reads timeout from MCP_HTTP_TIMEOUT_MS env var', async () => {
    vi.useFakeTimers();
    process.env['MCP_HTTP_TIMEOUT_MS'] = '1000';

    mockFetch.mockImplementation((_url: string, opts: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = opts.signal as AbortSignal;
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted.');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    });

    const promise = httpGet('https://jira.example.com/api', {}, { maxRetries: 0 });

    // Advance time and settle together to avoid unhandled rejection
    const [result] = await Promise.allSettled([
      promise,
      vi.advanceTimersByTimeAsync(2000),
    ]);

    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(String(result.reason)).toMatch(/timed out/i);
    }
  });
});
