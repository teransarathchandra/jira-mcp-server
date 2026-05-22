// ── Delivery Intelligence Layer — Impact Analyzer ─────────────────────────────
// Pure deterministic logic — no I/O. Given Jira + Confluence signals, predicts
// likely implementation areas before work begins.

import type { ImpactAnalysis, ImpactArea, ConfidenceLevel } from './deliveryTypes.js';
import type { RequirementSignals } from '../utils/requirementExtractor.js';

// ── Input type ────────────────────────────────────────────────────────────────

export interface ImpactAnalyzerInput {
  issueKey: string;
  issueSummary: string;
  issueDescription: string;
  requirementSignals: RequirementSignals;
  confluenceSignals?: RequirementSignals | null;
  components: string[];        // from Jira fields.components
  labels: string[];            // from Jira fields.labels
  linkedIssueSummaries: string[];
}

// ── Keyword maps ──────────────────────────────────────────────────────────────

const FRONTEND_SIGNALS = [
  'ui', 'frontend', 'component', 'page', 'form', 'button', 'modal',
  'screen', 'view', 'display', 'css', 'style', 'layout', 'react',
  'vue', 'angular', 'tsx', 'jsx', 'html',
];

const BACKEND_SIGNALS = [
  'api', 'server', 'backend', 'service', 'controller', 'endpoint',
  'handler', 'route', 'middleware', 'grpc', 'rest',
];

const API_SIGNALS = [
  '/api/', '/rest/', 'endpoint', 'request', 'response', 'payload',
  'http', 'webhook', 'swagger', 'openapi',
];

const DATABASE_SIGNALS = [
  'database', 'db', 'migration', 'schema', 'table', 'query', 'sql',
  'model', 'repository', 'orm', 'prisma', 'mongoose', 'typeorm',
];

const AUTH_SIGNALS = [
  'auth', 'authentication', 'authorization', 'permission', 'role',
  'oauth', 'jwt', 'token', 'login', 'logout', 'session', 'credential',
];

const VALIDATION_SIGNALS = [
  'validate', 'validation', 'required', 'constraint', 'schema',
  'format', 'regex', 'sanitize', 'input',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function countMatches(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.filter((kw) => lower.includes(kw.toLowerCase())).length;
}

function matchedKeywords(text: string, keywords: string[]): string[] {
  const lower = text.toLowerCase();
  return keywords.filter((kw) => lower.includes(kw.toLowerCase()));
}

function confidenceFromCount(count: number): ConfidenceLevel {
  if (count >= 3) return 'High';
  if (count >= 1) return 'Medium';
  return 'Low';
}

function buildImpactArea(
  area: string,
  description: string,
  searchHints: string[],
  matchCount: number,
): ImpactArea {
  return {
    area,
    description,
    searchHints,
    confidence: confidenceFromCount(matchCount),
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

export function analyzeImpact(input: ImpactAnalyzerInput): ImpactAnalysis {
  const {
    issueKey,
    issueSummary,
    issueDescription,
    requirementSignals,
    confluenceSignals,
    components,
    labels,
    linkedIssueSummaries,
  } = input;

  // Build combined text for keyword analysis
  const combinedText = [
    issueDescription,
    issueSummary,
    ...requirementSignals.technicalSignals,
    ...(confluenceSignals?.technicalSignals ?? []),
  ].join(' ');

  const lower = combinedText.toLowerCase();

  // ── Area detection ────────────────────────────────────────────────────────

  const frontendMatches = matchedKeywords(combinedText, FRONTEND_SIGNALS);
  const backendMatches = matchedKeywords(combinedText, BACKEND_SIGNALS);
  const apiMatches = matchedKeywords(combinedText, API_SIGNALS);
  const databaseMatches = matchedKeywords(combinedText, DATABASE_SIGNALS);
  const authMatches = matchedKeywords(combinedText, AUTH_SIGNALS);
  const validationMatches = matchedKeywords(combinedText, VALIDATION_SIGNALS);

  // ── Build ImpactArea arrays ───────────────────────────────────────────────

  const frontend: ImpactArea[] = [];
  const backend: ImpactArea[] = [];
  const api: ImpactArea[] = [];
  const database: ImpactArea[] = [];
  const auth: ImpactArea[] = [];
  const validation: ImpactArea[] = [];
  const testImpact: ImpactArea[] = [];

  if (frontendMatches.length > 0) {
    const topMatched = frontendMatches.slice(0, 4);
    frontend.push(
      buildImpactArea(
        'Frontend UI',
        'UI components, pages or forms likely need changes based on detected frontend signals.',
        [
          `Search for: ${topMatched[0] ?? 'component'} files`,
          'Search for: .tsx .jsx .html files in components/ or pages/',
          'Run: git log --oneline -- src/components',
          'Run: git log --oneline -- src/pages',
        ],
        frontendMatches.length,
      ),
    );
  }

  if (backendMatches.length > 0) {
    const topMatched = backendMatches.slice(0, 4);
    backend.push(
      buildImpactArea(
        'Backend Service',
        'Server-side services, controllers or route handlers likely need changes.',
        [
          `Search for: ${topMatched[0] ?? 'service'} files`,
          'Search for: .service.ts .controller.ts .handler.ts',
          'Run: git log --oneline -- src/services',
          'Run: git log --oneline -- src/controllers',
        ],
        backendMatches.length,
      ),
    );
  }

  if (apiMatches.length > 0) {
    const topMatched = apiMatches.slice(0, 4);
    api.push(
      buildImpactArea(
        'API Layer',
        'API endpoints or contracts likely need changes based on detected API signals.',
        [
          `Search for: ${topMatched[0] ?? 'endpoint'} in route files`,
          'Search for: /api/ path definitions',
          'Search for: swagger openapi spec files',
          'Run: git log --oneline -- src/routes',
        ],
        apiMatches.length,
      ),
    );
  }

  if (databaseMatches.length > 0) {
    const topMatched = databaseMatches.slice(0, 4);
    database.push(
      buildImpactArea(
        'Data / Database',
        'Database schema, migrations or ORM models likely need changes.',
        [
          `Search for: ${topMatched[0] ?? 'migration'} files`,
          'Search for: migration files in db/ or migrations/ directory',
          'Search for: schema definition files (.sql, prisma, typeorm)',
          'Run: git log --oneline -- src/migrations',
        ],
        databaseMatches.length,
      ),
    );
  }

  if (authMatches.length > 0) {
    const topMatched = authMatches.slice(0, 4);
    auth.push(
      buildImpactArea(
        'Auth / Permissions',
        'Authentication or authorization logic likely needs changes.',
        [
          `Search for: ${topMatched[0] ?? 'auth'} files`,
          'Search for: permission role token files',
          'Search for: middleware/auth or guards',
          'Run: git log --oneline -- src/auth',
        ],
        authMatches.length,
      ),
    );
  }

  if (validationMatches.length > 0) {
    const topMatched = validationMatches.slice(0, 4);
    validation.push(
      buildImpactArea(
        'Validation / Error Handling',
        'Input validation or error handling logic likely needs changes.',
        [
          `Search for: ${topMatched[0] ?? 'validation'} files`,
          'Search for: validator schema decorator files',
          'Search for: error handler middleware',
          'Run: git log --oneline -- src/validators',
        ],
        validationMatches.length,
      ),
    );
  }

  // Test impact — always include if any area is affected
  const anyAreaDetected =
    frontend.length > 0 ||
    backend.length > 0 ||
    api.length > 0 ||
    database.length > 0 ||
    auth.length > 0 ||
    validation.length > 0;

  if (anyAreaDetected) {
    testImpact.push(
      buildImpactArea(
        'Test Coverage',
        'New or updated tests will be needed to cover detected implementation areas.',
        [
          'Search for: existing test files matching affected modules',
          'Search for: *.test.ts *.spec.ts in tests/ directory',
          'Run: git log --oneline -- tests/',
        ],
        1,
      ),
    );
  }

  // ── likelyAffectedAreas ───────────────────────────────────────────────────

  const likelyAffectedAreas: string[] = [];
  if (frontend.length > 0) likelyAffectedAreas.push('Frontend UI');
  if (backend.length > 0) likelyAffectedAreas.push('Backend Service');
  if (api.length > 0) likelyAffectedAreas.push('API Layer');
  if (database.length > 0) likelyAffectedAreas.push('Data / Database');
  if (auth.length > 0) likelyAffectedAreas.push('Auth / Permissions');
  if (validation.length > 0) likelyAffectedAreas.push('Validation / Error Handling');

  // ── repoInspectionPlan ────────────────────────────────────────────────────

  const repoInspectionPlan: string[] = [];

  // Add entries for technical signals
  for (const signal of requirementSignals.technicalSignals.slice(0, 10)) {
    repoInspectionPlan.push(`Search for: \`${signal}\``);
  }

  // Components
  for (const component of components) {
    repoInspectionPlan.push(`Inspect: components/${component} directory`);
  }

  // Labels containing known area keywords
  for (const label of labels) {
    const labelLower = label.toLowerCase();
    if (FRONTEND_SIGNALS.some((kw) => labelLower.includes(kw))) {
      repoInspectionPlan.push(`Inspect: frontend modules — label "${label}" detected`);
    } else if (BACKEND_SIGNALS.some((kw) => labelLower.includes(kw))) {
      repoInspectionPlan.push(`Inspect: backend modules — label "${label}" detected`);
    } else if (DATABASE_SIGNALS.some((kw) => labelLower.includes(kw))) {
      repoInspectionPlan.push(`Inspect: database layer — label "${label}" detected`);
    } else if (AUTH_SIGNALS.some((kw) => labelLower.includes(kw))) {
      repoInspectionPlan.push(`Inspect: auth modules — label "${label}" detected`);
    }
  }

  // Git log hints for detected areas
  if (frontend.length > 0) {
    repoInspectionPlan.push('Run: git log --oneline -- src/components');
  }
  if (backend.length > 0) {
    repoInspectionPlan.push('Run: git log --oneline -- src/services');
  }
  if (database.length > 0) {
    repoInspectionPlan.push('Run: git log --oneline -- src/migrations');
  }
  if (auth.length > 0) {
    repoInspectionPlan.push('Run: git log --oneline -- src/auth');
  }

  // Deduplicate
  const dedupedPlan = Array.from(new Set(repoInspectionPlan));

  // ── unknowns ──────────────────────────────────────────────────────────────

  const unknowns: string[] = [];

  if (requirementSignals.technicalSignals.length === 0) {
    unknowns.push('No file/module references found — implementation scope is unclear');
  }

  if (issueDescription.length < 100) {
    unknowns.push('Limited requirement detail — may have undetected scope');
  }

  if (linkedIssueSummaries.length > 3) {
    unknowns.push('Multiple related issues may expand scope — review linked issues');
  }

  // ── riskyDownstreamFlows ──────────────────────────────────────────────────

  const riskyDownstreamFlows: string[] = [];

  if (auth.length > 0) {
    riskyDownstreamFlows.push('Auth changes may affect downstream services that rely on token/session');
  }
  if (database.length > 0) {
    riskyDownstreamFlows.push('Schema/migration changes may affect data integrity in dependent services');
  }
  if (api.length > 0) {
    riskyDownstreamFlows.push('API contract changes may break existing API consumers');
  }

  // Add risky linked issue summaries
  for (const summary of linkedIssueSummaries.slice(0, 3)) {
    const summaryLower = summary.toLowerCase();
    if (
      AUTH_SIGNALS.some((kw) => summaryLower.includes(kw)) ||
      DATABASE_SIGNALS.some((kw) => summaryLower.includes(kw)) ||
      API_SIGNALS.some((kw) => summaryLower.includes(kw))
    ) {
      riskyDownstreamFlows.push(`Linked issue may be impacted: "${summary}"`);
    }
  }

  return {
    issueKey,
    issueSummary,
    likelyAffectedAreas,
    frontend,
    backend,
    api,
    database,
    auth,
    validation,
    testImpact,
    riskyDownstreamFlows,
    unknowns,
    repoInspectionPlan: dedupedPlan,
  };
}
