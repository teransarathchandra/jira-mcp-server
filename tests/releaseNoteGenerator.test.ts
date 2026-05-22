import { describe, it, expect } from 'vitest';
import { generateReleaseNote, type ReleaseNoteInput } from '../src/delivery/releaseNoteGenerator.js';
import type { ImpactAnalysis, ReleaseAudience } from '../src/delivery/deliveryTypes.js';
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
        searchHints: [],
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

function makeInput(overrides: Partial<ReleaseNoteInput> = {}): ReleaseNoteInput {
  return {
    issueKey: 'TEST-1',
    issueSummary: 'Default issue summary',
    issueDescription: 'Default issue description text.',
    requirementSignals: emptySignals(),
    classifiedFiles: null,
    changedFilePaths: [],
    impactAnalysis: emptyImpact(),
    audience: 'internal',
    ...overrides,
  };
}

function makeWithAudience(audience: ReleaseAudience): ReleaseNoteInput {
  return makeInput({ audience });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('generateReleaseNote', () => {

  // 1. customer_safe → technicalImpact is empty, riskNotes is []
  it('sets technicalImpact to empty string for customer_safe audience', () => {
    const result = generateReleaseNote(makeWithAudience('customer_safe'));

    expect(result.technicalImpact).toBe('');
  });

  it('sets riskNotes to [] for customer_safe audience', () => {
    const authFile = makeFile('src/auth/token.ts');
    const classified: ClassifiedFiles = {
      ...emptyClassifiedFiles(),
      riskyFiles: [{ file: authFile, reasons: ['auth_or_permissions'] }],
      sourceFiles: [authFile],
    };
    const result = generateReleaseNote(
      makeInput({
        audience: 'customer_safe',
        classifiedFiles: classified,
        changedFilePaths: ['src/auth/token.ts'],
      }),
    );

    expect(result.riskNotes).toEqual([]);
  });

  // 2. internal audience → technicalImpact lists impact areas
  it('lists detected impact areas in technicalImpact for internal audience', () => {
    const result = generateReleaseNote(
      makeInput({
        audience: 'internal',
        impactAnalysis: frontendImpact(),
      }),
    );

    expect(result.technicalImpact).toContain('Frontend UI');
  });

  it('lists backend impact area in technicalImpact for internal audience', () => {
    const result = generateReleaseNote(
      makeInput({
        audience: 'internal',
        impactAnalysis: backendImpact(),
      }),
    );

    expect(result.technicalImpact).toContain('Backend Service');
  });

  it('returns "No specific technical impact detected" when no areas for non-customer_safe', () => {
    const result = generateReleaseNote(
      makeInput({
        audience: 'internal',
        impactAnalysis: emptyImpact(),
      }),
    );

    expect(result.technicalImpact).toContain('No specific technical impact');
  });

  // 3. Migration files → configMigrationNotes includes migration note
  it('includes migration note in configMigrationNotes when migration files present', () => {
    const migrationFile = makeFile('db/migrations/001_init.sql');
    const classified: ClassifiedFiles = {
      ...emptyClassifiedFiles(),
      migrationFiles: [migrationFile],
      riskyFiles: [{ file: migrationFile, reasons: ['database_migration'] }],
    };
    const result = generateReleaseNote(
      makeInput({
        audience: 'internal',
        classifiedFiles: classified,
        changedFilePaths: ['db/migrations/001_init.sql'],
      }),
    );

    expect(result.configMigrationNotes.some((n) => n.toLowerCase().includes('migration'))).toBe(true);
  });

  it('does NOT include migration note for customer_safe audience', () => {
    const migrationFile = makeFile('db/migrations/001_init.sql');
    const classified: ClassifiedFiles = {
      ...emptyClassifiedFiles(),
      migrationFiles: [migrationFile],
    };
    const result = generateReleaseNote(
      makeInput({
        audience: 'customer_safe',
        classifiedFiles: classified,
        changedFilePaths: ['db/migrations/001_init.sql'],
      }),
    );

    expect(result.configMigrationNotes.length).toBe(0);
  });

  // 4. ACs → qaNotes populated (not for customer_safe)
  it('populates qaNotes with AC checklist items for internal audience', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      acceptanceCriteria: ['User can log in', 'User sees dashboard'],
    };
    const result = generateReleaseNote(
      makeInput({
        audience: 'internal',
        requirementSignals: signals,
      }),
    );

    expect(result.qaNotes.length).toBe(2);
    expect(result.qaNotes[0]).toContain('AC 1');
    expect(result.qaNotes[1]).toContain('AC 2');
  });

  it('populates qaNotes for qa audience', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      acceptanceCriteria: ['User can submit form'],
    };
    const result = generateReleaseNote(
      makeInput({
        audience: 'qa',
        requirementSignals: signals,
      }),
    );

    expect(result.qaNotes.length).toBe(1);
    expect(result.qaNotes[0]).toContain('User can submit form');
  });

  it('caps qaNotes at 5 items', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      acceptanceCriteria: ['AC1', 'AC2', 'AC3', 'AC4', 'AC5', 'AC6', 'AC7'],
    };
    const result = generateReleaseNote(
      makeInput({
        audience: 'internal',
        requirementSignals: signals,
      }),
    );

    expect(result.qaNotes.length).toBeLessThanOrEqual(5);
  });

  // 5. customer_safe → qaNotes is []
  it('sets qaNotes to [] for customer_safe audience', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      acceptanceCriteria: ['User can log in', 'User sees dashboard'],
    };
    const result = generateReleaseNote(
      makeInput({
        audience: 'customer_safe',
        requirementSignals: signals,
      }),
    );

    expect(result.qaNotes).toEqual([]);
  });

  // 6. No diff → riskNotes includes "Impact assessment incomplete"
  it('includes "Impact assessment incomplete" in riskNotes when no files changed (internal)', () => {
    const result = generateReleaseNote(
      makeInput({
        audience: 'internal',
        classifiedFiles: emptyClassifiedFiles(),
        changedFilePaths: [],
      }),
    );

    expect(result.riskNotes.some((r) => r.includes('Impact assessment incomplete'))).toBe(true);
  });

  it('does NOT include "Impact assessment incomplete" when files are present', () => {
    const sourceFile = makeFile('src/feature.ts');
    const classified: ClassifiedFiles = {
      ...emptyClassifiedFiles(),
      sourceFiles: [sourceFile],
    };
    const result = generateReleaseNote(
      makeInput({
        audience: 'internal',
        classifiedFiles: classified,
        changedFilePaths: ['src/feature.ts'],
      }),
    );

    expect(result.riskNotes.some((r) => r.includes('Impact assessment incomplete'))).toBe(false);
  });

  // 7. Lock file → rollbackNotes includes restore note
  it('includes lock file restore note in rollbackNotes when lock file present', () => {
    const lockFile = makeFile('package-lock.json');
    const classified: ClassifiedFiles = {
      ...emptyClassifiedFiles(),
      lockFiles: [lockFile],
      riskyFiles: [{ file: lockFile, reasons: ['lock_file'] }],
    };
    const result = generateReleaseNote(
      makeInput({
        audience: 'internal',
        classifiedFiles: classified,
        changedFilePaths: ['package-lock.json'],
      }),
    );

    expect(result.rollbackNotes.some((n) => n.toLowerCase().includes('package-lock.json'))).toBe(true);
  });

  // 8. product audience → summary uses summary + first AC
  it('includes first AC in summary for product audience', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      acceptanceCriteria: ['Users can export reports'],
    };
    const result = generateReleaseNote(
      makeInput({
        audience: 'product',
        issueSummary: 'Add report export feature',
        requirementSignals: signals,
      }),
    );

    expect(result.summary).toContain('Add report export feature');
    expect(result.summary).toContain('Users can export reports');
  });

  it('uses just issueSummary for product audience when no ACs', () => {
    const result = generateReleaseNote(
      makeInput({
        audience: 'product',
        issueSummary: 'Add dark mode',
        requirementSignals: emptySignals(),
      }),
    );

    expect(result.summary).toBe('Add dark mode');
  });

  // 9. summary length respects customer_safe (max 150 chars)
  it('trims summary to max 150 chars for customer_safe audience', () => {
    const longSummary = 'A'.repeat(200);
    const result = generateReleaseNote(
      makeInput({
        audience: 'customer_safe',
        issueSummary: longSummary,
      }),
    );

    expect(result.summary.length).toBeLessThanOrEqual(150);
  });

  it('does not truncate summary for internal audience', () => {
    const summary = 'Short summary for internal audience';
    const result = generateReleaseNote(
      makeInput({
        audience: 'internal',
        issueSummary: summary,
      }),
    );

    expect(result.summary).toContain(summary);
  });

  // 10. Config file changes → configMigrationNotes includes env var note
  it('includes env var note in configMigrationNotes when config files changed', () => {
    const configFile = makeFile('.env.production');
    const classified: ClassifiedFiles = {
      ...emptyClassifiedFiles(),
      configFiles: [configFile],
      riskyFiles: [{ file: configFile, reasons: ['config_or_environment'] }],
    };
    const result = generateReleaseNote(
      makeInput({
        audience: 'internal',
        classifiedFiles: classified,
        changedFilePaths: ['.env.production'],
      }),
    );

    expect(
      result.configMigrationNotes.some((n) =>
        n.toLowerCase().includes('environment') || n.toLowerCase().includes('config'),
      ),
    ).toBe(true);
  });

  // Additional shape tests
  it('returns correct issueKey, issueSummary, and audience', () => {
    const result = generateReleaseNote(
      makeInput({
        issueKey: 'PROJ-42',
        issueSummary: 'Build login page',
        audience: 'qa',
      }),
    );

    expect(result.issueKey).toBe('PROJ-42');
    expect(result.issueSummary).toBe('Build login page');
    expect(result.audience).toBe('qa');
  });

  it('rollbackNotes is [] for customer_safe audience', () => {
    const migrationFile = makeFile('db/migrations/001.sql');
    const classified: ClassifiedFiles = {
      ...emptyClassifiedFiles(),
      migrationFiles: [migrationFile],
    };
    const result = generateReleaseNote(
      makeInput({
        audience: 'customer_safe',
        classifiedFiles: classified,
        changedFilePaths: ['db/migrations/001.sql'],
      }),
    );

    expect(result.rollbackNotes).toEqual([]);
  });

  it('includes "Standard rollback applies" when no risks or migration/lock files', () => {
    const sourceFile = makeFile('src/feature.ts');
    const classified: ClassifiedFiles = {
      ...emptyClassifiedFiles(),
      sourceFiles: [sourceFile],
    };
    const result = generateReleaseNote(
      makeInput({
        audience: 'internal',
        classifiedFiles: classified,
        changedFilePaths: ['src/feature.ts'],
      }),
    );

    expect(result.rollbackNotes).toContain('Standard rollback applies');
  });

  it('includes "Review database rollback procedure" in rollbackNotes when migration files present', () => {
    const migrationFile = makeFile('db/migrations/001.sql');
    const classified: ClassifiedFiles = {
      ...emptyClassifiedFiles(),
      migrationFiles: [migrationFile],
      riskyFiles: [{ file: migrationFile, reasons: ['database_migration'] }],
    };
    const result = generateReleaseNote(
      makeInput({
        audience: 'internal',
        classifiedFiles: classified,
        changedFilePaths: ['db/migrations/001.sql'],
      }),
    );

    expect(result.rollbackNotes.some((n) => n.toLowerCase().includes('rollback'))).toBe(true);
  });

  it('includes auth risk note in riskNotes when auth risky file present', () => {
    const authFile = makeFile('src/auth/jwt.ts');
    const classified: ClassifiedFiles = {
      ...emptyClassifiedFiles(),
      riskyFiles: [{ file: authFile, reasons: ['auth_or_permissions'] }],
      sourceFiles: [authFile],
    };
    const result = generateReleaseNote(
      makeInput({
        audience: 'internal',
        classifiedFiles: classified,
        changedFilePaths: ['src/auth/jwt.ts'],
      }),
    );

    expect(result.riskNotes).toContain('Auth flow risk');
  });

  it('internal summary includes description snippet', () => {
    const result = generateReleaseNote(
      makeInput({
        audience: 'internal',
        issueSummary: 'My feature',
        issueDescription: 'Some detailed technical description here.',
      }),
    );

    expect(result.summary).toContain('Some detailed technical description here.');
  });
});
