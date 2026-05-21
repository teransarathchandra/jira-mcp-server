import { describe, it, expect } from 'vitest';
import {
  buildTraceabilityMatrix,
  extractKeywords,
  type TraceabilityMatrixInput,
} from '../src/delivery/traceabilityMatrix.js';
import type { RequirementSignals } from '../src/utils/requirementExtractor.js';
import type { ClassifiedFiles } from '../src/utils/changedFileClassifier.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

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

function baseInput(overrides: Partial<TraceabilityMatrixInput> = {}): TraceabilityMatrixInput {
  return {
    issueKey: 'CMPI-1234',
    issueSummary: 'Test issue',
    requirementSignals: emptySignals(),
    confluenceSignals: null,
    classifiedFiles: emptyClassified(),
    diffText: '',
    diffTruncated: false,
    changedFilePaths: [],
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('buildTraceabilityMatrix', () => {

  // Test 1: AC with matching file and test → COVERED, High confidence
  it('marks AC as COVERED when matching file and test are present', () => {
    const signals = emptySignals();
    signals.acceptanceCriteria = ['User login authentication with password validation'];

    const matrix = buildTraceabilityMatrix(baseInput({
      requirementSignals: signals,
      changedFilePaths: [
        'src/auth/loginService.ts',
        'tests/auth/loginService.test.ts',
      ],
      diffText: '+  validatePassword(user.password);\n+  authenticate(user);\n',
      diffTruncated: false,
    }));

    expect(matrix.items).toHaveLength(1);
    const item = matrix.items[0];
    expect(item.requirementId).toBe('AC-1');
    expect(item.coverageStatus).toBe('COVERED');
    expect(item.confidence).toBe('High');
    expect(item.matchedFiles.length).toBeGreaterThanOrEqual(1);
    expect(item.matchedTests.length).toBeGreaterThanOrEqual(1);
    expect(item.source).toBe('acceptance_criteria');
    expect(item.sourceAuthority).toBe('high');
  });

  // Test 2: AC with matching file but no test → PARTIALLY_COVERED
  it('marks AC as PARTIALLY_COVERED when file matches but no test files', () => {
    const signals = emptySignals();
    signals.acceptanceCriteria = ['User registration form validation email'];

    const matrix = buildTraceabilityMatrix(baseInput({
      requirementSignals: signals,
      changedFilePaths: [
        'src/user/registrationService.ts',
      ],
      diffText: '+  validateEmail(user.email);\n',
      diffTruncated: false,
    }));

    expect(matrix.items).toHaveLength(1);
    const item = matrix.items[0];
    expect(item.coverageStatus).toBe('PARTIALLY_COVERED');
    expect(item.matchedFiles.length).toBeGreaterThanOrEqual(1);
    expect(item.matchedTests).toHaveLength(0);
  });

  // Test 3: AC with no matching file or diff evidence → MISSING
  it('marks AC as MISSING when no matching files or diff evidence found', () => {
    const signals = emptySignals();
    signals.acceptanceCriteria = ['Payment gateway integration stripe webhook'];

    const matrix = buildTraceabilityMatrix(baseInput({
      requirementSignals: signals,
      changedFilePaths: [
        'src/user/profileService.ts',
        'tests/user/profileService.test.ts',
      ],
      diffText: '+  updateProfile(user);\n',
      diffTruncated: false,
    }));

    expect(matrix.items).toHaveLength(1);
    const item = matrix.items[0];
    expect(item.coverageStatus).toBe('MISSING');
    expect(item.matchedFiles).toHaveLength(0);
    expect(item.matchedDiffEvidence).toHaveLength(0);
  });

  // Test 4: Truncated diff with no other evidence → NOT_ENOUGH_EVIDENCE
  it('marks AC as NOT_ENOUGH_EVIDENCE when diff is truncated and no evidence found', () => {
    const signals = emptySignals();
    signals.acceptanceCriteria = ['Export report functionality download button'];

    const matrix = buildTraceabilityMatrix(baseInput({
      requirementSignals: signals,
      changedFilePaths: [],
      diffText: '',
      diffTruncated: true,
    }));

    expect(matrix.items).toHaveLength(1);
    const item = matrix.items[0];
    expect(item.coverageStatus).toBe('NOT_ENOUGH_EVIDENCE');
    expect(item.confidence).toBe('Low');
  });

  // Test 4b: Truncated diff with non-empty diffText but no matching files/evidence → NOT_ENOUGH_EVIDENCE
  it('marks AC as NOT_ENOUGH_EVIDENCE when diff is truncated with non-empty diffText but no matching files or evidence', () => {
    const signals = emptySignals();
    signals.acceptanceCriteria = ['Export report functionality download button'];

    const matrix = buildTraceabilityMatrix(baseInput({
      requirementSignals: signals,
      changedFilePaths: [],
      diffText: '+  someUnrelatedChange();\n+  anotherUnrelatedLine();\n',
      diffTruncated: true,
    }));

    expect(matrix.items).toHaveLength(1);
    const item = matrix.items[0];
    expect(item.coverageStatus).toBe('NOT_ENOUGH_EVIDENCE');
    expect(item.confidence).toBe('Low');
  });

  // Test 5: Confluence signals added as CONF-x items
  it('adds non-duplicate Confluence signals as CONF-x items', () => {
    const signals = emptySignals();
    signals.acceptanceCriteria = ['User login with email and password'];

    const confluenceSignals = emptySignals();
    confluenceSignals.acceptanceCriteria = [
      'Admin dashboard should display analytics report charts',
    ];

    const matrix = buildTraceabilityMatrix(baseInput({
      requirementSignals: signals,
      confluenceSignals,
      changedFilePaths: [],
      diffText: '',
      diffTruncated: false,
    }));

    const confItems = matrix.items.filter(i => i.source === 'confluence');
    expect(confItems.length).toBeGreaterThanOrEqual(1);
    expect(confItems[0].requirementId).toBe('CONF-1');
    expect(confItems[0].sourceAuthority).toBe('medium');
  });

  // Test 6: Confluence duplicate deduplication (>70% word overlap skipped)
  it('deduplicates Confluence ACs that overlap >70% with Jira ACs', () => {
    const signals = emptySignals();
    signals.acceptanceCriteria = [
      'User must login with their email address and password credentials',
    ];

    const confluenceSignals = emptySignals();
    confluenceSignals.acceptanceCriteria = [
      // Very similar to the Jira AC — should be deduplicated
      'User must login with their email address and password credentials',
      // Distinct — should be added
      'Admin dashboard must display student enrollment metrics report',
    ];

    const matrix = buildTraceabilityMatrix(baseInput({
      requirementSignals: signals,
      confluenceSignals,
      changedFilePaths: [],
      diffText: '',
      diffTruncated: false,
    }));

    const confItems = matrix.items.filter(i => i.source === 'confluence');
    // The first confluence AC should be deduplicated, only the distinct one added
    expect(confItems).toHaveLength(1);
    expect(confItems[0].requirementText).toContain('Admin dashboard');
  });

  // Test 7: Business rules produce BR-x items with medium authority
  it('produces BR-x items with medium authority for business rules', () => {
    const signals = emptySignals();
    signals.businessRules = [
      'Users must not be able to delete their account if they have active subscriptions',
    ];

    const matrix = buildTraceabilityMatrix(baseInput({
      requirementSignals: signals,
      changedFilePaths: [],
      diffText: '',
      diffTruncated: false,
    }));

    const brItems = matrix.items.filter(i => i.source === 'business_rule');
    expect(brItems.length).toBeGreaterThanOrEqual(1);
    expect(brItems[0].requirementId).toBe('BR-1');
    expect(brItems[0].sourceAuthority).toBe('medium');
    expect(brItems[0].source).toBe('business_rule');
  });

  // Test 8: Summary counts are correct
  it('computes correct summary counts', () => {
    const signals = emptySignals();
    signals.acceptanceCriteria = [
      // Will be COVERED (has file + test)
      'Login authentication password user',
      // Will be PARTIALLY_COVERED (has file, no test)
      'Dashboard export report data table',
      // Will be MISSING (no match)
      'Webhook stripe payment integration billing',
    ];

    const matrix = buildTraceabilityMatrix(baseInput({
      requirementSignals: signals,
      changedFilePaths: [
        'src/auth/loginService.ts',
        'tests/auth/loginService.test.ts',
        'src/dashboard/exportService.ts',
      ],
      diffText: '+  authenticate(user.password);\n+  exportReport(data);\n',
      diffTruncated: false,
    }));

    expect(matrix.totalRequirements).toBe(3);
    // One item is COVERED
    expect(matrix.covered).toBeGreaterThanOrEqual(1);
    // At least one is MISSING (no webhook/stripe/payment/billing files or diff evidence)
    expect(matrix.missing).toBeGreaterThanOrEqual(1);
    // Summary values should sum to total
    const summedCount =
      matrix.covered +
      matrix.partial +
      matrix.missing +
      matrix.notEnoughEvidence +
      matrix.notApplicable;
    expect(summedCount).toBe(matrix.totalRequirements);
  });

  // Test 9: extractKeywords filters stop words and short words
  it('extractKeywords filters stop words and short words', () => {
    const keywords = extractKeywords('User must login with this form when they have a password');
    expect(keywords).not.toContain('must');
    expect(keywords).not.toContain('with');
    expect(keywords).not.toContain('this');
    expect(keywords).not.toContain('when');
    expect(keywords).not.toContain('they');
    expect(keywords).not.toContain('have');
    expect(keywords).not.toContain('a');
    // Short words should be filtered
    expect(keywords).not.toContain('a');
    // Should contain meaningful words
    expect(keywords).toContain('user');
    expect(keywords).toContain('login');
    expect(keywords).toContain('form');
    expect(keywords).toContain('password');
  });

  it('extractKeywords returns deduplicated words up to 15', () => {
    const text = 'authentication authentication user user login login password password';
    const keywords = extractKeywords(text);
    // Should deduplicate
    const unique = new Set(keywords);
    expect(unique.size).toBe(keywords.length);
    // Should not exceed 15
    expect(keywords.length).toBeLessThanOrEqual(15);
  });

  // Test 10: Empty input → matrix with zero items
  it('returns matrix with zero items for empty signals', () => {
    const matrix = buildTraceabilityMatrix(baseInput());

    expect(matrix.items).toHaveLength(0);
    expect(matrix.totalRequirements).toBe(0);
    expect(matrix.covered).toBe(0);
    expect(matrix.partial).toBe(0);
    expect(matrix.missing).toBe(0);
    expect(matrix.notEnoughEvidence).toBe(0);
    expect(matrix.notApplicable).toBe(0);
    expect(matrix.issueKey).toBe('CMPI-1234');
    expect(matrix.issueSummary).toBe('Test issue');
    expect(matrix.generatedAt).toBeTruthy();
  });

  // Additional: AC assignes correct requirementId sequence
  it('assigns sequential requirementIds for multiple ACs', () => {
    const signals = emptySignals();
    signals.acceptanceCriteria = ['First criterion', 'Second criterion', 'Third criterion'];

    const matrix = buildTraceabilityMatrix(baseInput({
      requirementSignals: signals,
    }));

    const acItems = matrix.items.filter(i => i.source === 'acceptance_criteria');
    expect(acItems[0].requirementId).toBe('AC-1');
    expect(acItems[1].requirementId).toBe('AC-2');
    expect(acItems[2].requirementId).toBe('AC-3');
  });

  // Additional: Business rule overlapping with AC is skipped
  it('skips business rule that duplicates an existing AC', () => {
    const signals = emptySignals();
    signals.acceptanceCriteria = [
      'Users must not be allowed to delete their account with active subscriptions',
    ];
    signals.businessRules = [
      'Users must not be allowed to delete their account with active subscriptions',
    ];

    const matrix = buildTraceabilityMatrix(baseInput({
      requirementSignals: signals,
    }));

    const brItems = matrix.items.filter(i => i.source === 'business_rule');
    // The BR should be skipped because it duplicates the AC
    expect(brItems).toHaveLength(0);
  });

  // Additional: matched diff evidence is limited to 3 snippets
  it('limits matched diff evidence to 3 snippets', () => {
    const signals = emptySignals();
    signals.acceptanceCriteria = ['authentication login user password'];

    const diffLines = [
      '+  authentication.verify()',
      '+  login(user)',
      '+  password.validate()',
      '+  authentication.session.create()',
      '+  login.audit.log()',
    ].join('\n');

    const matrix = buildTraceabilityMatrix(baseInput({
      requirementSignals: signals,
      changedFilePaths: ['src/auth/service.ts'],
      diffText: diffLines,
      diffTruncated: false,
    }));

    expect(matrix.items[0].matchedDiffEvidence.length).toBeLessThanOrEqual(3);
  });

  // Additional: generatedAt is a valid ISO date string
  it('sets generatedAt to a valid ISO date string', () => {
    const matrix = buildTraceabilityMatrix(baseInput());
    expect(() => new Date(matrix.generatedAt)).not.toThrow();
    expect(new Date(matrix.generatedAt).toISOString()).toBe(matrix.generatedAt);
  });

  // Additional: Medium confidence when diff is truncated but files match
  it('assigns Medium confidence when diff is truncated even if files match', () => {
    const signals = emptySignals();
    signals.acceptanceCriteria = ['Login authentication user password form'];

    const matrix = buildTraceabilityMatrix(baseInput({
      requirementSignals: signals,
      changedFilePaths: [
        'src/auth/loginHandler.ts',
        'tests/auth/loginHandler.test.ts',
      ],
      diffText: '+  authenticate(user.password);\n',
      diffTruncated: true,
    }));

    // With truncated diff but matching files: could be COVERED or PARTIALLY_COVERED
    // but confidence should be Medium (not High) due to truncation
    const item = matrix.items[0];
    expect(item.confidence).toBe('Medium');
  });
});
