type Resolver = () => void;

export class ConcurrencyLimiter {
  private readonly maxConcurrent: number;
  private _running: number = 0;
  private _queue: Resolver[] = [];

  constructor(maxConcurrent: number) {
    if (maxConcurrent < 1) {
      throw new RangeError('maxConcurrent must be at least 1');
    }
    this.maxConcurrent = maxConcurrent;
  }

  // Run fn respecting the concurrency limit.
  // If at capacity, queues the call until a slot is free.
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this._acquire();
    try {
      return await fn();
    } finally {
      this._release();
    }
  }

  private _acquire(): Promise<void> {
    if (this._running < this.maxConcurrent) {
      this._running++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this._queue.push(resolve);
    });
  }

  private _release(): void {
    const next = this._queue.shift();
    if (next !== undefined) {
      // Keep _running the same since we're handing slot to next waiter
      next();
    } else {
      this._running--;
    }
  }

  // Current number of running tasks
  get running(): number {
    return this._running;
  }

  // Current number of queued (waiting) tasks
  get queued(): number {
    return this._queue.length;
  }
}

// Factory: read limit from env var, fall back to defaultLimit
export function createLimiter(envVar: string, defaultLimit: number): ConcurrencyLimiter {
  const raw = process.env[envVar];
  const parsed = raw !== undefined ? parseInt(raw, 10) : NaN;
  const limit = Number.isFinite(parsed) && parsed >= 1 ? parsed : defaultLimit;
  return new ConcurrencyLimiter(limit);
}

// Pre-built limiters using env vars:
// MCP_MAX_CONCURRENT_JIRA_REQUESTS (default 3)
// MCP_MAX_CONCURRENT_CONFLUENCE_REQUESTS (default 3)
// MCP_MAX_CONCURRENT_GITHUB_REQUESTS (default 2)
export const jiraLimiter: ConcurrencyLimiter = createLimiter(
  'MCP_MAX_CONCURRENT_JIRA_REQUESTS',
  3,
);
export const confluenceLimiter: ConcurrencyLimiter = createLimiter(
  'MCP_MAX_CONCURRENT_CONFLUENCE_REQUESTS',
  3,
);
export const githubLimiter: ConcurrencyLimiter = createLimiter(
  'MCP_MAX_CONCURRENT_GITHUB_REQUESTS',
  2,
);

// Run multiple tasks through a limiter, collecting all results.
// If one task fails, others continue; errors are collected alongside results.
export async function runWithLimiter<T>(
  limiter: ConcurrencyLimiter,
  tasks: Array<() => Promise<T>>,
): Promise<Array<{ ok: true; value: T } | { ok: false; error: string }>> {
  const promises = tasks.map(async (task) => {
    try {
      const value = await limiter.run(task);
      return { ok: true as const, value };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { ok: false as const, error };
    }
  });
  return Promise.all(promises);
}
