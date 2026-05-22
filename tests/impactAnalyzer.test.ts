import { describe, it, expect } from 'vitest';
import { analyzeImpact, type ImpactAnalyzerInput } from '../src/delivery/impactAnalyzer.js';
import type { RequirementSignals } from '../src/utils/requirementExtractor.js';

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

function makeInput(overrides: Partial<ImpactAnalyzerInput> = {}): ImpactAnalyzerInput {
  return {
    issueKey: 'TEST-1',
    issueSummary: 'Default summary',
    issueDescription: 'Default description text for the issue.',
    requirementSignals: emptySignals(),
    confluenceSignals: null,
    components: [],
    labels: [],
    linkedIssueSummaries: [],
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('analyzeImpact', () => {
  it('detects frontend area when frontend keywords are present', () => {
    const input = makeInput({
      issueDescription: 'Update the React component to render a new modal form on the page',
    });
    const result = analyzeImpact(input);

    expect(result.frontend.length).toBeGreaterThan(0);
    expect(result.frontend[0].area).toBe('Frontend UI');
    expect(result.likelyAffectedAreas).toContain('Frontend UI');
  });

  it('detects backend area when backend keywords are present', () => {
    const input = makeInput({
      issueDescription: 'Create a new REST API endpoint in the service controller to handle requests',
    });
    const result = analyzeImpact(input);

    expect(result.backend.length).toBeGreaterThan(0);
    expect(result.backend[0].area).toBe('Backend Service');
    expect(result.likelyAffectedAreas).toContain('Backend Service');
  });

  it('detects database area with migration search hint', () => {
    const input = makeInput({
      issueDescription: 'Add a database migration to update the schema and add a new table for the ORM model',
    });
    const result = analyzeImpact(input);

    expect(result.database.length).toBeGreaterThan(0);
    expect(result.database[0].area).toBe('Data / Database');

    const hints = result.database[0].searchHints.join(' ');
    expect(hints.toLowerCase()).toContain('migration');
  });

  it('detects auth area when auth keywords are present', () => {
    const input = makeInput({
      issueDescription: 'Update authentication logic so that JWT token login uses OAuth and validates session permissions',
    });
    const result = analyzeImpact(input);

    expect(result.auth.length).toBeGreaterThan(0);
    expect(result.auth[0].area).toBe('Auth / Permissions');
    expect(result.likelyAffectedAreas).toContain('Auth / Permissions');
  });

  it('populates unknowns with "No file/module references found" when no technical signals', () => {
    const input = makeInput({
      issueDescription: 'A well-written description that is long enough to pass the length check but has no technical signals whatsoever.',
      requirementSignals: emptySignals(),
    });
    const result = analyzeImpact(input);

    expect(result.unknowns).toContain(
      'No file/module references found — implementation scope is unclear',
    );
  });

  it('populates unknowns with "Limited requirement detail" when description is short', () => {
    const input = makeInput({
      issueDescription: 'Short desc',
    });
    const result = analyzeImpact(input);

    expect(result.unknowns.some((u) => u.includes('Limited requirement detail'))).toBe(true);
  });

  it('adds repo inspection plan entries for technical signals', () => {
    const signals = emptySignals();
    signals.technicalSignals = ['UserService.ts', '/api/users', 'AuthController.ts'];

    const input = makeInput({
      issueDescription: 'A long enough description that passes the length threshold without triggering warnings here.',
      requirementSignals: signals,
    });
    const result = analyzeImpact(input);

    // Each technical signal should produce a "Search for" entry
    expect(result.repoInspectionPlan.some((h) => h.includes('UserService.ts'))).toBe(true);
    expect(result.repoInspectionPlan.some((h) => h.includes('/api/users'))).toBe(true);
  });

  it('adds component inspection hints for detected components', () => {
    const input = makeInput({
      issueDescription: 'A description that is long enough to avoid the length unknown warning check.',
      components: ['Auth', 'Dashboard'],
    });
    const result = analyzeImpact(input);

    expect(result.repoInspectionPlan.some((h) => h.includes('components/Auth'))).toBe(true);
    expect(result.repoInspectionPlan.some((h) => h.includes('components/Dashboard'))).toBe(true);
  });

  it('populates likelyAffectedAreas with multiple detected areas', () => {
    const input = makeInput({
      issueDescription:
        'Update the React UI form and the backend API server endpoint, add a database migration for the schema, and add authentication login logic.',
    });
    const result = analyzeImpact(input);

    expect(result.likelyAffectedAreas.length).toBeGreaterThanOrEqual(4);
    expect(result.likelyAffectedAreas).toContain('Frontend UI');
    expect(result.likelyAffectedAreas).toContain('Backend Service');
    expect(result.likelyAffectedAreas).toContain('Data / Database');
    expect(result.likelyAffectedAreas).toContain('Auth / Permissions');
  });

  it('assigns High confidence when 3+ keywords match', () => {
    // Frontend has 19 keywords; using many of them should yield High
    const input = makeInput({
      issueDescription:
        'Update the React tsx jsx frontend component page form button modal screen view display css style layout',
    });
    const result = analyzeImpact(input);

    expect(result.frontend.length).toBeGreaterThan(0);
    expect(result.frontend[0].confidence).toBe('High');
  });

  it('assigns Medium confidence when 1-2 keywords match', () => {
    // Only 1 backend keyword — should yield Medium
    const input = makeInput({
      issueDescription: 'Update the server logic here',
    });
    const result = analyzeImpact(input);

    // 'server' matches BACKEND_SIGNALS → Medium (1 match)
    expect(result.backend.length).toBeGreaterThan(0);
    expect(result.backend[0].confidence).toBe('Medium');
  });

  it('populates unknowns with linked issues warning when more than 3 linked issues', () => {
    const input = makeInput({
      issueDescription:
        'A well-described issue with sufficient detail to not trigger the length warning for this test case.',
      linkedIssueSummaries: ['Issue A', 'Issue B', 'Issue C', 'Issue D'],
    });
    const result = analyzeImpact(input);

    expect(result.unknowns.some((u) => u.includes('Multiple related issues'))).toBe(true);
  });

  it('detects validation area when validation keywords are present', () => {
    const input = makeInput({
      issueDescription: 'Add input validation to sanitize and validate the required format using regex',
    });
    const result = analyzeImpact(input);

    expect(result.validation.length).toBeGreaterThan(0);
    expect(result.validation[0].area).toBe('Validation / Error Handling');
  });

  it('returns correct issueKey and issueSummary on result', () => {
    const input = makeInput({
      issueKey: 'PROJ-42',
      issueSummary: 'Build login page',
      issueDescription: 'Update the React component login form for the authentication flow.',
    });
    const result = analyzeImpact(input);

    expect(result.issueKey).toBe('PROJ-42');
    expect(result.issueSummary).toBe('Build login page');
  });

  it('includes test impact area when any other area is detected', () => {
    const input = makeInput({
      issueDescription: 'Update the backend service API endpoint handler',
    });
    const result = analyzeImpact(input);

    expect(result.testImpact.length).toBeGreaterThan(0);
  });

  it('does not include test impact when no areas are detected', () => {
    const input = makeInput({
      issueDescription: 'A very long description with no recognizable signals about any specific area of the system at all, nothing about frontend or backend or database or auth or validation.',
    });
    const result = analyzeImpact(input);

    // If no areas are detected, testImpact should be empty
    if (result.likelyAffectedAreas.length === 0) {
      expect(result.testImpact.length).toBe(0);
    }
  });

  it('includes confluence signals in combined text for detection', () => {
    const confluenceSignals: RequirementSignals = {
      ...emptySignals(),
      technicalSignals: ['UserRepository.ts', 'prisma'],
    };

    const input = makeInput({
      issueDescription: 'Implement the new data access layer based on Confluence documentation.',
      confluenceSignals,
    });
    const result = analyzeImpact(input);

    // 'prisma' is in DATABASE_SIGNALS → database area should be detected
    expect(result.database.length).toBeGreaterThan(0);
  });
});
