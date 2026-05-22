// ── Delivery Intelligence Layer — Test Strategy Generator ─────────────────────
// Pure deterministic logic — no I/O. Given requirement and impact signals,
// produces a structured test strategy.

import type { TestStrategy, TestCase, ImpactAnalysis } from './deliveryTypes.js';
import type { RequirementSignals } from '../utils/requirementExtractor.js';
import type { ClassifiedFiles } from '../utils/changedFileClassifier.js';

// ── Input type ────────────────────────────────────────────────────────────────

export interface TestStrategyInput {
  issueKey: string;
  issueSummary: string;
  requirementSignals: RequirementSignals;
  confluenceSignals?: RequirementSignals | null;
  impactAnalysis: ImpactAnalysis;
  diffText?: string | null;
  changedTestFiles?: string[];    // test files that changed in PR
  classifiedFiles?: ClassifiedFiles | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

function hasFrontendImpact(impact: ImpactAnalysis): boolean {
  return impact.frontend.length > 0;
}

function hasBackendImpact(impact: ImpactAnalysis): boolean {
  return impact.backend.length > 0;
}

function hasDatabaseImpact(impact: ImpactAnalysis): boolean {
  return impact.database.length > 0;
}

function hasApiImpact(impact: ImpactAnalysis): boolean {
  return impact.api.length > 0;
}

function hasAuthSignals(signals: RequirementSignals, confluenceSignals?: RequirementSignals | null): boolean {
  const authKeywords = ['auth', 'authentication', 'authorization', 'permission', 'role', 'oauth', 'jwt', 'token', 'login', 'logout', 'session', 'credential'];
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

export function generateTestStrategy(input: TestStrategyInput): TestStrategy {
  const {
    issueKey,
    issueSummary,
    requirementSignals,
    confluenceSignals,
    impactAnalysis,
    changedTestFiles = [],
    classifiedFiles,
  } = input;

  const testCases: TestCase[] = [];

  // ── requirementSummary ────────────────────────────────────────────────────

  const acSnippets = requirementSignals.acceptanceCriteria.slice(0, 3);
  const ruleSnippets = requirementSignals.businessRules.slice(0, 2);

  let requirementSummary: string;
  if (acSnippets.length > 0 || ruleSnippets.length > 0) {
    const parts: string[] = [];
    if (acSnippets.length > 0) {
      parts.push('Acceptance criteria: ' + acSnippets.map((ac) => truncate(ac, 80)).join('; '));
    }
    if (ruleSnippets.length > 0) {
      parts.push('Business rules: ' + ruleSnippets.map((br) => truncate(br, 80)).join('; '));
    }
    requirementSummary = parts.join('. ');
  } else {
    requirementSummary = issueSummary;
  }

  // ── testScope ─────────────────────────────────────────────────────────────

  const scopeAreas = impactAnalysis.likelyAffectedAreas;
  const testScope =
    scopeAreas.length > 0
      ? `Tests should cover ${scopeAreas.join(', ')} changes for: ${truncate(issueSummary, 100)}.`
      : `Tests should cover all changes related to: ${truncate(issueSummary, 100)}.`;

  // ── Unit tests from acceptance criteria ──────────────────────────────────

  for (const ac of requirementSignals.acceptanceCriteria.slice(0, 6)) {
    testCases.push({
      category: 'unit',
      description: `Test that ${truncate(ac, 80)}`,
      priority: 'high',
    });
  }

  // ── Frontend tests ────────────────────────────────────────────────────────

  if (hasFrontendImpact(impactAnalysis)) {
    testCases.push({
      category: 'e2e',
      description: `Verify ${truncate(issueSummary, 60)} UI flow works end-to-end`,
      priority: 'high',
    });

    const descLower = [
      ...requirementSignals.acceptanceCriteria,
      ...requirementSignals.businessRules,
    ].join(' ').toLowerCase();

    if (descLower.includes('form') || descLower.includes('modal')) {
      testCases.push({
        category: 'ui_responsiveness',
        description: `Verify form/modal displays correctly on different screen sizes`,
        priority: 'medium',
      });
    }
  }

  // ── Backend tests ─────────────────────────────────────────────────────────

  if (hasBackendImpact(impactAnalysis)) {
    const serviceName = impactAnalysis.backend[0]?.area ?? 'backend service';
    testCases.push({
      category: 'integration',
      description: `Test ${serviceName} integration for ${truncate(issueSummary, 60)}`,
      priority: 'high',
    });

    if (hasApiImpact(impactAnalysis)) {
      testCases.push({
        category: 'api_contract',
        description: `Test API contract: request/response schema matches spec for ${truncate(issueSummary, 50)}`,
        priority: 'medium',
      });
    }
  }

  // ── Database tests ────────────────────────────────────────────────────────

  if (hasDatabaseImpact(impactAnalysis)) {
    testCases.push({
      category: 'migration',
      description: `Verify data migration runs cleanly`,
      priority: 'high',
    });
    testCases.push({
      category: 'integration',
      description: `Test database operations for this feature`,
      priority: 'medium',
    });
  }

  // ── Auth tests ────────────────────────────────────────────────────────────

  if (hasAuthSignals(requirementSignals, confluenceSignals)) {
    const roles =
      requirementSignals.userRoles.length > 0
        ? requirementSignals.userRoles.slice(0, 3).join(', ')
        : 'defined user roles';

    testCases.push({
      category: 'permission',
      description: `Verify role-based access for ${roles}`,
      priority: 'high',
    });
    testCases.push({
      category: 'negative',
      description: `Verify unauthorized access is rejected`,
      priority: 'high',
    });
  }

  // ── Validation tests ──────────────────────────────────────────────────────

  for (const rule of requirementSignals.validationRules.slice(0, 4)) {
    testCases.push({
      category: 'negative',
      description: `Test validation: ${truncate(rule, 80)}`,
      priority: 'medium',
    });
  }

  // ── Manual QA tests per user role ─────────────────────────────────────────

  for (const role of requirementSignals.userRoles.slice(0, 3)) {
    testCases.push({
      category: 'manual',
      description: `Manual test as ${role}: verify ${truncate(issueSummary, 60)}`,
      priority: 'medium',
    });
  }

  // ── Regression test ───────────────────────────────────────────────────────

  const areaLabel =
    impactAnalysis.likelyAffectedAreas.length > 0
      ? impactAnalysis.likelyAffectedAreas[0]
      : 'existing';

  testCases.push({
    category: 'regression',
    description: `Verify existing ${areaLabel} functionality not broken`,
    priority: 'medium',
  });

  // ── missingTestEvidence ───────────────────────────────────────────────────

  const missingTestEvidence: string[] = [];
  const acs = requirementSignals.acceptanceCriteria;

  if (changedTestFiles && changedTestFiles.length > 0) {
    // Find ACs that have no matching test file by keyword
    for (const ac of acs) {
      const acWords = ac
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length >= 4);
      const hasMatchingTest = changedTestFiles.some((testFile) => {
        const fileLower = testFile.toLowerCase();
        return acWords.some((word) => fileLower.includes(word));
      });
      if (!hasMatchingTest) {
        missingTestEvidence.push(`AC needs test coverage: ${truncate(ac, 100)}`);
      }
    }
  } else if (acs.length > 0) {
    missingTestEvidence.push('No test files changed — all ACs need test coverage');
  }

  // ── suggestedTestData ─────────────────────────────────────────────────────

  const suggestedTestData: string[] = [];

  for (const role of requirementSignals.userRoles.slice(0, 5)) {
    suggestedTestData.push(`Test account with ${role} permissions`);
  }

  if (requirementSignals.validationRules.length > 0) {
    suggestedTestData.push('Invalid input samples for validation testing');
  }

  if (hasDatabaseImpact(impactAnalysis)) {
    suggestedTestData.push('Test dataset with edge-case data (empty, null, maximum values)');
  }

  // ── regressionAreas ───────────────────────────────────────────────────────

  const regressionAreas: string[] = [];

  if (hasFrontendImpact(impactAnalysis)) {
    regressionAreas.push('Existing UI/navigation flows');
  }
  if (hasBackendImpact(impactAnalysis)) {
    regressionAreas.push('Existing API endpoints and service layer');
  }
  if (hasAuthSignals(requirementSignals, confluenceSignals)) {
    regressionAreas.push('Existing login/session flows');
  }
  if (hasDatabaseImpact(impactAnalysis)) {
    regressionAreas.push('Existing data operations and queries');
  }

  return {
    issueKey,
    issueSummary,
    requirementSummary,
    testScope,
    testCases,
    missingTestEvidence,
    suggestedTestData,
    regressionAreas,
  };
}
