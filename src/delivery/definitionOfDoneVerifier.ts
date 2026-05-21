// ── Delivery Intelligence Layer — Definition of Done Verifier ─────────────────
// Pure deterministic logic — no I/O, no LLM calls.

import type {
  DoDCheck,
  DoDResult,
  DoDStatus,
  ConfidenceLevel,
  SafetyCheckResult,
  TraceabilityMatrix,
} from './deliveryTypes.js';
import type { RequirementSignals } from '../utils/requirementExtractor.js';
import type { ClassifiedFiles } from '../utils/changedFileClassifier.js';
import type { MatchResult } from '../utils/prRequirementMatcher.js';

// ── Input type ────────────────────────────────────────────────────────────────

export interface DoDInput {
  issueKey: string;
  issueSummary: string;
  requirementSignals: RequirementSignals;
  classifiedFiles: ClassifiedFiles;
  diffText: string;
  diffTruncated: boolean;
  changedFileCount: number;
  jiraContextQualityScore: number;   // 0-100
  hasBlockingConflicts: boolean;
  hasUnresolvedAmbiguities: boolean;
  hasBackendRequirement: boolean;
  hasFrontendRequirement: boolean;
  matchResult?: MatchResult | null;
  traceabilityMatrix?: TraceabilityMatrix | null;
  safetyCheckResult?: SafetyCheckResult | null;
  confluenceConflictCount: number;
}

// ── Auth keywords ─────────────────────────────────────────────────────────────

const AUTH_KEYWORDS = ['auth', 'permission', 'role', 'access', 'login', 'logout', 'oauth', 'jwt', 'token'];

// ── Individual check functions ────────────────────────────────────────────────

function checkReqImplemented(input: DoDInput): DoDCheck {
  const matrix = input.traceabilityMatrix;

  if (!matrix) {
    return {
      checkId: 'req_implemented',
      checkName: 'Requirement Implemented',
      status: 'warning',
      detail: 'No traceability matrix available',
    };
  }

  const allMissing = matrix.items.length > 0 &&
    matrix.items.every(i => i.coverageStatus === 'MISSING');

  if (allMissing) {
    return {
      checkId: 'req_implemented',
      checkName: 'Requirement Implemented',
      status: 'failed',
      detail: 'No implementation evidence found',
    };
  }

  const hasCoverage = matrix.items.some(
    i => i.coverageStatus === 'COVERED' || i.coverageStatus === 'PARTIALLY_COVERED',
  );

  if (hasCoverage) {
    return {
      checkId: 'req_implemented',
      checkName: 'Requirement Implemented',
      status: 'passed',
      detail: 'Evidence of implementation found',
    };
  }

  return {
    checkId: 'req_implemented',
    checkName: 'Requirement Implemented',
    status: 'warning',
    detail: 'Implementation coverage unclear',
  };
}

function checkAcCovered(input: DoDInput): DoDCheck {
  const acs = input.requirementSignals.acceptanceCriteria;

  if (acs.length === 0) {
    return {
      checkId: 'ac_covered',
      checkName: 'Acceptance Criteria Covered',
      status: 'warning',
      detail: 'No explicit acceptance criteria in Jira',
    };
  }

  const matrix = input.traceabilityMatrix;
  if (!matrix) {
    return {
      checkId: 'ac_covered',
      checkName: 'Acceptance Criteria Covered',
      status: 'warning',
      detail: 'No traceability matrix available to assess AC coverage',
    };
  }

  const acItems = matrix.items.filter(i => i.source === 'acceptance_criteria');
  if (acItems.length === 0) {
    return {
      checkId: 'ac_covered',
      checkName: 'Acceptance Criteria Covered',
      status: 'warning',
      detail: 'No AC items in traceability matrix',
    };
  }

  const coveredCount = acItems.filter(
    i => i.coverageStatus === 'COVERED' || i.coverageStatus === 'PARTIALLY_COVERED',
  ).length;

  const percentage = (coveredCount / acItems.length) * 100;

  if (percentage >= 80) {
    return {
      checkId: 'ac_covered',
      checkName: 'Acceptance Criteria Covered',
      status: 'passed',
      detail: `${Math.round(percentage)}% of acceptance criteria covered`,
    };
  }

  if (percentage >= 50) {
    return {
      checkId: 'ac_covered',
      checkName: 'Acceptance Criteria Covered',
      status: 'warning',
      detail: `Only ${Math.round(percentage)}% of acceptance criteria covered`,
    };
  }

  return {
    checkId: 'ac_covered',
    checkName: 'Acceptance Criteria Covered',
    status: 'failed',
    detail: `Only ${Math.round(percentage)}% covered`,
  };
}

function checkTestsPresent(input: DoDInput): DoDCheck {
  if (input.changedFileCount === 0) {
    return {
      checkId: 'tests_present',
      checkName: 'Tests Added or Updated',
      status: 'skipped',
      detail: 'No changes to analyze',
    };
  }

  const count = input.classifiedFiles.testFiles.length;
  if (count === 0) {
    return {
      checkId: 'tests_present',
      checkName: 'Tests Added or Updated',
      status: 'failed',
      detail: 'No test files changed',
    };
  }

  return {
    checkId: 'tests_present',
    checkName: 'Tests Added or Updated',
    status: 'passed',
    detail: `${count} test file(s) changed`,
  };
}

function checkNoJiraAmbiguity(input: DoDInput): DoDCheck {
  if (input.hasUnresolvedAmbiguities) {
    return {
      checkId: 'no_jira_ambiguity',
      checkName: 'No Unresolved Jira Ambiguity',
      status: 'warning',
      detail: 'Unresolved ambiguity markers found',
    };
  }

  return {
    checkId: 'no_jira_ambiguity',
    checkName: 'No Unresolved Jira Ambiguity',
    status: 'passed',
    detail: 'No ambiguity markers detected',
  };
}

function checkNoConflicts(input: DoDInput): DoDCheck {
  if (input.hasBlockingConflicts) {
    return {
      checkId: 'no_conflicts',
      checkName: 'No Unresolved Jira/Confluence Conflicts',
      status: 'failed',
      detail: 'Blocking conflicts detected',
    };
  }

  if (input.confluenceConflictCount > 0) {
    return {
      checkId: 'no_conflicts',
      checkName: 'No Unresolved Jira/Confluence Conflicts',
      status: 'warning',
      detail: `${input.confluenceConflictCount} Confluence-Jira conflict(s) detected`,
    };
  }

  return {
    checkId: 'no_conflicts',
    checkName: 'No Unresolved Jira/Confluence Conflicts',
    status: 'passed',
    detail: 'No conflicts detected',
  };
}

function checkNoRiskyUnexplained(input: DoDInput): DoDCheck {
  const safety = input.safetyCheckResult;

  if (!safety) {
    return {
      checkId: 'no_risky_unexplained',
      checkName: 'No Unexplained Risky Files',
      status: 'skipped',
      detail: 'No safety check available',
    };
  }

  const criticalWarnings = safety.warnings.filter(w => w.severity === 'critical');
  if (criticalWarnings.length > 0) {
    const types = [...new Set(criticalWarnings.map(w => w.type))].join(', ');
    return {
      checkId: 'no_risky_unexplained',
      checkName: 'No Unexplained Risky Files',
      status: 'failed',
      detail: `Critical risky file types: ${types}`,
    };
  }

  const regularWarnings = safety.warnings.filter(w => w.severity === 'warning');
  if (regularWarnings.length > 0) {
    const types = [...new Set(regularWarnings.map(w => w.type))].join(', ');
    return {
      checkId: 'no_risky_unexplained',
      checkName: 'No Unexplained Risky Files',
      status: 'warning',
      detail: `Warning-level risky file types: ${types}`,
    };
  }

  return {
    checkId: 'no_risky_unexplained',
    checkName: 'No Unexplained Risky Files',
    status: 'passed',
    detail: 'No risky file concerns',
  };
}

function checkNoUnrelatedChanges(input: DoDInput): DoDCheck {
  const matchResult = input.matchResult;

  if (!matchResult) {
    return {
      checkId: 'no_unrelated_changes',
      checkName: 'No Broad Unrelated Changes',
      status: 'skipped',
      detail: 'No match result available',
    };
  }

  const n = matchResult.unrelatedChanges.length;

  if (n > 3) {
    return {
      checkId: 'no_unrelated_changes',
      checkName: 'No Broad Unrelated Changes',
      status: 'failed',
      detail: `${n} unrelated file changes`,
    };
  }

  if (n >= 1) {
    return {
      checkId: 'no_unrelated_changes',
      checkName: 'No Broad Unrelated Changes',
      status: 'warning',
      detail: `${n} potentially unrelated file(s)`,
    };
  }

  return {
    checkId: 'no_unrelated_changes',
    checkName: 'No Broad Unrelated Changes',
    status: 'passed',
    detail: 'All changes appear related',
  };
}

function checkBackendLayerPresent(input: DoDInput): DoDCheck {
  if (!input.hasBackendRequirement) {
    return {
      checkId: 'backend_layer_present',
      checkName: 'Backend Layer Present When Required',
      status: 'skipped',
      detail: 'No backend requirement detected',
    };
  }

  const n = input.classifiedFiles.backendFiles.length;
  if (n === 0) {
    return {
      checkId: 'backend_layer_present',
      checkName: 'Backend Layer Present When Required',
      status: 'failed',
      detail: 'Backend requirement but no backend files changed',
    };
  }

  return {
    checkId: 'backend_layer_present',
    checkName: 'Backend Layer Present When Required',
    status: 'passed',
    detail: `${n} backend file(s) changed`,
  };
}

function checkFrontendLayerPresent(input: DoDInput): DoDCheck {
  if (!input.hasFrontendRequirement) {
    return {
      checkId: 'frontend_layer_present',
      checkName: 'Frontend Layer Present When Required',
      status: 'skipped',
      detail: 'No frontend requirement detected',
    };
  }

  const n = input.classifiedFiles.frontendFiles.length;
  if (n === 0) {
    return {
      checkId: 'frontend_layer_present',
      checkName: 'Frontend Layer Present When Required',
      status: 'failed',
      detail: 'Frontend requirement but no frontend files changed',
    };
  }

  return {
    checkId: 'frontend_layer_present',
    checkName: 'Frontend Layer Present When Required',
    status: 'passed',
    detail: `${n} frontend file(s) changed`,
  };
}

function checkAuthHandled(input: DoDInput): DoDCheck {
  const combined = [
    input.diffText,
    ...input.requirementSignals.acceptanceCriteria,
    ...input.requirementSignals.businessRules,
    ...input.requirementSignals.technicalSignals,
  ].join(' ').toLowerCase();

  const hasAuthKeyword = AUTH_KEYWORDS.some(kw => combined.includes(kw));

  if (!hasAuthKeyword) {
    return {
      checkId: 'auth_handled',
      checkName: 'Auth/Permission Handling Present When Required',
      status: 'skipped',
      detail: 'No auth requirement detected',
    };
  }

  const authRiskyFiles = input.classifiedFiles.riskyFiles.filter(rf =>
    rf.reasons.includes('auth_or_permissions'),
  );

  if (authRiskyFiles.length > 0) {
    return {
      checkId: 'auth_handled',
      checkName: 'Auth/Permission Handling Present When Required',
      status: 'passed',
      detail: 'Auth-related files present',
    };
  }

  return {
    checkId: 'auth_handled',
    checkName: 'Auth/Permission Handling Present When Required',
    status: 'warning',
    detail: 'Auth requirement mentioned but no auth files changed',
  };
}

function checkValidationPresent(input: DoDInput): DoDCheck {
  if (input.requirementSignals.validationRules.length === 0) {
    return {
      checkId: 'validation_present',
      checkName: 'Validation/Error Handling Present When Required',
      status: 'skipped',
      detail: 'No validation requirements detected',
    };
  }

  const validationKeywords = ['validate', 'validator', 'required', 'constraint', 'error handling'];
  const diffLower = input.diffText.toLowerCase();
  const hasValidation = validationKeywords.some(kw => diffLower.includes(kw));

  if (hasValidation) {
    return {
      checkId: 'validation_present',
      checkName: 'Validation/Error Handling Present When Required',
      status: 'passed',
      detail: 'Validation code present in diff',
    };
  }

  return {
    checkId: 'validation_present',
    checkName: 'Validation/Error Handling Present When Required',
    status: 'warning',
    detail: 'Validation rules in spec but no clear validation code in diff',
  };
}

function checkMigrationNoted(input: DoDInput): DoDCheck {
  if (input.classifiedFiles.migrationFiles.length === 0) {
    return {
      checkId: 'migration_noted',
      checkName: 'DB Migration Has Rollback Note',
      status: 'skipped',
      detail: 'No migration files changed',
    };
  }

  const diffLower = input.diffText.toLowerCase();
  const hasRollback =
    diffLower.includes('rollback') ||
    diffLower.includes('revert') ||
    diffLower.includes('down migration');

  if (hasRollback) {
    return {
      checkId: 'migration_noted',
      checkName: 'DB Migration Has Rollback Note',
      status: 'passed',
      detail: 'Rollback/revert note found in migration',
    };
  }

  return {
    checkId: 'migration_noted',
    checkName: 'DB Migration Has Rollback Note',
    status: 'warning',
    detail: 'Migration file changed — ensure rollback plan exists',
  };
}

function checkDepsJustified(input: DoDInput): DoDCheck {
  const hasLockFile = input.classifiedFiles.lockFiles.length > 0;
  const hasPackageJson = input.classifiedFiles.sourceFiles.some(
    f => f.path.endsWith('package.json'),
  ) || input.classifiedFiles.configFiles.some(
    f => f.path.endsWith('package.json'),
  );

  if (!hasLockFile && !hasPackageJson) {
    return {
      checkId: 'deps_justified',
      checkName: 'Dependency Changes Justified',
      status: 'skipped',
      detail: 'No dependency file changes detected',
    };
  }

  const safety = input.safetyCheckResult;
  const hasLockfileWarning = safety?.warnings.some(w => w.type === 'lockfile_dependency') ?? false;

  if (hasLockfileWarning) {
    return {
      checkId: 'deps_justified',
      checkName: 'Dependency Changes Justified',
      status: 'warning',
      detail: 'Lock file changed — verify new dependencies are intentional',
    };
  }

  return {
    checkId: 'deps_justified',
    checkName: 'Dependency Changes Justified',
    status: 'passed',
    detail: 'Dependency changes appear justified',
  };
}

function checkQaNotesAvailable(input: DoDInput): DoDCheck {
  const acCount = input.requirementSignals.acceptanceCriteria.length;

  if (acCount === 0) {
    return {
      checkId: 'qa_notes_available',
      checkName: 'QA Test Notes Available',
      status: 'warning',
      detail: 'No acceptance criteria — QA test basis unclear',
    };
  }

  if (acCount >= 2 && input.jiraContextQualityScore >= 50) {
    return {
      checkId: 'qa_notes_available',
      checkName: 'QA Test Notes Available',
      status: 'passed',
      detail: 'Sufficient requirement detail for QA',
    };
  }

  return {
    checkId: 'qa_notes_available',
    checkName: 'QA Test Notes Available',
    status: 'warning',
    detail: 'Limited acceptance criteria for QA',
  };
}

// ── Check IDs that require human review when warning/failed ──────────────────

const HUMAN_REVIEW_CHECK_IDS = new Set([
  'no_conflicts',
  'no_risky_unexplained',
  'migration_noted',
  'auth_handled',
]);

// ── Scoring ───────────────────────────────────────────────────────────────────

function computeScore(checks: DoDCheck[]): number {
  let score = 100;
  for (const check of checks) {
    if (check.status === 'failed') score -= 10;
    else if (check.status === 'warning') score -= 4;
  }
  return Math.max(0, score);
}

// ── Status determination ──────────────────────────────────────────────────────

function determineStatus(
  input: DoDInput,
  checks: DoDCheck[],
  score: number,
): DoDStatus {
  const failedChecks = checks.filter(c => c.status === 'failed');
  const failedCount = failedChecks.length;

  // BLOCKED_BY_REQUIREMENT_GAP
  if (
    input.hasBlockingConflicts ||
    failedChecks.some(c => c.checkId === 'req_implemented' || c.checkId === 'ac_covered')
  ) {
    return 'BLOCKED_BY_REQUIREMENT_GAP';
  }

  // NOT_ENOUGH_EVIDENCE
  if (input.changedFileCount === 0 || input.jiraContextQualityScore < 20) {
    return 'NOT_ENOUGH_EVIDENCE';
  }

  // READY_FOR_REVIEW
  if (score >= 85 && failedCount === 0) {
    return 'READY_FOR_REVIEW';
  }

  // NEEDS_SMALL_FIXES
  if (score >= 60 && failedCount <= 1) {
    return 'NEEDS_SMALL_FIXES';
  }

  // NEEDS_MAJOR_FIXES
  if (score >= 35 || failedCount <= 3) {
    return 'NEEDS_MAJOR_FIXES';
  }

  return 'NEEDS_MAJOR_FIXES';
}

// ── Confidence ────────────────────────────────────────────────────────────────

function determineConfidence(input: DoDInput): ConfidenceLevel {
  if (
    input.jiraContextQualityScore >= 70 &&
    !input.diffTruncated &&
    input.changedFileCount > 0
  ) {
    return 'High';
  }

  if (input.jiraContextQualityScore >= 40) {
    return 'Medium';
  }

  return 'Low';
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Verify whether a task appears ready for merge.
 * Pure deterministic function — no I/O, no side effects.
 */
export function verifyDefinitionOfDone(input: DoDInput): DoDResult {
  const allChecks: DoDCheck[] = [
    checkReqImplemented(input),
    checkAcCovered(input),
    checkTestsPresent(input),
    checkNoJiraAmbiguity(input),
    checkNoConflicts(input),
    checkNoRiskyUnexplained(input),
    checkNoUnrelatedChanges(input),
    checkBackendLayerPresent(input),
    checkFrontendLayerPresent(input),
    checkAuthHandled(input),
    checkValidationPresent(input),
    checkMigrationNoted(input),
    checkDepsJustified(input),
    checkQaNotesAvailable(input),
  ];

  const passedChecks = allChecks.filter(c => c.status === 'passed');
  const failedChecks = allChecks.filter(c => c.status === 'failed');
  const warningChecks = allChecks.filter(c => c.status === 'warning');

  const score = computeScore(allChecks);
  const overallStatus = determineStatus(input, allChecks, score);
  const confidence = determineConfidence(input);

  const requiredFixes = failedChecks.map(c => c.detail);
  const recommendedFixes = warningChecks.map(c => c.detail);

  const humanReviewNeeded = allChecks
    .filter(
      c =>
        HUMAN_REVIEW_CHECK_IDS.has(c.checkId) &&
        (c.status === 'warning' || c.status === 'failed'),
    )
    .map(c => c.detail);

  return {
    issueKey: input.issueKey,
    issueSummary: input.issueSummary,
    overallStatus,
    confidence,
    score,
    passedChecks,
    failedChecks,
    warningChecks,
    requiredFixes,
    recommendedFixes,
    humanReviewNeeded,
  };
}
