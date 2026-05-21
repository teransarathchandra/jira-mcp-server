import type { RequirementSignals } from './requirementExtractor.js';
import type { ChangedFile } from '../git/gitDiffService.js';
import type { ClassifiedFiles } from './changedFileClassifier.js';
import type { RepoInspectionHint } from './repoInspectionHintGenerator.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export type RequirementCoverageStatus = 'covered' | 'partial' | 'missing' | 'not_enough_evidence';

export interface RequirementCoverageItem {
  criterion: string;      // the AC or requirement text
  evidence: string[];     // file paths or diff snippets that support it
  status: RequirementCoverageStatus;
}

export type TestCoverageSignal =
  | 'tests_added'
  | 'tests_modified'
  | 'no_test_changes'
  | 'only_snapshots_changed'
  | 'tests_in_unrelated_areas';

export interface UnrelatedChange {
  path: string;
  reason: string;
}

export interface MatchInput {
  requirementSignals: RequirementSignals;
  repoInspectionHints: RepoInspectionHint[];
  classifiedFiles: ClassifiedFiles;
  diffText: string;
  issueKey: string;       // e.g. "CMPI-1234"
  issueSummary: string;   // e.g. "Add payment validation"
}

export interface MatchResult {
  coverageItems: RequirementCoverageItem[];
  matchedEvidence: string[];        // list of files/diff areas matched to Jira requirement
  missingSignals: string[];         // Jira signals not found in PR
  unrelatedChanges: UnrelatedChange[];
  riskyChangePaths: string[];       // paths from riskyFiles (for display)
  testCoverageSignal: TestCoverageSignal;
  hasBackendChanges: boolean;       // true if any backend files changed
  hasFrontendChanges: boolean;      // true if any frontend files changed
  technicalSignalMatchCount: number;
  technicalSignalTotalCount: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'that', 'with', 'from', 'this', 'should', 'must', 'will',
  'have', 'been', 'able', 'when', 'then', 'given', 'also', 'into',
  'over', 'some', 'such', 'each', 'than', 'they', 'them', 'their',
  'there', 'were', 'what', 'which', 'your', 'more', 'about', 'after',
  'being', 'before', 'other', 'would', 'could', 'does', 'here', 'only',
]);

// ── Exported helper functions ──────────────────────────────────────────────────

/**
 * Extract key terms from a text string.
 * Returns words longer than 4 characters that are not stop words, lowercased.
 */
export function extractKeyTerms(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const seen = new Set<string>();
  const result: string[] = [];

  for (const word of words) {
    if (word.length > 4 && !STOP_WORDS.has(word) && !seen.has(word)) {
      seen.add(word);
      result.push(word);
    }
  }

  return result.slice(0, 10); // cap at 10 per AC item
}

/**
 * Check if a file path is related to a set of key terms (case-insensitive).
 */
export function isFileRelatedToTerms(filePath: string, terms: string[]): boolean {
  const lower = filePath.toLowerCase();
  return terms.some(term => lower.includes(term.toLowerCase()));
}

/**
 * Determine test coverage signal from classified files and requirement signals.
 */
export function determineTestCoverageSignal(
  testFiles: ChangedFile[],
  requirementSignals: RequirementSignals,
): TestCoverageSignal {
  if (testFiles.length === 0) {
    return 'no_test_changes';
  }

  // Check if all test files are snapshots
  const allSnapshots = testFiles.every(
    f => f.path.endsWith('.snap') || f.path.endsWith('.snapshot'),
  );
  if (allSnapshots) {
    return 'only_snapshots_changed';
  }

  // Gather all terms from requirement signals for relevance check.
  // For technical signals that look like filenames (e.g. "paymentService.ts"),
  // also include the stem without the extension so that test files like
  // "paymentService.test.ts" are recognized as related.
  const acTerms = requirementSignals.acceptanceCriteria.flatMap(ac => extractKeyTerms(ac));
  const techTermsLower = requirementSignals.technicalSignals.map(s => s.toLowerCase());
  const techTermsStems = techTermsLower.map(s => {
    const dotIdx = s.lastIndexOf('.');
    return dotIdx > 0 ? s.slice(0, dotIdx) : s;
  });
  const allRelevantTerms = [...new Set([...acTerms, ...techTermsLower, ...techTermsStems])];

  // Check if any test file is related to requirement terms
  const anyRelated = allRelevantTerms.length === 0
    ? true // no signals to compare against — assume related
    : testFiles.some(f => isFileRelatedToTerms(f.path, allRelevantTerms));

  if (!anyRelated) {
    return 'tests_in_unrelated_areas';
  }

  // Differentiate added vs modified
  const hasAdded = testFiles.some(f => f.status === 'added');
  return hasAdded ? 'tests_added' : 'tests_modified';
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/** Check if a signal (normalized to lowercase) appears in any changed file path. */
function signalMatchesFiles(signal: string, files: ChangedFile[]): string[] {
  const lower = signal.toLowerCase();
  return files
    .filter(f => f.path.toLowerCase().includes(lower))
    .map(f => f.path);
}

/** Collect all changed files (flattened across all categories). */
function allChangedFiles(classifiedFiles: ClassifiedFiles): ChangedFile[] {
  const seen = new Set<string>();
  const result: ChangedFile[] = [];

  const buckets: ChangedFile[][] = [
    classifiedFiles.testFiles,
    classifiedFiles.configFiles,
    classifiedFiles.migrationFiles,
    classifiedFiles.lockFiles,
    classifiedFiles.generatedFiles,
    classifiedFiles.documentationFiles,
    classifiedFiles.sourceFiles,
    classifiedFiles.backendFiles,
    classifiedFiles.frontendFiles,
  ];

  for (const bucket of buckets) {
    for (const file of bucket) {
      if (!seen.has(file.path)) {
        seen.add(file.path);
        result.push(file);
      }
    }
  }

  return result;
}

/** Check if a file qualifies as "noise" (config/doc/lock/generated). */
function isNoisyFile(
  file: ChangedFile,
  classifiedFiles: ClassifiedFiles,
): boolean {
  return (
    classifiedFiles.configFiles.some(f => f.path === file.path) ||
    classifiedFiles.documentationFiles.some(f => f.path === file.path) ||
    classifiedFiles.lockFiles.some(f => f.path === file.path) ||
    classifiedFiles.generatedFiles.some(f => f.path === file.path)
  );
}

/** Check if a file is a test file. */
function isTestFileInClassified(
  file: ChangedFile,
  classifiedFiles: ClassifiedFiles,
): boolean {
  return classifiedFiles.testFiles.some(f => f.path === file.path);
}

// ── Main function ──────────────────────────────────────────────────────────────

/**
 * Match Jira requirement signals against a PR's changed files and diff text.
 * Pure, deterministic — no I/O side-effects.
 */
export function matchRequirementsToChanges(input: MatchInput): MatchResult {
  const { requirementSignals, classifiedFiles, diffText } = input;

  const allFiles = allChangedFiles(classifiedFiles);
  const allPathsCombined = allFiles.map(f => f.path).join(' ');
  const diffLower = diffText.toLowerCase();
  const hasEnoughContext = diffText.trim().length > 0 || allFiles.length > 0;

  // ── Step 1: Technical signal matching ─────────────────────────────────────

  const technicalSignalTotalCount = requirementSignals.technicalSignals.length;
  const matchedEvidence: string[] = [];
  const missingSignals: string[] = [];
  let technicalSignalMatchCount = 0;

  const matchedSignalTerms = new Set<string>(); // lowercase matched signals

  for (const signal of requirementSignals.technicalSignals) {
    const lower = signal.toLowerCase();
    const fileMatches = signalMatchesFiles(lower, allFiles);
    const inDiff = diffLower.includes(lower);

    if (fileMatches.length > 0 || inDiff) {
      technicalSignalMatchCount++;
      matchedSignalTerms.add(lower);
      for (const path of fileMatches) {
        if (!matchedEvidence.includes(path)) {
          matchedEvidence.push(path);
        }
      }
    } else {
      if (!hasEnoughContext) {
        // not enough evidence to say it's missing
      } else {
        missingSignals.push(signal);
      }
    }
  }

  // ── Step 2: Acceptance criteria coverage ──────────────────────────────────

  // Build all AC key terms once (for use in unrelated-detection too)
  const acKeyTermsPerCriterion: string[][] = requirementSignals.acceptanceCriteria.map(
    ac => extractKeyTerms(ac),
  );
  const allAcTerms = [...new Set(acKeyTermsPerCriterion.flat())];

  const coverageItems: RequirementCoverageItem[] = [];

  for (let i = 0; i < requirementSignals.acceptanceCriteria.length; i++) {
    const criterion = requirementSignals.acceptanceCriteria[i];
    const keyTerms = acKeyTermsPerCriterion[i];

    const evidenceFiles: string[] = [];
    let termMatchCount = 0;

    for (const term of keyTerms) {
      const termLower = term.toLowerCase();
      const inPaths = allPathsCombined.toLowerCase().includes(termLower);
      const inDiff = diffLower.includes(termLower);

      if (inPaths || inDiff) {
        termMatchCount++;
        // collect file paths that contain this term
        for (const file of allFiles) {
          if (file.path.toLowerCase().includes(termLower)) {
            if (!evidenceFiles.includes(file.path)) {
              evidenceFiles.push(file.path);
            }
          }
        }
      }
    }

    let status: RequirementCoverageStatus;
    if (termMatchCount >= 2) {
      status = 'covered';
    } else if (termMatchCount === 1) {
      status = 'partial';
    } else if (!hasEnoughContext) {
      status = 'not_enough_evidence';
    } else if (allFiles.length > 0) {
      // files exist but none match — missing
      status = 'missing';
    } else {
      status = 'not_enough_evidence';
    }

    coverageItems.push({ criterion, evidence: evidenceFiles, status });
  }

  // If there are no AC items at all, there's nothing to cover
  // (handled implicitly by empty coverageItems)

  // ── Step 3: Unrelated change detection ────────────────────────────────────

  const unrelatedChanges: UnrelatedChange[] = [];

  if (technicalSignalTotalCount > 0) {
    // Gather all non-unrelated files first to check if "all changes" appear unrelated
    const candidateUnrelated: ChangedFile[] = [];

    for (const file of allFiles) {
      // Skip test files, noisy files
      if (isTestFileInClassified(file, classifiedFiles)) continue;
      if (isNoisyFile(file, classifiedFiles)) continue;

      const lower = file.path.toLowerCase();

      // Check technical signals
      const matchesTechnical = requirementSignals.technicalSignals.some(
        s => lower.includes(s.toLowerCase()),
      );

      // Check AC key terms
      const matchesAcTerms = allAcTerms.some(term => lower.includes(term.toLowerCase()));

      if (!matchesTechnical && !matchesAcTerms) {
        candidateUnrelated.push(file);
      }
    }

    // Only flag as unrelated if not ALL non-noisy, non-test files are unrelated
    const totalNonNoisy = allFiles.filter(
      f => !isNoisyFile(f, classifiedFiles) && !isTestFileInClassified(f, classifiedFiles),
    ).length;

    const shouldFlag = totalNonNoisy > 0 && candidateUnrelated.length < totalNonNoisy;

    for (const file of candidateUnrelated) {
      const reason = requirementSignals.technicalSignals.length > 0
        ? 'No Jira technical signals match this path'
        : 'File appears unrelated to the Jira task requirement';
      unrelatedChanges.push({ path: file.path, reason });

      if (!shouldFlag) {
        // Reset if we shouldn't flag any
        unrelatedChanges.length = 0;
        break;
      }
    }
  }

  // ── Step 4: Test coverage signal ──────────────────────────────────────────

  const testCoverageSignal = determineTestCoverageSignal(
    classifiedFiles.testFiles,
    requirementSignals,
  );

  // ── Step 5: Risky changes ─────────────────────────────────────────────────

  const riskyChangePaths = classifiedFiles.riskyFiles.map(r => r.file.path);

  // ── Assemble result ────────────────────────────────────────────────────────

  return {
    coverageItems,
    matchedEvidence,
    missingSignals,
    unrelatedChanges,
    riskyChangePaths,
    testCoverageSignal,
    hasBackendChanges: classifiedFiles.backendFiles.length > 0,
    hasFrontendChanges: classifiedFiles.frontendFiles.length > 0,
    technicalSignalMatchCount,
    technicalSignalTotalCount,
  };
}
