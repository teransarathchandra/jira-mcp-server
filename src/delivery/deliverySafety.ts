// ── Delivery Safety Gate ──────────────────────────────────────────────────────
// Pure deterministic safety checks. No I/O. No LLM calls.

import type { SafetyWarning, SafetyCheckResult } from './deliveryTypes.js';
import type { DiffResult } from '../git/gitDiffService.js';
import type { ClassifiedFiles } from '../utils/changedFileClassifier.js';
import type { RequirementSignals } from '../utils/requirementExtractor.js';

// ── Input type ────────────────────────────────────────────────────────────────

export interface SafetyCheckInput {
  diffResult?: Pick<DiffResult, 'changedFiles' | 'diffText' | 'originalDiffLength' | 'truncated'>;
  classifiedFiles?: ClassifiedFiles;
  requirementSignals?: RequirementSignals;
  totalDiffChars?: number;
}

// ── PII keywords ──────────────────────────────────────────────────────────────

const PII_KEYWORDS = [
  'ssn',
  'social security',
  'passport',
  'credit card',
  'date of birth',
  'dob',
  'pii',
] as const;

// ── Individual check functions ────────────────────────────────────────────────

function checkHugeDiff(input: SafetyCheckInput): SafetyWarning | null {
  const changedFiles = input.diffResult?.changedFiles ?? [];
  const originalDiffLength = input.diffResult?.originalDiffLength ?? input.totalDiffChars ?? 0;

  if (originalDiffLength > 100_000 || changedFiles.length > 50) {
    return {
      type: 'huge_diff',
      severity: 'warning',
      message: 'This diff is very large and may be difficult to review thoroughly.',
      detail: `Diff length: ${originalDiffLength} chars, changed files: ${changedFiles.length}`,
    };
  }
  return null;
}

function checkGeneratedFiles(input: SafetyCheckInput): SafetyWarning | null {
  const generatedFiles = input.classifiedFiles?.generatedFiles ?? [];
  if (generatedFiles.length > 0) {
    return {
      type: 'generated_files',
      severity: 'info',
      message: 'Generated/build artifact files were detected in the diff.',
      detail: generatedFiles.map(f => f.path).join(', '),
    };
  }
  return null;
}

function checkLockfile(input: SafetyCheckInput): SafetyWarning | null {
  const lockFiles = input.classifiedFiles?.lockFiles ?? [];
  if (lockFiles.length > 0) {
    return {
      type: 'lockfile_dependency',
      severity: 'warning',
      message: 'Lock file changes detected — dependency versions may have changed.',
      detail: lockFiles.map(f => f.path).join(', '),
    };
  }
  return null;
}

function checkMigration(input: SafetyCheckInput): SafetyWarning | null {
  const migrationFiles = input.classifiedFiles?.migrationFiles ?? [];
  if (migrationFiles.length > 0) {
    return {
      type: 'migration',
      severity: 'critical',
      message: 'Database migration files detected — human review required before merging.',
      detail: migrationFiles.map(f => f.path).join(', '),
    };
  }
  return null;
}

function checkEnvFiles(input: SafetyCheckInput): SafetyWarning | null {
  const configFiles = input.classifiedFiles?.configFiles ?? [];
  const envFiles = configFiles.filter(f => {
    const name = f.path.split('/').pop()?.toLowerCase() ?? '';
    return name === '.env' || name.startsWith('.env.');
  });

  if (envFiles.length > 0) {
    return {
      type: 'env_config',
      severity: 'critical',
      message: 'Environment variable files detected — verify no secrets are being committed.',
      detail: envFiles.map(f => f.path).join(', '),
    };
  }
  return null;
}

function checkNonEnvConfigFiles(input: SafetyCheckInput): SafetyWarning | null {
  const configFiles = input.classifiedFiles?.configFiles ?? [];
  const nonEnvFiles = configFiles.filter(f => {
    const name = f.path.split('/').pop()?.toLowerCase() ?? '';
    return name !== '.env' && !name.startsWith('.env.');
  });

  if (nonEnvFiles.length > 0) {
    return {
      type: 'env_config',
      severity: 'warning',
      message: 'Configuration files changed — review for unintended environment differences.',
      detail: nonEnvFiles.map(f => f.path).join(', '),
    };
  }
  return null;
}

function checkAuthSecurity(input: SafetyCheckInput): SafetyWarning | null {
  const riskyFiles = input.classifiedFiles?.riskyFiles ?? [];
  const authFiles = riskyFiles.filter(rf => rf.reasons.includes('auth_or_permissions'));
  if (authFiles.length > 0) {
    return {
      type: 'auth_security',
      severity: 'critical',
      message: 'Authentication or permissions-related files were modified.',
      detail: authFiles.map(rf => rf.file.path).join(', '),
    };
  }
  return null;
}

function checkPaymentFinance(input: SafetyCheckInput): SafetyWarning | null {
  const riskyFiles = input.classifiedFiles?.riskyFiles ?? [];
  const paymentFiles = riskyFiles.filter(rf => rf.reasons.includes('payment_or_financial'));
  if (paymentFiles.length > 0) {
    return {
      type: 'payment_finance',
      severity: 'critical',
      message: 'Payment or financial-related files were modified.',
      detail: paymentFiles.map(rf => rf.file.path).join(', '),
    };
  }
  return null;
}

function checkPiiInDiff(input: SafetyCheckInput): SafetyWarning | null {
  const diffText = (input.diffResult?.diffText ?? '').toLowerCase();
  if (!diffText) return null;

  const found = PII_KEYWORDS.filter(kw => diffText.includes(kw));
  if (found.length > 0) {
    return {
      type: 'pii_sensitive',
      severity: 'critical',
      message: 'Potential PII-related keywords found in the diff.',
      detail: `Keywords detected: ${found.join(', ')}`,
    };
  }
  return null;
}

function checkNoTests(input: SafetyCheckInput): SafetyWarning | null {
  const testFiles = input.classifiedFiles?.testFiles ?? [];
  const changedFiles = input.diffResult?.changedFiles ?? [];

  if (changedFiles.length > 0 && testFiles.length === 0) {
    return {
      type: 'no_tests',
      severity: 'warning',
      message: 'No test files were changed — consider whether test coverage is needed.',
    };
  }
  return null;
}

function checkUnrelatedFiles(input: SafetyCheckInput): SafetyWarning | null {
  const changedFiles = input.diffResult?.changedFiles ?? [];
  const sourceFiles = input.classifiedFiles?.sourceFiles ?? [];

  if (
    changedFiles.length > 5 &&
    sourceFiles.length > 0 &&
    sourceFiles.length / changedFiles.length > 0.5
  ) {
    return {
      type: 'unrelated_files',
      severity: 'info',
      message: 'A large proportion of changed files are unclassified source files — verify all changes are related to this issue.',
      detail: `${sourceFiles.length} of ${changedFiles.length} changed files have no specific tech-area signal.`,
    };
  }
  return null;
}

function checkUnresolvedRequirements(input: SafetyCheckInput): SafetyWarning | null {
  const ambiguities = input.requirementSignals?.ambiguities ?? [];
  if (ambiguities.length > 0) {
    return {
      type: 'unresolved_requirement',
      severity: 'warning',
      message: 'Unresolved requirement ambiguities detected (TBD/TBC/TODO/unclear markers).',
      detail: ambiguities.slice(0, 5).join(' | '),
    };
  }
  return null;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Run all deterministic safety checks against the provided inputs.
 * Returns a SafetyCheckResult with the collected warnings and computed flags.
 * Pure function — no I/O, no side effects.
 */
export function runSafetyChecks(input: SafetyCheckInput): SafetyCheckResult {
  const checkers = [
    checkHugeDiff,
    checkGeneratedFiles,
    checkLockfile,
    checkMigration,
    checkEnvFiles,
    checkNonEnvConfigFiles,
    checkAuthSecurity,
    checkPaymentFinance,
    checkPiiInDiff,
    checkNoTests,
    checkUnrelatedFiles,
    checkUnresolvedRequirements,
  ];

  const warnings: SafetyWarning[] = [];

  for (const checker of checkers) {
    const result = checker(input);
    if (result !== null) {
      warnings.push(result);
    }
  }

  const hasCriticalWarnings = warnings.some(w => w.severity === 'critical');

  return {
    warnings,
    hasBlockingWarnings: hasCriticalWarnings,
    hasCriticalWarnings,
  };
}
