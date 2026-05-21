// ── Types ─────────────────────────────────────────────────────────────────────

export interface ConflictResult {
  hasConflicts: boolean;
  conflicts: ConflictItem[];
}

export interface ConflictItem {
  type: 'requirement_change' | 'scope_conflict' | 'audience_conflict' | 'behavior_conflict';
  description: string;  // human-readable explanation
  source1: string;      // e.g. "task description"
  source2: string;      // e.g. "comment (2024-01-20)"
  severity: 'high' | 'medium' | 'low';
}

// ── Source shape (input) ──────────────────────────────────────────────────────

interface TextSource {
  label: string;
  text: string;
  date?: string;
}

// ── Detection rule sets ───────────────────────────────────────────────────────

/**
 * Behavior-conflict pairs: if one side matches in source A and the other in source B,
 * flag a behavior conflict.
 */
const BEHAVIOR_PAIRS: Array<{ sideA: RegExp; sideB: RegExp; description: string }> = [
  {
    sideA: /\bshow warning\b/i,
    sideB: /\bblock submission\b|\bprevent\b|\bdisable\b/i,
    description: 'One source says "show warning" while another says "block / prevent / disable".',
  },
  {
    sideA: /\ballow\b/i,
    sideB: /\bdisallow\b|\bdeny\b|\breject\b/i,
    description: 'One source says "allow" while another says "disallow / deny / reject".',
  },
  {
    sideA: /\boptional\b/i,
    sideB: /\brequired\b|\bmandatory\b/i,
    description: 'One source treats a field/action as optional; another treats it as required / mandatory.',
  },
  {
    sideA: /\bredirect\b/i,
    sideB: /\bstay on page\b|\bno redirect\b/i,
    description: 'One source mentions a redirect while another says "stay on page / no redirect".',
  },
];

/**
 * Audience-conflict pairs.
 */
const AUDIENCE_PAIRS: Array<{ sideA: RegExp; sideB: RegExp; description: string }> = [
  {
    sideA: /\badmin(?:s|istrators?)? only\b|\badministrators? only\b/i,
    sideB: /\ball users\b|\beveryone\b|\bpublic\b/i,
    description: 'One source restricts access to admins only; another says all users / everyone / public.',
  },
  {
    sideA: /\bauthenticated users?\b/i,
    sideB: /\banonymous\b/i,
    description: 'One source targets authenticated users; another mentions anonymous access.',
  },
];

const SCOPE_KEYWORDS = /\bmobile\b|\bresponsive\b/i;

const REQUIREMENT_CHANGE_MARKERS =
  /\binstead\b|\bactually\b|\bcorrection\b|\bupdate:\b|\bchanged to\b|\bshould be\b/i;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a deduplicated key for a conflict pair so the same logical conflict
 * from multiple source combinations is not reported twice.
 */
function conflictKey(type: string, source1: string, source2: string): string {
  return `${type}|${[source1, source2].sort().join('|')}`;
}

/**
 * Format source label with optional date.
 */
function sourceLabel(src: TextSource): string {
  if (src.date) return `${src.label} (${src.date})`;
  return src.label;
}

// ── Core detection ────────────────────────────────────────────────────────────

/**
 * Detect conflicts between an array of text sources (oldest first).
 */
export function detectConflicts(
  sources: Array<{ label: string; text: string; date?: string }>,
): ConflictResult {
  const conflicts: ConflictItem[] = [];
  const seen = new Set<string>();

  const addConflict = (item: ConflictItem) => {
    const key = conflictKey(item.type, item.source1, item.source2);
    if (!seen.has(key)) {
      seen.add(key);
      conflicts.push(item);
    }
  };

  // Compare every ordered pair (i < j, so j is chronologically later)
  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      const srcA = sources[i] as TextSource;
      const srcB = sources[j] as TextSource;
      const labelA = sourceLabel(srcA);
      const labelB = sourceLabel(srcB);
      const textA = srcA.text;
      const textB = srcB.text;

      // ── 1. Behavior conflicts ─────────────────────────────────────────────
      for (const pair of BEHAVIOR_PAIRS) {
        // A has sideA, B has sideB
        if (pair.sideA.test(textA) && pair.sideB.test(textB)) {
          addConflict({
            type: 'behavior_conflict',
            description: pair.description,
            source1: labelA,
            source2: labelB,
            severity: 'medium',
          });
        }
        // A has sideB, B has sideA
        if (pair.sideB.test(textA) && pair.sideA.test(textB)) {
          addConflict({
            type: 'behavior_conflict',
            description: pair.description,
            source1: labelA,
            source2: labelB,
            severity: 'medium',
          });
        }
      }

      // ── 2. Audience conflicts ─────────────────────────────────────────────
      for (const pair of AUDIENCE_PAIRS) {
        if (
          (pair.sideA.test(textA) && pair.sideB.test(textB)) ||
          (pair.sideB.test(textA) && pair.sideA.test(textB))
        ) {
          addConflict({
            type: 'audience_conflict',
            description: pair.description,
            source1: labelA,
            source2: labelB,
            severity: 'high',
          });
        }
      }

      // ── 3. Scope conflicts ────────────────────────────────────────────────
      // Mobile/responsive mentioned in one source but not in the other
      const aHasScope = SCOPE_KEYWORDS.test(textA);
      const bHasScope = SCOPE_KEYWORDS.test(textB);
      if (aHasScope !== bHasScope) {
        const withScope = aHasScope ? labelA : labelB;
        const withoutScope = aHasScope ? labelB : labelA;
        addConflict({
          type: 'scope_conflict',
          description:
            `Mobile/responsive scope is mentioned in "${withScope}" but not in "${withoutScope}". ` +
            'Clarify whether the feature is expected to be mobile-friendly.',
          source1: labelA,
          source2: labelB,
          severity: 'low',
        });
      }

      // ── 4. Requirement change via later source ────────────────────────────
      // Only apply when j is a "later" source (e.g. a comment overriding description)
      if (j > 0 && REQUIREMENT_CHANGE_MARKERS.test(textB)) {
        addConflict({
          type: 'requirement_change',
          description:
            `"${labelB}" contains language suggesting a requirement override ` +
            `("instead", "actually", "correction", "update:", "changed to", or "should be") ` +
            `which may supersede the earlier "${labelA}". Treat the latest useful comment as authoritative.`,
          source1: labelA,
          source2: labelB,
          severity: 'high',
        });
      }
    }
  }

  return {
    hasConflicts: conflicts.length > 0,
    conflicts,
  };
}

// ── Formatter ─────────────────────────────────────────────────────────────────

/**
 * Format a ConflictResult for inclusion in a Risk/Ambiguity section.
 * Returns an empty string when there are no conflicts.
 */
export function formatConflicts(result: ConflictResult): string {
  if (!result.hasConflicts || result.conflicts.length === 0) {
    return '';
  }

  const lines: string[] = ['⚠️ **Potential Conflicts Detected:**'];

  for (const item of result.conflicts) {
    const typeLabel = item.type.replace(/_/g, ' ');
    lines.push(
      `- [${item.severity}] ${capitalize(typeLabel)}: ${item.source2} may conflict with ${item.source1}. ${item.description}`,
    );
  }

  return lines.join('\n');
}

// ── Tiny util ─────────────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
