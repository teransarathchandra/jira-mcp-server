import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryCache, createCache, isCacheEnabled } from '../../src/cache/memoryCache.js';

describe('MemoryCache', () => {
  let cache: MemoryCache<string>;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Ensure cache is enabled by default
    delete process.env.MCP_CACHE_ENABLED;
    cache = new MemoryCache<string>({ ttlMs: 1000, maxItems: 3 });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('set and get basic round-trip', () => {
    it('stores and retrieves a value', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('stores and retrieves multiple values', () => {
      cache.set('a', 'alpha');
      cache.set('b', 'beta');
      expect(cache.get('a')).toBe('alpha');
      expect(cache.get('b')).toBe('beta');
    });

    it('overwrites an existing key', () => {
      cache.set('key', 'first');
      cache.set('key', 'second');
      expect(cache.get('key')).toBe('second');
    });

    it('returns undefined for a missing key', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });
  });

  describe('TTL expiration', () => {
    it('returns undefined for an expired entry', () => {
      vi.useFakeTimers();
      cache.set('key', 'value');
      expect(cache.get('key')).toBe('value');
      vi.advanceTimersByTime(1001);
      expect(cache.get('key')).toBeUndefined();
    });

    it('removes expired entry lazily on get', () => {
      vi.useFakeTimers();
      cache.set('key', 'value');
      vi.advanceTimersByTime(1001);
      cache.get('key'); // triggers removal
      // After lazy removal, size should not include the expired entry
      expect(cache.size).toBe(0);
    });

    it('does not expire before TTL', () => {
      vi.useFakeTimers();
      cache.set('key', 'value');
      vi.advanceTimersByTime(999);
      expect(cache.get('key')).toBe('value');
    });
  });

  describe('max-items eviction', () => {
    it('evicts the oldest entry when at capacity', () => {
      vi.useFakeTimers();
      cache.set('first', 'v1');
      vi.advanceTimersByTime(10);
      cache.set('second', 'v2');
      vi.advanceTimersByTime(10);
      cache.set('third', 'v3');
      // At capacity (maxItems=3); inserting fourth should evict 'first'
      vi.advanceTimersByTime(10);
      cache.set('fourth', 'v4');
      expect(cache.get('first')).toBeUndefined();
      expect(cache.get('second')).toBe('v2');
      expect(cache.get('third')).toBe('v3');
      expect(cache.get('fourth')).toBe('v4');
    });

    it('tracks eviction count in stats', () => {
      vi.useFakeTimers();
      cache.set('a', '1');
      vi.advanceTimersByTime(10);
      cache.set('b', '2');
      vi.advanceTimersByTime(10);
      cache.set('c', '3');
      vi.advanceTimersByTime(10);
      cache.set('d', '4'); // evicts 'a'
      expect(cache.stats.evictions).toBe(1);
    });

    it('does not evict when updating an existing key', () => {
      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');
      // Overwrite 'a' — not an eviction scenario since key already exists
      cache.set('a', 'updated');
      expect(cache.get('a')).toBe('updated');
      expect(cache.stats.evictions).toBe(0);
    });
  });

  describe('clear()', () => {
    it('removes all entries', () => {
      cache.set('x', '1');
      cache.set('y', '2');
      cache.clear();
      expect(cache.get('x')).toBeUndefined();
      expect(cache.get('y')).toBeUndefined();
      expect(cache.size).toBe(0);
    });
  });

  describe('purgeExpired()', () => {
    it('removes expired entries and returns count', () => {
      vi.useFakeTimers();
      cache.set('a', '1');
      cache.set('b', '2');
      vi.advanceTimersByTime(1001);
      cache.set('c', '3'); // fresh entry
      const purged = cache.purgeExpired();
      expect(purged).toBe(2);
      expect(cache.get('c')).toBe('3');
    });

    it('returns 0 when nothing is expired', () => {
      cache.set('a', '1');
      cache.set('b', '2');
      const purged = cache.purgeExpired();
      expect(purged).toBe(0);
    });
  });

  describe('size getter', () => {
    it('returns count of non-expired entries', () => {
      vi.useFakeTimers();
      cache.set('a', '1');
      cache.set('b', '2');
      expect(cache.size).toBe(2);
      vi.advanceTimersByTime(1001);
      expect(cache.size).toBe(0);
    });

    it('counts only live entries when mixed', () => {
      vi.useFakeTimers();
      cache.set('old', 'v');
      vi.advanceTimersByTime(1001);
      cache.set('fresh', 'v2');
      expect(cache.size).toBe(1);
    });
  });

  describe('has()', () => {
    it('returns true for an existing, non-expired entry', () => {
      cache.set('key', 'value');
      expect(cache.has('key')).toBe(true);
    });

    it('returns false for a missing key', () => {
      expect(cache.has('missing')).toBe(false);
    });

    it('returns false for an expired entry', () => {
      vi.useFakeTimers();
      cache.set('key', 'value');
      vi.advanceTimersByTime(1001);
      expect(cache.has('key')).toBe(false);
    });
  });

  describe('delete()', () => {
    it('removes a specific entry', () => {
      cache.set('key', 'value');
      cache.delete('key');
      expect(cache.get('key')).toBeUndefined();
    });

    it('does not affect other entries', () => {
      cache.set('a', '1');
      cache.set('b', '2');
      cache.delete('a');
      expect(cache.get('b')).toBe('2');
    });

    it('is a no-op for nonexistent key', () => {
      expect(() => cache.delete('none')).not.toThrow();
    });
  });

  describe('stats', () => {
    it('tracks hits correctly', () => {
      cache.set('key', 'val');
      cache.get('key');
      cache.get('key');
      expect(cache.stats.hits).toBe(2);
    });

    it('tracks misses correctly', () => {
      cache.get('missing');
      cache.get('also-missing');
      expect(cache.stats.misses).toBe(2);
    });

    it('tracks expired entries as misses', () => {
      vi.useFakeTimers();
      cache.set('key', 'val');
      vi.advanceTimersByTime(1001);
      cache.get('key'); // expired → miss
      expect(cache.stats.misses).toBe(1);
      expect(cache.stats.hits).toBe(0);
    });

    it('tracks evictions correctly', () => {
      vi.useFakeTimers();
      cache.set('a', '1');
      vi.advanceTimersByTime(1);
      cache.set('b', '2');
      vi.advanceTimersByTime(1);
      cache.set('c', '3');
      vi.advanceTimersByTime(1);
      cache.set('d', '4');
      expect(cache.stats.evictions).toBe(1);
    });

    it('includes current size in stats', () => {
      cache.set('a', '1');
      cache.set('b', '2');
      expect(cache.stats.size).toBe(2);
    });
  });

  describe('disabled cache (MCP_CACHE_ENABLED=false)', () => {
    beforeEach(() => {
      process.env.MCP_CACHE_ENABLED = 'false';
    });

    it('get always returns undefined when disabled', () => {
      cache.set('key', 'value');
      expect(cache.get('key')).toBeUndefined();
    });

    it('set is a no-op when disabled', () => {
      cache.set('key', 'value');
      // Re-enable and verify nothing was stored
      process.env.MCP_CACHE_ENABLED = 'true';
      expect(cache.get('key')).toBeUndefined();
    });

    it('has() returns false when disabled', () => {
      process.env.MCP_CACHE_ENABLED = 'false';
      expect(cache.has('any')).toBe(false);
    });

    it('size returns 0 when disabled', () => {
      process.env.MCP_CACHE_ENABLED = 'false';
      expect(cache.size).toBe(0);
    });

    it('misses are still tracked when disabled', () => {
      cache.get('key');
      expect(cache.stats.misses).toBe(1);
    });
  });
});

describe('isCacheEnabled', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns true by default (no env var)', () => {
    delete process.env.MCP_CACHE_ENABLED;
    expect(isCacheEnabled()).toBe(true);
  });

  it('returns true when set to "true"', () => {
    process.env.MCP_CACHE_ENABLED = 'true';
    expect(isCacheEnabled()).toBe(true);
  });

  it('returns false when set to "false"', () => {
    process.env.MCP_CACHE_ENABLED = 'false';
    expect(isCacheEnabled()).toBe(false);
  });

  it('is case-insensitive (FALSE)', () => {
    process.env.MCP_CACHE_ENABLED = 'FALSE';
    expect(isCacheEnabled()).toBe(false);
  });
});

describe('createCache', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.MCP_CACHE_ENABLED;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns same instance for same name', () => {
    const c1 = createCache<string>('test-singleton', { ttlMs: 1000 });
    const c2 = createCache<string>('test-singleton', { ttlMs: 2000 });
    expect(c1).toBe(c2);
  });

  it('returns different instances for different names', () => {
    const c1 = createCache<string>('cache-alpha', { ttlMs: 1000 });
    const c2 = createCache<string>('cache-beta', { ttlMs: 1000 });
    expect(c1).not.toBe(c2);
  });

  it('created cache stores and retrieves values', () => {
    const c = createCache<number>('cache-numbers', { ttlMs: 5000 });
    c.set('n', 42);
    expect(c.get('n')).toBe(42);
  });
});
