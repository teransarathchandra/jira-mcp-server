import { describe, it, expect } from 'vitest';
import { runSafetyChecks, type SafetyCheckInput } from '../src/delivery/deliverySafety.js';
import type { ChangedFile } from '../src/git/gitDiffService.js';
import type { ClassifiedFiles, RiskyFile } from '../src/utils/changedFileClassifier.js';
import type { RequirementSignals } from '../src/utils/requirementExtractor.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeFile(path: string, status: ChangedFile['status'] = 'modified'): ChangedFile {
  return { path, status };
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

function baseDiffResult(overrides?: Partial<SafetyCheckInput['diffResult']>): NonNullable<SafetyCheckInput['diffResult']> {
  return {
    changedFiles: [],
    diffText: '',
    originalDiffLength: 0,
    truncated: false,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('runSafetyChecks', () => {

  it('returns no warnings for empty input', () => {
    const result = runSafetyChecks({});
    expect(result.warnings).toHaveLength(0);
    expect(result.hasBlockingWarnings).toBe(false);
    expect(result.hasCriticalWarnings).toBe(false);
  });

  // ── huge_diff ─────────────────────────────────────────────────────────────

  describe('huge_diff', () => {
    it('warns when originalDiffLength > 100000', () => {
      const result = runSafetyChecks({
        diffResult: baseDiffResult({ originalDiffLength: 100_001, changedFiles: [] }),
      });
      const w = result.warnings.find(w => w.type === 'huge_diff');
      expect(w).toBeDefined();
      expect(w?.severity).toBe('warning');
    });

    it('warns when changedFiles.length > 50', () => {
      const files = Array.from({ length: 51 }, (_, i) => makeFile(`src/file${i}.ts`));
      const result = runSafetyChecks({
        diffResult: baseDiffResult({ changedFiles: files, originalDiffLength: 100 }),
      });
      const w = result.warnings.find(w => w.type === 'huge_diff');
      expect(w).toBeDefined();
      expect(w?.severity).toBe('warning');
    });

    it('does not warn for small diffs', () => {
      const result = runSafetyChecks({
        diffResult: baseDiffResult({ originalDiffLength: 5000, changedFiles: [makeFile('src/foo.ts')] }),
      });
      expect(result.warnings.find(w => w.type === 'huge_diff')).toBeUndefined();
    });
  });

  // ── generated_files ───────────────────────────────────────────────────────

  describe('generated_files', () => {
    it('emits info warning when generated files are present', () => {
      const classified = emptyClassified();
      classified.generatedFiles = [makeFile('dist/bundle.min.js')];
      const result = runSafetyChecks({ classifiedFiles: classified });
      const w = result.warnings.find(w => w.type === 'generated_files');
      expect(w).toBeDefined();
      expect(w?.severity).toBe('info');
      expect(w?.detail).toContain('dist/bundle.min.js');
    });

    it('does not warn when no generated files', () => {
      const result = runSafetyChecks({ classifiedFiles: emptyClassified() });
      expect(result.warnings.find(w => w.type === 'generated_files')).toBeUndefined();
    });
  });

  // ── lockfile_dependency ───────────────────────────────────────────────────

  describe('lockfile_dependency', () => {
    it('emits warning when lock files changed', () => {
      const classified = emptyClassified();
      classified.lockFiles = [makeFile('package-lock.json')];
      const result = runSafetyChecks({ classifiedFiles: classified });
      const w = result.warnings.find(w => w.type === 'lockfile_dependency');
      expect(w).toBeDefined();
      expect(w?.severity).toBe('warning');
    });

    it('does not warn when no lock files', () => {
      const result = runSafetyChecks({ classifiedFiles: emptyClassified() });
      expect(result.warnings.find(w => w.type === 'lockfile_dependency')).toBeUndefined();
    });
  });

  // ── migration ─────────────────────────────────────────────────────────────

  describe('migration', () => {
    it('emits critical warning for migration files', () => {
      const classified = emptyClassified();
      classified.migrationFiles = [makeFile('db/migrations/20240101_add_users.sql')];
      const result = runSafetyChecks({ classifiedFiles: classified });
      const w = result.warnings.find(w => w.type === 'migration');
      expect(w).toBeDefined();
      expect(w?.severity).toBe('critical');
    });

    it('sets hasBlockingWarnings when migration detected', () => {
      const classified = emptyClassified();
      classified.migrationFiles = [makeFile('migrations/001_init.sql')];
      const result = runSafetyChecks({ classifiedFiles: classified });
      expect(result.hasBlockingWarnings).toBe(true);
      expect(result.hasCriticalWarnings).toBe(true);
    });
  });

  // ── env_config ────────────────────────────────────────────────────────────

  describe('env_config', () => {
    it('emits critical warning for .env files', () => {
      const classified = emptyClassified();
      classified.configFiles = [makeFile('.env')];
      const result = runSafetyChecks({ classifiedFiles: classified });
      const w = result.warnings.find(w => w.type === 'env_config');
      expect(w).toBeDefined();
      expect(w?.severity).toBe('critical');
    });

    it('emits critical warning for .env.production', () => {
      const classified = emptyClassified();
      classified.configFiles = [makeFile('.env.production')];
      const result = runSafetyChecks({ classifiedFiles: classified });
      const w = result.warnings.find(w => w.type === 'env_config');
      expect(w?.severity).toBe('critical');
    });

    it('emits warning (not critical) for other config files', () => {
      const classified = emptyClassified();
      classified.configFiles = [makeFile('vitest.config.ts')];
      const result = runSafetyChecks({ classifiedFiles: classified });
      const w = result.warnings.find(w => w.type === 'env_config');
      expect(w).toBeDefined();
      expect(w?.severity).toBe('warning');
    });

    it('does not warn when no config files', () => {
      const result = runSafetyChecks({ classifiedFiles: emptyClassified() });
      expect(result.warnings.find(w => w.type === 'env_config')).toBeUndefined();
    });
  });

  // ── auth_security ─────────────────────────────────────────────────────────

  describe('auth_security', () => {
    it('emits critical warning for auth/permissions files', () => {
      const classified = emptyClassified();
      const riskyFile: RiskyFile = {
        file: makeFile('src/auth/jwtService.ts'),
        reasons: ['auth_or_permissions'],
      };
      classified.riskyFiles = [riskyFile];
      const result = runSafetyChecks({ classifiedFiles: classified });
      const w = result.warnings.find(w => w.type === 'auth_security');
      expect(w).toBeDefined();
      expect(w?.severity).toBe('critical');
    });

    it('does not fire when no auth risky files', () => {
      const classified = emptyClassified();
      const riskyFile: RiskyFile = {
        file: makeFile('src/payments/stripe.ts'),
        reasons: ['payment_or_financial'],
      };
      classified.riskyFiles = [riskyFile];
      const result = runSafetyChecks({ classifiedFiles: classified });
      expect(result.warnings.find(w => w.type === 'auth_security')).toBeUndefined();
    });
  });

  // ── payment_finance ───────────────────────────────────────────────────────

  describe('payment_finance', () => {
    it('emits critical warning for payment/financial files', () => {
      const classified = emptyClassified();
      const riskyFile: RiskyFile = {
        file: makeFile('src/billing/invoiceService.ts'),
        reasons: ['payment_or_financial'],
      };
      classified.riskyFiles = [riskyFile];
      const result = runSafetyChecks({ classifiedFiles: classified });
      const w = result.warnings.find(w => w.type === 'payment_finance');
      expect(w).toBeDefined();
      expect(w?.severity).toBe('critical');
    });
  });

  // ── pii_sensitive ─────────────────────────────────────────────────────────

  describe('pii_sensitive', () => {
    it('detects "ssn" in diff text', () => {
      const result = runSafetyChecks({
        diffResult: baseDiffResult({ diffText: '+  const ssn = user.socialSecurityNumber;', originalDiffLength: 50 }),
      });
      const w = result.warnings.find(w => w.type === 'pii_sensitive');
      expect(w).toBeDefined();
      expect(w?.severity).toBe('critical');
    });

    it('detects "credit card" in diff text (case-insensitive)', () => {
      const result = runSafetyChecks({
        diffResult: baseDiffResult({ diffText: '+ // store Credit Card number', originalDiffLength: 30 }),
      });
      const w = result.warnings.find(w => w.type === 'pii_sensitive');
      expect(w).toBeDefined();
    });

    it('detects "date of birth" in diff text', () => {
      const result = runSafetyChecks({
        diffResult: baseDiffResult({ diffText: '+ user.dateOfBirth // date of birth field', originalDiffLength: 40 }),
      });
      const w = result.warnings.find(w => w.type === 'pii_sensitive');
      expect(w).toBeDefined();
    });

    it('detects "passport" in diff text', () => {
      const result = runSafetyChecks({
        diffResult: baseDiffResult({ diffText: '+ const passportNumber = req.body.passport;', originalDiffLength: 45 }),
      });
      const w = result.warnings.find(w => w.type === 'pii_sensitive');
      expect(w).toBeDefined();
    });

    it('does not warn when no PII keywords in diff', () => {
      const result = runSafetyChecks({
        diffResult: baseDiffResult({ diffText: '+ const name = req.body.name;', originalDiffLength: 29 }),
      });
      expect(result.warnings.find(w => w.type === 'pii_sensitive')).toBeUndefined();
    });
  });

  // ── no_tests ──────────────────────────────────────────────────────────────

  describe('no_tests', () => {
    it('warns when source files changed but no test files', () => {
      const classified = emptyClassified();
      classified.testFiles = [];
      const result = runSafetyChecks({
        diffResult: baseDiffResult({ changedFiles: [makeFile('src/feature.ts')] }),
        classifiedFiles: classified,
      });
      const w = result.warnings.find(w => w.type === 'no_tests');
      expect(w).toBeDefined();
      expect(w?.severity).toBe('warning');
    });

    it('does not warn when test files are present', () => {
      const classified = emptyClassified();
      classified.testFiles = [makeFile('tests/feature.test.ts')];
      const result = runSafetyChecks({
        diffResult: baseDiffResult({ changedFiles: [makeFile('src/feature.ts'), makeFile('tests/feature.test.ts')] }),
        classifiedFiles: classified,
      });
      expect(result.warnings.find(w => w.type === 'no_tests')).toBeUndefined();
    });

    it('does not warn when no files changed', () => {
      const result = runSafetyChecks({
        diffResult: baseDiffResult({ changedFiles: [] }),
        classifiedFiles: emptyClassified(),
      });
      expect(result.warnings.find(w => w.type === 'no_tests')).toBeUndefined();
    });
  });

  // ── unresolved_requirement ────────────────────────────────────────────────

  describe('unresolved_requirement', () => {
    it('warns when requirement ambiguities exist', () => {
      const signals = emptySignals();
      signals.ambiguities = ['TBD: what does this field mean?', 'TODO: clarify edge case'];
      const result = runSafetyChecks({ requirementSignals: signals });
      const w = result.warnings.find(w => w.type === 'unresolved_requirement');
      expect(w).toBeDefined();
      expect(w?.severity).toBe('warning');
    });

    it('does not warn when no ambiguities', () => {
      const result = runSafetyChecks({ requirementSignals: emptySignals() });
      expect(result.warnings.find(w => w.type === 'unresolved_requirement')).toBeUndefined();
    });
  });

  // ── hasBlockingWarnings / hasCriticalWarnings ─────────────────────────────

  describe('blocking and critical flags', () => {
    it('hasBlockingWarnings is true when a critical warning is present', () => {
      const classified = emptyClassified();
      classified.migrationFiles = [makeFile('migrations/001.sql')];
      const result = runSafetyChecks({ classifiedFiles: classified });
      expect(result.hasBlockingWarnings).toBe(true);
      expect(result.hasCriticalWarnings).toBe(true);
    });

    it('hasBlockingWarnings is false when only warning/info severity', () => {
      const classified = emptyClassified();
      classified.lockFiles = [makeFile('package-lock.json')];
      const result = runSafetyChecks({ classifiedFiles: classified });
      expect(result.hasBlockingWarnings).toBe(false);
      expect(result.hasCriticalWarnings).toBe(false);
    });

    it('hasBlockingWarnings is false for empty input', () => {
      const result = runSafetyChecks({});
      expect(result.hasBlockingWarnings).toBe(false);
    });
  });
});
