// ── Delivery Intelligence Layer — Reviewer Persona Report ─────────────────────
// Generates role-specific review reports from Jira/Confluence/PR context.
// Pure logic — no I/O, no LLM calls.

import type {
  ReviewerReport,
  ReviewerPersona,
  ImpactAnalysis,
  TraceabilityMatrix,
  DoDResult,
} from './deliveryTypes.js';
import type { RequirementSignals } from '../utils/requirementExtractor.js';
import type { ClassifiedFiles } from '../utils/changedFileClassifier.js';

// ── Input type ────────────────────────────────────────────────────────────────

export interface ReviewerReportInput {
  issueKey: string;
  issueSummary: string;
  issueDescription: string;
  persona: ReviewerPersona;
  requirementSignals: RequirementSignals;
  confluenceSignals?: RequirementSignals | null;
  classifiedFiles?: ClassifiedFiles | null;
  diffText?: string | null;
  changedFilePaths: string[];
  impactAnalysis: ImpactAnalysis;
  traceabilityMatrix?: TraceabilityMatrix | null;
  dodResult?: DoDResult | null;
}

// ── UI keyword list (used in frontend persona) ────────────────────────────────

const UI_KEYWORDS = ['ui', 'button', 'form', 'modal', 'screen', 'page', 'component',
  'display', 'view', 'layout', 'style', 'css', 'frontend', 'react', 'html', 'render'];

// ── Sensitive data keywords (used in security persona) ───────────────────────

const SENSITIVE_DATA_KEYWORDS = ['password', 'secret', 'token', 'key', 'credential', 'pii', 'ssn'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function containsUiKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return UI_KEYWORDS.some(kw => lower.includes(kw));
}

function filePathsFromClassified(
  classifiedFiles: ClassifiedFiles | null | undefined,
  side: 'frontend' | 'backend',
  limit: number,
): string[] {
  if (!classifiedFiles) return [];
  const files = side === 'frontend' ? classifiedFiles.frontendFiles : classifiedFiles.backendFiles;
  return files.slice(0, limit).map(f => f.path);
}

function buildChangedFilesSummary(
  changedFilePaths: string[],
  classifiedFiles: ClassifiedFiles | null | undefined,
): string[] {
  if (!classifiedFiles) {
    return [`${changedFilePaths.length} file(s) changed`];
  }
  const source = classifiedFiles.sourceFiles.length;
  const tests = classifiedFiles.testFiles.length;
  const config = classifiedFiles.configFiles.length;
  return [`source: ${source}, tests: ${tests}, config: ${config}`];
}

function buildChangedFilesSummaryLines(
  changedFilePaths: string[],
  classifiedFiles: ClassifiedFiles | null | undefined,
): string[] {
  if (!classifiedFiles) {
    return [`${changedFilePaths.length} file(s) changed`];
  }

  const lines: string[] = [];
  if (classifiedFiles.sourceFiles.length > 0) {
    lines.push(`Source files: ${classifiedFiles.sourceFiles.length}`);
  }
  if (classifiedFiles.frontendFiles.length > 0) {
    lines.push(`Frontend files: ${classifiedFiles.frontendFiles.length}`);
  }
  if (classifiedFiles.backendFiles.length > 0) {
    lines.push(`Backend files: ${classifiedFiles.backendFiles.length}`);
  }
  if (classifiedFiles.testFiles.length > 0) {
    lines.push(`Test files: ${classifiedFiles.testFiles.length}`);
  }
  if (classifiedFiles.configFiles.length > 0) {
    lines.push(`Config files: ${classifiedFiles.configFiles.length}`);
  }
  if (classifiedFiles.migrationFiles.length > 0) {
    lines.push(`Migration files: ${classifiedFiles.migrationFiles.length}`);
  }
  if (lines.length === 0) {
    lines.push(`${changedFilePaths.length} file(s) changed`);
  }
  return lines;
}

function hasMigrationFiles(classifiedFiles: ClassifiedFiles | null | undefined): boolean {
  return (classifiedFiles?.migrationFiles.length ?? 0) > 0;
}

function hasAuthRiskyFiles(classifiedFiles: ClassifiedFiles | null | undefined): boolean {
  if (!classifiedFiles) return false;
  return classifiedFiles.riskyFiles.some(rf => rf.reasons.includes('auth_or_permissions'));
}

function hasPaymentRiskyFiles(classifiedFiles: ClassifiedFiles | null | undefined): boolean {
  if (!classifiedFiles) return false;
  return classifiedFiles.riskyFiles.some(rf => rf.reasons.includes('payment_or_financial'));
}

// ── Persona builders ──────────────────────────────────────────────────────────

function buildProductReviewerSections(input: ReviewerReportInput): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  const { requirementSignals, impactAnalysis, traceabilityMatrix } = input;

  // Requirement Coverage
  if (traceabilityMatrix && traceabilityMatrix.items.length > 0) {
    const covered = traceabilityMatrix.items
      .filter(item => item.coverageStatus === 'COVERED' || item.coverageStatus === 'PARTIALLY_COVERED')
      .map(item => `COVERED: ${item.requirementId} — ${item.requirementText}`);
    const missing = traceabilityMatrix.items
      .filter(item => item.coverageStatus === 'MISSING')
      .map(item => `MISSING: ${item.requirementId} — ${item.requirementText}`);
    sections['Requirement Coverage'] = [...covered, ...missing];
    if (sections['Requirement Coverage'].length === 0) {
      sections['Requirement Coverage'] = ['No requirement coverage data available'];
    }
  } else {
    const acs = requirementSignals.acceptanceCriteria;
    sections['Requirement Coverage'] = acs.length > 0
      ? acs.map((ac, i) => `AC-${i + 1}: ${ac} (unverified)`)
      : ['No acceptance criteria defined'];
  }

  // User Flow Impact
  if (impactAnalysis.frontend.length > 0) {
    sections['User Flow Impact'] = impactAnalysis.frontend.map(a => `${a.area}: ${a.description}`);
  } else {
    sections['User Flow Impact'] = ['No frontend changes detected'];
  }

  // Missing Business Rules
  if (traceabilityMatrix && traceabilityMatrix.items.length > 0) {
    const missingBrItems = traceabilityMatrix.items.filter(
      item => item.source === 'business_rule' && item.coverageStatus === 'MISSING',
    );
    sections['Missing Business Rules'] = missingBrItems.length > 0
      ? missingBrItems.map(item => item.requirementText)
      : ['No missing business rules detected'];
  } else {
    sections['Missing Business Rules'] = requirementSignals.businessRules.length > 0
      ? requirementSignals.businessRules
      : ['No business rules defined'];
  }

  // Acceptance Criteria Status
  if (traceabilityMatrix && traceabilityMatrix.items.length > 0) {
    const acItems = traceabilityMatrix.items.filter(i => i.source === 'acceptance_criteria');
    if (acItems.length > 0) {
      sections['Acceptance Criteria Status'] = acItems.map(item => {
        const isCovered = item.coverageStatus === 'COVERED' || item.coverageStatus === 'PARTIALLY_COVERED';
        const prefix = isCovered ? '✅' : '❌';
        const suffix = isCovered ? '' : ' (MISSING)';
        return `${prefix} ${item.requirementId}: ${item.requirementText}${suffix}`;
      });
    } else {
      sections['Acceptance Criteria Status'] = ['No acceptance criteria in traceability matrix'];
    }
  } else {
    const acs = requirementSignals.acceptanceCriteria;
    sections['Acceptance Criteria Status'] = acs.length > 0
      ? acs.map((ac, i) => `⚪ AC-${i + 1}: ${ac} (unverified)`)
      : ['No acceptance criteria defined'];
  }

  // Product Questions
  sections['Product Questions'] = requirementSignals.ambiguities.length > 0
    ? requirementSignals.ambiguities
    : ['No open questions detected'];

  return sections;
}

function buildFrontendReviewerSections(input: ReviewerReportInput): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  const { requirementSignals, impactAnalysis, classifiedFiles, changedFilePaths } = input;

  // What Changed
  const frontendPaths = filePathsFromClassified(classifiedFiles, 'frontend', 10);
  sections['What Changed'] = frontendPaths.length > 0
    ? frontendPaths
    : ['No frontend files detected in changes'];

  // UI/Component Impact
  if (impactAnalysis.frontend.length > 0) {
    sections['UI/Component Impact'] = impactAnalysis.frontend.map(a => `${a.area}: ${a.description}`);
  } else {
    sections['UI/Component Impact'] = ['No UI component impact detected'];
  }

  // Missing Frontend Coverage
  const uiAcs = requirementSignals.acceptanceCriteria.filter(ac => containsUiKeyword(ac));
  if (uiAcs.length > 0) {
    const frontendPathsLower = (classifiedFiles?.frontendFiles ?? []).map(f => f.path.toLowerCase());
    const missingUiAcs = uiAcs.filter(ac => {
      const acLower = ac.toLowerCase();
      return !frontendPathsLower.some(fp => {
        const basename = fp.split('/').pop() ?? fp;
        return UI_KEYWORDS.some(kw => acLower.includes(kw) && fp.includes(kw));
      });
    });
    sections['Missing Frontend Coverage'] = missingUiAcs.length > 0
      ? missingUiAcs.map(ac => `AC missing frontend file: ${ac}`)
      : ['Frontend coverage appears adequate'];
  } else {
    sections['Missing Frontend Coverage'] = ['Frontend coverage appears adequate'];
  }

  // Style/Accessibility Concerns
  const concerns: string[] = [];
  const allPaths = changedFilePaths.map(p => p.toLowerCase());
  const hasCssChanges = allPaths.some(p => p.endsWith('.css') || p.endsWith('.scss'));
  const hasReactComponents = allPaths.some(p => p.endsWith('.tsx') || p.endsWith('.jsx'));

  if (hasCssChanges) {
    concerns.push('CSS/style changes present — review for visual regression');
  }
  if (!hasReactComponents && changedFilePaths.length > 0) {
    concerns.push('No React component files — verify UI intent');
  }
  sections['Style/Accessibility Concerns'] = concerns.length > 0
    ? concerns
    : ['No specific concerns detected'];

  // Frontend Questions
  const frontendAmbiguities = requirementSignals.ambiguities.filter(a => containsUiKeyword(a));
  sections['Frontend Questions'] = frontendAmbiguities.length > 0
    ? frontendAmbiguities
    : ['No frontend-specific questions'];

  return sections;
}

function buildBackendReviewerSections(input: ReviewerReportInput): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  const { requirementSignals, impactAnalysis, classifiedFiles } = input;

  // What Changed
  const backendPaths = filePathsFromClassified(classifiedFiles, 'backend', 10);
  sections['What Changed'] = backendPaths.length > 0
    ? backendPaths
    : ['No backend files detected in changes'];

  // API/Service Impact
  const apiBackendAreas = [...impactAnalysis.backend, ...impactAnalysis.api];
  sections['API/Service Impact'] = apiBackendAreas.length > 0
    ? apiBackendAreas.map(a => `${a.area}: ${a.description}`)
    : ['No API or service impact detected'];

  // Database Impact
  sections['Database Impact'] = impactAnalysis.database.length > 0
    ? impactAnalysis.database.map(a => `${a.area}: ${a.description}`)
    : ['No database changes detected'];

  // Error Handling Review
  if (requirementSignals.validationRules.length > 0) {
    sections['Error Handling Review'] = requirementSignals.validationRules;
  } else {
    sections['Error Handling Review'] = ['Review error handling for uncovered edge cases'];
  }

  // Backend Questions
  sections['Backend Questions'] = requirementSignals.ambiguities.length > 0
    ? requirementSignals.ambiguities
    : ['No backend-specific questions'];

  return sections;
}

function buildQaReviewerSections(input: ReviewerReportInput): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  const { requirementSignals, impactAnalysis, classifiedFiles, changedFilePaths } = input;

  // What Changed
  sections['What Changed'] = buildChangedFilesSummary(changedFilePaths, classifiedFiles);

  // What To Test
  sections['What To Test'] = requirementSignals.acceptanceCriteria.length > 0
    ? requirementSignals.acceptanceCriteria.map((ac, i) => `AC ${i + 1}: ${ac}`)
    : ['No acceptance criteria defined — review full feature scope'];

  // Edge Cases
  const edgeCases = [
    ...requirementSignals.validationRules,
    ...requirementSignals.ambiguities,
  ];
  sections['Edge Cases'] = edgeCases.length > 0
    ? edgeCases
    : ['No explicit edge cases identified — explore boundary conditions'];

  // Regression Areas
  const regressionAreas: string[] = [];
  if (impactAnalysis.frontend.length > 0) {
    regressionAreas.push(...impactAnalysis.frontend.map(a => a.area));
  }
  if (impactAnalysis.backend.length > 0) {
    regressionAreas.push(...impactAnalysis.backend.map(a => a.area));
  }
  if (impactAnalysis.auth.length > 0) {
    regressionAreas.push(...impactAnalysis.auth.map(a => a.area));
  }
  sections['Regression Areas'] = regressionAreas.length > 0
    ? regressionAreas
    : ['Review related functionality'];

  // Test Data
  const testData: string[] = requirementSignals.userRoles.map(role => `Test account with ${role}`);
  if (requirementSignals.validationRules.length > 0) {
    testData.push('Invalid input samples');
  }
  sections['Test Data'] = testData.length > 0
    ? testData
    : ['Standard test account required'];

  // Questions For Developer
  sections['Questions For Developer'] = requirementSignals.ambiguities.length > 0
    ? requirementSignals.ambiguities
    : ['No open questions'];

  return sections;
}

function buildSecurityReviewerSections(input: ReviewerReportInput): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  const { requirementSignals, impactAnalysis, classifiedFiles, changedFilePaths } = input;

  // Auth/Permission Impact
  sections['Auth/Permission Impact'] = impactAnalysis.auth.length > 0
    ? impactAnalysis.auth.map(a => `${a.area}: ${a.description}`)
    : ['No direct auth changes detected — verify this is correct'];

  // Sensitive Data Risk
  const suspiciousPaths = changedFilePaths.filter(p =>
    SENSITIVE_DATA_KEYWORDS.some(kw => p.toLowerCase().includes(kw)),
  );
  sections['Sensitive Data Risk'] = suspiciousPaths.length > 0
    ? suspiciousPaths
    : ['No obvious sensitive data patterns in changed files'];

  // Input Validation Risk
  sections['Input Validation Risk'] = requirementSignals.validationRules.length > 0
    ? requirementSignals.validationRules
    : ['No explicit validation requirements — review input handling'];

  // Dependency/Config Risk
  const depConfigFiles: string[] = [];
  if (classifiedFiles) {
    depConfigFiles.push(
      ...classifiedFiles.lockFiles.map(f => f.path),
      ...classifiedFiles.configFiles.map(f => f.path),
    );
  }
  sections['Dependency/Config Risk'] = depConfigFiles.length > 0
    ? depConfigFiles
    : ['No dependency or config changes'];

  // Required Security Review Points
  const securityPoints = [
    'Verify no secrets committed',
    'Review auth token handling',
    'Check input sanitization',
  ];
  if (hasMigrationFiles(classifiedFiles)) {
    securityPoints.push('Database migration requires data security review');
  }
  sections['Required Security Review Points'] = securityPoints;

  return sections;
}

function buildReleaseReviewerSections(input: ReviewerReportInput): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  const { requirementSignals, impactAnalysis, classifiedFiles, changedFilePaths } = input;

  // What Changed
  sections['What Changed'] = buildChangedFilesSummaryLines(changedFilePaths, classifiedFiles);

  // Deployment Impact
  const deployAreas: string[] = [];
  if (impactAnalysis.frontend.length > 0) deployAreas.push(...impactAnalysis.frontend.map(a => a.area));
  if (impactAnalysis.backend.length > 0) deployAreas.push(...impactAnalysis.backend.map(a => a.area));
  if (impactAnalysis.database.length > 0) deployAreas.push(...impactAnalysis.database.map(a => a.area));
  if (impactAnalysis.auth.length > 0) deployAreas.push(...impactAnalysis.auth.map(a => a.area));
  if (hasMigrationFiles(classifiedFiles)) {
    deployAreas.push('Database migration required before deployment');
  }
  if ((classifiedFiles?.configFiles.length ?? 0) > 0) {
    deployAreas.push('Config changes — verify environment-specific values');
  }
  sections['Deployment Impact'] = deployAreas.length > 0
    ? deployAreas
    : ['No specific deployment impact detected'];

  // Configuration / Migration Notes
  const configMigrationFiles: string[] = [];
  if (classifiedFiles) {
    configMigrationFiles.push(
      ...classifiedFiles.migrationFiles.map(f => f.path),
      ...classifiedFiles.configFiles.map(f => f.path),
    );
  }
  sections['Configuration / Migration Notes'] = configMigrationFiles.length > 0
    ? configMigrationFiles
    : ['No migration or config changes'];

  // Rollback Risk
  let rollbackRisk: string;
  if (hasMigrationFiles(classifiedFiles)) {
    rollbackRisk = 'High — database migration included';
  } else if (hasAuthRiskyFiles(classifiedFiles) || hasPaymentRiskyFiles(classifiedFiles)) {
    rollbackRisk = 'Medium — sensitive component changes';
  } else {
    rollbackRisk = 'Low';
  }
  sections['Rollback Risk'] = [rollbackRisk];

  // Release Checklist
  const checklist = [
    '[ ] Tests passing',
    '[ ] PR reviewed',
    '[ ] Deployment plan confirmed',
  ];
  if (hasMigrationFiles(classifiedFiles)) {
    checklist.push('[ ] Migration rollback tested');
  }
  if (hasAuthRiskyFiles(classifiedFiles)) {
    checklist.push('[ ] Auth flow verified');
  }
  sections['Release Checklist'] = checklist;

  // QA Sign-off Notes
  const acs = requirementSignals.acceptanceCriteria.slice(0, 5);
  sections['QA Sign-off Notes'] = acs.length > 0
    ? acs.map((ac, i) => `Test ${i + 1}: ${ac}`)
    : ['No formal acceptance criteria — QA sign-off required'];

  return sections;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generate a role-specific review report from Jira/Confluence/PR context.
 * Pure function — no I/O, no side effects.
 */
export function generateReviewerReport(input: ReviewerReportInput): ReviewerReport {
  let sections: Record<string, string[]>;

  switch (input.persona) {
    case 'product_reviewer':
      sections = buildProductReviewerSections(input);
      break;
    case 'frontend_reviewer':
      sections = buildFrontendReviewerSections(input);
      break;
    case 'backend_reviewer':
      sections = buildBackendReviewerSections(input);
      break;
    case 'qa_reviewer':
      sections = buildQaReviewerSections(input);
      break;
    case 'security_reviewer':
      sections = buildSecurityReviewerSections(input);
      break;
    case 'release_reviewer':
      sections = buildReleaseReviewerSections(input);
      break;
    default: {
      // Unknown persona — return empty sections
      sections = {};
      break;
    }
  }

  return {
    issueKey: input.issueKey,
    issueSummary: input.issueSummary,
    persona: input.persona,
    sections,
  };
}
