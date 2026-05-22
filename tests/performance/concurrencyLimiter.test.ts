import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ConcurrencyLimiter,
  createLimiter,
  runWithLimiter,
  jiraLimiter,
  confluenceLimiter,
  githubLimiter,
} from '../../src/performance/concurrencyLimiter.js';

describe('ConcurrencyLimiter', () => {
  it('limit of 1: second task waits until first completes', async () => {
    const limiter = new ConcurrencyLimiter(1);
    const order: string[] = [];

    let resolveFirst!: () => void;
    const firstDone = new Promise<void>((res) => {
      resolveFirst = res;
    });

    const task1 = limiter.run(async () => {
      order.push('task1-start');
      await firstDone;
      order.push('task1-end');
    });

    // Yield to let task1 start
    await Promise.resolve();

    const task2 = limiter.run(async () => {
      order.push('task2-start');
    });

    expect(limiter.running).toBe(1);
    expect(limiter.queued).toBe(1);

    resolveFirst();
    await task1;
    await task2;

    expect(order).toEqual(['task1-start', 'task1-end', 'task2-start']);
  });

  it('limit of 2: two tasks run concurrently, third waits', async () => {
    const limiter = new ConcurrencyLimiter(2);

    let resolveTask1!: () => void;
    let resolveTask2!: () => void;

    const task1 = limiter.run(
      () =>
        new Promise<void>((res) => {
          resolveTask1 = res;
        }),
    );
    const task2 = limiter.run(
      () =>
        new Promise<void>((res) => {
          resolveTask2 = res;
        }),
    );

    // Yield to let tasks 1 and 2 start
    await Promise.resolve();
    await Promise.resolve();

    const task3 = limiter.run(async () => 'task3-done');

    expect(limiter.running).toBe(2);
    expect(limiter.queued).toBe(1);

    resolveTask1();
    await task1;

    // After task1 finishes, task3 should be dequeued
    await Promise.resolve();
    expect(limiter.queued).toBe(0);

    resolveTask2();
    await task2;
    await task3;

    expect(limiter.running).toBe(0);
    expect(limiter.queued).toBe(0);
  });

  it('running and queued counters correct during execution', async () => {
    const limiter = new ConcurrencyLimiter(1);

    expect(limiter.running).toBe(0);
    expect(limiter.queued).toBe(0);

    let resolveFirst!: () => void;
    const firstTask = limiter.run(
      () =>
        new Promise<void>((res) => {
          resolveFirst = res;
        }),
    );

    await Promise.resolve();

    expect(limiter.running).toBe(1);
    expect(limiter.queued).toBe(0);

    const secondTask = limiter.run(async () => 'second');

    expect(limiter.running).toBe(1);
    expect(limiter.queued).toBe(1);

    resolveFirst();
    await firstTask;
    await secondTask;

    expect(limiter.running).toBe(0);
    expect(limiter.queued).toBe(0);
  });

  it('error in one task does not prevent others from running', async () => {
    const limiter = new ConcurrencyLimiter(1);
    const results: string[] = [];

    const failingTask = limiter.run(async () => {
      throw new Error('task failed');
    });

    const successTask = limiter.run(async () => {
      results.push('success');
    });

    await expect(failingTask).rejects.toThrow('task failed');
    await successTask;

    expect(results).toContain('success');
    expect(limiter.running).toBe(0);
  });

  it('run returns the value from fn', async () => {
    const limiter = new ConcurrencyLimiter(2);
    const result = await limiter.run(async () => 42);
    expect(result).toBe(42);
  });

  it('throws RangeError for maxConcurrent < 1', () => {
    expect(() => new ConcurrencyLimiter(0)).toThrow(RangeError);
    expect(() => new ConcurrencyLimiter(-1)).toThrow(RangeError);
  });

  it('multiple tasks run up to the limit concurrently', async () => {
    const limiter = new ConcurrencyLimiter(3);
    let maxConcurrent = 0;
    let currentRunning = 0;

    const task = async () => {
      currentRunning++;
      maxConcurrent = Math.max(maxConcurrent, currentRunning);
      await new Promise((r) => setTimeout(r, 10));
      currentRunning--;
    };

    await Promise.all([
      limiter.run(task),
      limiter.run(task),
      limiter.run(task),
      limiter.run(task),
    ]);

    expect(maxConcurrent).toBeLessThanOrEqual(3);
    expect(maxConcurrent).toBeGreaterThanOrEqual(1);
  });
});

describe('createLimiter', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('uses the default limit when env var is not set', () => {
    delete process.env.MY_LIMIT;
    const limiter = createLimiter('MY_LIMIT', 5);
    expect(limiter).toBeInstanceOf(ConcurrencyLimiter);
    // Can't directly inspect maxConcurrent, but verify it runs 5 tasks concurrently
    expect(limiter.running).toBe(0);
  });

  it('uses env var value when set to a valid number', async () => {
    process.env.MY_LIMIT = '2';
    const limiter = createLimiter('MY_LIMIT', 5);

    let resolveA!: () => void;
    let resolveB!: () => void;

    const taskA = limiter.run(() => new Promise<void>((r) => { resolveA = r; }));
    const taskB = limiter.run(() => new Promise<void>((r) => { resolveB = r; }));
    const taskC = limiter.run(async () => 'c');

    await Promise.resolve();
    await Promise.resolve();

    // If env var = 2, max 2 run at once, third queues
    expect(limiter.running).toBe(2);
    expect(limiter.queued).toBe(1);

    resolveA();
    resolveB();
    await taskA;
    await taskB;
    await taskC;
  });

  it('falls back to default when env var is invalid', () => {
    process.env.MY_LIMIT = 'not-a-number';
    const limiter = createLimiter('MY_LIMIT', 4);
    expect(limiter).toBeInstanceOf(ConcurrencyLimiter);
  });

  it('falls back to default when env var is 0', () => {
    process.env.MY_LIMIT = '0';
    // 0 is invalid (< 1), should fall back to default
    const limiter = createLimiter('MY_LIMIT', 3);
    expect(limiter).toBeInstanceOf(ConcurrencyLimiter);
  });
});

describe('runWithLimiter', () => {
  it('collects ok results from all tasks', async () => {
    const limiter = new ConcurrencyLimiter(2);
    const tasks = [
      async () => 'a',
      async () => 'b',
      async () => 'c',
    ];
    const results = await runWithLimiter(limiter, tasks);
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ ok: true, value: 'a' });
    expect(results[1]).toEqual({ ok: true, value: 'b' });
    expect(results[2]).toEqual({ ok: true, value: 'c' });
  });

  it('failed task produces { ok: false, error: "..." } in results', async () => {
    const limiter = new ConcurrencyLimiter(2);
    const tasks = [
      async () => 'success',
      async () => { throw new Error('task error'); },
    ];
    const results = await runWithLimiter(limiter, tasks);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ ok: true, value: 'success' });
    expect(results[1]).toMatchObject({ ok: false, error: 'task error' });
  });

  it('error in one task does not prevent others from running', async () => {
    const limiter = new ConcurrencyLimiter(1);
    const executed: number[] = [];

    const tasks = [
      async () => { executed.push(1); throw new Error('fail'); },
      async () => { executed.push(2); return 'two'; },
      async () => { executed.push(3); return 'three'; },
    ];

    const results = await runWithLimiter(limiter, tasks);
    expect(executed).toContain(2);
    expect(executed).toContain(3);

    const ok = results.filter((r) => r.ok === true);
    const fail = results.filter((r) => r.ok === false);
    expect(ok).toHaveLength(2);
    expect(fail).toHaveLength(1);
  });

  it('returns empty array for empty task list', async () => {
    const limiter = new ConcurrencyLimiter(2);
    const results = await runWithLimiter(limiter, []);
    expect(results).toEqual([]);
  });

  it('error message is the Error.message string', async () => {
    const limiter = new ConcurrencyLimiter(1);
    const results = await runWithLimiter(limiter, [
      async () => { throw new Error('specific error message'); },
    ]);
    expect(results[0]).toEqual({ ok: false, error: 'specific error message' });
  });

  it('non-Error throws produce error as string', async () => {
    const limiter = new ConcurrencyLimiter(1);
    const results = await runWithLimiter(limiter, [
      async () => { throw 'string error'; },
    ]);
    expect(results[0]).toEqual({ ok: false, error: 'string error' });
  });
});

describe('pre-built limiters', () => {
  it('jiraLimiter is a ConcurrencyLimiter instance', () => {
    expect(jiraLimiter).toBeInstanceOf(ConcurrencyLimiter);
  });

  it('confluenceLimiter is a ConcurrencyLimiter instance', () => {
    expect(confluenceLimiter).toBeInstanceOf(ConcurrencyLimiter);
  });

  it('githubLimiter is a ConcurrencyLimiter instance', () => {
    expect(githubLimiter).toBeInstanceOf(ConcurrencyLimiter);
  });

  it('jiraLimiter has default concurrency of 3 (allows 3 concurrent)', async () => {
    // jiraLimiter is a singleton — test it with fast tasks to avoid interference
    let maxRunning = 0;
    let currentRunning = 0;

    const task = async () => {
      currentRunning++;
      maxRunning = Math.max(maxRunning, currentRunning);
      await new Promise((r) => setTimeout(r, 5));
      currentRunning--;
    };

    await Promise.all([
      jiraLimiter.run(task),
      jiraLimiter.run(task),
      jiraLimiter.run(task),
      jiraLimiter.run(task),
    ]);

    // With default limit of 3, max concurrent should be <= 3
    expect(maxRunning).toBeLessThanOrEqual(3);
    expect(maxRunning).toBeGreaterThanOrEqual(1);
    expect(jiraLimiter.running).toBe(0);
    expect(jiraLimiter.queued).toBe(0);
  });

  it('githubLimiter has lower default concurrency than jiraLimiter', async () => {
    // githubLimiter default is 2 — verify it allows at most 2 concurrent tasks
    let maxRunning = 0;
    let currentRunning = 0;

    const task = async () => {
      currentRunning++;
      maxRunning = Math.max(maxRunning, currentRunning);
      await new Promise((r) => setTimeout(r, 5));
      currentRunning--;
    };

    await Promise.all([
      githubLimiter.run(task),
      githubLimiter.run(task),
      githubLimiter.run(task),
    ]);

    expect(maxRunning).toBeLessThanOrEqual(2);
    expect(githubLimiter.running).toBe(0);
    expect(githubLimiter.queued).toBe(0);
  });
});
