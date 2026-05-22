import { type RequestTimer, isPerformanceLoggingEnabled } from './timing.js';

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

// Format a performance summary block for inclusion in output.
// Only includes if MCP_PERFORMANCE_LOGGING=true; returns '' otherwise.
export function formatPerformanceSummary(
  timer: RequestTimer,
  cacheStats?: { hits: number; misses: number },
): string {
  if (!isPerformanceLoggingEnabled()) {
    return '';
  }

  const entries = timer.entries.slice().sort((a, b) => a.startMs - b.startMs);

  const lines: string[] = ['## Performance Summary'];

  for (const entry of entries) {
    const duration = entry.durationMs as number;
    lines.push(`- ${entry.name}: ${formatDuration(duration)}`);
  }

  lines.push(`- Total: ${formatDuration(timer.totalMs)}`);

  if (cacheStats !== undefined) {
    lines.push(`- Cache hits: ${cacheStats.hits}`);
    lines.push(`- Cache misses: ${cacheStats.misses}`);
  }

  return lines.join('\n');
}
