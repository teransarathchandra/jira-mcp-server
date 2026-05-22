// ── Delivery Intelligence Layer — QA Handoff Generator ────────────────────────
// Pure deterministic logic — no I/O. Given Jira + diff context, produces a
// structured QA handoff document.

import type { QaHandoff, ImpactAnalysis } from './deliveryTypes.js';
import type { RequirementSignals } from '../utils/requirementExtractor.js';
import type { ClassifiedFiles } from '../utils/changedFileClassifier.js';

// ── Input type ────────────────────────────────────────────────────────────────

export interface QaHandoffInput {
  issueKey: string;
  issueSummary: string;
  issueDescription: string;
  requirementSignals: RequirementSignals;
  confluenceSignals?: RequirementSignals | null;
  classifiedFiles?: ClassifiedFiles | null;
  diffText?: string | null;
  changedFilePaths: string[];
  impactAnalysis: ImpactAnalysis;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const BUSINESS_RULE_SENTENCE_KEYWORDS =
  /\b(must|should|shall|required|business|customer|user)\b/i;

const LOCK_OR_GENERATED_PATTERNS = [
  /package-lock\.json$/i,
  /yarn\.lock$/i,
  /pnpm-lock\.yaml$/i,
  /\.lock$/i,
  /\.min\.js$/i,
  /\.min\.css$/i,
  /\.map$/i,
  /\.pb\.ts$/i,
  /\.pb\.go$/i,
  /(^|\/)dist\//i,
  /(^|\/)build\//i,
  /(^|\/)node_modules\//i,
  /(^\/|\/__)generated__\//i,
  /(^|\/)generated\//i,
  /generated/i,
];

function isLockOrGenerated(filePath: string): boolean {
  return LOCK_OR_GENERATED_PATTERNS.some((re) => re.test(filePath));
}

function isMigrationFilePath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return (
    lower.includes('/migrations/') ||
    lower.includes('/migration/') ||
    lower.includes('/db/migrate/') ||
    lower.includes('/db/migrations/') ||
    lower.endsWith('.sql') ||
    /\/\d{8}_/.test(lower) ||
    /\/v\d+__/i.test(lower) ||
    /\/\d{3,}_/.test(lower)
  );
}

function extractBusinessGoal(description: string, fallback: string): string {
  if (!description || !description.trim()) return fallback;

  const sentences = description.split(/(?<=[.?!])\s+|\n/);
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    if (BUSINESS_RULE_SENTENCE_KEYWORDS.test(trimmed)) {
      return trimmed.slice(0, 300);
    }
  }
  return fallback;
}

function buildChangedFilesSummary(
  changedFilePaths: string[],
  classifiedFiles: ClassifiedFiles | null | undefined,
): string[] {
  if (!classifiedFiles) {
    return changedFilePaths.length > 0
      ? [`All files: ${changedFilePaths.length}`]
      : [];
  }

  const summary: string[] = [];

  if (classifiedFiles.sourceFiles.length > 0) {
    summary.push(`Source files: ${classifiedFiles.sourceFiles.length}`);
  }
  if (classifiedFiles.testFiles.length > 0) {
    summary.push(`Test files: ${classifiedFiles.testFiles.length}`);
  }
  if (classifiedFiles.configFiles.length > 0) {
    summary.push(`Config files: ${classifiedFiles.configFiles.length}`);
  }
  if (classifiedFiles.migrationFiles.length > 0) {
    summary.push(`Migration files: ${classifiedFiles.migrationFiles.length}`);
  }
  if (classifiedFiles.lockFiles.length > 0) {
    summary.push(`Lock files: ${classifiedFiles.lockFiles.length}`);
  }
  if (classifiedFiles.generatedFiles.length > 0) {
    summary.push(`Generated files: ${classifiedFiles.generatedFiles.length}`);
  }
  if (classifiedFiles.documentationFiles.length > 0) {
    summary.push(`Documentation files: ${classifiedFiles.documentationFiles.length}`);
  }

  return summary;
}

function hasAuthSignals(
  signals: RequirementSignals,
  confluenceSignals?: RequirementSignals | null,
): boolean {
  const authKeywords = [
    'auth', 'authentication', 'authorization', 'permission', 'role',
    'oauth', 'jwt', 'token', 'login', 'logout', 'session', 'credential',
  ];
  const allText = [
    ...signals.acceptanceCriteria,
    ...signals.businessRules,
    ...signals.technicalSignals,
    ...(confluenceSignals?.acceptanceCriteria ?? []),
    ...(confluenceSignals?.businessRules ?? []),
    ...(confluenceSignals?.technicalSignals ?? []),
  ].join(' ').toLowerCase();
  return authKeywords.some((kw) => allText.includes(kw));
}

// ── Main export ───────────────────────────────────────────────────────────────

export function generateQaHandoff(input: QaHandoffInput): QaHandoff {
  const {
    issueKey,
    issueSummary,
    issueDescription,
    requirementSignals,
    confluenceSignals,
    classifiedFiles,
    changedFilePaths,
    impactAnalysis,
  } = input;

  // ── featureSummary ────────────────────────────────────────────────────────
  const featureSummary =
    issueDescription && issueDescription.trim()
      ? issueDescription.trim().slice(0, 200)
      : issueSummary;

  // ── businessGoal ─────────────────────────────────────────────────────────
  const businessGoal = extractBusinessGoal(issueDescription, issueSummary);

  // ── whatChanged ──────────────────────────────────────────────────────────
  const sourceOnlyPaths = changedFilePaths
    .filter((p) => !isLockOrGenerated(p))
    .slice(0, 15);
  const whatChanged = sourceOnlyPaths;

  // ── whatToTest ────────────────────────────────────────────────────────────
  const whatToTest: string[] = [];

  for (const ac of requirementSignals.acceptanceCriteria) {
    whatToTest.push(ac);
  }

  if (impactAnalysis.frontend.length > 0) {
    whatToTest.push('Verify UI renders correctly');
  }
  if (impactAnalysis.backend.length > 0) {
    whatToTest.push('Test API response');
  }
  if (impactAnalysis.auth.length > 0) {
    whatToTest.push('Test with different user roles');
  }

  // ── whatNotToTest ─────────────────────────────────────────────────────────
  const whatNotToTest: string[] = ['Unit test internals', 'Third-party library behavior'];

  const hasMigrationFiles = changedFilePaths.some(isMigrationFilePath);
  const hasGeneratedFiles = classifiedFiles
    ? classifiedFiles.generatedFiles.length > 0
    : changedFilePaths.some(isLockOrGenerated);

  if (hasGeneratedFiles) {
    whatNotToTest.push('Generated files');
  }
  if (hasMigrationFiles) {
    whatNotToTest.push('Migration internals');
  }

  // ── testDataPreconditions ─────────────────────────────────────────────────
  const testDataPreconditions: string[] = [];

  const userRoles =
    requirementSignals.userRoles.length > 0
      ? requirementSignals.userRoles
      : ['end user'];

  for (const role of requirementSignals.userRoles) {
    testDataPreconditions.push(`Test account with ${role} role`);
  }

  if (requirementSignals.validationRules.length > 0) {
    testDataPreconditions.push('Invalid input samples');
  }

  if (hasMigrationFiles) {
    testDataPreconditions.push('Backup of test database');
  }

  testDataPreconditions.push('Clean test environment');

  // ── userRoles ─────────────────────────────────────────────────────────────
  // (computed above for testDataPreconditions)

  // ── happyPath ─────────────────────────────────────────────────────────────
  const happyPath: string[] = [];

  if (requirementSignals.acceptanceCriteria.length > 0) {
    for (const ac of requirementSignals.acceptanceCriteria) {
      happyPath.push(ac);
    }
  } else {
    happyPath.push(`User completes ${issueSummary} successfully`);
  }

  // ── negativeCases ─────────────────────────────────────────────────────────
  const negativeCases: string[] = [];

  for (const rule of requirementSignals.validationRules) {
    negativeCases.push(`Invalid input: ${rule.slice(0, 100)}`);
  }

  const authSignalsPresent = hasAuthSignals(requirementSignals, confluenceSignals) || impactAnalysis.auth.length > 0;
  if (authSignalsPresent) {
    negativeCases.push('Unauthenticated access');
  }
  if (requirementSignals.validationRules.length > 0) {
    negativeCases.push('Invalid input submitted');
  }

  // ── regressionAreas ──────────────────────────────────────────────────────
  const regressionAreas: string[] = [];

  for (const area of impactAnalysis.frontend) {
    regressionAreas.push(area.area);
  }
  for (const area of impactAnalysis.backend) {
    regressionAreas.push(area.area);
  }

  if (authSignalsPresent) {
    regressionAreas.push('Existing authentication flows');
  }

  // ── knownRisks ────────────────────────────────────────────────────────────
  const knownRisks: string[] = [];

  if (classifiedFiles) {
    const reasons = new Set<string>();
    for (const riskyFile of classifiedFiles.riskyFiles) {
      for (const reason of riskyFile.reasons) {
        reasons.add(reason);
      }
    }

    if (reasons.has('database_migration')) {
      knownRisks.push('Data migration risk');
    }
    if (reasons.has('auth_or_permissions')) {
      knownRisks.push('Auth flow risk');
    }
    if (reasons.has('payment_or_financial')) {
      knownRisks.push('Payment processing risk');
    }
    if (reasons.has('config_or_environment')) {
      knownRisks.push('Configuration/environment change risk');
    }
  } else {
    // Derive from file paths
    if (changedFilePaths.some(isMigrationFilePath)) {
      knownRisks.push('Data migration risk');
    }
  }

  // ── openQuestions ─────────────────────────────────────────────────────────
  const openQuestions = requirementSignals.ambiguities.slice(0, 5);

  // ── changedFilesSummary ───────────────────────────────────────────────────
  const changedFilesSummary = buildChangedFilesSummary(changedFilePaths, classifiedFiles);

  return {
    issueKey,
    issueSummary,
    featureSummary,
    businessGoal,
    whatChanged,
    whatToTest,
    whatNotToTest,
    testDataPreconditions,
    userRoles,
    happyPath,
    negativeCases,
    regressionAreas,
    knownRisks,
    openQuestions,
    changedFilesSummary,
  };
}
