import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { formatPerformanceSummary } from '../../src/performance/performanceReporter.js';
import { createTimer } from '../../src/performance/timing.js';

describe('formatPerformanceSummary', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns empty string when MCP_PERFORMANCE_LOGGING is not set', async () => {
    delete process.env.MCP_PERFORMANCE_LOGGING;
    const timer = createTimer();
    await timer.time('step', async () => 'done');
    expect(formatPerformanceSummary(timer)).toBe('');
  });

  it('returns empty string when MCP_PERFORMANCE_LOGGING != "true"', async () => {
    process.env.MCP_PERFORMANCE_LOGGING = 'false';
    const timer = createTimer();
    await timer.time('step', async () => 'done');
    expect(formatPerformanceSummary(timer)).toBe('');
  });

  it('returns formatted summary when MCP_PERFORMANCE_LOGGING=true', async () => {
    process.env.MCP_PERFORMANCE_LOGGING = 'true';
    const timer = createTimer();
    await timer.time('Jira fetch', async () => {
      await new Promise((r) => setTimeout(r, 2));
      return 'ok';
    });

    const result = formatPerformanceSummary(timer);
    expect(result).toContain('## Performance Summary');
    expect(result).toContain('Jira fetch:');
    expect(result).toContain('Total:');
  });

  it('includes cache hits and misses when cacheStats provided', async () => {
    process.env.MCP_PERFORMANCE_LOGGING = 'true';
    const timer = createTimer();
    await timer.time('step', async () => 'ok');

    const result = formatPerformanceSummary(timer, { hits: 3, misses: 2 });
    expect(result).toContain('Cache hits: 3');
    expect(result).toContain('Cache misses: 2');
  });

  it('does not include cache lines when cacheStats not provided', async () => {
    process.env.MCP_PERFORMANCE_LOGGING = 'true';
    const timer = createTimer();
    await timer.time('step', async () => 'ok');

    const result = formatPerformanceSummary(timer);
    expect(result).not.toContain('Cache hits');
    expect(result).not.toContain('Cache misses');
  });

  it('shows duration in ms for < 1000ms', async () => {
    process.env.MCP_PERFORMANCE_LOGGING = 'true';
    const timer = createTimer();
    // Manually create a completed entry with known duration
    const entry = timer.start('quick-op');
    entry.durationMs = 420;
    // Call end to flush it from open entries... but entry already has durationMs
    // Actually since we set durationMs directly, entries getter will include it
    // But we need to also remove from _openEntries. Let's use time() approach instead.
    // Reset and use a controlled approach via the timer API.

    const timer2 = createTimer();
    // Use time() but we can't control the duration precisely.
    // Instead test the formatting function directly via a timer whose entries we control.
    // We'll use start/end but mock performance.now is tricky.
    // Let's just verify the format pattern for a real fast operation.
    await timer2.time('fast-step', async () => 'done');
    const result = formatPerformanceSummary(timer2);
    // For a very fast step, should show ms not s
    expect(result).toMatch(/fast-step: \d+ms/);
  });

  it('shows duration in X.XXs format for >= 1000ms', async () => {
    process.env.MCP_PERFORMANCE_LOGGING = 'true';
    const timer = createTimer();

    // Directly manipulate an entry for testing the format
    const entry = timer.start('slow-op');
    // Simulate completed entry
    entry.durationMs = 1280;
    // Remove from open entries by calling end — but durationMs is already set,
    // so we need to simulate properly. Let's patch the private state.
    // The cleanest way: just verify via the format logic.
    // Since we can't easily inject a slow entry without waiting,
    // test formatting via the actual timer time() with a known threshold.

    // Alternative: test with a timer2 that has a real slow op (100ms)
    // just to verify the s format appears when appropriate.
    // We'll set threshold by checking "s" suffix appears when duration >= 1000ms.

    // For testing the >= 1000ms branch, create a custom scenario:
    // We'll directly verify our understanding of formatDuration by checking
    // the output of a timer with artificially set durationMs.
    const timer2 = createTimer();
    const e2 = timer2.start('slow-step');
    e2.durationMs = 1280; // Set durationMs directly to simulate slow step
    // end() would set durationMs again — instead we just verify entries getter
    // returns entries with durationMs set regardless of whether _openEntries has it.
    // Looking at the implementation: entries returns _entries where durationMs !== undefined.
    // So e2 IS in entries now. But it's also in _openEntries.
    // Let's call end to clean it up — that will overwrite durationMs though.
    // Better: just call timer2.end('slow-step') and check that the REAL test verifies format.

    // The cleanest solution: test the format via a wrapped slow step mock.
    const timer3 = createTimer();
    // Use a short timer but test the >= 1000ms branch via the entry manipulation approach
    // We need to verify s format. Let's use 2 seconds in a real test.
    // That would be slow. Instead test via a direct entry with durationMs=1500.

    // Just test the condition: create an entry with large durationMs without calling end
    const timer4 = createTimer();
    const slowEntry = timer4.start('measured-op');
    slowEntry.durationMs = 1500; // directly set
    // timer4.entries will include this since durationMs is set
    const result = formatPerformanceSummary(timer4);
    expect(result).toMatch(/measured-op: 1\.50s/);
  });

  it('sorts entries by start time in output', async () => {
    process.env.MCP_PERFORMANCE_LOGGING = 'true';
    const timer = createTimer();
    await timer.time('first', async () => 'a');
    await timer.time('second', async () => 'b');
    await timer.time('third', async () => 'c');

    const result = formatPerformanceSummary(timer);
    const firstIdx = result.indexOf('first:');
    const secondIdx = result.indexOf('second:');
    const thirdIdx = result.indexOf('third:');
    expect(firstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(thirdIdx);
  });

  it('does NOT include any token/secret values in output', async () => {
    process.env.MCP_PERFORMANCE_LOGGING = 'true';
    const timer = createTimer();
    // Even if metadata contains sensitive info, output should be safe
    // (reporter only uses entry names and durations)
    timer.start('api-call', { token: 'super-secret-token-12345', apiKey: 'key-abc-xyz' });
    timer.end('api-call');

    const result = formatPerformanceSummary(timer);
    expect(result).not.toContain('super-secret-token-12345');
    expect(result).not.toContain('key-abc-xyz');
  });

  it('returns header and total when timer has no completed entries', () => {
    process.env.MCP_PERFORMANCE_LOGGING = 'true';
    const timer = createTimer();
    // start but don't end
    timer.start('open-step');

    const result = formatPerformanceSummary(timer);
    // Should still produce a header and total (even if 0)
    expect(result).toContain('## Performance Summary');
    expect(result).toContain('Total:');
    expect(result).not.toContain('open-step:');
  });
});
