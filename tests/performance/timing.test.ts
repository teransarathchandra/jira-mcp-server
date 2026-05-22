import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RequestTimer, createTimer, isPerformanceLoggingEnabled } from '../../src/performance/timing.js';

describe('RequestTimer', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('start and end produce an entry with correct name and duration > 0', async () => {
    const timer = createTimer();
    timer.start('test-step');
    // small delay to ensure measurable duration
    await new Promise((r) => setTimeout(r, 5));
    timer.end('test-step');

    const entries = timer.entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('test-step');
    expect(entries[0].durationMs).toBeGreaterThan(0);
  });

  it('start returns the entry object', () => {
    const timer = createTimer();
    const entry = timer.start('my-step');
    expect(entry.name).toBe('my-step');
    expect(entry.startMs).toBeGreaterThan(0);
    expect(entry.durationMs).toBeUndefined();
  });

  it('start accepts metadata and stores it on the entry', () => {
    const timer = createTimer();
    const meta = { key: 'value', count: 42 };
    const entry = timer.start('step-with-meta', meta);
    expect(entry.metadata).toEqual(meta);
  });

  it('time() wraps async fn and records duration', async () => {
    const timer = createTimer();
    const result = await timer.time('async-op', async () => {
      await new Promise((r) => setTimeout(r, 5));
      return 'done';
    });

    expect(result).toBe('done');
    const entries = timer.entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('async-op');
    expect(entries[0].durationMs).toBeGreaterThan(0);
  });

  it('time() still records entry if fn throws (duration set, rethrows)', async () => {
    const timer = createTimer();
    await expect(
      timer.time('failing-op', async () => {
        await new Promise((r) => setTimeout(r, 2));
        throw new Error('oops');
      }),
    ).rejects.toThrow('oops');

    const entries = timer.entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('failing-op');
    expect(entries[0].durationMs).toBeGreaterThan(0);
  });

  it('entries returns only completed entries', async () => {
    const timer = createTimer();
    timer.start('step-1');
    timer.start('step-2');

    // Only end step-1
    await new Promise((r) => setTimeout(r, 2));
    timer.end('step-1');

    const entries = timer.entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('step-1');
  });

  it('entries returns empty array when no steps completed', () => {
    const timer = createTimer();
    timer.start('open-step');
    expect(timer.entries).toHaveLength(0);
  });

  it('totalMs reflects elapsed from first start', async () => {
    const timer = createTimer();
    timer.start('step');
    await new Promise((r) => setTimeout(r, 10));
    timer.end('step');

    expect(timer.totalMs).toBeGreaterThan(0);
  });

  it('totalMs returns 0 when no entries exist', () => {
    const timer = new RequestTimer();
    expect(timer.totalMs).toBe(0);
  });

  it('multiple steps are all recorded', async () => {
    const timer = createTimer();
    timer.start('step-a');
    await new Promise((r) => setTimeout(r, 2));
    timer.end('step-a');

    timer.start('step-b');
    await new Promise((r) => setTimeout(r, 2));
    timer.end('step-b');

    const entries = timer.entries;
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.name)).toContain('step-a');
    expect(entries.map((e) => e.name)).toContain('step-b');
    for (const e of entries) {
      expect(e.durationMs).toBeGreaterThan(0);
    }
  });

  it('end on unknown name does nothing', () => {
    const timer = createTimer();
    expect(() => timer.end('nonexistent')).not.toThrow();
    expect(timer.entries).toHaveLength(0);
  });
});

describe('isPerformanceLoggingEnabled', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns false when MCP_PERFORMANCE_LOGGING is not set', () => {
    delete process.env.MCP_PERFORMANCE_LOGGING;
    expect(isPerformanceLoggingEnabled()).toBe(false);
  });

  it('returns true when MCP_PERFORMANCE_LOGGING is "true"', () => {
    process.env.MCP_PERFORMANCE_LOGGING = 'true';
    expect(isPerformanceLoggingEnabled()).toBe(true);
  });

  it('returns false when MCP_PERFORMANCE_LOGGING is "false"', () => {
    process.env.MCP_PERFORMANCE_LOGGING = 'false';
    expect(isPerformanceLoggingEnabled()).toBe(false);
  });

  it('returns false when MCP_PERFORMANCE_LOGGING is "1"', () => {
    process.env.MCP_PERFORMANCE_LOGGING = '1';
    expect(isPerformanceLoggingEnabled()).toBe(false);
  });
});
