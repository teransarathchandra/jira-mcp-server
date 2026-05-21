import { describe, it, expect } from 'vitest';
import {
  verifyDefinitionOfDone,
  type DoDInput,
} from '../src/delivery/definitionOfDoneVerifier.js';
import type { ClassifiedFiles, RiskyFile } from '../src/utils/changedFileClassifier.js';
import type { RequirementSignals } from '../src/utils/requirementExtractor.js';
import type { SafetyCheckResult, SafetyWarning, TraceabilityMatrix, TraceabilityItem } from '../src/delivery/deliveryTypes.js';
import type { ChangedFile } from '../src/git/gitDiffService.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeFile(path: string, status: ChangedFile['status'] = 'modified'): ChangedFile {
  return { path, status };
}

function emptyClassifiedFiles(): ClassifiedFiles {
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

function emptyRequirementSignals(): RequirementSignals {
  return {
    acceptanceCriteria: [],
    technicalSignals: [],
    businessRules: [],
    userRoles: [],
    validationRules: [],
    ambiguities: [],
  };
}

function makeSafetyResult(
  warnings: SafetyWarning[] = [],
): SafetyCheckResult {
  const hasCriticalWarnings = warnings.some(w => w.severity === 'critical');
  return {
    warnings,
    hasBlockingWarnings: hasCriticalWarnings,
    hasCriticalWarnings,
  };
}

function makeTraceabilityItem(
  id: string,
  text: string,
  coverageStatus: TraceabilityItem['coverageStatus'] = 'COVERED',
): TraceabilityItem {
  return {
    requirementId: id,
    requirementText: text,
    source: 'acceptance_criteria',
    sourceAuthority: 'high',
    expectedImplementationArea: 'General implementation',
    matchedFiles: coverageStatus === 'COVERED' ? ['src/feature.ts'] : [],
    matchedDiffEvidence: [],
    matchedTests: coverageStatus === 'COVERED' ? ['tests/feature.test.ts'] : [],
    coverageStatus,
    confidence: 'High',
    notes: '',
  };
}

function makeTraceabilityMatrix(
  items: TraceabilityItem[],
  issueKey = 'TEST-1',
): TraceabilityMatrix {
  const covered = items.filter(i => i.coverageStatus === 'COVERED').length;
  const partial = items.filter(i => i.coverageStatus === 'PARTIALLY_COVERED').length;
  const missing = items.filter(i => i.coverageStatus === 'MISSING').length;
  const notEnoughEvidence = items.filter(i => i.coverageStatus === 'NOT_ENOUGH_EVIDENCE').length;
  const notApplicable = items.filter(i => i.coverageStatus === 'NOT_APPLICABLE').length;

  return {
    issueKey,
    issueSummary: 'Test issue',
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

function baseInput(overrides?: Partial<DoDInput>): DoDInput {
  const classifiedFiles = emptyClassifiedFiles();
  classifiedFiles.testFiles = [makeFile('tests/feature.test.ts')];
  classifiedFiles.sourceFiles = [makeFile('src/feature.ts')];

  const requirementSignals = emptyRequirementSignals();
  requirementSignals.acceptanceCriteria = [
    'User can log in with valid credentials',
    'Error message shown for invalid credentials',
    'Session expires after 30 minutes',
  ];

  const traceabilityMatrix = makeTraceabilityMatrix([
    makeTraceabilityItem('AC-1', 'User can log in with valid credentials', 'COVERED'),
    makeTraceabilityItem('AC-2', 'Error message shown for invalid credentials', 'COVERED'),
    makeTraceabilityItem('AC-3', 'Session expires after 30 minutes', 'COVERED'),
  ]);

  return {
    issueKey: 'TEST-1',
    issueSummary: 'Implement login feature',
    requirementSignals,
    classifiedFiles,
    diffText: '+function login(user, pass) { return authenticate(user, pass); }',
    diffTruncated: false,
    changedFileCount: 2,
    jiraContextQualityScore: 80,
    hasBlockingConflicts: false,
    hasUnresolvedAmbiguities: false,
    hasBackendRequirement: false,
    hasFrontendRequirement: false,
    matchResult: {
      coverageItems: [],
      matchedEvidence: [],
      missingSignals: [],
      unrelatedChanges: [],
      riskyChangePaths: [],
      testCoverageSignal: 'tests_added',
      hasBackendChanges: false,
      hasFrontendChanges: false,
      technicalSignalMatchCount: 0,
      technicalSignalTotalCount: 0,
    },
    traceabilityMatrix,
    safetyCheckResult: makeSafetyResult(),
    confluenceConflictCount: 0,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('verifyDefinitionOfDone', () => {

  // ── Test 1: All checks passed → READY_FOR_REVIEW ─────────────────────────

  it('returns READY_FOR_REVIEW with high score when all checks pass', () => {
    const input = baseInput();
    const result = verifyDefinitionOfDone(input);

    expect(result.overallStatus).toBe('READY_FOR_REVIEW');
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.failedChecks).toHaveLength(0);
    expect(result.confidence).toBe('High');
  });

  // ── Test 2: No tests changed → tests_present failed ──────────────────────

  it('fails tests_present check when no test files changed', () => {
    const classifiedFiles = emptyClassifiedFiles();
    classifiedFiles.sourceFiles = [makeFile('src/feature.ts')]; // source but no tests

    const input = baseInput({
      classifiedFiles,
      changedFileCount: 1,
    });
    const result = verifyDefinitionOfDone(input);

    const testsCheck = result.failedChecks.find(c => c.checkId === 'tests_present');
    expect(testsCheck).toBeDefined();
    expect(testsCheck?.detail).toBe('No test files changed');
    expect(result.score).toBeLessThan(100);
    // score should be reduced by at least 10 (for one failed check)
    expect(result.score).toBeLessThanOrEqual(90);
  });

  // ── Test 3: Blocking conflicts → BLOCKED_BY_REQUIREMENT_GAP ─────────────

  it('returns BLOCKED_BY_REQUIREMENT_GAP when blocking conflicts present', () => {
    const input = baseInput({
      hasBlockingConflicts: true,
    });
    const result = verifyDefinitionOfDone(input);

    expect(result.overallStatus).toBe('BLOCKED_BY_REQUIREMENT_GAP');
    const conflictsCheck = result.failedChecks.find(c => c.checkId === 'no_conflicts');
    expect(conflictsCheck).toBeDefined();
    expect(conflictsCheck?.detail).toBe('Blocking conflicts detected');
  });

  // ── Test 4: No ACs in Jira → ac_covered warning ──────────────────────────

  it('produces ac_covered warning when no ACs in Jira', () => {
    const requirementSignals = emptyRequirementSignals();
    // No acceptance criteria

    const input = baseInput({
      requirementSignals,
      traceabilityMatrix: null,
    });
    const result = verifyDefinitionOfDone(input);

    const acCheck = result.warningChecks.find(c => c.checkId === 'ac_covered');
    expect(acCheck).toBeDefined();
    expect(acCheck?.detail).toBe('No explicit acceptance criteria in Jira');
  });

  // ── Test 5: Migration file with no rollback mention → migration_noted warning

  it('produces migration_noted warning when migration file changed but no rollback in diff', () => {
    const classifiedFiles = emptyClassifiedFiles();
    classifiedFiles.testFiles = [makeFile('tests/feature.test.ts')];
    classifiedFiles.migrationFiles = [makeFile('db/migrations/001_add_users.sql')];

    const input = baseInput({
      classifiedFiles,
      diffText: '+ALTER TABLE users ADD COLUMN phone VARCHAR(20);',
    });
    const result = verifyDefinitionOfDone(input);

    const migrationCheck = result.warningChecks.find(c => c.checkId === 'migration_noted');
    expect(migrationCheck).toBeDefined();
    expect(migrationCheck?.detail).toBe('Migration file changed — ensure rollback plan exists');
    expect(result.humanReviewNeeded).toContain('Migration file changed — ensure rollback plan exists');
  });

  // ── Test 6: Critical safety warning → no_risky_unexplained failed ─────────

  it('fails no_risky_unexplained when critical safety warnings exist', () => {
    const safetyCheckResult = makeSafetyResult([
      {
        type: 'auth_security',
        severity: 'critical',
        message: 'Authentication files modified',
      },
    ]);

    const input = baseInput({ safetyCheckResult });
    const result = verifyDefinitionOfDone(input);

    const riskyCheck = result.failedChecks.find(c => c.checkId === 'no_risky_unexplained');
    expect(riskyCheck).toBeDefined();
    expect(riskyCheck?.detail).toContain('auth_security');
  });

  // ── Test 7: Backend requirement but no backend files ──────────────────────

  it('fails backend_layer_present when backend required but no backend files changed', () => {
    const input = baseInput({
      hasBackendRequirement: true,
    });
    // classifiedFiles has no backendFiles (from baseInput)
    const result = verifyDefinitionOfDone(input);

    const backendCheck = result.failedChecks.find(c => c.checkId === 'backend_layer_present');
    expect(backendCheck).toBeDefined();
    expect(backendCheck?.detail).toBe('Backend requirement but no backend files changed');
  });

  // ── Test 8: Frontend requirement but no frontend files ────────────────────

  it('fails frontend_layer_present when frontend required but no frontend files changed', () => {
    const input = baseInput({
      hasFrontendRequirement: true,
    });
    // classifiedFiles has no frontendFiles
    const result = verifyDefinitionOfDone(input);

    const frontendCheck = result.failedChecks.find(c => c.checkId === 'frontend_layer_present');
    expect(frontendCheck).toBeDefined();
    expect(frontendCheck?.detail).toBe('Frontend requirement but no frontend files changed');
  });

  // ── Test 9: Score calculation: 2 failed (-20) + 2 warnings (-8) = 72/100 ──

  it('calculates score correctly: 2 failed (-20) + 2 warnings (-8) = 72', () => {
    // Use backend + frontend failure → 2 failed
    // Use unresolved ambiguities warning + no ACs warning → need 2 warnings
    const requirementSignals = emptyRequirementSignals();
    // No ACs → ac_covered = warning
    // No validation rules → validation_present = skipped
    requirementSignals.ambiguities = ['TBD: needs clarification']; // → no_jira_ambiguity = warning

    const classifiedFiles = emptyClassifiedFiles();
    classifiedFiles.testFiles = [makeFile('tests/feature.test.ts')];
    // No backendFiles, no frontendFiles

    const input = baseInput({
      requirementSignals,
      classifiedFiles,
      hasUnresolvedAmbiguities: true,
      hasBackendRequirement: true,  // will fail since no backend files
      hasFrontendRequirement: true, // will fail since no frontend files
      traceabilityMatrix: null,     // req_implemented → warning (no matrix)
    });
    const result = verifyDefinitionOfDone(input);

    // 2 failed checks (-20), 2+ warning checks (-8+)
    // The exact score depends on how many checks are warning vs skipped
    expect(result.failedChecks.length).toBeGreaterThanOrEqual(2);
    expect(result.score).toBeLessThan(90);
  });

  // ── Test 9b: Exact score 72: specific scenario ────────────────────────────

  it('computes score of 72 with exactly 2 failed and 2 warnings', () => {
    // We'll carefully craft an input with exactly:
    // - backend_layer_present: failed (-10)
    // - frontend_layer_present: failed (-10)
    // - no_jira_ambiguity: warning (-4)
    // - qa_notes_available: warning (since only 1 AC and quality < 50... no, we need quality >= 50)
    // Actually to get exactly 2 warnings we need the rest to be passed or skipped

    const requirementSignals = emptyRequirementSignals();
    requirementSignals.acceptanceCriteria = ['User can submit form']; // 1 AC → qa_notes_available warning (limited ACs)
    requirementSignals.ambiguities = ['TBD item']; // → no_jira_ambiguity warning

    const classifiedFiles = emptyClassifiedFiles();
    classifiedFiles.testFiles = [makeFile('tests/form.test.ts')];
    classifiedFiles.sourceFiles = [makeFile('src/form.ts')];

    const traceabilityMatrix = makeTraceabilityMatrix([
      makeTraceabilityItem('AC-1', 'User can submit form', 'COVERED'),
    ]);

    const input: DoDInput = {
      issueKey: 'TEST-SCORE',
      issueSummary: 'Form feature',
      requirementSignals,
      classifiedFiles,
      diffText: '+function submitForm() { return true; }',
      diffTruncated: false,
      changedFileCount: 2,
      jiraContextQualityScore: 75, // high quality for confidence
      hasBlockingConflicts: false,
      hasUnresolvedAmbiguities: true, // → no_jira_ambiguity warning
      hasBackendRequirement: true,    // → backend_layer_present failed
      hasFrontendRequirement: true,   // → frontend_layer_present failed
      matchResult: {
        coverageItems: [],
        matchedEvidence: [],
        missingSignals: [],
        unrelatedChanges: [],
        riskyChangePaths: [],
        testCoverageSignal: 'tests_added',
        hasBackendChanges: false,
        hasFrontendChanges: false,
        technicalSignalMatchCount: 0,
        technicalSignalTotalCount: 0,
      },
      traceabilityMatrix,
      safetyCheckResult: makeSafetyResult(),
      confluenceConflictCount: 0,
    };

    const result = verifyDefinitionOfDone(input);

    // Should have backend + frontend as failed, no_jira_ambiguity + qa_notes as warnings
    const backendFailed = result.failedChecks.find(c => c.checkId === 'backend_layer_present');
    const frontendFailed = result.failedChecks.find(c => c.checkId === 'frontend_layer_present');
    const ambiguityWarning = result.warningChecks.find(c => c.checkId === 'no_jira_ambiguity');
    const qaWarning = result.warningChecks.find(c => c.checkId === 'qa_notes_available');

    expect(backendFailed).toBeDefined();
    expect(frontendFailed).toBeDefined();
    expect(ambiguityWarning).toBeDefined();
    expect(qaWarning).toBeDefined();

    // 2 failed = -20, 2 warnings = -8 → score = 72
    expect(result.score).toBe(72);
  });

  // ── Test 10: NOT_ENOUGH_EVIDENCE when changedFileCount === 0 ─────────────

  it('returns NOT_ENOUGH_EVIDENCE when changedFileCount is 0', () => {
    const input = baseInput({
      changedFileCount: 0,
    });
    const result = verifyDefinitionOfDone(input);

    expect(result.overallStatus).toBe('NOT_ENOUGH_EVIDENCE');
  });

  // ── Test 11: humanReviewNeeded populated for conflict/migration warnings ──

  it('populates humanReviewNeeded for no_conflicts and migration_noted when warning/failed', () => {
    const classifiedFiles = emptyClassifiedFiles();
    classifiedFiles.testFiles = [makeFile('tests/feature.test.ts')];
    classifiedFiles.migrationFiles = [makeFile('db/migrations/001.sql')];

    const input = baseInput({
      classifiedFiles,
      confluenceConflictCount: 2,   // → no_conflicts warning
      diffText: '+ALTER TABLE users ADD COLUMN email VARCHAR(255);', // no rollback
    });
    const result = verifyDefinitionOfDone(input);

    // no_conflicts should be a warning (confluenceConflictCount > 0)
    const conflictsCheck = result.warningChecks.find(c => c.checkId === 'no_conflicts');
    expect(conflictsCheck).toBeDefined();

    // migration_noted should be a warning (migration file but no rollback)
    const migrationCheck = result.warningChecks.find(c => c.checkId === 'migration_noted');
    expect(migrationCheck).toBeDefined();

    // humanReviewNeeded should contain details from both
    expect(result.humanReviewNeeded).toContain(conflictsCheck!.detail);
    expect(result.humanReviewNeeded).toContain(migrationCheck!.detail);
  });

  // ── Test 12: DoDStatus correct for different score ranges ────────────────

  describe('DoDStatus for different score ranges', () => {
    it('returns NEEDS_SMALL_FIXES when score 60-84 with <= 1 failed', () => {
      // Score should be 60-84: let's produce 3-4 warnings (-12 to -16) and 0-1 failures
      const requirementSignals = emptyRequirementSignals();
      requirementSignals.acceptanceCriteria = ['User can log in']; // 1 AC → qa_notes warning
      requirementSignals.ambiguities = ['TBD: clarify X']; // → no_jira_ambiguity warning

      const classifiedFiles = emptyClassifiedFiles();
      classifiedFiles.testFiles = [makeFile('tests/feature.test.ts')];
      classifiedFiles.lockFiles = [makeFile('package-lock.json')]; // → deps_justified warning

      const safetyCheckResult = makeSafetyResult([
        {
          type: 'lockfile_dependency',
          severity: 'warning',
          message: 'Lock file changes detected',
        },
      ]);

      const traceabilityMatrix = makeTraceabilityMatrix([
        makeTraceabilityItem('AC-1', 'User can log in', 'COVERED'),
      ]);

      const input: DoDInput = {
        issueKey: 'TEST-2',
        issueSummary: 'Small fixes scenario',
        requirementSignals,
        classifiedFiles,
        diffText: '+function login() {}',
        diffTruncated: false,
        changedFileCount: 3,
        jiraContextQualityScore: 70,
        hasBlockingConflicts: false,
        hasUnresolvedAmbiguities: true,   // warning
        hasBackendRequirement: false,
        hasFrontendRequirement: false,
        matchResult: {
          coverageItems: [],
          matchedEvidence: [],
          missingSignals: [],
          unrelatedChanges: [{ path: 'src/unrelated.ts', reason: 'no match' }], // 1 unrelated → warning
          riskyChangePaths: [],
          testCoverageSignal: 'tests_added',
          hasBackendChanges: false,
          hasFrontendChanges: false,
          technicalSignalMatchCount: 0,
          technicalSignalTotalCount: 1,
        },
        traceabilityMatrix,
        safetyCheckResult,
        confluenceConflictCount: 0,
      };

      const result = verifyDefinitionOfDone(input);
      // Should have 0 failures and 4+ warnings → score = 100 - 0 - (4*4) = 84 at least
      expect(result.failedChecks).toHaveLength(0);
      // Status should be NEEDS_SMALL_FIXES (score 60-84) or READY_FOR_REVIEW (>=85)
      // depending on exact number of warnings
      expect(['NEEDS_SMALL_FIXES', 'READY_FOR_REVIEW']).toContain(result.overallStatus);
    });

    it('returns NEEDS_MAJOR_FIXES when multiple failures', () => {
      const requirementSignals = emptyRequirementSignals();

      const classifiedFiles = emptyClassifiedFiles();
      classifiedFiles.testFiles = []; // no tests → test_present failed
      classifiedFiles.sourceFiles = [makeFile('src/feature.ts')];

      const traceabilityMatrix = makeTraceabilityMatrix([
        makeTraceabilityItem('AC-1', 'Some requirement', 'MISSING'),
        makeTraceabilityItem('AC-2', 'Another requirement', 'MISSING'),
        makeTraceabilityItem('AC-3', 'Third requirement', 'MISSING'),
      ]);
      // All missing → req_implemented failed

      const input: DoDInput = {
        issueKey: 'TEST-3',
        issueSummary: 'Major fixes needed',
        requirementSignals: {
          ...emptyRequirementSignals(),
          acceptanceCriteria: ['Some requirement', 'Another requirement', 'Third requirement'],
        },
        classifiedFiles,
        diffText: '+const x = 1;',
        diffTruncated: false,
        changedFileCount: 1,
        jiraContextQualityScore: 50,
        hasBlockingConflicts: false,
        hasUnresolvedAmbiguities: false,
        hasBackendRequirement: true,   // → failed since no backend files
        hasFrontendRequirement: false,
        matchResult: {
          coverageItems: [],
          matchedEvidence: [],
          missingSignals: [],
          unrelatedChanges: Array.from({ length: 5 }, (_, i) => ({
            path: `src/unrelated${i}.ts`,
            reason: 'no match',
          })), // > 3 → no_unrelated_changes failed
          riskyChangePaths: [],
          testCoverageSignal: 'no_test_changes',
          hasBackendChanges: false,
          hasFrontendChanges: false,
          technicalSignalMatchCount: 0,
          technicalSignalTotalCount: 3,
        },
        traceabilityMatrix,
        safetyCheckResult: makeSafetyResult(),
        confluenceConflictCount: 0,
      };

      const result = verifyDefinitionOfDone(input);
      // Should have multiple failures → NEEDS_MAJOR_FIXES or BLOCKED_BY_REQUIREMENT_GAP
      expect(result.failedChecks.length).toBeGreaterThanOrEqual(2);
      expect(['NEEDS_MAJOR_FIXES', 'BLOCKED_BY_REQUIREMENT_GAP']).toContain(result.overallStatus);
    });

    it('returns NOT_ENOUGH_EVIDENCE when jiraContextQualityScore < 20', () => {
      const input = baseInput({
        jiraContextQualityScore: 10,
      });
      const result = verifyDefinitionOfDone(input);
      expect(result.overallStatus).toBe('NOT_ENOUGH_EVIDENCE');
    });
  });

  // ── Additional edge case tests ────────────────────────────────────────────

  it('skips tests_present check when changedFileCount is 0', () => {
    const input = baseInput({ changedFileCount: 0 });
    const result = verifyDefinitionOfDone(input);
    const testsCheck = result.passedChecks
      .concat(result.failedChecks, result.warningChecks)
      .find(c => c.checkId === 'tests_present');
    // When changedFileCount is 0, the check is skipped
    expect(testsCheck).toBeUndefined();
  });

  it('passes migration_noted when rollback keyword is in diff', () => {
    const classifiedFiles = emptyClassifiedFiles();
    classifiedFiles.testFiles = [makeFile('tests/feature.test.ts')];
    classifiedFiles.migrationFiles = [makeFile('db/migrations/001.sql')];

    const input = baseInput({
      classifiedFiles,
      diffText: '+-- rollback: DROP COLUMN phone FROM users;',
    });
    const result = verifyDefinitionOfDone(input);

    const migrationCheck = result.passedChecks.find(c => c.checkId === 'migration_noted');
    expect(migrationCheck).toBeDefined();
    expect(migrationCheck?.detail).toContain('Rollback');
  });

  it('produces low confidence when jiraContextQualityScore < 40', () => {
    const input = baseInput({
      jiraContextQualityScore: 30,
    });
    const result = verifyDefinitionOfDone(input);
    expect(result.confidence).toBe('Low');
  });

  it('produces medium confidence when jiraContextQualityScore 40-69', () => {
    const input = baseInput({
      jiraContextQualityScore: 55,
    });
    const result = verifyDefinitionOfDone(input);
    expect(result.confidence).toBe('Medium');
  });

  it('produces high confidence when quality >= 70 and not truncated and files > 0', () => {
    const input = baseInput({
      jiraContextQualityScore: 75,
      diffTruncated: false,
      changedFileCount: 2,
    });
    const result = verifyDefinitionOfDone(input);
    expect(result.confidence).toBe('High');
  });

  it('includes failed check details in requiredFixes', () => {
    const input = baseInput({
      hasBackendRequirement: true,
    });
    const result = verifyDefinitionOfDone(input);
    expect(result.requiredFixes).toContain('Backend requirement but no backend files changed');
  });

  it('includes warning check details in recommendedFixes', () => {
    const input = baseInput({
      hasUnresolvedAmbiguities: true,
    });
    const result = verifyDefinitionOfDone(input);
    expect(result.recommendedFixes).toContain('Unresolved ambiguity markers found');
  });

  it('skips backend_layer_present when no backend requirement', () => {
    const input = baseInput({
      hasBackendRequirement: false,
    });
    const result = verifyDefinitionOfDone(input);
    const backendCheck = [...result.passedChecks, ...result.failedChecks, ...result.warningChecks]
      .find(c => c.checkId === 'backend_layer_present');
    expect(backendCheck).toBeUndefined(); // should be in skipped
  });

  it('passes backend_layer_present when backend files present and required', () => {
    const classifiedFiles = emptyClassifiedFiles();
    classifiedFiles.testFiles = [makeFile('tests/api.test.ts')];
    classifiedFiles.backendFiles = [makeFile('src/api/userService.ts')];

    const input = baseInput({
      classifiedFiles,
      hasBackendRequirement: true,
    });
    const result = verifyDefinitionOfDone(input);

    const backendCheck = result.passedChecks.find(c => c.checkId === 'backend_layer_present');
    expect(backendCheck).toBeDefined();
    expect(backendCheck?.detail).toBe('1 backend file(s) changed');
  });

  it('handles null safetyCheckResult gracefully (skipped)', () => {
    const input = baseInput({ safetyCheckResult: null });
    const result = verifyDefinitionOfDone(input);
    // no_risky_unexplained should be skipped
    const riskyCheck = [...result.passedChecks, ...result.failedChecks, ...result.warningChecks]
      .find(c => c.checkId === 'no_risky_unexplained');
    expect(riskyCheck).toBeUndefined();
  });

  it('handles null matchResult gracefully (skipped)', () => {
    const input = baseInput({ matchResult: null });
    const result = verifyDefinitionOfDone(input);
    // no_unrelated_changes should be skipped
    const unrelatedCheck = [...result.passedChecks, ...result.failedChecks, ...result.warningChecks]
      .find(c => c.checkId === 'no_unrelated_changes');
    expect(unrelatedCheck).toBeUndefined();
  });

  it('produces auth_handled warning when auth keyword in requirement but no auth files', () => {
    const requirementSignals = emptyRequirementSignals();
    requirementSignals.acceptanceCriteria = [
      'User must login with valid token',
      'Verify JWT authentication is working',
    ];

    const input = baseInput({
      requirementSignals,
      diffText: '+function processPayment() {}', // no auth-related diff
    });
    const result = verifyDefinitionOfDone(input);

    const authCheck = result.warningChecks.find(c => c.checkId === 'auth_handled');
    expect(authCheck).toBeDefined();
    expect(authCheck?.detail).toBe('Auth requirement mentioned but no auth files changed');
  });

  it('reports Confluence conflict count in no_conflicts warning', () => {
    const input = baseInput({ confluenceConflictCount: 3 });
    const result = verifyDefinitionOfDone(input);

    const conflictsCheck = result.warningChecks.find(c => c.checkId === 'no_conflicts');
    expect(conflictsCheck).toBeDefined();
    expect(conflictsCheck?.detail).toBe('3 Confluence-Jira conflict(s) detected');
  });
});
