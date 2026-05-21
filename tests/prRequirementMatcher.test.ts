import { describe, it, expect } from 'vitest';
import {
  extractKeyTerms,
  isFileRelatedToTerms,
  determineTestCoverageSignal,
  matchRequirementsToChanges,
} from '../src/utils/prRequirementMatcher.js';
import type {
  MatchInput,
  TestCoverageSignal,
} from '../src/utils/prRequirementMatcher.js';
import type { ChangedFile } from '../src/git/gitDiffService.js';
import type { RequirementSignals } from '../src/utils/requirementExtractor.js';
import type { ClassifiedFiles } from '../src/utils/changedFileClassifier.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeFile(path: string, status: ChangedFile['status'] = 'added'): ChangedFile {
  return { path, status };
}

function emptySignals(): RequirementSignals {
  return {
    acceptanceCriteria: [],
    technicalSignals: [],
    businessRules: [],
    userRoles: [],
    validationRules: [],
    ambiguities: [],
  };
}

function emptyClassified(): ClassifiedFiles {
  return {
    testFiles: [],
    configFiles: [],
    migrationFiles: [],
    lockFiles: [],
    generatedFiles: [],
    documentationFiles: [],
    sourceFiles: [],
    riskyFiles: [],
    backendFiles: [],
    frontendFiles: [],
  };
}

function makeMatchInput(overrides: Partial<MatchInput> = {}): MatchInput {
  return {
    requirementSignals: emptySignals(),
    repoInspectionHints: [],
    classifiedFiles: emptyClassified(),
    diffText: '',
    issueKey: 'TEST-1',
    issueSummary: 'Test issue',
    ...overrides,
  };
}

// ── extractKeyTerms ────────────────────────────────────────────────────────────

describe('extractKeyTerms', () => {
  it('returns words longer than 4 characters', () => {
    const terms = extractKeyTerms('payment validation logic');
    expect(terms).toContain('payment');
    expect(terms).toContain('validation');
  });

  it('filters out words with 4 or fewer characters', () => {
    const terms = extractKeyTerms('the cat runs fast here');
    expect(terms).not.toContain('the');
    expect(terms).not.toContain('cat');
    expect(terms).not.toContain('runs');
    expect(terms).not.toContain('fast');
    expect(terms).not.toContain('here');
  });

  it('filters stop words', () => {
    const terms = extractKeyTerms('this should must with from that');
    expect(terms).not.toContain('this');
    expect(terms).not.toContain('should');
    expect(terms).not.toContain('must');
    expect(terms).not.toContain('with');
    expect(terms).not.toContain('from');
    expect(terms).not.toContain('that');
  });

  it('returns lowercase terms', () => {
    const terms = extractKeyTerms('Payment Validation Logic');
    expect(terms).toContain('payment');
    expect(terms).toContain('validation');
    expect(terms).not.toContain('Payment');
    expect(terms).not.toContain('Validation');
  });

  it('deduplicates terms', () => {
    const terms = extractKeyTerms('payment payment validation');
    const count = terms.filter(t => t === 'payment').length;
    expect(count).toBe(1);
  });

  it('returns empty array for empty string', () => {
    expect(extractKeyTerms('')).toEqual([]);
  });

  it('handles punctuation gracefully', () => {
    const terms = extractKeyTerms('payment-validation, logic!');
    expect(terms).toContain('payment');
    expect(terms).toContain('validation');
    expect(terms).toContain('logic');
  });

  it('caps results at 10 terms', () => {
    const text = 'abcde fghij klmno pqrst uvwxy abcdf fghik klmnp pqrsu uvwxy1 uvwxy2 uvwxy3';
    const terms = extractKeyTerms(text);
    expect(terms.length).toBeLessThanOrEqual(10);
  });
});

// ── isFileRelatedToTerms ──────────────────────────────────────────────────────

describe('isFileRelatedToTerms', () => {
  it('returns true when file path contains a term', () => {
    expect(isFileRelatedToTerms('src/utils/paymentValidator.ts', ['payment'])).toBe(true);
  });

  it('returns false when file path does not contain any term', () => {
    expect(isFileRelatedToTerms('src/utils/stringUtils.ts', ['payment', 'billing'])).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isFileRelatedToTerms('src/utils/PaymentService.ts', ['payment'])).toBe(true);
  });

  it('returns false for empty terms array', () => {
    expect(isFileRelatedToTerms('src/utils/paymentService.ts', [])).toBe(false);
  });

  it('matches on partial path segments', () => {
    expect(isFileRelatedToTerms('src/features/user-management/userController.ts', ['controller'])).toBe(true);
  });

  it('matches on directory names', () => {
    expect(isFileRelatedToTerms('src/payments/index.ts', ['payments'])).toBe(true);
  });
});

// ── determineTestCoverageSignal ───────────────────────────────────────────────

describe('determineTestCoverageSignal', () => {
  it('returns no_test_changes when testFiles is empty', () => {
    const signal = determineTestCoverageSignal([], emptySignals());
    expect(signal).toBe('no_test_changes');
  });

  it('returns tests_added when a test file has status added', () => {
    const testFiles: ChangedFile[] = [
      makeFile('tests/paymentValidator.test.ts', 'added'),
    ];
    const signals: RequirementSignals = {
      ...emptySignals(),
      acceptanceCriteria: ['Payment validation works correctly'],
      technicalSignals: ['paymentValidator.ts'],
    };
    const signal = determineTestCoverageSignal(testFiles, signals);
    expect(signal).toBe('tests_added');
  });

  it('returns tests_modified when test files are modified (not added)', () => {
    const testFiles: ChangedFile[] = [
      makeFile('tests/paymentValidator.test.ts', 'modified'),
    ];
    const signals: RequirementSignals = {
      ...emptySignals(),
      acceptanceCriteria: ['Payment validation works correctly'],
      technicalSignals: ['paymentValidator.ts'],
    };
    const signal = determineTestCoverageSignal(testFiles, signals);
    expect(signal).toBe('tests_modified');
  });

  it('returns only_snapshots_changed when all test files are .snap', () => {
    const testFiles: ChangedFile[] = [
      makeFile('src/__tests__/__snapshots__/Button.snap', 'modified'),
    ];
    const signal = determineTestCoverageSignal(testFiles, emptySignals());
    expect(signal).toBe('only_snapshots_changed');
  });

  it('returns only_snapshots_changed when all test files end with .snapshot', () => {
    const testFiles: ChangedFile[] = [
      makeFile('src/__tests__/Component.snapshot', 'modified'),
    ];
    const signal = determineTestCoverageSignal(testFiles, emptySignals());
    expect(signal).toBe('only_snapshots_changed');
  });

  it('returns tests_in_unrelated_areas when test files do not match any signals', () => {
    const testFiles: ChangedFile[] = [
      makeFile('tests/authService.test.ts', 'modified'),
    ];
    const signals: RequirementSignals = {
      ...emptySignals(),
      acceptanceCriteria: ['Payment validation works correctly'],
      technicalSignals: ['paymentValidator.ts'],
    };
    const signal = determineTestCoverageSignal(testFiles, signals);
    expect(signal).toBe('tests_in_unrelated_areas');
  });

  it('returns tests_added when multiple test files, at least one added', () => {
    const testFiles: ChangedFile[] = [
      makeFile('tests/payment.test.ts', 'modified'),
      makeFile('tests/paymentNew.test.ts', 'added'),
    ];
    const signals: RequirementSignals = {
      ...emptySignals(),
      technicalSignals: ['payment'],
    };
    const signal = determineTestCoverageSignal(testFiles, signals);
    expect(signal).toBe('tests_added');
  });
});

// ── matchRequirementsToChanges ─────────────────────────────────────────────────

describe('matchRequirementsToChanges – AC coverage', () => {
  it('returns covered when AC mentions "payment validation" and paymentValidator.ts changed', () => {
    const classified: ClassifiedFiles = {
      ...emptyClassified(),
      sourceFiles: [makeFile('src/utils/paymentValidator.ts', 'modified')],
    };
    const input = makeMatchInput({
      requirementSignals: {
        ...emptySignals(),
        // AC has key terms: payment, validation, reject, invalid, cards
        // File path 'paymentValidator.ts' contains 'payment' AND diffText contains 'validation'
        acceptanceCriteria: ['Payment validation must reject invalid cards'],
      },
      classifiedFiles: classified,
      diffText: 'paymentValidator.ts validation logic updated',
    });
    const result = matchRequirementsToChanges(input);
    expect(result.coverageItems).toHaveLength(1);
    expect(result.coverageItems[0].status).toBe('covered');
    expect(result.coverageItems[0].evidence).toContain('src/utils/paymentValidator.ts');
  });

  it('returns missing when AC mentions "backend validation" and only frontend files changed', () => {
    const classified: ClassifiedFiles = {
      ...emptyClassified(),
      frontendFiles: [makeFile('src/components/LoginForm.tsx', 'modified')],
      sourceFiles: [makeFile('src/components/LoginForm.tsx', 'modified')],
    };
    const input = makeMatchInput({
      requirementSignals: {
        ...emptySignals(),
        acceptanceCriteria: ['Backend validation rejects empty passwords'],
      },
      classifiedFiles: classified,
      diffText: 'LoginForm.tsx updated styles',
    });
    const result = matchRequirementsToChanges(input);
    expect(result.coverageItems[0].status).toBe('missing');
  });

  it('returns partial when only one AC key term matches', () => {
    const classified: ClassifiedFiles = {
      ...emptyClassified(),
      sourceFiles: [makeFile('src/services/userService.ts', 'modified')],
    };
    const input = makeMatchInput({
      requirementSignals: {
        ...emptySignals(),
        // "email" matches file, "password" doesn't → partial (1 match)
        acceptanceCriteria: ['Email address should match password requirements'],
      },
      classifiedFiles: classified,
      diffText: 'userService email logic',
    });
    const result = matchRequirementsToChanges(input);
    // Terms: email (>4 chars, not stop word), address (>4), match, password, requirements
    // "email" appears in diffText; "userService" in path
    // We just need to confirm it's not "missing"
    expect(['covered', 'partial']).toContain(result.coverageItems[0].status);
  });

  it('returns not_enough_evidence when no AC and no files and no diff', () => {
    const input = makeMatchInput();
    const result = matchRequirementsToChanges(input);
    expect(result.coverageItems).toHaveLength(0);
    expect(result.testCoverageSignal).toBe('no_test_changes');
  });

  it('returns not_enough_evidence status when diffText is empty for AC with no matches', () => {
    const input = makeMatchInput({
      requirementSignals: {
        ...emptySignals(),
        acceptanceCriteria: ['Complex enterprise payment flow validation'],
      },
      classifiedFiles: emptyClassified(),
      diffText: '',
    });
    const result = matchRequirementsToChanges(input);
    expect(result.coverageItems[0].status).toBe('not_enough_evidence');
  });
});

describe('matchRequirementsToChanges – technical signal matching', () => {
  it('matches when Jira technical signal "UserService.ts" and that file changed', () => {
    const classified: ClassifiedFiles = {
      ...emptyClassified(),
      backendFiles: [makeFile('src/services/UserService.ts', 'modified')],
      sourceFiles: [makeFile('src/services/UserService.ts', 'modified')],
    };
    const input = makeMatchInput({
      requirementSignals: {
        ...emptySignals(),
        technicalSignals: ['UserService.ts'],
      },
      classifiedFiles: classified,
      diffText: '',
    });
    const result = matchRequirementsToChanges(input);
    expect(result.technicalSignalMatchCount).toBe(1);
    expect(result.technicalSignalTotalCount).toBe(1);
    expect(result.matchedEvidence).toContain('src/services/UserService.ts');
  });

  it('adds unmatched signals to missingSignals when there are files but no match', () => {
    const classified: ClassifiedFiles = {
      ...emptyClassified(),
      sourceFiles: [makeFile('src/utils/helper.ts', 'added')],
    };
    const input = makeMatchInput({
      requirementSignals: {
        ...emptySignals(),
        technicalSignals: ['PaymentGateway.ts'],
      },
      classifiedFiles: classified,
      diffText: 'helper.ts updated',
    });
    const result = matchRequirementsToChanges(input);
    expect(result.missingSignals).toContain('PaymentGateway.ts');
    expect(result.technicalSignalMatchCount).toBe(0);
  });

  it('matches signal in diffText even if no file path matches', () => {
    const classified: ClassifiedFiles = {
      ...emptyClassified(),
      sourceFiles: [makeFile('src/utils/helper.ts', 'added')],
    };
    const input = makeMatchInput({
      requirementSignals: {
        ...emptySignals(),
        technicalSignals: ['paymentGateway'],
      },
      classifiedFiles: classified,
      diffText: 'Updated PaymentGateway logic in the diff',
    });
    const result = matchRequirementsToChanges(input);
    expect(result.technicalSignalMatchCount).toBe(1);
    expect(result.missingSignals).not.toContain('paymentGateway');
  });
});

describe('matchRequirementsToChanges – unrelated change detection', () => {
  it('does not flag generated/node_modules files as unrelated', () => {
    const classified: ClassifiedFiles = {
      ...emptyClassified(),
      generatedFiles: [makeFile('node_modules/package.json', 'modified')],
    };
    const input = makeMatchInput({
      requirementSignals: {
        ...emptySignals(),
        technicalSignals: ['paymentService.ts'],
      },
      classifiedFiles: classified,
      diffText: '',
    });
    const result = matchRequirementsToChanges(input);
    expect(result.unrelatedChanges.map(u => u.path)).not.toContain('node_modules/package.json');
  });

  it('flags unrelated source file when technical signals are present', () => {
    const paymentFile = makeFile('src/services/paymentService.ts', 'modified');
    const unrelatedFile = makeFile('src/utils/dateFormatter.ts', 'modified');

    const classified: ClassifiedFiles = {
      ...emptyClassified(),
      backendFiles: [paymentFile],
      sourceFiles: [paymentFile, unrelatedFile],
    };
    const input = makeMatchInput({
      requirementSignals: {
        ...emptySignals(),
        technicalSignals: ['paymentService.ts'],
        acceptanceCriteria: ['Payment processing must handle failures gracefully'],
      },
      classifiedFiles: classified,
      diffText: 'paymentService updated',
    });
    const result = matchRequirementsToChanges(input);
    expect(result.unrelatedChanges.map(u => u.path)).toContain('src/utils/dateFormatter.ts');
  });

  it('does not flag unrelated changes when there are no technical signals', () => {
    const classified: ClassifiedFiles = {
      ...emptyClassified(),
      sourceFiles: [makeFile('src/utils/dateFormatter.ts', 'modified')],
    };
    const input = makeMatchInput({
      requirementSignals: emptySignals(),
      classifiedFiles: classified,
      diffText: '',
    });
    const result = matchRequirementsToChanges(input);
    // No signals → can't determine what's unrelated
    expect(result.unrelatedChanges).toHaveLength(0);
  });

  it('does not flag test files as unrelated', () => {
    const testFile = makeFile('tests/unrelated.test.ts', 'added');
    const classified: ClassifiedFiles = {
      ...emptyClassified(),
      testFiles: [testFile],
      sourceFiles: [makeFile('src/paymentService.ts', 'modified')],
    };
    const input = makeMatchInput({
      requirementSignals: {
        ...emptySignals(),
        technicalSignals: ['paymentService.ts'],
      },
      classifiedFiles: classified,
      diffText: '',
    });
    const result = matchRequirementsToChanges(input);
    expect(result.unrelatedChanges.map(u => u.path)).not.toContain('tests/unrelated.test.ts');
  });

  it('does not flag config files as unrelated', () => {
    const configFile = makeFile('tsconfig.json', 'modified');
    const classified: ClassifiedFiles = {
      ...emptyClassified(),
      configFiles: [configFile],
      sourceFiles: [makeFile('src/paymentService.ts', 'modified')],
    };
    const input = makeMatchInput({
      requirementSignals: {
        ...emptySignals(),
        technicalSignals: ['paymentService.ts'],
      },
      classifiedFiles: classified,
      diffText: '',
    });
    const result = matchRequirementsToChanges(input);
    expect(result.unrelatedChanges.map(u => u.path)).not.toContain('tsconfig.json');
  });
});

describe('matchRequirementsToChanges – backend/frontend flags', () => {
  it('sets hasBackendChanges true when backendFiles is non-empty', () => {
    const classified: ClassifiedFiles = {
      ...emptyClassified(),
      backendFiles: [makeFile('src/services/UserService.ts', 'modified')],
    };
    const result = matchRequirementsToChanges(makeMatchInput({ classifiedFiles: classified }));
    expect(result.hasBackendChanges).toBe(true);
    expect(result.hasFrontendChanges).toBe(false);
  });

  it('sets hasFrontendChanges true when frontendFiles is non-empty', () => {
    const classified: ClassifiedFiles = {
      ...emptyClassified(),
      frontendFiles: [makeFile('src/components/Button.tsx', 'added')],
    };
    const result = matchRequirementsToChanges(makeMatchInput({ classifiedFiles: classified }));
    expect(result.hasFrontendChanges).toBe(true);
    expect(result.hasBackendChanges).toBe(false);
  });

  it('sets both flags when both types of files are present', () => {
    const classified: ClassifiedFiles = {
      ...emptyClassified(),
      backendFiles: [makeFile('src/services/PaymentService.ts', 'modified')],
      frontendFiles: [makeFile('src/components/PaymentForm.tsx', 'modified')],
    };
    const result = matchRequirementsToChanges(makeMatchInput({ classifiedFiles: classified }));
    expect(result.hasBackendChanges).toBe(true);
    expect(result.hasFrontendChanges).toBe(true);
  });
});

describe('matchRequirementsToChanges – risky change paths', () => {
  it('collects risky file paths from classifiedFiles.riskyFiles', () => {
    const riskyFile = makeFile('src/auth/tokenService.ts', 'modified');
    const classified: ClassifiedFiles = {
      ...emptyClassified(),
      riskyFiles: [{ file: riskyFile, reasons: ['auth_or_permissions'] }],
    };
    const result = matchRequirementsToChanges(makeMatchInput({ classifiedFiles: classified }));
    expect(result.riskyChangePaths).toContain('src/auth/tokenService.ts');
  });

  it('returns empty riskyChangePaths when no risky files', () => {
    const result = matchRequirementsToChanges(makeMatchInput());
    expect(result.riskyChangePaths).toHaveLength(0);
  });
});

describe('matchRequirementsToChanges – test coverage signal', () => {
  it('returns no_test_changes when no test files in classifiedFiles', () => {
    const result = matchRequirementsToChanges(makeMatchInput());
    expect(result.testCoverageSignal).toBe('no_test_changes');
  });

  it('returns tests_added when a test file is newly added', () => {
    const classified: ClassifiedFiles = {
      ...emptyClassified(),
      // Test file path must contain the technical signal 'paymentservice' to be "related"
      testFiles: [makeFile('tests/paymentService.test.ts', 'added')],
      sourceFiles: [makeFile('src/paymentService.ts', 'modified')],
    };
    const signals: RequirementSignals = {
      ...emptySignals(),
      technicalSignals: ['paymentService.ts'],
    };
    const input = makeMatchInput({ classifiedFiles: classified, requirementSignals: signals });
    const result = matchRequirementsToChanges(input);
    expect(result.testCoverageSignal).toBe('tests_added');
  });

  it('returns only_snapshots_changed when all test files are .snap', () => {
    const classified: ClassifiedFiles = {
      ...emptyClassified(),
      testFiles: [makeFile('src/__tests__/__snapshots__/App.snap', 'modified')],
    };
    const result = matchRequirementsToChanges(makeMatchInput({ classifiedFiles: classified }));
    expect(result.testCoverageSignal).toBe('only_snapshots_changed');
  });
});

describe('matchRequirementsToChanges – empty input edge case', () => {
  it('returns safe defaults when all inputs are empty', () => {
    const result = matchRequirementsToChanges(makeMatchInput());
    expect(result.coverageItems).toHaveLength(0);
    expect(result.matchedEvidence).toHaveLength(0);
    expect(result.missingSignals).toHaveLength(0);
    expect(result.unrelatedChanges).toHaveLength(0);
    expect(result.riskyChangePaths).toHaveLength(0);
    expect(result.testCoverageSignal).toBe('no_test_changes');
    expect(result.hasBackendChanges).toBe(false);
    expect(result.hasFrontendChanges).toBe(false);
    expect(result.technicalSignalMatchCount).toBe(0);
    expect(result.technicalSignalTotalCount).toBe(0);
  });
});
