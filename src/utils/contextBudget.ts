// ── Context Budget Utilities ──────────────────────────────────────────────────
// Pure utilities for controlling context size and preventing token explosion.
// No LLM calls — all deterministic string/array manipulation.

// ── Global output budget limits (read from env with defaults) ─────────────────
export const MAX_OUTPUT_CHARS: number = parseInt(
  process.env.MCP_MAX_OUTPUT_CHARS ?? "60000",
  10
);
export const MAX_SECTION_CHARS: number = parseInt(
  process.env.MCP_MAX_SECTION_CHARS ?? "12000",
  10
);
export const MAX_DIFF_CHARS: number = parseInt(
  process.env.MCP_MAX_DIFF_CHARS ?? "50000",
  10
);
export const MAX_CONFLUENCE_CHARS: number = parseInt(
  process.env.MCP_MAX_CONFLUENCE_CHARS ?? "30000",
  10
);

// ── Priority-based section budget ─────────────────────────────────────────────
export type ContentPriority = "critical" | "high" | "medium" | "low";

export interface ContentSection {
  content: string;
  priority: ContentPriority;
  label?: string;
}

const PRIORITY_ORDER: ContentPriority[] = ["critical", "high", "medium", "low"];

/**
 * Given a list of sections and a total budget, fit as many sections as
 * possible in priority order (critical → high → medium → low).
 * Within the same priority, first-in wins (order preserved).
 * Critical sections are always included even if they exceed the budget.
 * A non-critical section that would exceed remaining budget is omitted entirely.
 * Returns the assembled content, a list of omitted section labels, and a
 * truncated flag.
 */
export function fitSections(
  sections: ContentSection[],
  budgetChars: number,
  separator = "\n\n"
): { content: string; omitted: string[]; truncated: boolean } {
  const included: ContentSection[] = [];
  const omitted: string[] = [];
  let remaining = budgetChars;

  for (const priority of PRIORITY_ORDER) {
    const group = sections.filter((s) => s.priority === priority);
    for (const section of group) {
      const sectionLen =
        section.content.length +
        (included.length > 0 ? separator.length : 0);

      if (priority === "critical") {
        // Critical sections always included, even over budget.
        included.push(section);
        remaining -= sectionLen;
      } else if (sectionLen <= remaining) {
        included.push(section);
        remaining -= sectionLen;
      } else {
        if (section.label !== undefined) {
          omitted.push(section.label);
        }
      }
    }
  }

  const content = included.map((s) => s.content).join(separator);
  return { content, omitted, truncated: omitted.length > 0 };
}

// ── Priority-aware truncation ─────────────────────────────────────────────────
const WARNING_PREFIXES = ["⚠️", "❌", "🔴"];

function isWarningLine(line: string): boolean {
  return WARNING_PREFIXES.some((prefix) => line.startsWith(prefix));
}

/**
 * Truncate content to maxChars, but always preserve lines that start with
 * ⚠️, ❌, or 🔴. Other lines are truncated from the end.
 * Returns content that ends at a newline boundary when possible.
 */
export function truncatePreservingWarnings(
  content: string,
  maxChars: number
): string {
  if (content.length <= maxChars) {
    return content;
  }

  const lines = content.split("\n");
  const warningLines: string[] = [];
  const normalLines: string[] = [];

  for (const line of lines) {
    if (isWarningLine(line)) {
      warningLines.push(line);
    } else {
      normalLines.push(line);
    }
  }

  // Start with all warning lines joined.
  const warningBlock = warningLines.join("\n");
  const warningChars = warningBlock.length;

  // Budget for normal lines (account for separator newline if both blocks exist).
  const separatorLen = warningLines.length > 0 && normalLines.length > 0 ? 1 : 0;
  const normalBudget = maxChars - warningChars - separatorLen;

  let normalBlock = "";
  if (normalBudget > 0 && normalLines.length > 0) {
    // Join normal lines, then trim to budget at newline boundary.
    const joined = normalLines.join("\n");
    if (joined.length <= normalBudget) {
      normalBlock = joined;
    } else {
      // Trim at last newline within budget.
      const candidate = joined.slice(0, normalBudget);
      const lastNewline = candidate.lastIndexOf("\n");
      normalBlock =
        lastNewline > 0 ? candidate.slice(0, lastNewline) : candidate;
    }
  }

  if (warningLines.length > 0 && normalBlock.length > 0) {
    return warningBlock + "\n" + normalBlock;
  } else if (warningLines.length > 0) {
    return warningBlock;
  } else {
    return normalBlock;
  }
}

// ── Omission summary ──────────────────────────────────────────────────────────
/**
 * Generate an omission notice listing what was dropped.
 * Returns '' if nothing was omitted.
 * Example: "⚠️ Omitted sections (budget exceeded): linked issues, epic siblings"
 */
export function formatOmissionSummary(omitted: string[]): string {
  if (omitted.length === 0) {
    return "";
  }
  return `⚠️ Omitted sections (budget exceeded): ${omitted.join(", ")}`;
}

// ── Final prompt budget check ─────────────────────────────────────────────────
/**
 * Check if a final assembled prompt exceeds MCP_MAX_OUTPUT_CHARS.
 * Returns the prompt unchanged if within budget.
 * If over budget, truncates using truncatePreservingWarnings and appends an
 * omission notice.
 */
export function enforceFinalBudget(prompt: string): string {
  if (prompt.length <= MAX_OUTPUT_CHARS) {
    return prompt;
  }
  // Reserve space for the omission notice.
  const notice = "\n\n⚠️ Output truncated to fit budget.";
  const truncated = truncatePreservingWarnings(
    prompt,
    MAX_OUTPUT_CHARS - notice.length
  );
  return truncated + notice;
}

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
