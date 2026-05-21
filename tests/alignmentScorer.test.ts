import { describe, it, expect } from 'vitest';
import {
  scoreAlignment,
} from '../src/utils/alignmentScorer.js';
import type {
  ScoringInput,
  AlignmentResult,
} from '../src/utils/alignmentScorer.js';
import type { MatchResult } from '../src/utils/prRequirementMatcher.js';
import type { RequirementSignals } from '../src/utils/requirementExtractor.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeRequirementSignals(overrides: Partial<RequirementSignals> = {}): RequirementSignals {
  return {
    acceptanceCriteria: [],
    technicalSignals: [],
    businessRules: [],
    userRoles: [],
    validationRules: [],
    ambiguities: [],
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

function makeScoringInput(overrides: Partial<ScoringInput> = {}): ScoringInput {
  return {
    matchResult: makeMatchResult(),
    requirementSignals: makeRequirementSignals(),
    jiraContextQualityScore: 75,
    diffTruncated: false,
    totalChangedFileCount: 5,
    hasBackendRequirement: false,
    hasFrontendRequirement: false,
    ...overrides,
  };
}

// ── Perfect alignment scenario ─────────────────────────────────────────────────

describe('scoreAlignment — perfect input', () => {
  it('returns STRONGLY_ALIGNED when all ACs covered, signals matched, tests added, no unrelated', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        coverageItems: [
          { criterion: 'User can login', evidence: ['src/auth/login.ts'], status: 'covered' },
          { criterion: 'Validate email format', evidence: ['src/validators/email.ts'], status: 'covered' },
          { criterion: 'Return JWT token', evidence: ['src/auth/token.ts'], status: 'covered' },
        ],
        technicalSignalMatchCount: 4,
        technicalSignalTotalCount: 4,
        testCoverageSignal: 'tests_added',
        unrelatedChanges: [],
        hasBackendChanges: true,
        hasFrontendChanges: false,
      }),
      requirementSignals: makeRequirementSignals({
        technicalSignals: ['loginService.ts', 'tokenService.ts', 'emailValidator.ts', 'authController.ts'],
      }),
      jiraContextQualityScore: 85,
      totalChangedFileCount: 8,
    });

    const result = scoreAlignment(input);

    expect(result.status).toBe('STRONGLY_ALIGNED');
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it('score breakdown components sum to overall score (before cross-cutting penalties)', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        coverageItems: [
          { criterion: 'Feature A', evidence: ['src/featureA.ts'], status: 'covered' },
          { criterion: 'Feature B', evidence: ['src/featureB.ts'], status: 'covered' },
        ],
        technicalSignalMatchCount: 3,
        technicalSignalTotalCount: 4,
        testCoverageSignal: 'tests_added',
        unrelatedChanges: [],
        hasBackendChanges: true,
      }),
      requirementSignals: makeRequirementSignals({
        technicalSignals: ['featureA.ts', 'featureB.ts', 'featureC.ts', 'featureD.ts'],
      }),
      jiraContextQualityScore: 75,
      diffTruncated: false,
      totalChangedFileCount: 5,
      hasBackendRequirement: false,
      hasFrontendRequirement: false,
    });

    const result = scoreAlignment(input);
    const { acCoverageScore, technicalSignalScore, relevantFilesScore, testCoverageScore, noiseScore, crossCuttingPenalty } = result.scoreBreakdown;
    const breakdownSum = acCoverageScore + technicalSignalScore + relevantFilesScore + testCoverageScore + noiseScore;

    // Score should equal breakdown sum minus cross-cutting penalties
    expect(result.score).toBe(breakdownSum - crossCuttingPenalty);
  });
});

// ── Missing ACs and no tests ───────────────────────────────────────────────────

describe('scoreAlignment — missing ACs and no tests', () => {
  it('returns WEAKLY_ALIGNED or lower when ACs are all missing and no tests', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        coverageItems: [
          { criterion: 'User login', evidence: [], status: 'missing' },
          { criterion: 'Password validation', evidence: [], status: 'missing' },
          { criterion: 'Token generation', evidence: [], status: 'missing' },
        ],
        technicalSignalMatchCount: 0,
        technicalSignalTotalCount: 3,
        testCoverageSignal: 'no_test_changes',
        hasBackendChanges: false,
        hasFrontendChanges: false,
      }),
      requirementSignals: makeRequirementSignals({
        technicalSignals: ['loginService.ts', 'tokenService.ts', 'authController.ts'],
      }),
      jiraContextQualityScore: 30,
      totalChangedFileCount: 3,
    });

    const result = scoreAlignment(input);

    expect(['WEAKLY_ALIGNED', 'NOT_ENOUGH_EVIDENCE']).toContain(result.status);
    expect(result.score).toBeLessThan(45);
  });

  it('includes penalty for no test changes', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        testCoverageSignal: 'no_test_changes',
      }),
    });

    const result = scoreAlignment(input);

    expect(result.penalties).toContain('No test changes detected');
  });
});

// ── No AC items in Jira ────────────────────────────────────────────────────────

describe('scoreAlignment — no AC items', () => {
  it('applies penalty and caps acCoverageScore at 20 when no AC items', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        coverageItems: [],
        technicalSignalMatchCount: 4,
        technicalSignalTotalCount: 4,
        testCoverageSignal: 'tests_added',
      }),
    });

    const result = scoreAlignment(input);

    expect(result.penalties).toContain('No explicit acceptance criteria in Jira');
    expect(result.scoreBreakdown.acCoverageScore).toBe(20);
    // With max AC=20 instead of 40, max possible score is reduced
    expect(result.scoreBreakdown.acCoverageScore).toBeLessThanOrEqual(20);
  });

  it('does not apply AC penalty when AC items exist', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        coverageItems: [
          { criterion: 'Some AC', evidence: ['file.ts'], status: 'covered' },
        ],
      }),
    });

    const result = scoreAlignment(input);

    expect(result.penalties).not.toContain('No explicit acceptance criteria in Jira');
  });
});

// ── Backend requirement but no backend changes ─────────────────────────────────

describe('scoreAlignment — backend/frontend requirement mismatches', () => {
  it('penalizes when backend required but no backend changes', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        hasBackendChanges: false,
        hasFrontendChanges: false,
      }),
      hasBackendRequirement: true,
      hasFrontendRequirement: false,
    });

    const result = scoreAlignment(input);

    expect(result.penalties).toContain(
      'Jira requires backend changes but no backend files changed',
    );
  });

  it('penalizes when frontend required but no frontend changes', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        hasBackendChanges: false,
        hasFrontendChanges: false,
      }),
      hasBackendRequirement: false,
      hasFrontendRequirement: true,
    });

    const result = scoreAlignment(input);

    expect(result.penalties).toContain(
      'Jira requires frontend changes but no frontend files changed',
    );
  });

  it('does not penalize when backend required and backend changes exist', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        hasBackendChanges: true,
      }),
      hasBackendRequirement: true,
    });

    const result = scoreAlignment(input);

    expect(result.penalties).not.toContain(
      'Jira requires backend changes but no backend files changed',
    );
  });

  it('penalizes both backend and frontend when both required but neither changed', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        hasBackendChanges: false,
        hasFrontendChanges: false,
      }),
      hasBackendRequirement: true,
      hasFrontendRequirement: true,
    });

    const result = scoreAlignment(input);

    expect(result.penalties).toContain(
      'Jira requires backend changes but no backend files changed',
    );
    expect(result.penalties).toContain(
      'Jira requires frontend changes but no frontend files changed',
    );
  });
});

// ── NOT_ENOUGH_EVIDENCE override ───────────────────────────────────────────────

describe('scoreAlignment — NOT_ENOUGH_EVIDENCE override', () => {
  it('overrides to NOT_ENOUGH_EVIDENCE when no files changed', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        coverageItems: [
          { criterion: 'Some AC', evidence: [], status: 'covered' },
        ],
        technicalSignalMatchCount: 3,
        technicalSignalTotalCount: 3,
        testCoverageSignal: 'tests_added',
      }),
      totalChangedFileCount: 0,
      jiraContextQualityScore: 90,
    });

    const result = scoreAlignment(input);

    expect(result.status).toBe('NOT_ENOUGH_EVIDENCE');
  });

  it('overrides to NOT_ENOUGH_EVIDENCE when no technical signals and no coverage items', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        coverageItems: [],
        technicalSignalTotalCount: 0,
        technicalSignalMatchCount: 0,
      }),
      totalChangedFileCount: 5,
    });

    const result = scoreAlignment(input);

    expect(result.status).toBe('NOT_ENOUGH_EVIDENCE');
  });

  it('overrides to NOT_ENOUGH_EVIDENCE when diff truncated and score < 30', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        coverageItems: [
          { criterion: 'AC 1', evidence: [], status: 'missing' },
          { criterion: 'AC 2', evidence: [], status: 'missing' },
        ],
        technicalSignalMatchCount: 0,
        technicalSignalTotalCount: 5,
        testCoverageSignal: 'no_test_changes',
      }),
      requirementSignals: makeRequirementSignals({
        technicalSignals: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
      }),
      diffTruncated: true,
      jiraContextQualityScore: 20,
      totalChangedFileCount: 3,
    });

    const result = scoreAlignment(input);

    // Score should be low enough (<30) to trigger override
    expect(result.score).toBeLessThan(30); // verify precondition
    expect(result.status).toBe('NOT_ENOUGH_EVIDENCE');
  });

  it('does NOT override when diff truncated but score >= 30', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        coverageItems: [
          { criterion: 'Feature A', evidence: ['src/a.ts'], status: 'covered' },
          { criterion: 'Feature B', evidence: ['src/b.ts'], status: 'covered' },
        ],
        technicalSignalMatchCount: 3,
        technicalSignalTotalCount: 4,
        testCoverageSignal: 'tests_modified',
        hasBackendChanges: true,
      }),
      requirementSignals: makeRequirementSignals({
        technicalSignals: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
      }),
      diffTruncated: true,
      jiraContextQualityScore: 75,
      totalChangedFileCount: 6,
    });

    const result = scoreAlignment(input);

    expect(result.score).toBeGreaterThanOrEqual(30); // verify precondition
    expect(result.status).not.toBe('NOT_ENOUGH_EVIDENCE');
  });
});

// ── Score breakdown verification ───────────────────────────────────────────────

describe('scoreAlignment — score breakdown', () => {
  it('breakdown scores are within their expected ranges', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        coverageItems: [
          { criterion: 'Feature A', evidence: ['src/a.ts'], status: 'covered' },
          { criterion: 'Feature B', evidence: [], status: 'partial' },
          { criterion: 'Feature C', evidence: [], status: 'missing' },
        ],
        technicalSignalMatchCount: 2,
        technicalSignalTotalCount: 4,
        testCoverageSignal: 'tests_modified',
        unrelatedChanges: [{ path: 'src/unrelated.ts', reason: 'No match' }],
      }),
      requirementSignals: makeRequirementSignals({
        technicalSignals: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
      }),
      totalChangedFileCount: 10,
      jiraContextQualityScore: 60,
    });

    const result = scoreAlignment(input);
    const bd = result.scoreBreakdown;

    expect(bd.acCoverageScore).toBeGreaterThanOrEqual(0);
    expect(bd.acCoverageScore).toBeLessThanOrEqual(40);

    expect(bd.technicalSignalScore).toBeGreaterThanOrEqual(0);
    expect(bd.technicalSignalScore).toBeLessThanOrEqual(20);

    expect(bd.relevantFilesScore).toBeGreaterThanOrEqual(0);
    expect(bd.relevantFilesScore).toBeLessThanOrEqual(15);

    expect(bd.testCoverageScore).toBeGreaterThanOrEqual(0);
    expect(bd.testCoverageScore).toBeLessThanOrEqual(15);

    expect(bd.noiseScore).toBeGreaterThanOrEqual(0);
    expect(bd.noiseScore).toBeLessThanOrEqual(10);
  });

  it('max possible score is 100 with perfect inputs', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        coverageItems: [
          { criterion: 'Feature A', evidence: ['src/a.ts'], status: 'covered' },
        ],
        technicalSignalMatchCount: 4,
        technicalSignalTotalCount: 4,
        testCoverageSignal: 'tests_added',
        unrelatedChanges: [],
        riskyChangePaths: [],
        hasBackendChanges: true,
        hasFrontendChanges: true,
      }),
      requirementSignals: makeRequirementSignals({
        technicalSignals: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
        ambiguities: [],
      }),
      jiraContextQualityScore: 95,
      diffTruncated: false,
      totalChangedFileCount: 5,
      hasBackendRequirement: true,
      hasFrontendRequirement: true,
    });

    const result = scoreAlignment(input);

    // Perfect: AC=40, technical=20, relevantFiles=15, test=15, noise=10 => 100
    expect(result.score).toBe(100);
    expect(result.scoreBreakdown.acCoverageScore).toBe(40);
    expect(result.scoreBreakdown.technicalSignalScore).toBe(20);
    expect(result.scoreBreakdown.relevantFilesScore).toBe(15);
    expect(result.scoreBreakdown.testCoverageScore).toBe(15);
    expect(result.scoreBreakdown.noiseScore).toBe(10);
  });
});

// ── Confidence level ───────────────────────────────────────────────────────────

describe('scoreAlignment — confidence level', () => {
  it('returns High confidence when quality >= 70, not truncated, signals >= 3', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        technicalSignalTotalCount: 4,
        technicalSignalMatchCount: 3,
        coverageItems: [
          { criterion: 'AC', evidence: ['src/a.ts'], status: 'covered' },
        ],
      }),
      requirementSignals: makeRequirementSignals({
        technicalSignals: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
      }),
      jiraContextQualityScore: 75,
      diffTruncated: false,
    });

    const result = scoreAlignment(input);

    expect(result.confidence).toBe('High');
  });

  it('returns Medium confidence when quality >= 40 and not truncated but signals < 3', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        technicalSignalTotalCount: 2,
        technicalSignalMatchCount: 2,
        coverageItems: [
          { criterion: 'AC', evidence: ['src/a.ts'], status: 'covered' },
        ],
      }),
      requirementSignals: makeRequirementSignals({
        technicalSignals: ['a.ts', 'b.ts'],
      }),
      jiraContextQualityScore: 55,
      diffTruncated: false,
    });

    const result = scoreAlignment(input);

    expect(result.confidence).toBe('Medium');
  });

  it('returns Low confidence when quality < 40', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        technicalSignalTotalCount: 5,
        technicalSignalMatchCount: 5,
      }),
      requirementSignals: makeRequirementSignals({
        technicalSignals: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
      }),
      jiraContextQualityScore: 30,
      diffTruncated: false,
    });

    const result = scoreAlignment(input);

    expect(result.confidence).toBe('Low');
  });

  it('returns Low confidence when diff is truncated', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        technicalSignalTotalCount: 5,
        technicalSignalMatchCount: 5,
      }),
      requirementSignals: makeRequirementSignals({
        technicalSignals: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
      }),
      jiraContextQualityScore: 80,
      diffTruncated: true,
    });

    const result = scoreAlignment(input);

    expect(result.confidence).toBe('Low');
  });

  it('returns Medium when quality >= 40 and not truncated even if signals = 2', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        technicalSignalTotalCount: 2,
        technicalSignalMatchCount: 2,
      }),
      requirementSignals: makeRequirementSignals({
        technicalSignals: ['a.ts', 'b.ts'],
      }),
      jiraContextQualityScore: 70,
      diffTruncated: false,
    });

    const result = scoreAlignment(input);

    // quality=70 is >= 70 but signals=2 < 3, so High threshold not met → Medium
    expect(result.confidence).toBe('Medium');
  });
});

// ── Noise score penalties ──────────────────────────────────────────────────────

describe('scoreAlignment — noise score penalties', () => {
  it('reduces noise score when diff is truncated', () => {
    const withTruncation = makeScoringInput({ diffTruncated: true });
    const withoutTruncation = makeScoringInput({ diffTruncated: false });

    const r1 = scoreAlignment(withTruncation);
    const r2 = scoreAlignment(withoutTruncation);

    expect(r1.scoreBreakdown.noiseScore).toBeLessThan(r2.scoreBreakdown.noiseScore);
  });

  it('reduces noise score when risky change paths exist', () => {
    const withRisky = makeScoringInput({
      matchResult: makeMatchResult({ riskyChangePaths: ['src/security.ts'] }),
    });
    const withoutRisky = makeScoringInput({
      matchResult: makeMatchResult({ riskyChangePaths: [] }),
    });

    const r1 = scoreAlignment(withRisky);
    const r2 = scoreAlignment(withoutRisky);

    expect(r1.scoreBreakdown.noiseScore).toBeLessThan(r2.scoreBreakdown.noiseScore);
    expect(r1.penalties).toContain('Risky file changes detected');
  });

  it('reduces noise score when ambiguities exist', () => {
    const withAmbiguities = makeScoringInput({
      requirementSignals: makeRequirementSignals({ ambiguities: ['TBD: clarify scope'] }),
    });
    const withoutAmbiguities = makeScoringInput({
      requirementSignals: makeRequirementSignals({ ambiguities: [] }),
    });

    const r1 = scoreAlignment(withAmbiguities);
    const r2 = scoreAlignment(withoutAmbiguities);

    expect(r1.scoreBreakdown.noiseScore).toBeLessThan(r2.scoreBreakdown.noiseScore);
    expect(r1.penalties).toContain('Unresolved requirement ambiguities');
  });

  it('noise score never goes below 0', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({ riskyChangePaths: ['security.ts', 'auth.ts'] }),
      requirementSignals: makeRequirementSignals({ ambiguities: ['TBD'] }),
      diffTruncated: true,
    });

    const result = scoreAlignment(input);

    expect(result.scoreBreakdown.noiseScore).toBeGreaterThanOrEqual(0);
  });
});

// ── AC coverage score edge cases ───────────────────────────────────────────────

describe('scoreAlignment — AC coverage score', () => {
  it('scores 40 when all ACs are covered', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        coverageItems: [
          { criterion: 'AC 1', evidence: ['src/a.ts'], status: 'covered' },
          { criterion: 'AC 2', evidence: ['src/b.ts'], status: 'covered' },
        ],
      }),
    });

    const result = scoreAlignment(input);

    expect(result.scoreBreakdown.acCoverageScore).toBe(40);
  });

  it('scores partial for half covered, half partial ACs', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        coverageItems: [
          { criterion: 'AC 1', evidence: ['src/a.ts'], status: 'covered' },
          { criterion: 'AC 2', evidence: [], status: 'partial' },
        ],
      }),
    });

    const result = scoreAlignment(input);

    // ratio = (1 + 0.5 * 1) / 2 = 0.75 => 30 points
    expect(result.scoreBreakdown.acCoverageScore).toBe(30);
  });

  it('scores 0 for fully missing ACs', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        coverageItems: [
          { criterion: 'AC 1', evidence: [], status: 'missing' },
          { criterion: 'AC 2', evidence: [], status: 'missing' },
        ],
      }),
    });

    const result = scoreAlignment(input);

    expect(result.scoreBreakdown.acCoverageScore).toBe(0);
  });
});

// ── Technical signal score edge cases ─────────────────────────────────────────

describe('scoreAlignment — technical signal score', () => {
  it('returns 10 (neutral) when no technical signals in Jira', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        technicalSignalTotalCount: 0,
        technicalSignalMatchCount: 0,
        coverageItems: [
          { criterion: 'Some AC', evidence: ['src/a.ts'], status: 'covered' },
        ],
      }),
    });

    const result = scoreAlignment(input);

    expect(result.scoreBreakdown.technicalSignalScore).toBe(10);
  });

  it('returns 20 when 75%+ signals matched', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        technicalSignalTotalCount: 4,
        technicalSignalMatchCount: 4,
        coverageItems: [
          { criterion: 'AC', evidence: ['src/a.ts'], status: 'covered' },
        ],
      }),
    });

    const result = scoreAlignment(input);

    expect(result.scoreBreakdown.technicalSignalScore).toBe(20);
  });

  it('returns 3 when less than 25% signals matched', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        technicalSignalTotalCount: 8,
        technicalSignalMatchCount: 1,
        coverageItems: [
          { criterion: 'AC', evidence: [], status: 'missing' },
        ],
      }),
    });

    const result = scoreAlignment(input);

    expect(result.scoreBreakdown.technicalSignalScore).toBe(3);
  });
});

// ── Relevant files score edge cases ───────────────────────────────────────────

describe('scoreAlignment — relevant files score', () => {
  it('returns 0 when totalChangedFileCount is 0', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        coverageItems: [
          { criterion: 'AC', evidence: [], status: 'covered' },
        ],
        technicalSignalTotalCount: 3,
        technicalSignalMatchCount: 3,
      }),
      totalChangedFileCount: 0,
    });

    const result = scoreAlignment(input);

    expect(result.scoreBreakdown.relevantFilesScore).toBe(0);
  });

  it('returns 15 when no unrelated changes', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        unrelatedChanges: [],
        coverageItems: [{ criterion: 'AC', evidence: ['src/a.ts'], status: 'covered' }],
        technicalSignalTotalCount: 3,
        technicalSignalMatchCount: 3,
      }),
      totalChangedFileCount: 5,
    });

    const result = scoreAlignment(input);

    expect(result.scoreBreakdown.relevantFilesScore).toBe(15);
  });

  it('adds penalty for many unrelated changes', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        unrelatedChanges: [
          { path: 'src/a.ts', reason: 'No match' },
          { path: 'src/b.ts', reason: 'No match' },
          { path: 'src/c.ts', reason: 'No match' },
          { path: 'src/d.ts', reason: 'No match' },
        ],
        coverageItems: [{ criterion: 'AC', evidence: [], status: 'missing' }],
      }),
      totalChangedFileCount: 10,
    });

    const result = scoreAlignment(input);

    // unrelated ratio = 4/10 = 0.4 > 0.3, so penalty should be added
    expect(result.penalties).toContain('Many unrelated file changes detected');
  });
});

// ── Jira context quality penalty ───────────────────────────────────────────────

describe('scoreAlignment — Jira context quality penalty', () => {
  it('penalizes when Jira context quality < 40', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        coverageItems: [
          { criterion: 'AC 1', evidence: ['src/a.ts'], status: 'covered' },
        ],
        technicalSignalMatchCount: 4,
        technicalSignalTotalCount: 4,
        testCoverageSignal: 'tests_added',
      }),
      jiraContextQualityScore: 35,
    });

    const result = scoreAlignment(input);

    expect(result.penalties).toContain('Jira context quality too low for reliable scoring');
  });

  it('does not penalize when Jira context quality >= 40', () => {
    const input = makeScoringInput({
      jiraContextQualityScore: 40,
    });

    const result = scoreAlignment(input);

    expect(result.penalties).not.toContain('Jira context quality too low for reliable scoring');
  });
});

// ── Score floor ────────────────────────────────────────────────────────────────

describe('scoreAlignment — score floor', () => {
  it('score never goes below 0', () => {
    const input = makeScoringInput({
      matchResult: makeMatchResult({
        coverageItems: [],
        technicalSignalMatchCount: 0,
        technicalSignalTotalCount: 5,
        testCoverageSignal: 'no_test_changes',
        unrelatedChanges: [
          { path: 'a.ts', reason: 'No match' },
          { path: 'b.ts', reason: 'No match' },
          { path: 'c.ts', reason: 'No match' },
          { path: 'd.ts', reason: 'No match' },
          { path: 'e.ts', reason: 'No match' },
          { path: 'f.ts', reason: 'No match' },
        ],
        riskyChangePaths: ['security.ts'],
        hasBackendChanges: false,
        hasFrontendChanges: false,
      }),
      requirementSignals: makeRequirementSignals({
        ambiguities: ['TBD'],
        technicalSignals: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
      }),
      jiraContextQualityScore: 10,
      diffTruncated: true,
      totalChangedFileCount: 6,
      hasBackendRequirement: true,
      hasFrontendRequirement: true,
    });

    const result = scoreAlignment(input);

    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});
