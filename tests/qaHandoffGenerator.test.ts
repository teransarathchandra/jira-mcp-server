import { describe, it, expect } from 'vitest';
import { generateQaHandoff, type QaHandoffInput } from '../src/delivery/qaHandoffGenerator.js';
import type { ImpactAnalysis } from '../src/delivery/deliveryTypes.js';
import type { RequirementSignals } from '../src/utils/requirementExtractor.js';
import type { ClassifiedFiles, RiskyFile } from '../src/utils/changedFileClassifier.js';
import type { ChangedFile } from '../src/git/gitDiffService.js';

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

function emptyImpact(overrides: Partial<ImpactAnalysis> = {}): ImpactAnalysis {
  return {
    issueKey: 'TEST-1',
    issueSummary: 'Default summary',
    likelyAffectedAreas: [],
    frontend: [],
    backend: [],
    api: [],
    database: [],
    auth: [],
    validation: [],
    testImpact: [],
    riskyDownstreamFlows: [],
    unknowns: [],
    repoInspectionPlan: [],
    ...overrides,
  };
}

function frontendImpact(): ImpactAnalysis {
  return emptyImpact({
    likelyAffectedAreas: ['Frontend UI'],
    frontend: [
      {
        area: 'Frontend UI',
        description: 'UI components need changes.',
        searchHints: ['Search for: component files'],
        confidence: 'High',
      },
    ],
  });
}

function backendImpact(): ImpactAnalysis {
  return emptyImpact({
    likelyAffectedAreas: ['Backend Service'],
    backend: [
      {
        area: 'Backend Service',
        description: 'Server-side services need changes.',
        searchHints: [],
        confidence: 'Medium',
      },
    ],
  });
}

function authImpact(): ImpactAnalysis {
  return emptyImpact({
    likelyAffectedAreas: ['Auth / Permissions'],
    auth: [
      {
        area: 'Auth / Permissions',
        description: 'Auth logic needs changes.',
        searchHints: [],
        confidence: 'High',
      },
    ],
  });
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

function makeFile(path: string, status: ChangedFile['status'] = 'modified'): ChangedFile {
  return { path, status };
}

function makeInput(overrides: Partial<QaHandoffInput> = {}): QaHandoffInput {
  return {
    issueKey: 'TEST-1',
    issueSummary: 'Default issue summary',
    issueDescription: 'Default issue description text.',
    requirementSignals: emptySignals(),
    confluenceSignals: null,
    classifiedFiles: null,
    diffText: null,
    changedFilePaths: [],
    impactAnalysis: emptyImpact(),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('generateQaHandoff', () => {

  // 1. ACs → whatToTest populated with AC items
  it('populates whatToTest with acceptance criteria items', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      acceptanceCriteria: ['User can log in', 'User sees dashboard'],
    };
    const result = generateQaHandoff(makeInput({ requirementSignals: signals }));

    expect(result.whatToTest).toContain('User can log in');
    expect(result.whatToTest).toContain('User sees dashboard');
  });

  // 2. Frontend impact → "Verify UI renders correctly" in whatToTest
  it('adds "Verify UI renders correctly" when frontend impact detected', () => {
    const result = generateQaHandoff(
      makeInput({ impactAnalysis: frontendImpact() }),
    );

    expect(result.whatToTest).toContain('Verify UI renders correctly');
  });

  it('does NOT add "Verify UI renders correctly" when no frontend impact', () => {
    const result = generateQaHandoff(makeInput({ impactAnalysis: emptyImpact() }));

    expect(result.whatToTest).not.toContain('Verify UI renders correctly');
  });

  // 3. User roles → testDataPreconditions includes role accounts
  it('includes role-based test account in testDataPreconditions for each user role', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      userRoles: ['admin', 'editor'],
    };
    const result = generateQaHandoff(makeInput({ requirementSignals: signals }));

    const allPreconditions = result.testDataPreconditions.join(' ');
    expect(allPreconditions).toContain('admin');
    expect(allPreconditions).toContain('editor');
  });

  it('always includes "Clean test environment" in testDataPreconditions', () => {
    const result = generateQaHandoff(makeInput());

    expect(result.testDataPreconditions).toContain('Clean test environment');
  });

  // 4. Validation rules → negativeCases includes invalid input
  it('includes invalid input case in negativeCases when validation rules present', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      validationRules: ['Email must be valid format'],
    };
    const result = generateQaHandoff(makeInput({ requirementSignals: signals }));

    expect(result.negativeCases.some((c) => c.toLowerCase().includes('invalid'))).toBe(true);
  });

  it('does NOT include invalid input in negativeCases when no validation rules', () => {
    const result = generateQaHandoff(makeInput({ requirementSignals: emptySignals() }));

    expect(result.negativeCases.some((c) => c.toLowerCase().includes('invalid input submitted'))).toBe(false);
  });

  // 5. Risky migration file → knownRisks includes "Data migration risk"
  it('includes "Data migration risk" in knownRisks when migration risky file present', () => {
    const migrationFile = makeFile('db/migrations/20240101_add_users.sql');
    const riskyFiles: RiskyFile[] = [
      { file: migrationFile, reasons: ['database_migration'] },
    ];
    const classified: ClassifiedFiles = {
      ...emptyClassifiedFiles(),
      migrationFiles: [migrationFile],
      riskyFiles,
    };
    const result = generateQaHandoff(
      makeInput({
        classifiedFiles: classified,
        changedFilePaths: ['db/migrations/20240101_add_users.sql'],
      }),
    );

    expect(result.knownRisks).toContain('Data migration risk');
  });

  it('includes "Auth flow risk" in knownRisks when auth risky file present', () => {
    const authFile = makeFile('src/auth/tokenService.ts');
    const riskyFiles: RiskyFile[] = [
      { file: authFile, reasons: ['auth_or_permissions'] },
    ];
    const classified: ClassifiedFiles = {
      ...emptyClassifiedFiles(),
      riskyFiles,
      sourceFiles: [authFile],
    };
    const result = generateQaHandoff(
      makeInput({
        classifiedFiles: classified,
        changedFilePaths: ['src/auth/tokenService.ts'],
      }),
    );

    expect(result.knownRisks).toContain('Auth flow risk');
  });

  // 6. Ambiguities → openQuestions populated
  it('populates openQuestions from requirementSignals.ambiguities', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      ambiguities: ['TBD: What happens on timeout?', 'Unclear how errors are handled'],
    };
    const result = generateQaHandoff(makeInput({ requirementSignals: signals }));

    expect(result.openQuestions).toContain('TBD: What happens on timeout?');
    expect(result.openQuestions).toContain('Unclear how errors are handled');
  });

  it('caps openQuestions at 5 items', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      ambiguities: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7'],
    };
    const result = generateQaHandoff(makeInput({ requirementSignals: signals }));

    expect(result.openQuestions.length).toBeLessThanOrEqual(5);
  });

  it('returns empty openQuestions when no ambiguities', () => {
    const result = generateQaHandoff(makeInput({ requirementSignals: emptySignals() }));

    expect(result.openQuestions).toEqual([]);
  });

  // 7. changedFilesSummary groups files by category
  it('groups changedFilesSummary by category', () => {
    const sourceFile = makeFile('src/feature.ts');
    const testFile = makeFile('tests/feature.test.ts');
    const configFile = makeFile('tsconfig.json');
    const classified: ClassifiedFiles = {
      ...emptyClassifiedFiles(),
      sourceFiles: [sourceFile],
      testFiles: [testFile],
      configFiles: [configFile],
    };
    const result = generateQaHandoff(
      makeInput({
        classifiedFiles: classified,
        changedFilePaths: ['src/feature.ts', 'tests/feature.test.ts', 'tsconfig.json'],
      }),
    );

    const summary = result.changedFilesSummary.join('\n');
    expect(summary).toContain('Source files: 1');
    expect(summary).toContain('Test files: 1');
    expect(summary).toContain('Config files: 1');
  });

  // 8. Empty description → featureSummary falls back to issueSummary
  it('falls back featureSummary to issueSummary when description is empty', () => {
    const result = generateQaHandoff(
      makeInput({
        issueDescription: '',
        issueSummary: 'Add dark mode support',
      }),
    );

    expect(result.featureSummary).toBe('Add dark mode support');
  });

  it('uses first 200 chars of description as featureSummary when description present', () => {
    const longDesc = 'A'.repeat(300);
    const result = generateQaHandoff(
      makeInput({ issueDescription: longDesc }),
    );

    expect(result.featureSummary.length).toBe(200);
  });

  // 9. No ACs → happyPath derived from issueSummary
  it('derives happyPath from issueSummary when no acceptance criteria', () => {
    const result = generateQaHandoff(
      makeInput({
        issueSummary: 'Export report as PDF',
        requirementSignals: emptySignals(),
      }),
    );

    expect(result.happyPath.length).toBeGreaterThan(0);
    expect(result.happyPath[0]).toContain('Export report as PDF');
  });

  it('builds happyPath from ACs when acceptance criteria are present', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      acceptanceCriteria: ['User clicks export', 'PDF downloads'],
    };
    const result = generateQaHandoff(makeInput({ requirementSignals: signals }));

    expect(result.happyPath).toContain('User clicks export');
    expect(result.happyPath).toContain('PDF downloads');
  });

  // 10. Auth signals → "Existing authentication flows" in regressionAreas
  it('includes "Existing authentication flows" in regressionAreas when auth impact detected', () => {
    const result = generateQaHandoff(
      makeInput({ impactAnalysis: authImpact() }),
    );

    expect(result.regressionAreas).toContain('Existing authentication flows');
  });

  it('includes "Existing authentication flows" when auth keyword in AC', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      acceptanceCriteria: ['Only authenticated users can access the dashboard'],
    };
    const result = generateQaHandoff(makeInput({ requirementSignals: signals }));

    expect(result.regressionAreas).toContain('Existing authentication flows');
  });

  it('does NOT include "Existing authentication flows" when no auth signals', () => {
    const result = generateQaHandoff(
      makeInput({
        requirementSignals: emptySignals(),
        impactAnalysis: emptyImpact(),
      }),
    );

    expect(result.regressionAreas).not.toContain('Existing authentication flows');
  });

  // Output shape checks
  it('returns correct issueKey and issueSummary', () => {
    const result = generateQaHandoff(
      makeInput({
        issueKey: 'PROJ-42',
        issueSummary: 'Build login page',
      }),
    );

    expect(result.issueKey).toBe('PROJ-42');
    expect(result.issueSummary).toBe('Build login page');
  });

  it('filters out lock/generated files from whatChanged', () => {
    const result = generateQaHandoff(
      makeInput({
        changedFilePaths: [
          'src/feature.ts',
          'package-lock.json',
          'dist/bundle.js',
          'src/service.ts',
        ],
      }),
    );

    expect(result.whatChanged).toContain('src/feature.ts');
    expect(result.whatChanged).toContain('src/service.ts');
    expect(result.whatChanged).not.toContain('package-lock.json');
    expect(result.whatChanged).not.toContain('dist/bundle.js');
  });

  it('whatChanged caps at 15 files', () => {
    const manyFiles = Array.from({ length: 20 }, (_, i) => `src/file${i}.ts`);
    const result = generateQaHandoff(makeInput({ changedFilePaths: manyFiles }));

    expect(result.whatChanged.length).toBeLessThanOrEqual(15);
  });

  it('adds "Test API response" to whatToTest when backend impact detected', () => {
    const result = generateQaHandoff(makeInput({ impactAnalysis: backendImpact() }));

    expect(result.whatToTest).toContain('Test API response');
  });

  it('adds "Test with different user roles" to whatToTest when auth impact detected', () => {
    const result = generateQaHandoff(makeInput({ impactAnalysis: authImpact() }));

    expect(result.whatToTest).toContain('Test with different user roles');
  });

  it('includes "Invalid input samples" in testDataPreconditions when validation rules present', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      validationRules: ['Email must be valid'],
    };
    const result = generateQaHandoff(makeInput({ requirementSignals: signals }));

    expect(result.testDataPreconditions).toContain('Invalid input samples');
  });

  it('includes "Backup of test database" in testDataPreconditions when migration files present', () => {
    const migrationFile = makeFile('db/migrations/001_init.sql');
    const classified: ClassifiedFiles = {
      ...emptyClassifiedFiles(),
      migrationFiles: [migrationFile],
      riskyFiles: [{ file: migrationFile, reasons: ['database_migration'] }],
    };
    const result = generateQaHandoff(
      makeInput({
        classifiedFiles: classified,
        changedFilePaths: ['db/migrations/001_init.sql'],
      }),
    );

    expect(result.testDataPreconditions).toContain('Backup of test database');
  });

  it('defaults userRoles to ["end user"] when no roles in signals', () => {
    const result = generateQaHandoff(makeInput({ requirementSignals: emptySignals() }));

    expect(result.userRoles).toEqual(['end user']);
  });

  it('uses requirementSignals.userRoles when present', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      userRoles: ['admin', 'viewer'],
    };
    const result = generateQaHandoff(makeInput({ requirementSignals: signals }));

    expect(result.userRoles).toEqual(['admin', 'viewer']);
  });

  it('includes frontend area in regressionAreas when frontend impact detected', () => {
    const result = generateQaHandoff(makeInput({ impactAnalysis: frontendImpact() }));

    expect(result.regressionAreas).toContain('Frontend UI');
  });

  it('includes backend area in regressionAreas when backend impact detected', () => {
    const result = generateQaHandoff(makeInput({ impactAnalysis: backendImpact() }));

    expect(result.regressionAreas).toContain('Backend Service');
  });
});
