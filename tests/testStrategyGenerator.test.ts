import { describe, it, expect } from 'vitest';
import { generateTestStrategy, type TestStrategyInput } from '../src/delivery/testStrategyGenerator.js';
import type { ImpactAnalysis } from '../src/delivery/deliveryTypes.js';
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
        searchHints: ['Search for: component files'],
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
        area: 'backend service',
        description: 'Server-side services need changes.',
        searchHints: ['Search for: service files'],
        confidence: 'Medium',
      },
    ],
  });
}

function makeInput(overrides: Partial<TestStrategyInput> = {}): TestStrategyInput {
  return {
    issueKey: 'TEST-1',
    issueSummary: 'Default issue summary',
    requirementSignals: emptySignals(),
    confluenceSignals: null,
    impactAnalysis: emptyImpact(),
    diffText: null,
    changedTestFiles: [],
    classifiedFiles: null,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('generateTestStrategy', () => {
  // ── Acceptance criteria → unit tests ───────────────────────────────────────

  it('generates one unit test case per acceptance criterion', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      acceptanceCriteria: ['User can log in', 'User sees dashboard', 'User can log out'],
    };
    const result = generateTestStrategy(makeInput({ requirementSignals: signals }));

    const unitTests = result.testCases.filter((tc) => tc.category === 'unit');
    expect(unitTests.length).toBe(3);
  });

  it('unit test cases have priority high', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      acceptanceCriteria: ['User can submit a form'],
    };
    const result = generateTestStrategy(makeInput({ requirementSignals: signals }));

    const unitTests = result.testCases.filter((tc) => tc.category === 'unit');
    expect(unitTests.length).toBe(1);
    expect(unitTests[0].priority).toBe('high');
  });

  it('caps unit tests at 6 even if more than 6 ACs are provided', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      acceptanceCriteria: ['AC1', 'AC2', 'AC3', 'AC4', 'AC5', 'AC6', 'AC7', 'AC8'],
    };
    const result = generateTestStrategy(makeInput({ requirementSignals: signals }));

    const unitTests = result.testCases.filter((tc) => tc.category === 'unit');
    expect(unitTests.length).toBe(6);
  });

  it('unit test description starts with "Test that " and includes AC text', () => {
    const ac = 'User can reset their password';
    const signals: RequirementSignals = { ...emptySignals(), acceptanceCriteria: [ac] };
    const result = generateTestStrategy(makeInput({ requirementSignals: signals }));

    const unitTests = result.testCases.filter((tc) => tc.category === 'unit');
    expect(unitTests[0].description).toContain('Test that');
    expect(unitTests[0].description).toContain('User can reset their password');
  });

  // ── Frontend impact → E2E test ─────────────────────────────────────────────

  it('adds an e2e test case when frontend impact is detected', () => {
    const result = generateTestStrategy(makeInput({ impactAnalysis: frontendImpact() }));

    const e2eTests = result.testCases.filter((tc) => tc.category === 'e2e');
    expect(e2eTests.length).toBeGreaterThan(0);
  });

  it('does NOT add an e2e test case when there is no frontend impact', () => {
    const result = generateTestStrategy(makeInput({ impactAnalysis: emptyImpact() }));

    const e2eTests = result.testCases.filter((tc) => tc.category === 'e2e');
    expect(e2eTests.length).toBe(0);
  });

  it('e2e test includes issue summary text in description', () => {
    const result = generateTestStrategy(
      makeInput({
        issueSummary: 'Checkout flow',
        impactAnalysis: frontendImpact(),
      }),
    );

    const e2eTests = result.testCases.filter((tc) => tc.category === 'e2e');
    expect(e2eTests[0].description).toContain('Checkout flow');
  });

  // ── Backend impact → integration test ─────────────────────────────────────

  it('adds an integration test case when backend impact is detected', () => {
    const result = generateTestStrategy(makeInput({ impactAnalysis: backendImpact() }));

    const integrationTests = result.testCases.filter((tc) => tc.category === 'integration');
    expect(integrationTests.length).toBeGreaterThan(0);
  });

  it('does NOT add an integration test case when there is no backend impact', () => {
    const result = generateTestStrategy(makeInput({ impactAnalysis: emptyImpact() }));

    const integrationTests = result.testCases.filter((tc) => tc.category === 'integration');
    expect(integrationTests.length).toBe(0);
  });

  it('integration test description includes backend service area name', () => {
    const result = generateTestStrategy(makeInput({ impactAnalysis: backendImpact() }));

    const integrationTests = result.testCases.filter((tc) => tc.category === 'integration');
    expect(integrationTests[0].description).toContain('backend service');
  });

  // ── Auth signals → permission + negative tests ─────────────────────────────

  it('adds permission and negative test when auth keyword in acceptanceCriteria', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      acceptanceCriteria: ['Only authenticated users can access the admin panel'],
    };
    const result = generateTestStrategy(makeInput({ requirementSignals: signals }));

    const permissionTests = result.testCases.filter((tc) => tc.category === 'permission');
    const negativeTests = result.testCases.filter(
      (tc) => tc.category === 'negative' && tc.description.includes('unauthorized'),
    );
    expect(permissionTests.length).toBeGreaterThan(0);
    expect(negativeTests.length).toBeGreaterThan(0);
  });

  it('adds permission and negative test when auth keyword in businessRules', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      businessRules: ['JWT token must be validated on every request'],
    };
    const result = generateTestStrategy(makeInput({ requirementSignals: signals }));

    const permissionTests = result.testCases.filter((tc) => tc.category === 'permission');
    const negativeTests = result.testCases.filter(
      (tc) => tc.category === 'negative' && tc.description.includes('unauthorized'),
    );
    expect(permissionTests.length).toBeGreaterThan(0);
    expect(negativeTests.length).toBeGreaterThan(0);
  });

  it('does NOT add auth tests when no auth signals are present', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      acceptanceCriteria: ['User sees a list of products'],
      businessRules: ['Products are sorted by price'],
    };
    const result = generateTestStrategy(makeInput({ requirementSignals: signals }));

    const permissionTests = result.testCases.filter((tc) => tc.category === 'permission');
    expect(permissionTests.length).toBe(0);
  });

  it('permission test description references user roles when present', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      acceptanceCriteria: ['Only authenticated users can access the admin panel'],
      userRoles: ['admin', 'manager'],
    };
    const result = generateTestStrategy(makeInput({ requirementSignals: signals }));

    const permissionTests = result.testCases.filter((tc) => tc.category === 'permission');
    expect(permissionTests[0].description).toContain('admin');
  });

  // ── User roles → manual QA tests ──────────────────────────────────────────

  it('adds one manual test per user role', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      userRoles: ['admin', 'editor', 'viewer'],
    };
    const result = generateTestStrategy(makeInput({ requirementSignals: signals }));

    const manualTests = result.testCases.filter((tc) => tc.category === 'manual');
    expect(manualTests.length).toBe(3);
  });

  it('does NOT add manual tests when no user roles are present', () => {
    const result = generateTestStrategy(makeInput());

    const manualTests = result.testCases.filter((tc) => tc.category === 'manual');
    expect(manualTests.length).toBe(0);
  });

  it('manual test description includes the role name', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      userRoles: ['superuser'],
    };
    const result = generateTestStrategy(makeInput({ requirementSignals: signals }));

    const manualTests = result.testCases.filter((tc) => tc.category === 'manual');
    expect(manualTests[0].description).toContain('superuser');
  });

  it('caps manual tests at 3 even if more than 3 user roles are provided', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      userRoles: ['admin', 'editor', 'viewer', 'guest', 'owner'],
    };
    const result = generateTestStrategy(makeInput({ requirementSignals: signals }));

    const manualTests = result.testCases.filter((tc) => tc.category === 'manual');
    expect(manualTests.length).toBe(3);
  });

  // ── Validation rules → negative tests ─────────────────────────────────────

  it('adds one negative test per validation rule', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      validationRules: ['Email must be valid', 'Password must be at least 8 characters'],
    };
    const result = generateTestStrategy(makeInput({ requirementSignals: signals }));

    // Filter only validation-originated negatives (they contain "Test validation:")
    const validationNegatives = result.testCases.filter(
      (tc) => tc.category === 'negative' && tc.description.startsWith('Test validation:'),
    );
    expect(validationNegatives.length).toBe(2);
  });

  it('validation negative tests have priority medium', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      validationRules: ['Username must not be empty'],
    };
    const result = generateTestStrategy(makeInput({ requirementSignals: signals }));

    const validationNegatives = result.testCases.filter(
      (tc) => tc.category === 'negative' && tc.description.startsWith('Test validation:'),
    );
    expect(validationNegatives[0].priority).toBe('medium');
  });

  // ── missingTestEvidence — empty changedTestFiles with ACs ──────────────────

  it('populates missingTestEvidence when ACs are present and no test files changed', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      acceptanceCriteria: ['User can submit the form', 'Validation errors are shown'],
    };
    const result = generateTestStrategy(
      makeInput({
        requirementSignals: signals,
        changedTestFiles: [],
      }),
    );

    expect(result.missingTestEvidence.length).toBeGreaterThan(0);
    expect(result.missingTestEvidence[0]).toContain('No test files changed');
  });

  it('missingTestEvidence is empty when no ACs and no test files changed', () => {
    const result = generateTestStrategy(
      makeInput({
        requirementSignals: emptySignals(),
        changedTestFiles: [],
      }),
    );

    expect(result.missingTestEvidence.length).toBe(0);
  });

  it('missingTestEvidence is empty when ACs are covered by changed test files', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      // Use a short AC so all words are < 4 chars → treated as no match requirement
      acceptanceCriteria: ['User logs in via login page'],
    };
    const result = generateTestStrategy(
      makeInput({
        requirementSignals: signals,
        // 'login' is >= 4 chars and appears in the test file name
        changedTestFiles: ['tests/login.test.ts'],
      }),
    );

    // 'login' (5 chars) is in both AC words and test file name → should match
    expect(result.missingTestEvidence.length).toBe(0);
  });

  // ── suggestedTestData includes role-based accounts ─────────────────────────

  it('includes role-based test account suggestion for each user role', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      userRoles: ['admin', 'guest'],
    };
    const result = generateTestStrategy(makeInput({ requirementSignals: signals }));

    expect(result.suggestedTestData.some((d) => d.includes('admin'))).toBe(true);
    expect(result.suggestedTestData.some((d) => d.includes('guest'))).toBe(true);
  });

  it('does NOT include role-based accounts when no user roles are present', () => {
    const result = generateTestStrategy(makeInput());

    const roleItems = result.suggestedTestData.filter((d) => d.includes('permissions'));
    expect(roleItems.length).toBe(0);
  });

  it('includes invalid input suggestion when validation rules are present', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      validationRules: ['Email must be valid'],
    };
    const result = generateTestStrategy(makeInput({ requirementSignals: signals }));

    expect(result.suggestedTestData.some((d) => d.toLowerCase().includes('invalid input'))).toBe(true);
  });

  // ── regressionAreas includes frontend entry when frontend impact detected ──

  it('includes frontend regression area when frontend impact is detected', () => {
    const result = generateTestStrategy(makeInput({ impactAnalysis: frontendImpact() }));

    expect(result.regressionAreas.some((a) => a.toLowerCase().includes('ui'))).toBe(true);
  });

  it('does NOT include frontend regression area when no frontend impact', () => {
    const result = generateTestStrategy(makeInput({ impactAnalysis: emptyImpact() }));

    expect(result.regressionAreas.some((a) => a.toLowerCase().includes('ui'))).toBe(false);
  });

  it('includes backend regression area when backend impact is detected', () => {
    const result = generateTestStrategy(makeInput({ impactAnalysis: backendImpact() }));

    expect(result.regressionAreas.some((a) => a.toLowerCase().includes('api'))).toBe(true);
  });

  // ── requirementSummary fallback to issueSummary when no ACs ───────────────

  it('falls back requirementSummary to issueSummary when ACs and businessRules are empty', () => {
    const result = generateTestStrategy(
      makeInput({
        issueSummary: 'Build user profile page',
        requirementSignals: emptySignals(),
      }),
    );

    expect(result.requirementSummary).toBe('Build user profile page');
  });

  it('uses acceptance criteria text in requirementSummary when ACs are present', () => {
    const signals: RequirementSignals = {
      ...emptySignals(),
      acceptanceCriteria: ['User can update their avatar'],
    };
    const result = generateTestStrategy(
      makeInput({
        issueSummary: 'User profile page',
        requirementSignals: signals,
      }),
    );

    expect(result.requirementSummary).toContain('Acceptance criteria');
    expect(result.requirementSummary).toContain('User can update their avatar');
  });

  // ── Output shape ───────────────────────────────────────────────────────────

  it('always returns issueKey and issueSummary unchanged', () => {
    const result = generateTestStrategy(
      makeInput({ issueKey: 'PROJ-99', issueSummary: 'My feature' }),
    );

    expect(result.issueKey).toBe('PROJ-99');
    expect(result.issueSummary).toBe('My feature');
  });

  it('always contains at least one regression test case', () => {
    const result = generateTestStrategy(makeInput());

    const regressionTests = result.testCases.filter((tc) => tc.category === 'regression');
    expect(regressionTests.length).toBeGreaterThanOrEqual(1);
  });

  it('testScope mentions the issue summary', () => {
    const result = generateTestStrategy(
      makeInput({ issueSummary: 'Payment gateway integration' }),
    );

    expect(result.testScope).toContain('Payment gateway integration');
  });

  it('testScope lists affected areas when likelyAffectedAreas is non-empty', () => {
    const impact = emptyImpact({
      likelyAffectedAreas: ['Frontend UI', 'Backend Service'],
      frontend: [
        {
          area: 'Frontend UI',
          description: 'UI changes.',
          searchHints: [],
          confidence: 'High',
        },
      ],
      backend: [
        {
          area: 'Backend Service',
          description: 'Backend changes.',
          searchHints: [],
          confidence: 'Medium',
        },
      ],
    });
    const result = generateTestStrategy(makeInput({ impactAnalysis: impact }));

    expect(result.testScope).toContain('Frontend UI');
    expect(result.testScope).toContain('Backend Service');
  });
});
