// ── Context Budget Utilities ──────────────────────────────────────────────────
// Pure utilities for controlling context size and preventing token explosion.
// No LLM calls — all deterministic string/array manipulation.

/**
 * Truncate a string to maxChars, appending "... [truncated]" if cut.
 */
export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(0, maxChars) + "... [truncated]";
}

/**
 * Deduplicate an array of strings (case-insensitive).
 * Returns first occurrence with original casing.
 */
export function dedupStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

/**
 * Deduplicate an array of objects by a key field.
 * Keeps the first occurrence of each key.
 */
export function dedupByKey<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result;
}

/**
 * Limit an array to maxItems.
 * Returns the truncated slice and a warning string if items were dropped,
 * or null warning if nothing was dropped.
 */
export function limitArray<T>(
  items: T[],
  maxItems: number
): { items: T[]; warning: string | null } {
  if (items.length <= maxItems) {
    return { items, warning: null };
  }
  return {
    items: items.slice(0, maxItems),
    warning: `Truncated to ${maxItems} of ${items.length} items.`,
  };
}

/**
 * Summarize a long text to at most maxChars characters.
 * Tries to end at a sentence boundary (". " or ".\n").
 * Falls back to cutting at the last space within the limit.
 * Appends "..." if truncated.
 */
export function summarizeText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  const candidate = text.slice(0, maxChars);

  // Try to find the last sentence boundary within candidate.
  // Search for ". " or ".\n" to avoid cutting mid-sentence.
  const dotSpace = candidate.lastIndexOf(". ");
  const dotNewline = candidate.lastIndexOf(".\n");
  const boundary = Math.max(dotSpace, dotNewline);

  if (boundary > 0) {
    // Include the period but not the trailing space/newline.
    return candidate.slice(0, boundary + 1) + "...";
  }

  // No sentence boundary — cut at last space to avoid splitting a word.
  const lastSpace = candidate.lastIndexOf(" ");
  if (lastSpace > 0) {
    return candidate.slice(0, lastSpace) + "...";
  }

  // Hard cut as last resort.
  return candidate + "...";
}

/**
 * Returns the number of characters remaining before `current` would exceed
 * maxChars. May be negative if already over budget.
 */
export function remainingBudget(current: string, maxChars: number): number {
  return maxChars - current.length;
}

/**
 * Format a truncation warning for display.
 * Only emits a non-empty string when shown < total.
 * Example: "⚠️ Showing 8 of 12 linked issues (limit reached)."
 */
export function formatTruncationWarning(
  itemType: string,
  shown: number,
  total: number
): string {
  if (shown >= total) {
    return "";
  }
  return `⚠️ Showing ${shown} of ${total} ${itemType} (limit reached).`;
}
