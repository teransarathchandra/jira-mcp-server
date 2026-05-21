// ── Delivery Intelligence Layer — Shared Types ────────────────────────────────
// Pure type definitions. No logic. No external imports.

export type CoverageStatus =
  | 'COVERED'
  | 'PARTIALLY_COVERED'
  | 'MISSING'
  | 'NOT_ENOUGH_EVIDENCE'
  | 'NOT_APPLICABLE';

export type DoDStatus =
  | 'READY_FOR_REVIEW'
  | 'NEEDS_SMALL_FIXES'
  | 'NEEDS_MAJOR_FIXES'
  | 'BLOCKED_BY_REQUIREMENT_GAP'
  | 'NOT_ENOUGH_EVIDENCE';

export type ConfidenceLevel = 'High' | 'Medium' | 'Low';

export type ReviewerPersona =
  | 'product_reviewer'
  | 'frontend_reviewer'
  | 'backend_reviewer'
  | 'qa_reviewer'
  | 'security_reviewer'
  | 'release_reviewer';

export type ReleaseAudience = 'internal' | 'qa' | 'product' | 'customer_safe';

// ── Traceability ──────────────────────────────────────────────────────────────

export interface TraceabilityItem {
  requirementId: string;
  requirementText: string;
  source: 'acceptance_criteria' | 'business_rule' | 'technical_signal' | 'confluence' | 'comment';
  sourceAuthority: 'high' | 'medium' | 'low';
  expectedImplementationArea: string;
  matchedFiles: string[];
  matchedDiffEvidence: string[];
  matchedTests: string[];
  coverageStatus: CoverageStatus;
  confidence: ConfidenceLevel;
  notes: string;
}

export interface TraceabilityMatrix {
  issueKey: string;
  issueSummary: string;
  generatedAt: string; // ISO date string
  items: TraceabilityItem[];
  totalRequirements: number;
  covered: number;
  partial: number;
  missing: number;
  notEnoughEvidence: number;
  notApplicable: number;
}

// ── Definition of Done ────────────────────────────────────────────────────────

export interface DoDCheck {
  checkId: string;
  checkName: string;
  status: 'passed' | 'failed' | 'warning' | 'skipped';
  detail: string;
}

export interface DoDResult {
  issueKey: string;
  issueSummary: string;
  overallStatus: DoDStatus;
  confidence: ConfidenceLevel;
  score: number; // 0-100
  passedChecks: DoDCheck[];
  failedChecks: DoDCheck[];
  warningChecks: DoDCheck[];
  requiredFixes: string[];
  recommendedFixes: string[];
  humanReviewNeeded: string[];
}

// ── Impact Analysis ───────────────────────────────────────────────────────────

export interface ImpactArea {
  area: string;
  description: string;
  searchHints: string[];
  confidence: ConfidenceLevel;
}

export interface ImpactAnalysis {
  issueKey: string;
  issueSummary: string;
  likelyAffectedAreas: string[];
  frontend: ImpactArea[];
  backend: ImpactArea[];
  api: ImpactArea[];
  database: ImpactArea[];
  auth: ImpactArea[];
  validation: ImpactArea[];
  testImpact: ImpactArea[];
  riskyDownstreamFlows: string[];
  unknowns: string[];
  repoInspectionPlan: string[];
}

// ── Test Strategy ─────────────────────────────────────────────────────────────

export interface TestCase {
  category:
    | 'unit'
    | 'integration'
    | 'e2e'
    | 'manual'
    | 'negative'
    | 'edge'
    | 'permission'
    | 'migration'
    | 'api_contract'
    | 'ui_responsiveness'
    | 'regression';
  description: string;
  scenario?: string;
  expectedOutcome?: string;
  priority: 'high' | 'medium' | 'low';
}

export interface TestStrategy {
  issueKey: string;
  issueSummary: string;
  requirementSummary: string;
  testScope: string;
  testCases: TestCase[];
  missingTestEvidence: string[];
  suggestedTestData: string[];
  regressionAreas: string[];
}

// ── Safety ────────────────────────────────────────────────────────────────────

export interface SafetyWarning {
  type:
    | 'huge_diff'
    | 'generated_files'
    | 'lockfile_dependency'
    | 'migration'
    | 'env_config'
    | 'auth_security'
    | 'payment_finance'
    | 'pii_sensitive'
    | 'no_tests'
    | 'unrelated_files'
    | 'unresolved_requirement';
  severity: 'critical' | 'warning' | 'info';
  message: string;
  detail?: string;
}

export interface SafetyCheckResult {
  warnings: SafetyWarning[];
  hasBlockingWarnings: boolean;
  hasCriticalWarnings: boolean;
}

// ── QA Handoff ────────────────────────────────────────────────────────────────

export interface QaHandoff {
  issueKey: string;
  issueSummary: string;
  featureSummary: string;
  businessGoal: string;
  whatChanged: string[];
  whatToTest: string[];
  whatNotToTest: string[];
  testDataPreconditions: string[];
  userRoles: string[];
  happyPath: string[];
  negativeCases: string[];
  regressionAreas: string[];
  knownRisks: string[];
  openQuestions: string[];
  changedFilesSummary: string[];
}

// ── Release Note ──────────────────────────────────────────────────────────────

export interface ReleaseNote {
  issueKey: string;
  issueSummary: string;
  audience: ReleaseAudience;
  summary: string;
  userImpact: string;
  technicalImpact: string;
  configMigrationNotes: string[];
  riskNotes: string[];
  rollbackNotes: string[];
  qaNotes: string[];
}

// ── Reviewer Report ───────────────────────────────────────────────────────────

export interface ReviewerReport {
  issueKey: string;
  issueSummary: string;
  persona: ReviewerPersona;
  sections: Record<string, string[]>; // section title -> list of items
}
