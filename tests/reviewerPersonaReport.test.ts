import { describe, it, expect } from 'vitest';
import {
  generateReviewerReport,
  type ReviewerReportInput,
} from '../src/delivery/reviewerPersonaReport.js';
import type { ImpactAnalysis, TraceabilityMatrix } from '../src/delivery/deliveryTypes.js';
import type { RequirementSignals } from '../src/utils/requirementExtractor.js';
import type { ClassifiedFiles } from '../src/utils/changedFileClassifier.js';

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

function emptyImpact(): ImpactAnalysis {
  return {
    issueKey: 'TEST-1',
    issueSummary: 'Test issue',
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
  };
}

function emptyClassifiedFiles(): ClassifiedFiles {
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

function makeInput(overrides: Partial<ReviewerReportInput> = {}): ReviewerReportInput {
  return {
    issueKey: 'TEST-1',
    issueSummary: 'Test issue summary',
    issueDescription: 'Test description',
    persona: 'qa_reviewer',
    requirementSignals: emptySignals(),
    confluenceSignals: null,
    classifiedFiles: emptyClassifiedFiles(),
    diffText: null,
    changedFilePaths: [],
    impactAnalysis: emptyImpact(),
    traceabilityMatrix: null,
    dodResult: null,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('generateReviewerReport', () => {
  // Test 1: qa_reviewer — ACs populate "What To Test"
  it('qa_reviewer — ACs populate "What To Test"', () => {
    const input = makeInput({
      persona: 'qa_reviewer',
      requirementSignals: {
        ...emptySignals(),
        acceptanceCriteria: [
          'User can log in with valid credentials',
          'User sees error message on invalid password',
        ],
      },
    });

    const report = generateReviewerReport(input);

    expect(report.persona).toBe('qa_reviewer');
    expect(report.sections['What To Test']).toBeDefined();
    expect(report.sections['What To Test']).toHaveLength(2);
    expect(report.sections['What To Test'][0]).toContain('User can log in');
    expect(report.sections['What To Test'][1]).toContain('invalid password');
  });

  // Test 2: qa_reviewer — ambiguities populate "Questions For Developer"
  it('qa_reviewer — ambiguities populate "Questions For Developer"', () => {
    const input = makeInput({
      persona: 'qa_reviewer',
      requirementSignals: {
        ...emptySignals(),
        ambiguities: ['TBD: what happens when session expires?', 'TODO: define error codes'],
      },
    });

    const report = generateReviewerReport(input);

    expect(report.sections['Questions For Developer']).toBeDefined();
    expect(report.sections['Questions For Developer']).toHaveLength(2);
    expect(report.sections['Questions For Developer'][0]).toContain('session expires');
    expect(report.sections['Questions For Developer'][1]).toContain('error codes');
  });

  // Test 3: product_reviewer — ACs in "Acceptance Criteria Status" as "⚪ AC-N: text (unverified)" when no matrix
  it('product_reviewer — ACs appear as unverified when no traceability matrix', () => {
    const input = makeInput({
      persona: 'product_reviewer',
      requirementSignals: {
        ...emptySignals(),
        acceptanceCriteria: [
          'User can view their profile',
          'User can update their email',
        ],
      },
      traceabilityMatrix: null,
    });

    const report = generateReviewerReport(input);

    expect(report.sections['Acceptance Criteria Status']).toBeDefined();
    const status = report.sections['Acceptance Criteria Status'];
    expect(status[0]).toBe('⚪ AC-1: User can view their profile (unverified)');
    expect(status[1]).toBe('⚪ AC-2: User can update their email (unverified)');
  });

  // Test 4: product_reviewer — ambiguities populate "Product Questions"
  it('product_reviewer — ambiguities populate "Product Questions"', () => {
    const input = makeInput({
      persona: 'product_reviewer',
      requirementSignals: {
        ...emptySignals(),
        ambiguities: ['Unclear: should admins bypass 2FA?'],
      },
    });

    const report = generateReviewerReport(input);

    expect(report.sections['Product Questions']).toBeDefined();
    expect(report.sections['Product Questions']).toHaveLength(1);
    expect(report.sections['Product Questions'][0]).toContain('bypass 2FA');
  });

  // Test 5: security_reviewer — suspicious file paths populate "Sensitive Data Risk"
  it('security_reviewer — suspicious file paths populate "Sensitive Data Risk"', () => {
    const input = makeInput({
      persona: 'security_reviewer',
      changedFilePaths: [
        'src/auth/tokenManager.ts',
        'src/utils/helper.ts',
        'src/services/passwordService.ts',
        'src/models/user.ts',
      ],
    });

    const report = generateReviewerReport(input);

    expect(report.sections['Sensitive Data Risk']).toBeDefined();
    const risk = report.sections['Sensitive Data Risk'];
    // tokenManager.ts contains "token", passwordService.ts contains "password"
    expect(risk).toContain('src/auth/tokenManager.ts');
    expect(risk).toContain('src/services/passwordService.ts');
    // helper.ts and user.ts should not appear
    expect(risk).not.toContain('src/utils/helper.ts');
  });

  // Test 6: security_reviewer — "Required Security Review Points" always has 3 base items
  it('security_reviewer — "Required Security Review Points" always has 3 base items', () => {
    const input = makeInput({ persona: 'security_reviewer' });

    const report = generateReviewerReport(input);

    expect(report.sections['Required Security Review Points']).toBeDefined();
    const points = report.sections['Required Security Review Points'];
    expect(points.length).toBeGreaterThanOrEqual(3);
    expect(points).toContain('Verify no secrets committed');
    expect(points).toContain('Review auth token handling');
    expect(points).toContain('Check input sanitization');
  });

  // Test 7: backend_reviewer — backend files populate "What Changed"
  it('backend_reviewer — backend files populate "What Changed"', () => {
    const classifiedFiles: ClassifiedFiles = {
      ...emptyClassifiedFiles(),
      backendFiles: [
        { path: 'src/services/userService.ts', status: 'modified', additions: 10, deletions: 5 },
        { path: 'src/controllers/authController.ts', status: 'modified', additions: 20, deletions: 3 },
      ],
    };

    const input = makeInput({
      persona: 'backend_reviewer',
      classifiedFiles,
      changedFilePaths: [
        'src/services/userService.ts',
        'src/controllers/authController.ts',
      ],
    });

    const report = generateReviewerReport(input);

    expect(report.sections['What Changed']).toBeDefined();
    expect(report.sections['What Changed']).toContain('src/services/userService.ts');
    expect(report.sections['What Changed']).toContain('src/controllers/authController.ts');
  });

  // Test 8: release_reviewer — migration file → high rollback risk in "Rollback Risk"
  it('release_reviewer — migration file leads to high rollback risk', () => {
    const classifiedFiles: ClassifiedFiles = {
      ...emptyClassifiedFiles(),
      migrationFiles: [
        { path: 'db/migrations/20240101_add_user_table.sql', status: 'added', additions: 15, deletions: 0 },
      ],
    };

    const input = makeInput({
      persona: 'release_reviewer',
      classifiedFiles,
      changedFilePaths: ['db/migrations/20240101_add_user_table.sql'],
    });

    const report = generateReviewerReport(input);

    expect(report.sections['Rollback Risk']).toBeDefined();
    expect(report.sections['Rollback Risk'][0]).toContain('High');
    expect(report.sections['Rollback Risk'][0]).toContain('database migration');
  });

  // Test 9: release_reviewer — release checklist always has 3 base items
  it('release_reviewer — release checklist always has 3 base items', () => {
    const input = makeInput({ persona: 'release_reviewer' });

    const report = generateReviewerReport(input);

    expect(report.sections['Release Checklist']).toBeDefined();
    const checklist = report.sections['Release Checklist'];
    expect(checklist.length).toBeGreaterThanOrEqual(3);
    expect(checklist).toContain('[ ] Tests passing');
    expect(checklist).toContain('[ ] PR reviewed');
    expect(checklist).toContain('[ ] Deployment plan confirmed');
  });

  // Test 10: frontend_reviewer — frontend files populate "What Changed"
  it('frontend_reviewer — frontend files populate "What Changed"', () => {
    const classifiedFiles: ClassifiedFiles = {
      ...emptyClassifiedFiles(),
      frontendFiles: [
        { path: 'src/components/LoginForm.tsx', status: 'modified', additions: 8, deletions: 2 },
        { path: 'src/pages/Dashboard.tsx', status: 'modified', additions: 5, deletions: 1 },
      ],
    };

    const input = makeInput({
      persona: 'frontend_reviewer',
      classifiedFiles,
      changedFilePaths: [
        'src/components/LoginForm.tsx',
        'src/pages/Dashboard.tsx',
      ],
    });

    const report = generateReviewerReport(input);

    expect(report.sections['What Changed']).toBeDefined();
    expect(report.sections['What Changed']).toContain('src/components/LoginForm.tsx');
    expect(report.sections['What Changed']).toContain('src/pages/Dashboard.tsx');
  });

  // Test 11: All persona sections are non-empty (no empty section value arrays)
  it.each([
    'product_reviewer',
    'frontend_reviewer',
    'backend_reviewer',
    'qa_reviewer',
    'security_reviewer',
    'release_reviewer',
  ] as const)('%s — all sections have at least one item', (persona) => {
    const input = makeInput({ persona });
    const report = generateReviewerReport(input);

    expect(Object.keys(report.sections).length).toBeGreaterThan(0);

    for (const [sectionName, items] of Object.entries(report.sections)) {
      expect(items.length, `Section "${sectionName}" should not be empty`).toBeGreaterThan(0);
    }
  });

  // Test 12: Unknown persona falls back gracefully (returns empty sections)
  it('unknown persona returns empty sections without throwing', () => {
    const input = makeInput({
      persona: 'unknown_persona' as any,
    });

    let report;
    expect(() => {
      report = generateReviewerReport(input);
    }).not.toThrow();

    expect(report).toBeDefined();
    expect(report!.sections).toBeDefined();
    expect(Object.keys(report!.sections)).toHaveLength(0);
  });

  // Additional: product_reviewer with traceability matrix uses COVERED/MISSING markers
  it('product_reviewer — uses ✅/❌ markers when traceability matrix is provided', () => {
    const traceabilityMatrix: TraceabilityMatrix = {
      issueKey: 'TEST-1',
      issueSummary: 'Test issue',
      generatedAt: new Date().toISOString(),
      items: [
        {
          requirementId: 'AC-1',
          requirementText: 'User can log in',
          source: 'acceptance_criteria',
          sourceAuthority: 'high',
          expectedImplementationArea: 'Frontend/UI',
          matchedFiles: ['src/auth/login.ts'],
          matchedDiffEvidence: [],
          matchedTests: ['tests/login.test.ts'],
          coverageStatus: 'COVERED',
          confidence: 'High',
          notes: 'Matched 1 file(s) and 1 test file(s).',
        },
        {
          requirementId: 'AC-2',
          requirementText: 'User sees error on bad password',
          source: 'acceptance_criteria',
          sourceAuthority: 'high',
          expectedImplementationArea: 'Frontend/UI',
          matchedFiles: [],
          matchedDiffEvidence: [],
          matchedTests: [],
          coverageStatus: 'MISSING',
          confidence: 'Low',
          notes: 'No matching files.',
        },
      ],
      totalRequirements: 2,
      covered: 1,
      partial: 0,
      missing: 1,
      notEnoughEvidence: 0,
      notApplicable: 0,
    };

    const input = makeInput({
      persona: 'product_reviewer',
      traceabilityMatrix,
    });

    const report = generateReviewerReport(input);
    const status = report.sections['Acceptance Criteria Status'];

    expect(status).toBeDefined();
    expect(status[0]).toMatch(/^✅/);
    expect(status[0]).toContain('AC-1');
    expect(status[1]).toMatch(/^❌/);
    expect(status[1]).toContain('AC-2');
    expect(status[1]).toContain('MISSING');
  });

  // Additional: security_reviewer with migration adds extra review point
  it('security_reviewer — migration file adds data security review point', () => {
    const classifiedFiles: ClassifiedFiles = {
      ...emptyClassifiedFiles(),
      migrationFiles: [
        { path: 'db/migrations/001_create_users.sql', status: 'added', additions: 10, deletions: 0 },
      ],
    };

    const input = makeInput({
      persona: 'security_reviewer',
      classifiedFiles,
    });

    const report = generateReviewerReport(input);
    const points = report.sections['Required Security Review Points'];

    expect(points).toContain('Database migration requires data security review');
    expect(points.length).toBe(4); // 3 base + 1 migration
  });

  // Additional: release_reviewer with auth risky files adds to checklist
  it('release_reviewer — auth risky files add auth flow check to checklist', () => {
    const classifiedFiles: ClassifiedFiles = {
      ...emptyClassifiedFiles(),
      riskyFiles: [
        {
          file: { path: 'src/auth/jwtService.ts', status: 'modified', additions: 5, deletions: 2 },
          reasons: ['auth_or_permissions'],
        },
      ],
    };

    const input = makeInput({
      persona: 'release_reviewer',
      classifiedFiles,
    });

    const report = generateReviewerReport(input);
    const checklist = report.sections['Release Checklist'];

    expect(checklist).toContain('[ ] Auth flow verified');
  });
});
