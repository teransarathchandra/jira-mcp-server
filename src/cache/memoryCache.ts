import { logger } from '../logging/logger.js';

export interface CacheOptions {
  ttlMs: number;
  maxItems?: number;
}

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  insertedAt: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
}

export function isCacheEnabled(): boolean {
  const val = process.env.MCP_CACHE_ENABLED;
  if (val === undefined || val === null) return true;
  return val.toLowerCase() !== 'false';
}

const isDebug = (): boolean => process.env.MCP_DEBUG === 'true';

export class MemoryCache<T> {
  private readonly store: Map<string, CacheEntry<T>> = new Map();
  private readonly ttlMs: number;
  private readonly maxItems: number;
  private _hits = 0;
  private _misses = 0;
  private _evictions = 0;

  constructor(options: CacheOptions) {
    this.ttlMs = options.ttlMs;
    this.maxItems = options.maxItems ?? 500;
  }

  set(key: string, value: T): void {
    if (!isCacheEnabled()) return;

    // Evict oldest if at capacity
    if (!this.store.has(key) && this.store.size >= this.maxItems) {
      this._evictOldest();
    }

    const now = Date.now();
    this.store.set(key, {
      value,
      expiresAt: now + this.ttlMs,
      insertedAt: now,
    });
  }

  get(key: string): T | undefined {
    if (!isCacheEnabled()) {
      this._misses++;
      return undefined;
    }

    const entry = this.store.get(key);
    if (entry === undefined) {
      this._misses++;
      if (isDebug()) {
        logger.debug('[cache] miss', { key });
      }
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this._misses++;
      if (isDebug()) {
        logger.debug('[cache] expired', { key });
      }
      return undefined;
    }

    this._hits++;
    if (isDebug()) {
      logger.debug('[cache] hit', { key });
    }
    return entry.value;
  }

  has(key: string): boolean {
    if (!isCacheEnabled()) return false;
    const entry = this.store.get(key);
    if (entry === undefined) return false;
    if (Date.now() > entry.expiresAt) return false;
    return true;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  purgeExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        count++;
      }
    }
    return count;
  }

  get size(): number {
    if (!isCacheEnabled()) return 0;
    const now = Date.now();
    let count = 0;
    for (const entry of this.store.values()) {
      if (now <= entry.expiresAt) count++;
    }
    return count;
  }

  get stats(): CacheStats {
    return {
      hits: this._hits,
      misses: this._misses,
      evictions: this._evictions,
      size: this.size,
    };
  }

  private _evictOldest(): void {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;

    for (const [key, entry] of this.store) {
      if (entry.insertedAt < oldestTime) {
        oldestTime = entry.insertedAt;
        oldestKey = key;
      }
    }

    if (oldestKey !== undefined) {
      this.store.delete(oldestKey);
      this._evictions++;
    }
  }
}

const cacheRegistry = new Map<string, MemoryCache<unknown>>();

export function createCache<T>(name: string, options: CacheOptions): MemoryCache<T> {
  if (cacheRegistry.has(name)) {
    return cacheRegistry.get(name) as MemoryCache<T>;
  }
  const cache = new MemoryCache<T>(options);
  cacheRegistry.set(name, cache as MemoryCache<unknown>);
  return cache;
}

export default cacheRegistry;
