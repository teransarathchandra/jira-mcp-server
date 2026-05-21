import type { AlignmentResult, AlignmentStatus } from './alignmentScorer.js';
import type { MatchResult, RequirementCoverageItem, TestCoverageSignal } from './prRequirementMatcher.js';
import type { DiffResult } from '../git/gitDiffService.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PrReviewInput {
  issueKey: string;
  issueSummary: string;
  issueDescription: string;       // first 400 chars of Jira description
  acceptanceCriteria: string[];   // from requirementExtractor
  jiraConflicts: string[];        // from conflictDetector (formatted strings)
  jiraAmbiguities: string[];      // from requirementExtractor
  diffResult: DiffResult;
  matchResult: MatchResult;
  alignmentResult: AlignmentResult;
}

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_EMOJI: Record<AlignmentStatus, string> = {
  STRONGLY_ALIGNED: '✅',
  MOSTLY_ALIGNED: '🟡',
  PARTIALLY_ALIGNED: '🟠',
  WEAKLY_ALIGNED: '🔴',
  NOT_ENOUGH_EVIDENCE: '❓',
};

const STATUS_RECOMMENDATION: Record<AlignmentStatus, string> = {
  STRONGLY_ALIGNED: 'Looks aligned; proceed with normal review.',
  MOSTLY_ALIGNED: 'Mostly aligned; address minor gaps before merging.',
  PARTIALLY_ALIGNED: 'Partially aligned; changes needed before merge.',
  WEAKLY_ALIGNED: 'Weakly aligned; this PR likely does not satisfy the Jira requirement.',
  NOT_ENOUGH_EVIDENCE: 'Not enough evidence; manual review required.',
};

const COVERAGE_STATUS_LABEL: Record<RequirementCoverageItem['status'], string> = {
  covered: 'Covered',
  partial: 'Partial',
  missing: 'Missing',
  not_enough_evidence: 'Not enough evidence',
};

// ── Helper: escape markdown table cells ───────────────────────────────────────

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

// ── Exported helper functions ──────────────────────────────────────────────────

/**
 * Format the verdict line with status emoji.
 */
export function formatVerdict(result: AlignmentResult): string {
  const emoji = STATUS_EMOJI[result.status];
  return `${emoji} ${result.status}`;
}

/**
 * Format the requirements coverage table as a markdown string.
 */
export function formatCoverageTable(coverageItems: RequirementCoverageItem[]): string {
  if (coverageItems.length === 0) {
    return 'No explicit acceptance criteria found in Jira.';
  }

  const header = '| Jira Requirement / Acceptance Criteria | Evidence in PR | Status |';
  const separator = '|---|---|---|';

  const rows = coverageItems.map(item => {
    const criterion = escapeTableCell(item.criterion);
    const evidence = item.evidence.length > 0
      ? escapeTableCell(item.evidence.join(', '))
      : 'No matching changes found';
    const status = COVERAGE_STATUS_LABEL[item.status];
    return `| ${criterion} | ${evidence} | ${status} |`;
  });

  return [header, separator, ...rows].join('\n');
}

/**
 * Format test review section based on test coverage signal.
 */
export function formatTestReview(signal: TestCoverageSignal): string {
  switch (signal) {
    case 'tests_added':
      return 'Tests added: This PR includes new test files. Good.';
    case 'tests_modified':
      return 'Tests modified: Existing tests were updated.';
    case 'no_test_changes':
      return 'No test changes detected. If this task changes behavior, consider adding tests.';
    case 'tests_in_unrelated_areas':
      return 'Tests changed in unrelated areas. The test changes may not cover this Jira task\'s behavior.';
    case 'only_snapshots_changed':
      return 'Only snapshot tests changed. Behavioral test coverage may be insufficient.';
    default: {
      const _exhaustive: never = signal;
      void _exhaustive;
      return 'No test changes detected. If this task changes behavior, consider adding tests.';
    }
  }
}

/**
 * Generate up to 5 practical review comments based on input data.
 */
export function generateReviewComments(input: PrReviewInput): string[] {
  const { matchResult, diffResult, alignmentResult } = input;
  const comments: string[] = [];

  // 1. Backend requirement but only frontend changes
  const hasBackendPenalty = alignmentResult.penalties.includes(
    'Jira requires backend changes but no backend files changed',
  );
  if (hasBackendPenalty) {
    comments.push(
      'The Jira task mentions backend validation, but this PR appears to only update the frontend. ' +
      'Please confirm whether backend validation already exists or add coverage.',
    );
  }

  // 2. No test changes
  if (matchResult.testCoverageSignal === 'no_test_changes') {
    const descSnippet = input.issueSummary || 'behavior';
    comments.push(
      `No test files were changed. Since this task changes ${descSnippet}, please add or update tests.`,
    );
  }

  // 3. Risky files
  if (matchResult.riskyChangePaths.length > 0) {
    for (const riskyPath of matchResult.riskyChangePaths.slice(0, 2)) {
      if (comments.length >= 5) break;
      comments.push(
        `The PR modifies ${riskyPath}, which is a risky change. Please ensure proper review.`,
      );
    }
  }

  // 4. Unrelated changes
  if (matchResult.unrelatedChanges.length > 0) {
    const unrelatedFiles = matchResult.unrelatedChanges.map(u => u.path).join(', ');
    if (comments.length < 5) {
      comments.push(
        `These changes appear unrelated to the Jira task: ${unrelatedFiles}. Please explain if needed.`,
      );
    }
  }

  // 5. Missing requirements
  const missingItems = matchResult.coverageItems
    .filter(item => item.status === 'missing')
    .map(item => item.criterion);
  if (missingItems.length > 0 && comments.length < 5) {
    comments.push(
      `The following Jira requirements have no matching evidence in this PR: ${missingItems.join('; ')}.`,
    );
  }

  // Suppress diffResult-unused warning
  void diffResult;

  return comments.slice(0, 5);
}

// ── Main formatting function ───────────────────────────────────────────────────

/**
 * Format a complete PR alignment review as a Markdown string.
 * Pure — no I/O side-effects.
 */
export function formatPrAlignmentReview(input: PrReviewInput): string {
  const {
    issueKey,
    issueSummary,
    issueDescription,
    acceptanceCriteria,
    jiraConflicts,
    jiraAmbiguities,
    diffResult,
    matchResult,
    alignmentResult,
  } = input;

  const { scoreBreakdown } = alignmentResult;

  // ── Section: Header ──────────────────────────────────────────────────────────
  const header = `# PR Alignment Review: ${issueKey}`;

  // ── Section: Verdict ─────────────────────────────────────────────────────────
  const verdictSection = [
    '## Verdict',
    `- **Status:** ${formatVerdict(alignmentResult)}`,
    `- **Score:** ${alignmentResult.score}/100`,
    `- **Confidence:** ${alignmentResult.confidence}`,
  ].join('\n');

  // ── Section: Jira Requirement Summary ────────────────────────────────────────
  const descText = issueDescription.trim() || 'No description available.';
  const jiraSectionLines: string[] = [
    '## Jira Requirement Summary',
    issueSummary,
    '',
    descText,
  ];
  if (acceptanceCriteria.length > 0) {
    jiraSectionLines.push('');
    jiraSectionLines.push('**Acceptance Criteria:**');
    for (const criterion of acceptanceCriteria) {
      jiraSectionLines.push(`- ${criterion}`);
    }
  }
  const jiraSection = jiraSectionLines.join('\n');

  // ── Section: PR Summary ──────────────────────────────────────────────────────
  const changedFiles = diffResult.changedFiles;
  const addedCount = changedFiles.filter(f => f.status === 'added').length;
  const modifiedCount = changedFiles.filter(f => f.status === 'modified').length;
  const deletedCount = changedFiles.filter(f => f.status === 'deleted').length;
  const renamedCount = changedFiles.filter(f => f.status === 'renamed').length;

  // Test files: paths containing test/spec indicators
  const testFileCount = changedFiles.filter(f =>
    /[./](test|spec)\b|__tests__|\.(test|spec)\.(ts|tsx|js|jsx)$/.test(f.path)
  ).length;
  const riskyFileCount = matchResult.riskyChangePaths.length;

  const prSummaryLines = [
    '## PR Summary',
    `- **Base branch:** ${diffResult.baseBranch}`,
    `- **Compare ref:** ${diffResult.compareRef}`,
    `- **Current branch:** ${diffResult.currentBranch}`,
    `- **Changed files:** ${changedFiles.length}`,
    `  - Added: ${addedCount}`,
    `  - Modified: ${modifiedCount}`,
    `  - Deleted: ${deletedCount}`,
    `  - Renamed: ${renamedCount}`,
    `- **Test files changed:** ${testFileCount}`,
    `- **Risky files changed:** ${riskyFileCount}`,
  ];

  const totalKnown = addedCount + modifiedCount + deletedCount + renamedCount;
  if (totalKnown !== changedFiles.length) {
    prSummaryLines.push(`  - Other: ${changedFiles.length - totalKnown}`);
  }

  if (diffResult.truncated) {
    prSummaryLines.push(
      `- ⚠️ Diff was truncated (original: ${diffResult.originalDiffLength} chars). Alignment confidence is reduced.`,
    );
  }

  const prSummarySection = prSummaryLines.join('\n');

  // ── Section: Requirement Coverage ────────────────────────────────────────────
  const coverageSection = [
    '## Requirement Coverage',
    '',
    formatCoverageTable(matchResult.coverageItems),
  ].join('\n');

  // ── Section: Matched Implementation Evidence ──────────────────────────────────
  let matchedEvidenceContent: string;
  if (matchResult.matchedEvidence.length > 0) {
    matchedEvidenceContent = matchResult.matchedEvidence.map(e => `- ${e}`).join('\n');
  } else {
    matchedEvidenceContent = 'No matched implementation evidence found.';
  }
  const matchedEvidenceSection = `## Matched Implementation Evidence\n${matchedEvidenceContent}`;

  // ── Section: Missing or Weak Evidence ────────────────────────────────────────
  const missingCoverageItems = matchResult.coverageItems.filter(
    item => item.status === 'missing' || item.status === 'partial',
  );
  const hasMissingEvidence =
    matchResult.missingSignals.length > 0 || missingCoverageItems.length > 0;

  let missingContent: string;
  if (hasMissingEvidence) {
    const lines: string[] = [];
    for (const signal of matchResult.missingSignals) {
      lines.push(`- ${signal}`);
    }
    for (const item of missingCoverageItems) {
      lines.push(`- ${item.criterion} (${COVERAGE_STATUS_LABEL[item.status]})`);
    }
    missingContent = lines.join('\n');
  } else {
    missingContent = 'No missing evidence detected.';
  }
  const missingSection = `## Missing or Weak Evidence\n${missingContent}`;

  // ── Section: Unrelated or Suspicious Changes ──────────────────────────────────
  let unrelatedContent: string;
  if (matchResult.unrelatedChanges.length > 0) {
    const tableHeader = '| File | Reason |';
    const tableSep = '|---|---|';
    const tableRows = matchResult.unrelatedChanges.map(
      u => `| ${escapeTableCell(u.path)} | ${escapeTableCell(u.reason)} |`,
    );
    unrelatedContent = [tableHeader, tableSep, ...tableRows].join('\n');
  } else {
    unrelatedContent = 'No unrelated changes detected.';
  }
  const unrelatedSection = `## Unrelated or Suspicious Changes\n${unrelatedContent}`;

  // ── Section: Risky Changes ────────────────────────────────────────────────────
  let riskyContent: string;
  if (matchResult.riskyChangePaths.length > 0) {
    riskyContent = matchResult.riskyChangePaths.map(p => `- ${p}`).join('\n');
  } else {
    riskyContent = 'No risky changes detected.';
  }
  const riskySection = `## Risky Changes\n${riskyContent}`;

  // ── Section: Test Review ─────────────────────────────────────────────────────
  const testReviewSection = `## Test Review\n${formatTestReview(matchResult.testCoverageSignal)}`;

  // ── Section: Requirement Conflicts / Ambiguity ────────────────────────────────
  const hasConflictsOrAmbiguities = jiraConflicts.length > 0 || jiraAmbiguities.length > 0;
  let conflictsContent: string;
  if (hasConflictsOrAmbiguities) {
    const lines: string[] = [];
    for (const conflict of jiraConflicts) {
      lines.push(`- ${conflict}`);
    }
    for (const ambiguity of jiraAmbiguities) {
      lines.push(`- ${ambiguity}`);
    }
    conflictsContent = lines.join('\n');
  } else {
    conflictsContent = 'No conflicts or ambiguities detected.';
  }
  const conflictsSection = `## Requirement Conflicts / Ambiguity\n${conflictsContent}`;

  // ── Section: Score Breakdown ──────────────────────────────────────────────────
  const scoreBreakdownSection = [
    '## Score Breakdown',
    `- Acceptance criteria coverage: ${scoreBreakdown.acCoverageScore}/40`,
    `- Technical signal match: ${scoreBreakdown.technicalSignalScore}/20`,
    `- Relevant files: ${scoreBreakdown.relevantFilesScore}/15`,
    `- Test coverage: ${scoreBreakdown.testCoverageScore}/15`,
    `- Low noise: ${scoreBreakdown.noiseScore}/10`,
    `- Cross-cutting penalties: -${scoreBreakdown.crossCuttingPenalty}`,
  ].join('\n');

  // ── Section: Review Comments ──────────────────────────────────────────────────
  const comments = generateReviewComments(input);
  let reviewCommentsContent: string;
  if (comments.length > 0) {
    reviewCommentsContent = comments.map(c => `- ${c}`).join('\n');
  } else {
    reviewCommentsContent = 'No specific review comments generated.';
  }
  const reviewCommentsSection = `## Review Comments to Consider\n${reviewCommentsContent}`;

  // ── Section: Final Recommendation ────────────────────────────────────────────
  const recommendation = STATUS_RECOMMENDATION[alignmentResult.status];
  const finalRecommendationSection = `## Final Recommendation\n${recommendation}`;

  // ── Assemble ─────────────────────────────────────────────────────────────────
  return [
    header,
    verdictSection,
    jiraSection,
    prSummarySection,
    coverageSection,
    matchedEvidenceSection,
    missingSection,
    unrelatedSection,
    riskySection,
    testReviewSection,
    conflictsSection,
    scoreBreakdownSection,
    reviewCommentsSection,
    finalRecommendationSection,
  ].join('\n\n');
}
