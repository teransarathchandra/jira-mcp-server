import { describe, it, expect } from 'vitest';
import {
  formatVerdict,
  formatCoverageTable,
  formatTestReview,
  generateReviewComments,
  formatPrAlignmentReview,
} from '../src/utils/formatPrAlignmentReview.js';
import type { PrReviewInput } from '../src/utils/formatPrAlignmentReview.js';
import type { AlignmentResult } from '../src/utils/alignmentScorer.js';
import type { MatchResult, RequirementCoverageItem, TestCoverageSignal } from '../src/utils/prRequirementMatcher.js';
import type { DiffResult } from '../src/git/gitDiffService.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeAlignmentResult(overrides: Partial<AlignmentResult> = {}): AlignmentResult {
  return {
    status: 'MOSTLY_ALIGNED',
    score: 76,
    confidence: 'Medium',
    scoreBreakdown: {
      acCoverageScore: 30,
      technicalSignalScore: 14,
      relevantFilesScore: 15,
      testCoverageScore: 12,
      noiseScore: 8,
      crossCuttingPenalty: 3,
    },
    penalties: [],
    ...overrides,
  };
}

function makeMatchResult(overrides: Partial<MatchResult> = {}): MatchResult {
  return {
    coverageItems: [],
    matchedEvidence: [],
    missingSignals: [],
    unrelatedChanges: [],
    riskyChangePaths: [],
    testCoverageSignal: 'no_test_changes',
    hasBackendChanges: false,
    hasFrontendChanges: false,
    technicalSignalMatchCount: 0,
    technicalSignalTotalCount: 0,
    ...overrides,
  };
}

function makeDiffResult(overrides: Partial<DiffResult> = {}): DiffResult {
  return {
    changedFiles: [],
    diffText: '',
    diffStats: '',
    truncated: false,
    originalDiffLength: 0,
    warnings: [],
    currentBranch: 'feature/payment-validation',
    baseBranch: 'main',
    compareRef: 'HEAD',
    ...overrides,
  };
}

function makePrReviewInput(overrides: Partial<PrReviewInput> = {}): PrReviewInput {
  return {
    issueKey: 'CMPI-1234',
    issueSummary: 'Add payment validation',
    issueDescription: 'This ticket adds server-side validation for payment amounts.',
    acceptanceCriteria: [],
    jiraConflicts: [],
    jiraAmbiguities: [],
    diffResult: makeDiffResult(),
    matchResult: makeMatchResult(),
    alignmentResult: makeAlignmentResult(),
    ...overrides,
  };
}

// ── formatVerdict ──────────────────────────────────────────────────────────────

describe('formatVerdict', () => {
  it('returns STRONGLY_ALIGNED with checkmark emoji', () => {
    const result = makeAlignmentResult({ status: 'STRONGLY_ALIGNED', score: 90 });
    expect(formatVerdict(result)).toContain('STRONGLY_ALIGNED');
    expect(formatVerdict(result)).toContain('✅');
  });

  it('returns MOSTLY_ALIGNED with yellow circle emoji', () => {
    const result = makeAlignmentResult({ status: 'MOSTLY_ALIGNED', score: 70 });
    expect(formatVerdict(result)).toContain('MOSTLY_ALIGNED');
    expect(formatVerdict(result)).toContain('🟡');
  });

  it('returns PARTIALLY_ALIGNED with orange circle emoji', () => {
    const result = makeAlignmentResult({ status: 'PARTIALLY_ALIGNED', score: 50 });
    expect(formatVerdict(result)).toContain('PARTIALLY_ALIGNED');
    expect(formatVerdict(result)).toContain('🟠');
  });

  it('returns WEAKLY_ALIGNED with red circle emoji', () => {
    const result = makeAlignmentResult({ status: 'WEAKLY_ALIGNED', score: 30 });
    expect(formatVerdict(result)).toContain('WEAKLY_ALIGNED');
    expect(formatVerdict(result)).toContain('🔴');
  });

  it('returns NOT_ENOUGH_EVIDENCE with question mark emoji', () => {
    const result = makeAlignmentResult({ status: 'NOT_ENOUGH_EVIDENCE', score: 10 });
    expect(formatVerdict(result)).toContain('NOT_ENOUGH_EVIDENCE');
    expect(formatVerdict(result)).toContain('❓');
  });
});

// ── formatCoverageTable ────────────────────────────────────────────────────────

describe('formatCoverageTable', () => {
  it('returns fallback message when no coverage items', () => {
    const result = formatCoverageTable([]);
    expect(result).toContain('No explicit acceptance criteria found in Jira.');
  });

  it('returns a markdown table with header and separator', () => {
    const items: RequirementCoverageItem[] = [
      { criterion: 'User can login', evidence: ['src/auth/login.ts'], status: 'covered' },
    ];
    const result = formatCoverageTable(items);
    expect(result).toContain('| Jira Requirement / Acceptance Criteria |');
    expect(result).toContain('|---|---|---|');
  });

  it('shows Covered for covered items', () => {
    const items: RequirementCoverageItem[] = [
      { criterion: 'Validate email', evidence: ['src/validators.ts'], status: 'covered' },
    ];
    expect(formatCoverageTable(items)).toContain('Covered');
  });

  it('shows Partial for partial items', () => {
    const items: RequirementCoverageItem[] = [
      { criterion: 'Validate phone', evidence: [], status: 'partial' },
    ];
    expect(formatCoverageTable(items)).toContain('Partial');
  });

  it('shows Missing for missing items', () => {
    const items: RequirementCoverageItem[] = [
      { criterion: 'Token refresh', evidence: [], status: 'missing' },
    ];
    expect(formatCoverageTable(items)).toContain('Missing');
  });

  it('shows Not enough evidence for not_enough_evidence items', () => {
    const items: RequirementCoverageItem[] = [
      { criterion: 'Some criterion', evidence: [], status: 'not_enough_evidence' },
    ];
    expect(formatCoverageTable(items)).toContain('Not enough evidence');
  });

  it('shows "No matching changes found" when evidence is empty', () => {
    const items: RequirementCoverageItem[] = [
      { criterion: 'Validate payment', evidence: [], status: 'missing' },
    ];
    expect(formatCoverageTable(items)).toContain('No matching changes found');
  });

  it('shows evidence file list when evidence exists', () => {
    const items: RequirementCoverageItem[] = [
      { criterion: 'Login flow', evidence: ['src/auth/login.ts', 'src/auth/token.ts'], status: 'covered' },
    ];
    const result = formatCoverageTable(items);
    expect(result).toContain('src/auth/login.ts');
    expect(result).toContain('src/auth/token.ts');
  });
});

// ── formatTestReview ───────────────────────────────────────────────────────────

describe('formatTestReview', () => {
  it('returns correct message for tests_added', () => {
    const result = formatTestReview('tests_added');
    expect(result).toContain('Tests added');
    expect(result).toContain('Good');
  });

  it('returns correct message for tests_modified', () => {
    const result = formatTestReview('tests_modified');
    expect(result).toContain('Tests modified');
    expect(result).toContain('updated');
  });

  it('returns correct message for no_test_changes', () => {
    const result = formatTestReview('no_test_changes');
    expect(result).toContain('No test changes detected');
    expect(result).toContain('consider adding tests');
  });

  it('returns correct message for tests_in_unrelated_areas', () => {
    const result = formatTestReview('tests_in_unrelated_areas');
    expect(result).toContain('unrelated areas');
    expect(result).toContain('may not cover');
  });

  it('returns correct message for only_snapshots_changed', () => {
    const result = formatTestReview('only_snapshots_changed');
    expect(result).toContain('snapshot');
    expect(result).toContain('insufficient');
  });

  const allSignals: TestCoverageSignal[] = [
    'tests_added',
    'tests_modified',
    'no_test_changes',
    'tests_in_unrelated_areas',
    'only_snapshots_changed',
  ];

  for (const signal of allSignals) {
    it(`returns a non-empty string for signal: ${signal}`, () => {
      expect(formatTestReview(signal).length).toBeGreaterThan(0);
    });
  }
});

// ── generateReviewComments ─────────────────────────────────────────────────────

describe('generateReviewComments', () => {
  it('generates backend comment when backend penalty exists', () => {
    const input = makePrReviewInput({
      alignmentResult: makeAlignmentResult({
        penalties: ['Jira requires backend changes but no backend files changed'],
      }),
    });
    const comments = generateReviewComments(input);
    expect(comments.some(c => c.includes('backend'))).toBe(true);
  });

  it('generates test comment when no test changes', () => {
    const input = makePrReviewInput({
      matchResult: makeMatchResult({ testCoverageSignal: 'no_test_changes' }),
    });
    const comments = generateReviewComments(input);
    expect(comments.some(c => c.includes('test'))).toBe(true);
  });

  it('does not generate test comment when tests were added', () => {
    const input = makePrReviewInput({
      matchResult: makeMatchResult({ testCoverageSignal: 'tests_added' }),
    });
    const comments = generateReviewComments(input);
    // Should not have the "please add or update tests" comment
    expect(comments.some(c => c.includes('please add or update tests'))).toBe(false);
  });

  it('generates risky file comment when risky paths exist', () => {
    const input = makePrReviewInput({
      matchResult: makeMatchResult({
        riskyChangePaths: ['src/auth/jwt.ts'],
        testCoverageSignal: 'tests_added',
      }),
    });
    const comments = generateReviewComments(input);
    expect(comments.some(c => c.includes('src/auth/jwt.ts') && c.includes('risky'))).toBe(true);
  });

  it('generates unrelated changes comment when unrelated changes exist', () => {
    const input = makePrReviewInput({
      matchResult: makeMatchResult({
        unrelatedChanges: [{ path: 'src/utils/logger.ts', reason: 'No match' }],
        testCoverageSignal: 'tests_added',
      }),
    });
    const comments = generateReviewComments(input);
    expect(comments.some(c => c.includes('unrelated') && c.includes('src/utils/logger.ts'))).toBe(true);
  });

  it('generates missing requirements comment when items are missing', () => {
    const input = makePrReviewInput({
      matchResult: makeMatchResult({
        coverageItems: [
          { criterion: 'Validate amount', evidence: [], status: 'missing' },
        ],
        testCoverageSignal: 'tests_added',
      }),
    });
    const comments = generateReviewComments(input);
    expect(comments.some(c => c.includes('Validate amount'))).toBe(true);
  });

  it('returns at most 5 comments', () => {
    const input = makePrReviewInput({
      alignmentResult: makeAlignmentResult({
        penalties: ['Jira requires backend changes but no backend files changed'],
      }),
      matchResult: makeMatchResult({
        testCoverageSignal: 'no_test_changes',
        riskyChangePaths: ['src/auth.ts', 'src/payment.ts'],
        unrelatedChanges: [{ path: 'src/logger.ts', reason: 'No match' }],
        coverageItems: [
          { criterion: 'AC 1', evidence: [], status: 'missing' },
          { criterion: 'AC 2', evidence: [], status: 'missing' },
        ],
      }),
    });
    const comments = generateReviewComments(input);
    expect(comments.length).toBeLessThanOrEqual(5);
  });

  it('returns empty array when no issues detected', () => {
    const input = makePrReviewInput({
      alignmentResult: makeAlignmentResult({ penalties: [] }),
      matchResult: makeMatchResult({
        testCoverageSignal: 'tests_added',
        riskyChangePaths: [],
        unrelatedChanges: [],
        coverageItems: [
          { criterion: 'Some AC', evidence: ['src/feature.ts'], status: 'covered' },
        ],
      }),
    });
    const comments = generateReviewComments(input);
    expect(comments.length).toBe(0);
  });
});

// ── formatPrAlignmentReview (smoke tests) ─────────────────────────────────────

describe('formatPrAlignmentReview', () => {
  it('contains the issue key in the header', () => {
    const input = makePrReviewInput({ issueKey: 'CMPI-9999' });
    const output = formatPrAlignmentReview(input);
    expect(output).toContain('# PR Alignment Review: CMPI-9999');
  });

  it('contains all expected section headers', () => {
    const input = makePrReviewInput();
    const output = formatPrAlignmentReview(input);

    expect(output).toContain('## Verdict');
    expect(output).toContain('## Jira Requirement Summary');
    expect(output).toContain('## PR Summary');
    expect(output).toContain('## Requirement Coverage');
    expect(output).toContain('## Matched Implementation Evidence');
    expect(output).toContain('## Missing or Weak Evidence');
    expect(output).toContain('## Unrelated or Suspicious Changes');
    expect(output).toContain('## Risky Changes');
    expect(output).toContain('## Test Review');
    expect(output).toContain('## Requirement Conflicts / Ambiguity');
    expect(output).toContain('## Score Breakdown');
    expect(output).toContain('## Review Comments to Consider');
    expect(output).toContain('## Final Recommendation');
  });

  it('shows score and confidence in verdict section', () => {
    const input = makePrReviewInput({
      alignmentResult: makeAlignmentResult({ score: 76, confidence: 'Medium' }),
    });
    const output = formatPrAlignmentReview(input);
    expect(output).toContain('76/100');
    expect(output).toContain('Medium');
  });

  it('shows issue summary in jira section', () => {
    const input = makePrReviewInput({ issueSummary: 'Fix payment timeout bug' });
    const output = formatPrAlignmentReview(input);
    expect(output).toContain('Fix payment timeout bug');
  });

  it('shows "No description available." when issueDescription is empty', () => {
    const input = makePrReviewInput({ issueDescription: '' });
    const output = formatPrAlignmentReview(input);
    expect(output).toContain('No description available.');
  });

  it('shows acceptance criteria when provided', () => {
    const input = makePrReviewInput({
      acceptanceCriteria: ['User can submit the form', 'Validation error is shown'],
    });
    const output = formatPrAlignmentReview(input);
    expect(output).toContain('**Acceptance Criteria:**');
    expect(output).toContain('- User can submit the form');
    expect(output).toContain('- Validation error is shown');
  });

  it('does not show acceptance criteria section when empty', () => {
    const input = makePrReviewInput({ acceptanceCriteria: [] });
    const output = formatPrAlignmentReview(input);
    expect(output).not.toContain('**Acceptance Criteria:**');
  });

  it('shows truncation warning when diff is truncated', () => {
    const input = makePrReviewInput({
      diffResult: makeDiffResult({ truncated: true, originalDiffLength: 100_000 }),
    });
    const output = formatPrAlignmentReview(input);
    expect(output).toContain('- ⚠️ Diff was truncated');
    expect(output).toContain('100000');
  });

  it('does not show truncation warning when diff is not truncated', () => {
    const input = makePrReviewInput({
      diffResult: makeDiffResult({ truncated: false }),
    });
    const output = formatPrAlignmentReview(input);
    expect(output).not.toContain('Diff was truncated');
  });

  it('shows correct branch info', () => {
    const input = makePrReviewInput({
      diffResult: makeDiffResult({
        baseBranch: 'develop',
        compareRef: 'feature/CMPI-1234',
        currentBranch: 'feature/CMPI-1234',
      }),
    });
    const output = formatPrAlignmentReview(input);
    expect(output).toContain('develop');
    expect(output).toContain('feature/CMPI-1234');
  });

  it('shows score breakdown values', () => {
    const input = makePrReviewInput({
      alignmentResult: makeAlignmentResult({
        scoreBreakdown: {
          acCoverageScore: 30,
          technicalSignalScore: 14,
          relevantFilesScore: 12,
          testCoverageScore: 10,
          noiseScore: 8,
          crossCuttingPenalty: 5,
        },
      }),
    });
    const output = formatPrAlignmentReview(input);
    expect(output).toContain('30/40');
    expect(output).toContain('14/20');
    expect(output).toContain('12/15');
    expect(output).toContain('10/15');
    expect(output).toContain('8/10');
    expect(output).toContain('-5');
  });

  it('shows correct final recommendation for STRONGLY_ALIGNED', () => {
    const input = makePrReviewInput({
      alignmentResult: makeAlignmentResult({ status: 'STRONGLY_ALIGNED', score: 90 }),
    });
    const output = formatPrAlignmentReview(input);
    expect(output).toContain('proceed with normal review');
  });

  it('shows correct final recommendation for WEAKLY_ALIGNED', () => {
    const input = makePrReviewInput({
      alignmentResult: makeAlignmentResult({ status: 'WEAKLY_ALIGNED', score: 30 }),
    });
    const output = formatPrAlignmentReview(input);
    expect(output).toContain('likely does not satisfy');
  });

  it('shows conflicts and ambiguities when present', () => {
    const input = makePrReviewInput({
      jiraConflicts: ['Conflict: Requirement A contradicts B'],
      jiraAmbiguities: ['Ambiguity: Scope unclear'],
    });
    const output = formatPrAlignmentReview(input);
    expect(output).toContain('Conflict: Requirement A contradicts B');
    expect(output).toContain('Ambiguity: Scope unclear');
  });

  it('shows no conflicts message when none present', () => {
    const input = makePrReviewInput({ jiraConflicts: [], jiraAmbiguities: [] });
    const output = formatPrAlignmentReview(input);
    expect(output).toContain('No conflicts or ambiguities detected.');
  });

  it('shows matched evidence when present', () => {
    const input = makePrReviewInput({
      matchResult: makeMatchResult({
        matchedEvidence: ['src/payment/validator.ts', 'src/payment/service.ts'],
      }),
    });
    const output = formatPrAlignmentReview(input);
    expect(output).toContain('src/payment/validator.ts');
    expect(output).toContain('src/payment/service.ts');
  });

  it('shows no matched evidence message when empty', () => {
    const input = makePrReviewInput({
      matchResult: makeMatchResult({ matchedEvidence: [] }),
    });
    const output = formatPrAlignmentReview(input);
    expect(output).toContain('No matched implementation evidence found.');
  });

  it('shows "No specific review comments generated." when clean', () => {
    const input = makePrReviewInput({
      alignmentResult: makeAlignmentResult({ penalties: [] }),
      matchResult: makeMatchResult({
        testCoverageSignal: 'tests_added',
        riskyChangePaths: [],
        unrelatedChanges: [],
        coverageItems: [{ criterion: 'AC 1', evidence: ['src/a.ts'], status: 'covered' }],
      }),
    });
    const output = formatPrAlignmentReview(input);
    expect(output).toContain('No specific review comments generated.');
  });

  it('shows changed file counts correctly', () => {
    const input = makePrReviewInput({
      diffResult: makeDiffResult({
        changedFiles: [
          { path: 'src/a.ts', status: 'added' },
          { path: 'src/b.ts', status: 'added' },
          { path: 'src/c.ts', status: 'modified' },
          { path: 'src/d.ts', status: 'deleted' },
          { path: 'src/e.ts', status: 'renamed', oldPath: 'src/old.ts' },
        ],
      }),
    });
    const output = formatPrAlignmentReview(input);
    expect(output).toContain('Changed files:** 5');
    expect(output).toContain('Added: 2');
    expect(output).toContain('Modified: 1');
    expect(output).toContain('Deleted: 1');
    expect(output).toContain('Renamed: 1');
  });

  it('shows Other count when unknown file statuses are present', () => {
    const input = makePrReviewInput({
      diffResult: makeDiffResult({
        changedFiles: [
          { path: 'src/a.ts', status: 'added' },
          // Cast to simulate an unknown status returned by git
          { path: 'src/b.ts', status: 'copied' as 'modified' },
        ],
      }),
    });
    const output = formatPrAlignmentReview(input);
    expect(output).toContain('Changed files:** 2');
    expect(output).toContain('Other: 1');
  });
});
