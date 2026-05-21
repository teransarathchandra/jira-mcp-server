// ── Delivery Intelligence Layer — Traceability Matrix ─────────────────────────
// Maps each confirmed Jira requirement/acceptance criterion to implementation
// evidence from a PR diff. Pure deterministic logic — no I/O, no LLM calls.

import type {
  TraceabilityItem,
  TraceabilityMatrix,
  CoverageStatus,
  ConfidenceLevel,
} from './deliveryTypes.js';
import type { RequirementSignals } from '../utils/requirementExtractor.js';
import type { ClassifiedFiles } from '../utils/changedFileClassifier.js';

// ── Public input type ─────────────────────────────────────────────────────────

export interface TraceabilityMatrixInput {
  issueKey: string;
  issueSummary: string;
  requirementSignals: RequirementSignals;
  confluenceSignals?: RequirementSignals | null;
  classifiedFiles: ClassifiedFiles;
  diffText: string;
  diffTruncated: boolean;
  changedFilePaths: string[];
}

// ── Stop words ────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'that', 'this', 'with', 'when', 'from', 'have', 'will', 'should', 'must',
  'then', 'been', 'they', 'also', 'more', 'than', 'into', 'were', 'each',
  'which',
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract meaningful keywords from a text string.
 * - Split into word tokens
 * - Filter to words >= 4 chars
 * - Filter out stop words
 * - Lowercase and deduplicate
 * - Return up to 15 keywords
 */
export function extractKeywords(text: string): string[] {
  const words = text.split(/\W+/).filter(Boolean);
  const seen = new Set<string>();
  const result: string[] = [];

  for (const word of words) {
    const lower = word.toLowerCase();
    if (lower.length < 4) continue;
    if (STOP_WORDS.has(lower)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    result.push(lower);
    if (result.length >= 15) break;
  }

  return result;
}

/** Returns the lowercase basename from a path. */
function basename(filePath: string): string {
  return filePath.split('/').pop()?.toLowerCase() ?? filePath.toLowerCase();
}

/** Returns true if the file path looks like a test file. */
function isTestFilePath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return (
    lower.includes('.test.') ||
    lower.includes('.spec.') ||
    lower.includes('__tests__') ||
    lower.includes('/tests/') ||
    lower.includes('/test/')
  );
}

/**
 * Find changed file paths whose basename or full path contains any keyword
 * from the requirement text (case-insensitive word-token match, min 4 chars).
 */
function matchFiles(keywords: string[], changedFilePaths: string[]): string[] {
  if (keywords.length === 0) return [];
  return changedFilePaths.filter(fp => {
    const lowerFp = fp.toLowerCase();
    const lowerBasename = basename(fp);
    return keywords.some(kw => lowerFp.includes(kw) || lowerBasename.includes(kw));
  });
}

/**
 * Find diff lines starting with '+' that contain any keyword.
 * Returns up to 3 snippets, trimmed to max 120 chars each.
 */
function matchDiffEvidence(keywords: string[], diffText: string): string[] {
  if (!diffText || keywords.length === 0) return [];

  const lines = diffText.split('\n');
  const matches: string[] = [];

  for (const line of lines) {
    if (!line.startsWith('+')) continue;
    const lowerLine = line.toLowerCase();
    if (keywords.some(kw => lowerLine.includes(kw))) {
      const trimmed = line.trim().slice(0, 120);
      matches.push(trimmed);
      if (matches.length >= 3) break;
    }
  }

  return matches;
}

/**
 * Find test file paths that overlap with the AC keywords.
 */
function matchTests(keywords: string[], changedFilePaths: string[]): string[] {
  if (keywords.length === 0) return [];
  return changedFilePaths.filter(fp => {
    if (!isTestFilePath(fp)) return false;
    const lowerFp = fp.toLowerCase();
    const lowerBasename = basename(fp);
    return keywords.some(kw => lowerFp.includes(kw) || lowerBasename.includes(kw));
  });
}

/**
 * Extract a brief expected implementation area description from AC text.
 */
function extractImplementationArea(text: string): string {
  const lower = text.toLowerCase();

  // Check for known technical patterns
  const patterns: Array<[RegExp, string]> = [
    [/\.tsx?|\.jsx?/, 'TypeScript/JavaScript'],
    [/\.py/, 'Python'],
    [/\.go\b/, 'Go'],
    [/\/api\/|rest api|endpoint/, 'API layer'],
    [/database|migration|sql|schema/, 'Database'],
    [/component|ui|frontend|button|form|modal/, 'Frontend/UI'],
    [/service|repository|controller|handler/, 'Service layer'],
    [/auth|permission|role|access/, 'Auth/Permissions'],
    [/test|spec/, 'Tests'],
    [/config|environment|env/, 'Configuration'],
  ];

  const areas: string[] = [];
  for (const [pattern, area] of patterns) {
    if (pattern.test(lower) && !areas.includes(area)) {
      areas.push(area);
    }
  }

  return areas.length > 0 ? areas.join(', ') : 'General implementation';
}

/**
 * Compute coverage status from evidence.
 */
function computeCoverageStatus(
  matchedFiles: string[],
  matchedTests: string[],
  matchedDiffEvidence: string[],
  diffText: string,
  diffTruncated: boolean,
): CoverageStatus {
  // Not enough evidence when diff is empty/truncated and nothing found
  if ((diffText === '' || diffTruncated) && matchedFiles.length === 0 && matchedDiffEvidence.length === 0) {
    return 'NOT_ENOUGH_EVIDENCE';
  }

  if (matchedFiles.length >= 1 && matchedTests.length >= 1) return 'COVERED';
  if (matchedFiles.length >= 1 && matchedTests.length === 0) return 'PARTIALLY_COVERED';
  if (matchedFiles.length === 0 && matchedDiffEvidence.length === 0) return 'MISSING';

  // Has diff evidence but no matched files
  return 'PARTIALLY_COVERED';
}

/**
 * Compute confidence level.
 */
function computeConfidence(
  matchedFiles: string[],
  matchedDiffEvidence: string[],
  diffTruncated: boolean,
): ConfidenceLevel {
  if (matchedFiles.length === 0 && matchedDiffEvidence.length === 0) return 'Low';
  if (!diffTruncated && matchedFiles.length >= 1) return 'High';
  return 'Medium';
}

/**
 * Generate a brief note explaining coverage status.
 */
function generateNotes(
  status: CoverageStatus,
  matchedFiles: string[],
  matchedTests: string[],
  matchedDiffEvidence: string[],
  diffTruncated: boolean,
): string {
  switch (status) {
    case 'COVERED':
      return `Matched ${matchedFiles.length} file(s) and ${matchedTests.length} test file(s).`;
    case 'PARTIALLY_COVERED':
      if (matchedFiles.length > 0) {
        return `Matched ${matchedFiles.length} file(s) but no test files found.`;
      }
      return `Found ${matchedDiffEvidence.length} diff evidence snippet(s) but no matched files.`;
    case 'MISSING':
      return 'No matching files or diff evidence found for this requirement.';
    case 'NOT_ENOUGH_EVIDENCE':
      if (diffTruncated) {
        return 'Diff was truncated — unable to confirm coverage. Partial analysis only.';
      }
      return 'No diff available — unable to assess implementation coverage.';
    case 'NOT_APPLICABLE':
      return 'Requirement marked as not applicable.';
    default:
      return '';
  }
}

/**
 * Build a TraceabilityItem from a requirement text and collected evidence.
 */
function buildItem(
  requirementId: string,
  requirementText: string,
  source: TraceabilityItem['source'],
  sourceAuthority: TraceabilityItem['sourceAuthority'],
  changedFilePaths: string[],
  diffText: string,
  diffTruncated: boolean,
): TraceabilityItem {
  const keywords = extractKeywords(requirementText);

  const matchedFiles = matchFiles(keywords, changedFilePaths);
  const matchedDiffEvidence = matchedFiles.length > 0
    ? matchDiffEvidence(keywords, diffText)
    : matchDiffEvidence(keywords, diffText);
  const matchedTests = matchTests(keywords, changedFilePaths);
  const expectedImplementationArea = extractImplementationArea(requirementText);

  const coverageStatus = computeCoverageStatus(
    matchedFiles,
    matchedTests,
    matchedDiffEvidence,
    diffText,
    diffTruncated,
  );

  const confidence = computeConfidence(matchedFiles, matchedDiffEvidence, diffTruncated);
  const notes = generateNotes(coverageStatus, matchedFiles, matchedTests, matchedDiffEvidence, diffTruncated);

  return {
    requirementId,
    requirementText,
    source,
    sourceAuthority,
    expectedImplementationArea,
    matchedFiles,
    matchedDiffEvidence,
    matchedTests,
    coverageStatus,
    confidence,
    notes,
  };
}

/**
 * Check if two requirement texts have >70% word overlap (for deduplication).
 */
function isDuplicateRequirement(textA: string, textB: string): boolean {
  const wordsA = new Set(textA.toLowerCase().split(/\W+/).filter(w => w.length >= 3));
  const wordsB = new Set(textB.toLowerCase().split(/\W+/).filter(w => w.length >= 3));

  if (wordsA.size === 0 || wordsB.size === 0) return false;

  let overlap = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) overlap++;
  }

  const overlapRatio = overlap / Math.min(wordsA.size, wordsB.size);
  return overlapRatio > 0.7;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Build a traceability matrix mapping requirements to implementation evidence.
 * Pure function — no I/O, no side effects.
 */
export function buildTraceabilityMatrix(input: TraceabilityMatrixInput): TraceabilityMatrix {
  const {
    issueKey,
    issueSummary,
    requirementSignals,
    confluenceSignals,
    changedFilePaths,
    diffText,
    diffTruncated,
  } = input;

  const items: TraceabilityItem[] = [];

  // ── 1. Acceptance Criteria (source: acceptance_criteria, authority: high) ──

  for (let i = 0; i < requirementSignals.acceptanceCriteria.length; i++) {
    const ac = requirementSignals.acceptanceCriteria[i];
    items.push(
      buildItem(
        `AC-${i + 1}`,
        ac,
        'acceptance_criteria',
        'high',
        changedFilePaths,
        diffText,
        diffTruncated,
      ),
    );
  }

  // ── 2. Business Rules (source: business_rule, authority: medium) ──────────

  // Collect keywords from all ACs to detect overlap (skip BR if it duplicates an AC)
  const acTexts = requirementSignals.acceptanceCriteria;

  for (let i = 0; i < requirementSignals.businessRules.length; i++) {
    const br = requirementSignals.businessRules[i];

    // Skip if this BR heavily overlaps with any existing AC
    const isDuplicate = acTexts.some(acText => isDuplicateRequirement(br, acText));
    if (isDuplicate) continue;

    items.push(
      buildItem(
        `BR-${i + 1}`,
        br,
        'business_rule',
        'medium',
        changedFilePaths,
        diffText,
        diffTruncated,
      ),
    );
  }

  // ── 3. Confluence Signals (source: confluence, authority: medium) ─────────

  if (confluenceSignals) {
    const allExistingTexts = [
      ...requirementSignals.acceptanceCriteria,
      ...requirementSignals.businessRules,
    ];

    let confIndex = 0;
    for (const confAc of confluenceSignals.acceptanceCriteria) {
      // Skip if >70% word overlap with any existing Jira signal
      const isDuplicate = allExistingTexts.some(existing =>
        isDuplicateRequirement(confAc, existing),
      );
      if (isDuplicate) continue;

      items.push(
        buildItem(
          `CONF-${confIndex + 1}`,
          confAc,
          'confluence',
          'medium',
          changedFilePaths,
          diffText,
          diffTruncated,
        ),
      );
      confIndex++;
    }
  }

  // ── 4. Compute summary counts ─────────────────────────────────────────────

  const covered = items.filter(i => i.coverageStatus === 'COVERED').length;
  const partial = items.filter(i => i.coverageStatus === 'PARTIALLY_COVERED').length;
  const missing = items.filter(i => i.coverageStatus === 'MISSING').length;
  const notEnoughEvidence = items.filter(i => i.coverageStatus === 'NOT_ENOUGH_EVIDENCE').length;
  const notApplicable = items.filter(i => i.coverageStatus === 'NOT_APPLICABLE').length;

  return {
    issueKey,
    issueSummary,
    generatedAt: new Date().toISOString(),
    items,
    totalRequirements: items.length,
    covered,
    partial,
    missing,
    notEnoughEvidence,
    notApplicable,
  };
}
