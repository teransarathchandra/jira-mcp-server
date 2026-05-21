// ── Types ─────────────────────────────────────────────────────────────────────

export interface RepoInspectionHint {
  category: 'file' | 'api' | 'component' | 'validation' | 'test' | 'general';
  instruction: string;
}

export interface RepoInspectionResult {
  hints: RepoInspectionHint[];
  hasSpecificHints: boolean; // true if at least one non-general hint
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_HINTS = 10;

const FILE_EXTENSION_PATTERN = /\b[\w.\-/]+\.(?:tsx?|jsx?|cs|py|go|rs|java|rb|php|sh)\b/i;
const API_PATH_PATTERN = /(?:\/api\/|\/rest\/)[\w/\-{}.:?=&%]*/;
const PASCAL_CASE_PATTERN = /^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/;

const VALIDATION_KEYWORDS =
  /\b(validation|validator|required field|validate)\b/i;

// ── Helpers ───────────────────────────────────────────────────────────────────

function dedup(hints: RepoInspectionHint[]): RepoInspectionHint[] {
  const seen = new Set<string>();
  const result: RepoInspectionHint[] = [];
  for (const hint of hints) {
    const key = hint.instruction.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(hint);
    }
  }
  return result;
}

function isFilename(signal: string): boolean {
  return FILE_EXTENSION_PATTERN.test(signal);
}

function isApiPath(signal: string): boolean {
  return API_PATH_PATTERN.test(signal);
}

function isPascalCase(signal: string): boolean {
  return PASCAL_CASE_PATTERN.test(signal);
}

function extractFilename(signal: string): string {
  // Return just the basename portion if it contains path separators
  const parts = signal.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] ?? signal;
}

function extractKeyPhrase(summary: string): string {
  // Take first 60 chars, trimmed, to avoid overly long hints
  const cleaned = summary.trim().replace(/\s+/g, ' ');
  return cleaned.length > 60 ? cleaned.slice(0, 57) + '...' : cleaned;
}

// ── Main function ─────────────────────────────────────────────────────────────

export function generateRepoInspectionHints(params: {
  technicalSignals: string[];
  components: string[];
  labels: string[];
  userRoles: string[];
  linkedIssueSummaries: string[];
  mainDescription: string;
  summary: string;
}): RepoInspectionResult {
  const {
    technicalSignals,
    components,
    linkedIssueSummaries,
    mainDescription,
  } = params;

  const hints: RepoInspectionHint[] = [];

  // ── File hints ────────────────────────────────────────────────────────────
  for (const signal of technicalSignals) {
    if (isFilename(signal)) {
      const filename = extractFilename(signal);
      hints.push({
        category: 'file',
        instruction: `Look for existing file: ${filename} or files with similar names.`,
      });
    }
  }

  // ── API hints ─────────────────────────────────────────────────────────────
  for (const signal of technicalSignals) {
    if (isApiPath(signal)) {
      hints.push({
        category: 'api',
        instruction: `Find the API route/controller for: ${signal}`,
      });
    }
  }

  // ── Component hints — from Jira components ────────────────────────────────
  for (const component of components) {
    const trimmed = component.trim();
    if (trimmed) {
      hints.push({
        category: 'component',
        instruction: `Search for existing ${trimmed} component or module before creating new ones.`,
      });
    }
  }

  // ── Component hints — from PascalCase technical signals ───────────────────
  for (const signal of technicalSignals) {
    if (!isFilename(signal) && !isApiPath(signal) && isPascalCase(signal)) {
      hints.push({
        category: 'component',
        instruction: `Search for existing ${signal} component or module before creating new ones.`,
      });
    }
  }

  // ── Validation hints ──────────────────────────────────────────────────────
  if (VALIDATION_KEYWORDS.test(mainDescription)) {
    hints.push({
      category: 'validation',
      instruction:
        'Find existing validation utilities or form validators before adding new validation logic.',
    });
  }

  // ── Test hints ────────────────────────────────────────────────────────────
  // Gather names from components and file hints to build test hint subject
  const specificHintsSoFar = hints.filter(
    (h) => h.category !== 'general',
  );
  if (specificHintsSoFar.length > 0) {
    const firstComponent = components[0]?.trim();
    const firstFilenameSignal = technicalSignals.find(isFilename);
    const firstPascalSignal = technicalSignals.find(
      (s) => !isFilename(s) && !isApiPath(s) && isPascalCase(s),
    );
    const testSubject =
      firstComponent ??
      (firstFilenameSignal ? extractFilename(firstFilenameSignal) : undefined) ??
      firstPascalSignal ??
      'the relevant module';

    hints.push({
      category: 'test',
      instruction: `Run and review existing tests related to ${testSubject}.`,
    });
  }

  // ── Linked issue hints ────────────────────────────────────────────────────
  for (const summary of linkedIssueSummaries) {
    const keyPhrase = extractKeyPhrase(summary);
    if (keyPhrase) {
      hints.push({
        category: 'component',
        instruction: `Related issue mentions '${keyPhrase}' — check if existing implementation exists.`,
      });
    }
  }

  // ── General hints (always) ────────────────────────────────────────────────
  hints.push({
    category: 'general',
    instruction: 'Inspect the overall project structure and conventions before making changes.',
  });
  hints.push({
    category: 'general',
    instruction: 'Follow existing code patterns and naming conventions found in the repository.',
  });

  // ── Deduplicate and cap ───────────────────────────────────────────────────
  const deduplicated = dedup(hints);
  const capped = deduplicated.slice(0, MAX_HINTS);

  const hasSpecificHints = capped.some((h) => h.category !== 'general');

  return { hints: capped, hasSpecificHints };
}

// ── Format function ───────────────────────────────────────────────────────────

export function formatRepoInspectionSection(result: RepoInspectionResult): string {
  const lines: string[] = [
    '## Suggested Repo Inspection Targets',
    '',
    'Before making changes, Claude Code should:',
  ];

  for (const hint of result.hints) {
    lines.push(`- ${hint.instruction}`);
  }

  return lines.join('\n');
}
