// A named timing context for one operation
export interface TimingEntry {
  name: string;
  startMs: number;
  durationMs?: number; // set when ended
  metadata?: Record<string, unknown>;
}

// Collect timings for a single request/invocation
export class RequestTimer {
  private _entries: TimingEntry[] = [];
  private _openEntries: Map<string, TimingEntry> = new Map();

  // Start timing a named step. Returns the entry so caller can store it.
  start(name: string, metadata?: Record<string, unknown>): TimingEntry {
    const entry: TimingEntry = {
      name,
      startMs: performance.now(),
      ...(metadata !== undefined ? { metadata } : {}),
    };
    this._openEntries.set(name, entry);
    this._entries.push(entry);
    return entry;
  }

  // End a previously started step by name.
  end(name: string): void {
    const entry = this._openEntries.get(name);
    if (entry === undefined) return;
    entry.durationMs = performance.now() - entry.startMs;
    this._openEntries.delete(name);
  }

  // Wrap an async function call and automatically start/end timing for it.
  async time<T>(
    name: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>,
  ): Promise<T> {
    const entry = this.start(name, metadata);
    try {
      const result = await fn();
      entry.durationMs = performance.now() - entry.startMs;
      this._openEntries.delete(name);
      return result;
    } catch (err) {
      entry.durationMs = performance.now() - entry.startMs;
      this._openEntries.delete(name);
      throw err;
    }
  }

  // Get all completed entries (durationMs set)
  get entries(): TimingEntry[] {
    return this._entries.filter((e) => e.durationMs !== undefined);
  }

  // Total elapsed since first start() call
  get totalMs(): number {
    if (this._entries.length === 0) return 0;
    const firstStart = this._entries[0].startMs;
    const now = performance.now();
    // If all entries are done, use the last end time
    const completedEntries = this._entries.filter((e) => e.durationMs !== undefined);
    if (completedEntries.length === this._entries.length && completedEntries.length > 0) {
      const lastEnd = Math.max(
        ...completedEntries.map((e) => e.startMs + (e.durationMs as number)),
      );
      return lastEnd - firstStart;
    }
    return now - firstStart;
  }
}

// Create a new RequestTimer
export function createTimer(): RequestTimer {
  return new RequestTimer();
}

// Return true if performance logging is enabled (MCP_PERFORMANCE_LOGGING=true)
export function isPerformanceLoggingEnabled(): boolean {
  return process.env.MCP_PERFORMANCE_LOGGING === 'true';
}
